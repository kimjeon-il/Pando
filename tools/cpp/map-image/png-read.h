#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct PandoPngImage {
    uint32_t width,height,orientation;
    uint8_t* rgba;
    char error[256];
} PandoPngImage;
int pando_read_png(const uint8_t* bytes,size_t size,PandoPngImage* result);
#ifdef __cplusplus
}
#endif
