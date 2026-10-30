#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <utility>
#include <vector>

namespace pando::map_image {
struct MacroFinished {int width,height;std::vector<std::uint8_t> image,target,known;};
inline MacroFinished macroFinish(const std::vector<std::uint8_t>& image,std::vector<std::uint8_t> target,
        std::vector<std::uint8_t> known,int width,int height,int rotation,
        const std::vector<std::array<std::int32_t,4>>& glyphs,const std::vector<std::array<std::int32_t,4>>& exclusions){
    const auto pixels=std::size_t(width)*height;
    if(width<1||height<1||image.size()!=pixels*3||target.size()!=pixels||known.size()!=pixels||
       (rotation!=0&&rotation!=90&&rotation!=180&&rotation!=270))throw std::invalid_argument("Invalid macro finish dimensions or rotation");
    for(const auto& r:glyphs){
        if(r[0]>r[2]||r[1]>r[3])throw std::invalid_argument("Invalid macro glyph rectangle");
        const int x0=std::max(0,r[0]),y0=std::max(0,r[1]),x1=std::min(width-1,r[2]),y1=std::min(height-1,r[3]);
        for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x)target[std::size_t(y)*width+x]=known[std::size_t(y)*width+x]=0;
    }
    const bool swap=rotation==90||rotation==270;const int outWidth=swap?height:width,outHeight=swap?width:height;
    MacroFinished out{outWidth,outHeight,std::vector<std::uint8_t>(pixels*3),std::vector<std::uint8_t>(pixels),std::vector<std::uint8_t>(pixels)};
    for(int y=0;y<height;++y)for(int x=0;x<width;++x){
        const int ox=rotation==90?height-1-y:rotation==180?width-1-x:rotation==270?y:x;
        const int oy=rotation==90?x:rotation==180?height-1-y:rotation==270?width-1-x:y;
        const auto from=std::size_t(y)*width+x,to=std::size_t(oy)*outWidth+ox;
        std::copy_n(image.data()+from*3,3,out.image.data()+to*3);out.target[to]=target[from];out.known[to]=known[from];
    }
    for(const auto& r:exclusions){
        if(r[0]<0||r[1]<0||r[0]>=r[2]||r[1]>=r[3]||r[2]>outWidth||r[3]>outHeight)
            throw std::invalid_argument("Invalid macro exclusion rectangle");
        for(int y=r[1];y<r[3];++y)for(int x=r[0];x<r[2];++x)out.target[std::size_t(y)*outWidth+x]=out.known[std::size_t(y)*outWidth+x]=0;
    }
    return out;
}
inline std::vector<std::uint8_t> macroClassify(const std::vector<std::uint8_t>& rgb,int width,int height,
        const std::vector<std::array<double,3>>& colors,bool visible){
    if(width<1||height<1||rgb.size()!=std::size_t(width)*height*3||colors.empty()||
       colors.size()>(visible?1024u:16u)||(!visible&&colors.size()<2))throw std::invalid_argument("Invalid macro color palette");
    for(const auto& color:colors)for(const double value:color)
        if(!std::isfinite(value)||value<0||value>1)throw std::invalid_argument("Invalid macro color palette");
    std::vector<std::uint8_t> output(std::size_t(width)*height);
    for(std::size_t pixel=0;pixel<output.size();++pixel){
        std::array<float,3> source{};for(int c=0;c<3;++c)source[c]=static_cast<float>(rgb[pixel*3+c])/255.0f;
        float nearest=std::numeric_limits<float>::infinity();
        for(std::size_t i=0;i<colors.size();++i){
            if(visible){
                double distance=0;for(int c=0;c<3;++c)distance=std::max(distance,std::abs(static_cast<double>(source[c])-colors[i][c]));
                if(distance<=0.15){output[pixel]=1;break;}
            }else{
                float distance=0;for(int c=0;c<3;++c)distance=std::max(distance,std::abs(source[c]-static_cast<float>(colors[i][c])));
                if(distance<nearest&&distance<=static_cast<float>(2.5/255)){nearest=distance;output[pixel]=static_cast<std::uint8_t>(i+1);}
            }
        }
    }
    return output;
}
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
