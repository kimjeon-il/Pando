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
}
