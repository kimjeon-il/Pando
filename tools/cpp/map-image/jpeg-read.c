#include "image-read.h"
#include <stdio.h>
#include <jpeglib.h>
#include <jerror.h>
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
int pando_read_jpeg(const uint8_t* bytes,size_t size,PandoImage* result){
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
    if(!decoder->jpeg.image_width||!decoder->jpeg.image_height||decoder->jpeg.image_width>16384||decoder->jpeg.image_height>16384||
       (uint64_t)decoder->jpeg.image_width*decoder->jpeg.image_height>16777216){
        strncpy(decoder->error,"JPEG exceeds the 16MP graph budget",sizeof(decoder->error)-1);longjmp(decoder->jump,1);
    }
    {
        jpeg_saved_marker_ptr marker;
        for(marker=decoder->jpeg.marker_list;marker;marker=marker->next)
            if(marker->marker==JPEG_APP0+1&&marker->data_length>=6&&!memcmp(marker->data,"Exif\0\0",6)){
                result->orientation=pando_exif_orientation(marker->data+6,marker->data_length-6);break;
            }
    }
    cmyk=decoder->jpeg.jpeg_color_space==JCS_CMYK||decoder->jpeg.jpeg_color_space==JCS_YCCK;
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
            for(c=0;c<3;c++)dest[c]=cmyk?(uint8_t)(source[3]-((255-source[c])*source[3]+127)/255):source[c];
            dest[3]=255;
        }
    }
    jpeg_finish_decompress(&decoder->jpeg);
    result->width=decoder->jpeg.output_width;result->height=decoder->jpeg.output_height;result->rgba=decoder->pixels;decoder->pixels=NULL;
    free(decoder->row);jpeg_destroy_decompress(&decoder->jpeg);free(decoder);return 1;
}
