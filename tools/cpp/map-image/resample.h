#pragma once
#include <cstdint>
#include <vector>

namespace pando::map_image {
// Opaque, interleaved 8-bit RGB. Image dimensions are capped to the map graph budget.
std::vector<std::uint8_t> resizeRgb(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
// Straight-alpha RGBA; color is premultiplied during filtering.
std::vector<std::uint8_t> resizeRgba(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
// Pillow's two-stage thumbnail reduction for opaque RGB PDF pages.
std::vector<std::uint8_t> resizeOpaqueThumbnail(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
std::vector<std::uint8_t> rotateRgba(const std::vector<std::uint8_t>& input,
    int width,int height,int clockwiseDegrees);
}
