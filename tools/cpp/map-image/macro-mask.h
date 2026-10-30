#pragma once
#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

namespace pando::map_image {
inline std::pair<std::vector<std::uint8_t>,std::vector<std::uint8_t>> macroAdjacency(const std::vector<std::uint8_t>& input,int width,int height,int radius){
    if(width<1||height<1||radius<1||radius>4||input.size()!=std::size_t(width)*height)throw std::invalid_argument("Invalid macro adjacency input");
    std::vector<std::uint8_t> target(input.size()),known(input.size());
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        const auto index=std::size_t(y)*width+x;const auto value=input[index];bool interior=value!=0;std::uint8_t first=0;bool different=false;
        for(int sy=std::max(0,y-radius);sy<=std::min(height-1,y+radius);++sy)for(int sx=std::max(0,x-radius);sx<=std::min(width-1,x+radius);++sx){
            const auto other=input[std::size_t(sy)*width+sx];if(other!=value)interior=false;
            if(other){if(!first)first=other;else if(other!=first)different=true;}
        }
        target[index]=!value&&different;known[index]=target[index]||interior;
    }
    return {std::move(target),std::move(known)};
}
inline std::vector<std::uint8_t> macroDilate(const std::vector<std::uint8_t>& input,int width,int height,int radius){
    if(width<1||height<1||radius<1||radius>32||input.size()!=std::size_t(width)*height||
       std::any_of(input.begin(),input.end(),[](std::uint8_t value){return value>1;}))throw std::invalid_argument("Invalid macro dilation input");
    std::vector<std::uint8_t> horizontal(input.size()),target(input.size());
    for(int y=0;y<height;++y){int count=0;for(int x=0;x<std::min(width,radius+1);++x)count+=input[std::size_t(y)*width+x];
        for(int x=0;x<width;++x){horizontal[std::size_t(y)*width+x]=count>0;
            if(x-radius>=0)count-=input[std::size_t(y)*width+x-radius];
            if(x+radius+1<width)count+=input[std::size_t(y)*width+x+radius+1];}}
    for(int x=0;x<width;++x){int count=0;for(int y=0;y<std::min(height,radius+1);++y)count+=horizontal[std::size_t(y)*width+x];
        for(int y=0;y<height;++y){target[std::size_t(y)*width+x]=count>0;
            if(y-radius>=0)count-=horizontal[std::size_t(y-radius)*width+x];
            if(y+radius+1<height)count+=horizontal[std::size_t(y+radius+1)*width+x];}}
    return target;
}
}
