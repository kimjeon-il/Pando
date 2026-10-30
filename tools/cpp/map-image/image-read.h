#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct PandoImage {
    uint32_t width,height,orientation;
    uint8_t* rgba;
    char error[256];
} PandoImage;
uint32_t pando_exif_orientation(const uint8_t* data,size_t size);
int pando_read_png(const uint8_t* bytes,size_t size,PandoImage* result);
int pando_read_gray_mask(const uint8_t* bytes,size_t size,PandoImage* result);
int pando_inspect_png(const uint8_t* bytes,size_t size,PandoImage* result);
int pando_read_jpeg(const uint8_t* bytes,size_t size,PandoImage* result);
int pando_inspect_jpeg(const uint8_t* bytes,size_t size,PandoImage* result);
typedef int (*PandoImageRowStart)(void* context,uint32_t width,uint32_t height,uint32_t orientation);
typedef int (*PandoImageRowConsumer)(void* context,uint32_t y,const uint8_t* rgba,size_t length);
int pando_stream_jpeg_rows(const uint8_t* bytes,size_t size,PandoImage* result,
    PandoImageRowStart start,PandoImageRowConsumer consume,void* context);
int pando_stream_png_rows(const uint8_t* bytes,size_t size,PandoImage* result,
    PandoImageRowStart start,PandoImageRowConsumer consume,void* context);
int pando_read_jpeg_draft(const uint8_t* bytes,size_t size,uint32_t maximum_pixels,int inspect_only,PandoImage* result,
    uint32_t* original_width,uint32_t* original_height,uint32_t* bound_width,uint32_t* bound_height,int* cmyk);
int pando_write_jpeg(const uint8_t* rgba,uint32_t width,uint32_t height,uint8_t** bytes,size_t* size,char* error,size_t error_size);
int pando_write_jpeg_quality(const uint8_t* rgba,uint32_t width,uint32_t height,int quality,uint8_t** bytes,size_t* size,char* error,size_t error_size);
int pando_read_webp(const uint8_t* bytes,size_t size,PandoImage* result);
int pando_inspect_webp(const uint8_t* bytes,size_t size,PandoImage* result);
int pando_stream_webp_rows(const uint8_t* bytes,size_t size,PandoImage* result,
    PandoImageRowStart start,PandoImageRowConsumer consume,void* context);
#ifdef __cplusplus
}
#endif
