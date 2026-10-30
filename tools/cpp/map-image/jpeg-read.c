#include "image-read.h"
#include <stdio.h>
#include <jpeglib.h>
#include <jerror.h>
#include <math.h>
#include <setjmp.h>
#include <stdlib.h>
#include <string.h>

typedef struct Decoder {
    struct jpeg_decompress_struct jpeg;
    struct jpeg_error_mgr errors;
    jmp_buf jump;
    uint8_t* pixels;
    JSAMPLE* row;
    char error[JMSG_LENGTH_MAX];
} Decoder;
static void failure(j_common_ptr common){
    Decoder* decoder=(Decoder*)common->client_data;
    (*common->err->format_message)(common,decoder->error);
    longjmp(decoder->jump,1);
}
static void message(j_common_ptr common,int level){
    if(level<0&&common->err->msg_code==JWRN_JPEG_EOF)failure(common);
}
static int read_jpeg(const uint8_t* bytes,size_t size,uint32_t maximum_pixels,int inspect_only,PandoImage* result,
    uint32_t* original_width,uint32_t* original_height,uint32_t* bound_width,uint32_t* bound_height,int* output_cmyk){
    Decoder* decoder;unsigned int y,x;int cmyk;
    memset(result,0,sizeof(*result));result->orientation=1;
    decoder=(Decoder*)calloc(1,sizeof(*decoder));if(!decoder){strcpy(result->error,"Out of memory");return 0;}
    decoder->jpeg.err=jpeg_std_error(&decoder->errors);decoder->errors.error_exit=failure;decoder->errors.emit_message=message;
    decoder->jpeg.client_data=decoder;
    if(setjmp(decoder->jump)){
        strncpy(result->error,decoder->error,sizeof(result->error)-1);
        free(decoder->pixels);free(decoder->row);jpeg_destroy_decompress(&decoder->jpeg);free(decoder);return 0;
    }
    jpeg_create_decompress(&decoder->jpeg);decoder->jpeg.client_data=decoder;jpeg_mem_src(&decoder->jpeg,bytes,(unsigned long)size);
    jpeg_save_markers(&decoder->jpeg,JPEG_APP0+1,0xffff);jpeg_read_header(&decoder->jpeg,TRUE);
    if(!decoder->jpeg.image_width||!decoder->jpeg.image_height||
       (!maximum_pixels&&(decoder->jpeg.image_width>16384||decoder->jpeg.image_height>16384||
          (uint64_t)decoder->jpeg.image_width*decoder->jpeg.image_height>16777216))||
       (maximum_pixels&&(uint64_t)decoder->jpeg.image_width*decoder->jpeg.image_height>600000000)){
        strncpy(decoder->error,maximum_pixels?"JPEG exceeds the source pixel budget":"JPEG exceeds the 16MP graph budget",sizeof(decoder->error)-1);longjmp(decoder->jump,1);
    }
    {
        jpeg_saved_marker_ptr marker;
        for(marker=decoder->jpeg.marker_list;marker;marker=marker->next)
            if(marker->marker==JPEG_APP0+1&&marker->data_length>=6&&!memcmp(marker->data,"Exif\0\0",6)){
                result->orientation=pando_exif_orientation(marker->data+6,marker->data_length-6);break;
            }
    }
    if(maximum_pixels){
        const uint32_t w=decoder->jpeg.image_width,h=decoder->jpeg.image_height;
        const uint64_t pixels=(uint64_t)w*h;double ratio;uint32_t bw,bh,scale;
        *original_width=w;*original_height=h;
        if(result->orientation!=1){strncpy(decoder->error,"Current acquired JPEG orientation required",sizeof(decoder->error)-1);longjmp(decoder->jump,1);}
        if(inspect_only||pixels<=maximum_pixels){result->width=w;result->height=h;*bound_width=w;*bound_height=h;*output_cmyk=0;
            jpeg_destroy_decompress(&decoder->jpeg);free(decoder);return 1;}
        ratio=sqrt((double)maximum_pixels/(double)pixels);bw=(uint32_t)floor(w*ratio);bh=(uint32_t)floor(h*ratio);
        if(!bw)bw=1;if(!bh)bh=1;*bound_width=bw;*bound_height=bh;
        scale=w/bw<h/bh?w/bw:h/bh;decoder->jpeg.scale_num=1;decoder->jpeg.scale_denom=scale>=8?8:scale>=4?4:scale>=2?2:1;
        jpeg_calc_output_dimensions(&decoder->jpeg);
        if((uint64_t)decoder->jpeg.output_width*decoder->jpeg.output_height>16777216){
            strncpy(decoder->error,"Draft JPEG exceeds the 16MP working budget",sizeof(decoder->error)-1);longjmp(decoder->jump,1);}
    }
    cmyk=decoder->jpeg.jpeg_color_space==JCS_CMYK||decoder->jpeg.jpeg_color_space==JCS_YCCK;
    if(maximum_pixels)*output_cmyk=cmyk;
    decoder->jpeg.out_color_space=cmyk?JCS_CMYK:JCS_RGB;jpeg_start_decompress(&decoder->jpeg);
    if(decoder->jpeg.output_components!=(cmyk?4:3)){
        strncpy(decoder->error,"Unexpected JPEG pixel layout",sizeof(decoder->error)-1);longjmp(decoder->jump,1);
    }
    decoder->row=(JSAMPLE*)malloc((size_t)decoder->jpeg.output_width*decoder->jpeg.output_components);
    decoder->pixels=(uint8_t*)malloc((size_t)decoder->jpeg.output_width*decoder->jpeg.output_height*4);
    if(!decoder->row||!decoder->pixels){strncpy(decoder->error,"JPEG allocation failed",sizeof(decoder->error)-1);longjmp(decoder->jump,1);}
    for(y=0;y<decoder->jpeg.output_height;y++){
        JSAMPROW rows[1]={decoder->row};
        if(jpeg_read_scanlines(&decoder->jpeg,rows,1)!=1){strncpy(decoder->error,"Truncated JPEG input",sizeof(decoder->error)-1);longjmp(decoder->jump,1);}
        for(x=0;x<decoder->jpeg.output_width;x++){
            const JSAMPLE* source=decoder->row+x*(cmyk?4:3);uint8_t* dest=decoder->pixels+((size_t)y*decoder->jpeg.output_width+x)*4;int c;
            for(c=0;c<3;c++)dest[c]=cmyk?(maximum_pixels?(uint8_t)(255-source[c]):(uint8_t)(source[3]-((255-source[c])*source[3]+127)/255)):source[c];
            dest[3]=cmyk&&maximum_pixels?(uint8_t)(255-source[3]):255;
        }
    }
    jpeg_finish_decompress(&decoder->jpeg);
    result->width=decoder->jpeg.output_width;result->height=decoder->jpeg.output_height;result->rgba=decoder->pixels;decoder->pixels=NULL;
    free(decoder->row);jpeg_destroy_decompress(&decoder->jpeg);free(decoder);return 1;
}
int pando_read_jpeg(const uint8_t* bytes,size_t size,PandoImage* result){return read_jpeg(bytes,size,0,0,result,NULL,NULL,NULL,NULL,NULL);}
int pando_read_jpeg_draft(const uint8_t* bytes,size_t size,uint32_t maximum_pixels,int inspect_only,PandoImage* result,
    uint32_t* original_width,uint32_t* original_height,uint32_t* bound_width,uint32_t* bound_height,int* cmyk){
    if(!maximum_pixels){memset(result,0,sizeof(*result));strcpy(result->error,"Positive pixel budget required");return 0;}
    return read_jpeg(bytes,size,maximum_pixels,inspect_only,result,original_width,original_height,bound_width,bound_height,cmyk);
}

typedef struct Encoder {
    struct jpeg_compress_struct jpeg;struct jpeg_error_mgr errors;jmp_buf jump;
    uint8_t* row;unsigned char* output;unsigned long size;char error[JMSG_LENGTH_MAX];
} Encoder;
static void encoder_failure(j_common_ptr common){Encoder* encoder=(Encoder*)common->client_data;
    (*common->err->format_message)(common,encoder->error);longjmp(encoder->jump,1);}
int pando_write_jpeg(const uint8_t* rgba,uint32_t width,uint32_t height,uint8_t** bytes,size_t* size,char* error,size_t error_size){
    Encoder* encoder=(Encoder*)calloc(1,sizeof(*encoder));uint32_t x;
    if(!encoder){snprintf(error,error_size,"JPEG allocation failed");return 0;}
    encoder->jpeg.err=jpeg_std_error(&encoder->errors);encoder->errors.error_exit=encoder_failure;encoder->jpeg.client_data=encoder;
    if(setjmp(encoder->jump)){snprintf(error,error_size,"%s",encoder->error);free(encoder->row);free(encoder->output);
        jpeg_destroy_compress(&encoder->jpeg);free(encoder);return 0;}
    jpeg_create_compress(&encoder->jpeg);encoder->jpeg.client_data=encoder;jpeg_mem_dest(&encoder->jpeg,&encoder->output,&encoder->size);
    encoder->jpeg.image_width=width;encoder->jpeg.image_height=height;encoder->jpeg.input_components=3;encoder->jpeg.in_color_space=JCS_RGB;
    jpeg_set_defaults(&encoder->jpeg);jpeg_set_quality(&encoder->jpeg,95,TRUE);jpeg_start_compress(&encoder->jpeg,TRUE);
    encoder->row=(uint8_t*)malloc((size_t)width*3);if(!encoder->row){snprintf(encoder->error,sizeof(encoder->error),"JPEG allocation failed");longjmp(encoder->jump,1);}
    while(encoder->jpeg.next_scanline<height){JSAMPROW rows[1]={encoder->row};const size_t y=encoder->jpeg.next_scanline;
        for(x=0;x<width;x++){const uint8_t* src=rgba+(y*width+x)*4;uint8_t* dst=encoder->row+(size_t)x*3;dst[0]=src[0];dst[1]=src[1];dst[2]=src[2];}
        jpeg_write_scanlines(&encoder->jpeg,rows,1);
    }
    jpeg_finish_compress(&encoder->jpeg);*bytes=encoder->output;*size=encoder->size;encoder->output=NULL;
    free(encoder->row);jpeg_destroy_compress(&encoder->jpeg);free(encoder);return 1;
}
