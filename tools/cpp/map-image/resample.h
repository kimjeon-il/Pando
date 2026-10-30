#pragma once
#include <cstdint>
#include <vector>

namespace pando::map_image {
// Opaque, interleaved 8-bit RGB. Image dimensions are capped to the map graph budget.
std::vector<std::uint8_t> resizeRgb(const std::vector<std::uint8_t>& input,
    int width,int height,int outputWidth,int outputHeight);
}
