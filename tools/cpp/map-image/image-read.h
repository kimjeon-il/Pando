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
int pando_read_jpeg(const uint8_t* bytes,size_t size,PandoImage* result);
int pando_read_webp(const uint8_t* bytes,size_t size,PandoImage* result);
#ifdef __cplusplus
}
#endif
