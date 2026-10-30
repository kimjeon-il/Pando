#pragma once
#include <cstdint>
#include <vector>
namespace pando::map_image {
std::vector<std::uint8_t> encodePngRgba(const std::vector<std::uint8_t>& input,int width,int height);
std::vector<std::uint8_t> encodePngGray(const std::vector<std::uint8_t>& input,int width,int height);
}
