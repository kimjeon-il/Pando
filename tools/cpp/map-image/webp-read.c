#include "image-read.h"
#include <webp/decode.h>
#include <webp/demux.h>
#include <stdlib.h>
#include <string.h>

int pando_inspect_webp(const uint8_t* bytes,size_t size,PandoImage* result){
    WebPData data;WebPDemuxer* demux;WebPChunkIterator exif;uint32_t width,height;
    memset(result,0,sizeof(*result));result->orientation=1;data.bytes=bytes;data.size=size;demux=WebPDemux(&data);
    if(!demux){strcpy(result->error,"Invalid or truncated WebP");return 0;}
    width=WebPDemuxGetI(demux,WEBP_FF_CANVAS_WIDTH);height=WebPDemuxGetI(demux,WEBP_FF_CANVAS_HEIGHT);
    if(!width||!height||(uint64_t)width*height>600000000){strcpy(result->error,"WebP exceeds the source pixel budget");WebPDemuxDelete(demux);return 0;}
    if(WebPDemuxGetChunk(demux,"EXIF",1,&exif)){const uint8_t* p=exif.chunk.bytes;size_t n=exif.chunk.size;
        if(n>=6&&!memcmp(p,"Exif\0\0",6)){p+=6;n-=6;}result->orientation=pando_exif_orientation(p,n);WebPDemuxReleaseChunkIterator(&exif);}
    result->width=width;result->height=height;WebPDemuxDelete(demux);return 1;
}
int pando_read_webp(const uint8_t* bytes,size_t size,PandoImage* result){
    WebPData data;WebPDemuxer* demux=NULL;WebPAnimDecoder* animation=NULL;
    WebPChunkIterator exif;uint8_t* pixels=NULL;uint32_t width,height;size_t length;
    memset(result,0,sizeof(*result));result->orientation=1;
    data.bytes=bytes;data.size=size;
    demux=WebPDemux(&data);
    if(!demux){strcpy(result->error,"Invalid or truncated WebP");goto fail;}
    width=WebPDemuxGetI(demux,WEBP_FF_CANVAS_WIDTH);height=WebPDemuxGetI(demux,WEBP_FF_CANVAS_HEIGHT);
    if(!width||!height||width>16384||height>16384||(uint64_t)width*height>16777216){
        strcpy(result->error,"WebP exceeds the 16MP graph budget");goto fail;
    }
    if(WebPDemuxGetChunk(demux,"EXIF",1,&exif)){
        const uint8_t* payload=exif.chunk.bytes;size_t payload_size=exif.chunk.size;
        if(payload_size>=6&&!memcmp(payload,"Exif\0\0",6)){payload+=6;payload_size-=6;}
        result->orientation=pando_exif_orientation(payload,payload_size);
        WebPDemuxReleaseChunkIterator(&exif);
    }
    length=(size_t)width*height*4;pixels=(uint8_t*)malloc(length);
    if(!pixels){strcpy(result->error,"WebP allocation failed");goto fail;}
    if(WebPDemuxGetI(demux,WEBP_FF_FORMAT_FLAGS)&ANIMATION_FLAG){
        WebPAnimDecoderOptions options;uint8_t* frame=NULL;int timestamp=0;
        if(!WebPAnimDecoderOptionsInit(&options)){strcpy(result->error,"WebP decoder ABI mismatch");goto fail;}
        options.color_mode=MODE_RGBA;options.use_threads=0;
        animation=WebPAnimDecoderNew(&data,&options);
        if(!animation||!WebPAnimDecoderGetNext(animation,&frame,&timestamp)){
            strcpy(result->error,"Invalid WebP animation frame");goto fail;
        }
        memcpy(pixels,frame,length);
    }else if(!WebPDecodeRGBAInto(bytes,size,pixels,length,(int)width*4)){
        strcpy(result->error,"Invalid WebP pixels");goto fail;
    }
    result->width=width;result->height=height;result->rgba=pixels;
    if(animation)WebPAnimDecoderDelete(animation);
    WebPDemuxDelete(demux);return 1;
fail:
    free(pixels);if(animation)WebPAnimDecoderDelete(animation);if(demux)WebPDemuxDelete(demux);return 0;
}

int pando_stream_webp_rows(const uint8_t* bytes,size_t size,PandoImage* result,
    PandoImageRowStart start,PandoImageRowConsumer consume,void* context){
    WebPData data;WebPDemuxer* demux;uint8_t* pixels=NULL;uint32_t y,row,count,width,height,top,bottom;
    if(!start||!consume){memset(result,0,sizeof(*result));strcpy(result->error,"WebP row callbacks required");return 0;}
    if(!pando_inspect_webp(bytes,size,result))return 0;
    width=result->width;height=result->height;data.bytes=bytes;data.size=size;
    demux=WebPDemux(&data);if(!demux){strcpy(result->error,"Invalid or truncated WebP");return 0;}
    if(WebPDemuxGetI(demux,WEBP_FF_FORMAT_FLAGS)&ANIMATION_FLAG){
        WebPDemuxDelete(demux);
        if(!pando_read_webp(bytes,size,result))return 0;
        if(!start(context,width,height,result->orientation)){
            free(result->rgba);result->rgba=NULL;strcpy(result->error,"WebP row consumer initialization failed");return 0;
        }
        for(y=0;y<height;y++)if(!consume(context,y,result->rgba+(size_t)y*width*4,(size_t)width*4)){
            free(result->rgba);result->rgba=NULL;strcpy(result->error,"WebP row consumer failed");return 0;
        }
        free(result->rgba);result->rgba=NULL;return 1;
    }
    WebPDemuxDelete(demux);
    if(!start(context,width,height,result->orientation)){strcpy(result->error,"WebP row consumer initialization failed");return 0;}
    /* Lossy WebP filtering needs neighboring macroblocks at crop boundaries. */
    pixels=(uint8_t*)malloc((size_t)width*(height<576?height:576)*4);
    if(!pixels){strcpy(result->error,"WebP row allocation failed");return 0;}
    for(y=0;y<height;y+=count){
        WebPDecoderConfig config;VP8StatusCode status;count=height-y<512?height-y:512;
        top=y>32?y-32:0;bottom=height-y-count<32?height:y+count+32;
        if(!WebPInitDecoderConfig(&config)){strcpy(result->error,"WebP decoder ABI mismatch");free(pixels);return 0;}
        config.options.use_cropping=1;config.options.crop_left=0;config.options.crop_top=(int)top;
        config.options.crop_width=(int)width;config.options.crop_height=(int)(bottom-top);
        config.output.colorspace=MODE_RGBA;config.output.is_external_memory=1;
        config.output.u.RGBA.rgba=pixels;config.output.u.RGBA.stride=(int)width*4;
        config.output.u.RGBA.size=(size_t)width*(bottom-top)*4;
        status=WebPDecode(bytes,size,&config);WebPFreeDecBuffer(&config.output);
        if(status!=VP8_STATUS_OK){strcpy(result->error,"Invalid WebP pixels");free(pixels);return 0;}
        for(row=0;row<count;row++)if(!consume(context,y+row,pixels+(size_t)(y-top+row)*width*4,(size_t)width*4)){
            strcpy(result->error,"WebP row consumer failed");free(pixels);return 0;
        }
    }
    free(pixels);return 1;
}
