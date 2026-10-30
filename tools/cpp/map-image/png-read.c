#include "image-read.h"
#include <png.h>
#include <stdlib.h>
#include <string.h>

typedef struct Decoder {
    const uint8_t* bytes;size_t size,offset;
    uint8_t* pixels;uint8_t* output;png_bytep* rows;
    char error[256];
} Decoder;
static void failure(png_structp png,png_const_charp message){
    Decoder* decoder=(Decoder*)png_get_error_ptr(png);
    if(decoder){strncpy(decoder->error,message,sizeof(decoder->error)-1);decoder->error[sizeof(decoder->error)-1]=0;}
    png_longjmp(png,1);
}
static void warning(png_structp png,png_const_charp message){(void)png;(void)message;}
static void input(png_structp png,png_bytep target,png_size_t length){
    Decoder* decoder=(Decoder*)png_get_io_ptr(png);
    if(length>decoder->size-decoder->offset)png_error(png,"Truncated PNG input");
    memcpy(target,decoder->bytes+decoder->offset,length);decoder->offset+=length;
}
static uint16_t short_at(const uint8_t* p,int little){return little?(uint16_t)(p[0]|p[1]<<8):(uint16_t)(p[0]<<8|p[1]);}
static uint32_t long_at(const uint8_t* p,int little){return little?(uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24:
    (uint32_t)p[0]<<24|(uint32_t)p[1]<<16|(uint32_t)p[2]<<8|(uint32_t)p[3];}
uint32_t pando_exif_orientation(const uint8_t* data,size_t size){
    int little;uint32_t offset;uint16_t entries;size_t i;
    if(size<8)return 1;
    if(data[0]=='I'&&data[1]=='I')little=1;else if(data[0]=='M'&&data[1]=='M')little=0;else return 1;
    if(short_at(data+2,little)!=42)return 1;
    offset=long_at(data+4,little);if(offset>size-2)return 1;
    entries=short_at(data+offset,little);offset+=2;
    if(entries>(size-offset)/12)return 1;
    for(i=0;i<entries;i++){
        const uint8_t* entry=data+offset+i*12;
        if(short_at(entry,little)==274&&short_at(entry+2,little)==3&&long_at(entry+4,little)==1)
            return short_at(entry+8,little);
    }
    return 1;
}
int pando_inspect_png(const uint8_t* bytes,size_t size,PandoImage* result){
    Decoder* decoder;png_structp png;png_infop info;png_uint_32 width,height,exif_size=0;png_bytep exif=NULL;
    memset(result,0,sizeof(*result));result->orientation=1;
    decoder=(Decoder*)calloc(1,sizeof(*decoder));if(!decoder){strcpy(result->error,"Out of memory");return 0;}
    decoder->bytes=bytes;decoder->size=size;png=png_create_read_struct(PNG_LIBPNG_VER_STRING,decoder,failure,warning);
    if(!png){free(decoder);strcpy(result->error,"PNG decoder unavailable");return 0;}
    info=png_create_info_struct(png);if(!info){png_destroy_read_struct(&png,NULL,NULL);free(decoder);strcpy(result->error,"PNG metadata unavailable");return 0;}
    if(setjmp(png_jmpbuf(png))){strncpy(result->error,decoder->error,sizeof(result->error)-1);png_destroy_read_struct(&png,&info,NULL);free(decoder);return 0;}
    png_set_read_fn(png,decoder,input);png_set_user_limits(png,600000000,600000000);png_read_info(png,info);
    png_get_IHDR(png,info,&width,&height,NULL,NULL,NULL,NULL,NULL);
    if(!width||!height||(uint64_t)width*height>600000000)png_error(png,"PNG exceeds the source pixel budget");
    if(png_get_eXIf_1(png,info,&exif_size,&exif)&&exif)result->orientation=pando_exif_orientation(exif,exif_size);
    result->width=width;result->height=height;png_destroy_read_struct(&png,&info,NULL);free(decoder);return 1;
}
static int read_gray_mask(const uint8_t* bytes,size_t size,PandoImage* result,
    PandoImageRowStart start,PandoImageRowConsumer consume,void* context){
    Decoder* decoder;png_structp png;png_infop info;int depth,color;
    memset(result,0,sizeof(*result));decoder=(Decoder*)calloc(1,sizeof(*decoder));
    if(!decoder){strcpy(result->error,"Out of memory");return 0;}decoder->bytes=bytes;decoder->size=size;
    png=png_create_read_struct(PNG_LIBPNG_VER_STRING,decoder,failure,warning);
    if(!png){free(decoder);strcpy(result->error,"PNG decoder unavailable");return 0;}
    info=png_create_info_struct(png);if(!info){png_destroy_read_struct(&png,NULL,NULL);free(decoder);strcpy(result->error,"PNG metadata unavailable");return 0;}
    if(setjmp(png_jmpbuf(png))){strncpy(result->error,decoder->error,sizeof(result->error)-1);png_destroy_read_struct(&png,&info,NULL);free(decoder);return 0;}
    png_set_read_fn(png,decoder,input);png_set_user_limits(png,consume?65535:16384,consume?65535:16384);png_read_info(png,info);
    depth=png_get_bit_depth(png,info);color=png_get_color_type(png,info);
    if(depth!=8||color!=PNG_COLOR_TYPE_GRAY)png_error(png,"Training mask must be 8-bit grayscale");
    png_destroy_read_struct(&png,&info,NULL);free(decoder);
    return consume?pando_stream_png_rows(bytes,size,result,start,consume,context):pando_read_png(bytes,size,result);
}
int pando_read_gray_mask(const uint8_t* bytes,size_t size,PandoImage* result){return read_gray_mask(bytes,size,result,NULL,NULL,NULL);}
int pando_stream_gray_mask(const uint8_t* bytes,size_t size,PandoImage* result,
    PandoImageRowStart start,PandoImageRowConsumer consume,void* context){
    if(!start||!consume){memset(result,0,sizeof(*result));strcpy(result->error,"PNG row callbacks required");return 0;}
    return read_gray_mask(bytes,size,result,start,consume,context);
}
static int read_png(const uint8_t* bytes,size_t size,PandoImage* result,
    PandoImageRowStart start,PandoImageRowConsumer consume,void* context,uint64_t full_budget){
    Decoder* decoder;png_structp png;png_infop info;png_uint_32 width,height;int color,depth,interlace,has_alpha;size_t y,x,rowbytes;
    png_uint_32 exif_size=0;png_bytep exif=NULL;
    memset(result,0,sizeof(*result));result->orientation=1;
    decoder=(Decoder*)calloc(1,sizeof(*decoder));if(!decoder){strcpy(result->error,"Out of memory");return 0;}
    decoder->bytes=bytes;decoder->size=size;
    png=png_create_read_struct(PNG_LIBPNG_VER_STRING,decoder,failure,warning);
    if(!png){free(decoder);strcpy(result->error,"PNG decoder unavailable");return 0;}
    info=png_create_info_struct(png);
    if(!info){png_destroy_read_struct(&png,NULL,NULL);free(decoder);strcpy(result->error,"PNG metadata unavailable");return 0;}
    if(setjmp(png_jmpbuf(png))){
        strncpy(result->error,decoder->error,sizeof(result->error)-1);
        free(decoder->pixels);free(decoder->output);free(decoder->rows);png_destroy_read_struct(&png,&info,NULL);free(decoder);return 0;
    }
    png_set_read_fn(png,decoder,input);png_set_user_limits(png,(consume||full_budget>16777216)?65535:16384,(consume||full_budget>16777216)?65535:16384);png_read_info(png,info);
    png_get_IHDR(png,info,&width,&height,&depth,&color,&interlace,NULL,NULL);
    if(!width||!height||(uint64_t)width*height>(consume?600000000:full_budget))
        png_error(png,consume?"PNG exceeds the source pixel budget":full_budget==16777216?"PNG exceeds the 16MP graph budget":"PNG exceeds the interlaced decoder pixel budget");
    if(png_get_eXIf_1(png,info,&exif_size,&exif)&&exif)result->orientation=pando_exif_orientation(exif,exif_size);
    if(consume&&(result->orientation<1||result->orientation>8))png_error(png,"Invalid streaming PNG orientation");
    if(consume&&interlace!=PNG_INTERLACE_NONE){
        /* Bound the full Adam7 decoder until incremental pass handling is available. */
        png_destroy_read_struct(&png,&info,NULL);free(decoder);
        if(!read_png(bytes,size,result,NULL,NULL,NULL,64000000))return 0;
        if(!start(context,result->width,result->height,result->orientation)){
            free(result->rgba);result->rgba=NULL;strcpy(result->error,"PNG row consumer initialization failed");return 0;
        }
        for(y=0;y<result->height;y++)if(!consume(context,(uint32_t)y,result->rgba+y*(size_t)result->width*4,(size_t)result->width*4)){
            free(result->rgba);result->rgba=NULL;strcpy(result->error,"PNG row consumer failed");return 0;
        }
        free(result->rgba);result->rgba=NULL;return 1;
    }
    has_alpha=(color&PNG_COLOR_MASK_ALPHA)!=0||png_get_valid(png,info,PNG_INFO_tRNS);
    if(color==PNG_COLOR_TYPE_PALETTE)png_set_palette_to_rgb(png);
    if(color==PNG_COLOR_TYPE_GRAY&&depth<8)png_set_expand_gray_1_2_4_to_8(png);
    if(png_get_valid(png,info,PNG_INFO_tRNS))png_set_tRNS_to_alpha(png);
    if(color==PNG_COLOR_TYPE_GRAY||color==PNG_COLOR_TYPE_GRAY_ALPHA)png_set_gray_to_rgb(png);
    if(!has_alpha)png_set_add_alpha(png,depth==16?65535:255,PNG_FILLER_AFTER);
    png_set_interlace_handling(png);png_read_update_info(png,info);
    rowbytes=png_get_rowbytes(png,info);
    if(rowbytes!=(size_t)width*(depth==16?8:4))png_error(png,"Unexpected PNG pixel layout");
    decoder->pixels=(uint8_t*)malloc(rowbytes*(consume?1:height));
    decoder->output=(uint8_t*)malloc((size_t)width*(consume?1:height)*4);
    if(!consume)decoder->rows=(png_bytep*)malloc(sizeof(png_bytep)*height);
    if(!decoder->pixels||!decoder->output||(!consume&&!decoder->rows))png_error(png,"PNG allocation failed");
    if(consume){
        if(!start(context,width,height,result->orientation))png_error(png,"PNG row consumer initialization failed");
        for(y=0;y<height;y++){
            png_read_row(png,decoder->pixels,NULL);
            for(x=0;x<width;x++){
                const uint8_t* source=decoder->pixels+x*(depth==16?8:4);uint8_t* dest=decoder->output+x*4;int c;
                for(c=0;c<4;c++)dest[c]=depth==16?(color==PNG_COLOR_TYPE_GRAY&&c<3?(source[c*2]?255:source[c*2+1]):source[c*2]):source[c];
            }
            if(!consume(context,(uint32_t)y,decoder->output,(size_t)width*4))png_error(png,"PNG row consumer failed");
        }
    }else{
        for(y=0;y<height;y++)decoder->rows[y]=decoder->pixels+y*rowbytes;
        png_read_image(png,decoder->rows);
        for(y=0;y<height;y++)for(x=0;x<width;x++){
            const uint8_t* source=decoder->pixels+y*rowbytes+x*(depth==16?8:4);uint8_t* dest=decoder->output+(y*width+x)*4;int c;
            for(c=0;c<4;c++)dest[c]=depth==16?(color==PNG_COLOR_TYPE_GRAY&&c<3?(source[c*2]?255:source[c*2+1]):source[c*2]):source[c];
        }
    }
    png_read_end(png,info);
    result->width=width;result->height=height;
    if(consume){free(decoder->output);decoder->output=NULL;}else{result->rgba=decoder->output;decoder->output=NULL;}
    free(decoder->pixels);free(decoder->rows);png_destroy_read_struct(&png,&info,NULL);free(decoder);return 1;
}
int pando_read_png(const uint8_t* bytes,size_t size,PandoImage* result){return read_png(bytes,size,result,NULL,NULL,NULL,16777216);}
int pando_stream_png_rows(const uint8_t* bytes,size_t size,PandoImage* result,
    PandoImageRowStart start,PandoImageRowConsumer consume,void* context){
    if(!start||!consume){memset(result,0,sizeof(*result));strcpy(result->error,"PNG row callbacks required");return 0;}
    return read_png(bytes,size,result,start,consume,context,16777216);
}
