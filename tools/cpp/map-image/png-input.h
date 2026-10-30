#pragma once
#include <cstdint>
#include <vector>
namespace pando::map_image {
struct PngInput {
    int encodedWidth,encodedHeight,orientation,originalWidth,originalHeight;
    int x,y,rectWidth,rectHeight,width,height;
    std::vector<std::uint8_t> data;
};
PngInput readPng(const std::vector<std::uint8_t>& encoded,int maximumPixels,int x,int y,int width,int height);
}
