#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace pando::map_image {
struct ImageInput {
    int encodedWidth,encodedHeight,orientation,originalWidth,originalHeight;
    int x,y,rectWidth,rectHeight,width,height;
    std::vector<std::uint8_t> data;
};
ImageInput readImage(const std::vector<std::uint8_t>& encoded,const std::string& format,int maximumPixels,int x,int y,int width,int height);
}
