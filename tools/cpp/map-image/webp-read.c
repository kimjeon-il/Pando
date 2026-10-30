#include "image-read.h"
#include <webp/decode.h>
#include <webp/demux.h>
#include <stdlib.h>
#include <string.h>

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
