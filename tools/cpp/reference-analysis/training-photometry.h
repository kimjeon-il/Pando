#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace pando::reference {
// Pillow 12.3 RGB conversion and ImageEnhance blend semantics; see the
// Pillow license in ../map-preview/PILLOW-LICENSE.
inline std::uint8_t trainingGray(const std::uint8_t* pixel){
    return static_cast<std::uint8_t>((std::uint32_t(pixel[0])*19595U+std::uint32_t(pixel[1])*38470U+std::uint32_t(pixel[2])*7471U+32768U)>>16);
}
inline std::uint8_t trainingBlend(std::uint8_t base,std::uint8_t value,float factor){
    const float mixed=float(base)+factor*(int(value)-int(base));
    return static_cast<std::uint8_t>(std::max(0.f,std::min(255.f,mixed)));
}
inline std::vector<std::uint8_t> applyTrainingPhotometry(const std::vector<std::uint8_t>& input,int width,int height,
    bool gray,double contrast,double brightness,double saturation){
    if(width<1||height<1||std::uint64_t(width)*height>16777216||input.size()!=std::size_t(width)*height*3||
       !std::isfinite(contrast)||!std::isfinite(brightness)||!std::isfinite(saturation)||contrast<=0||brightness<=0||saturation<=0)
        throw std::invalid_argument("Invalid training photometry input");
    auto output=input;
    if(gray)for(std::size_t i=0;i<output.size();i+=3){const auto luminance=trainingGray(&output[i]);output[i]=output[i+1]=output[i+2]=luminance;}
    const float colorFactor=static_cast<float>(saturation),contrastFactor=static_cast<float>(contrast),brightnessFactor=static_cast<float>(brightness);
    for(std::size_t i=0;i<output.size();i+=3){const auto luminance=trainingGray(&output[i]);for(int c=0;c<3;++c)output[i+c]=trainingBlend(luminance,output[i+c],colorFactor);}
    std::uint64_t sum=0;for(std::size_t i=0;i<output.size();i+=3)sum+=trainingGray(&output[i]);
    const auto mean=static_cast<std::uint8_t>(std::floor(double(sum)/(output.size()/3)+.5));
    for(auto& pixel:output)pixel=trainingBlend(mean,pixel,contrastFactor);
    for(auto& pixel:output)pixel=trainingBlend(0,pixel,brightnessFactor);
    return output;
}
inline std::vector<std::uint8_t> applyTrainingGaussianBlur(const std::vector<std::uint8_t>& input,int width,int height,double radius){
    if(width<1||height<1||std::uint64_t(width)*height>16777216||input.size()!=std::size_t(width)*height*3||
       (radius!=0&&radius!=.25&&radius!=.5))throw std::invalid_argument("Invalid training blur input");
    if(radius==0)return input;
    const float r=static_cast<float>(radius),sigma2=r*r/3;
    const float length=static_cast<float>(std::sqrt(12.0*sigma2+1.0)),whole=static_cast<float>(std::floor((length-1.0)/2.0));
    float fraction=(2*whole+1)*(whole*(whole+1)-3*sigma2);fraction/=6*(sigma2-(whole+1)*(whole+1));
    const float box=whole+fraction;
    if(box<0||box>=1)throw std::invalid_argument("Unexpected training box blur radius");
    const auto weight=static_cast<std::uint32_t>(16777216.f/(box*2+1)),far=(16777216U-weight)/2;
    auto current=input,next=input;
    for(int axis=0;axis<2;++axis)for(int pass=0;pass<3;++pass){
        for(int y=0;y<height;++y)for(int x=0;x<width;++x){
            const int x0=axis==0?std::max(0,x-1):x,x1=axis==0?std::min(width-1,x+1):x;
            const int y0=axis==1?std::max(0,y-1):y,y1=axis==1?std::min(height-1,y+1):y;
            for(int c=0;c<3;++c){const auto at=(std::size_t(y)*width+x)*3+c;
                const auto before=(std::size_t(y0)*width+x0)*3+c,after=(std::size_t(y1)*width+x1)*3+c;
                const std::uint32_t sum=current[at]*weight+(std::uint32_t(current[before])+current[after])*far;
                next[at]=static_cast<std::uint8_t>((sum+(1U<<23))>>24);}
        }
        current.swap(next);
    }
    return current;
}
}
