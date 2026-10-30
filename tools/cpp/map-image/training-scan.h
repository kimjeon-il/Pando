#pragma once
#include "image-read.h"
#include "resample.h"
#include "../reference-analysis/condition-sampling.h"
#include "../reference-analysis/training-photometry.h"
#include <cmath>
#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace pando::map_image {
inline int trainingRoundedSize(int size,double scale){
    const double value=size*scale,lower=std::floor(value),fraction=value-lower;
    const int rounded=static_cast<int>(fraction>.5?lower+1:fraction<.5?lower:(static_cast<int>(lower)%2?lower+1:lower));
    if(rounded<1)throw std::invalid_argument("Training scaled image dimension is zero");return rounded;
}
inline std::vector<std::uint8_t> trainingScan(const std::vector<std::uint8_t>& input,int width,int height,std::uint64_t epoch,std::uint64_t index){
    if(width<1||height<1||std::uint64_t(width)*height>16777216||input.size()!=std::size_t(width)*height*4)
        throw std::invalid_argument("Invalid training scan dimensions");
    std::vector<std::uint8_t> rgb(std::size_t(width)*height*3);
    for(std::size_t i=0;i<rgb.size()/3;++i){if(input[i*4+3]!=255)throw std::invalid_argument("Training scan input must be opaque");
        for(int c=0;c<3;++c)rgb[i*3+c]=input[i*4+c];}
    const auto conditions=pando::reference::trainingScanConditions(epoch,index);
    rgb=pando::reference::applyTrainingPhotometry(rgb,width,height,conditions.grayscale,conditions.contrast,conditions.brightness,conditions.saturation);
    const auto rgba=[&](){std::vector<std::uint8_t> out(rgb.size()/3*4,255);for(std::size_t i=0;i<rgb.size()/3;++i)for(int c=0;c<3;++c)out[i*4+c]=rgb[i*3+c];return out;};
    if(conditions.resolution!=1){const int w=trainingRoundedSize(width,conditions.resolution),h=trainingRoundedSize(height,conditions.resolution);
        auto scaled=resizeOpaqueBilinear(rgba(),width,height,w,h);scaled=resizeOpaqueBilinear(scaled,w,h,width,height);
        for(std::size_t i=0;i<rgb.size()/3;++i)for(int c=0;c<3;++c)rgb[i*3+c]=scaled[i*4+c];}
    if(conditions.blur)rgb=pando::reference::applyTrainingGaussianBlur(rgb,width,height,conditions.blur);
    const auto prepared=rgba();std::uint8_t* bytes=nullptr;std::size_t size=0;char error[256]{};
    if(!pando_write_jpeg_quality(prepared.data(),width,height,conditions.quality,&bytes,&size,error,sizeof(error)))throw std::runtime_error(std::string("Training JPEG encoding: ")+error);
    std::unique_ptr<std::uint8_t,decltype(&std::free)> encoded(bytes,&std::free);PandoImage decoded{};
    if(!pando_read_jpeg(encoded.get(),size,&decoded))throw std::runtime_error(std::string("Training JPEG decoding: ")+decoded.error);
    std::unique_ptr<std::uint8_t,decltype(&std::free)> pixels(decoded.rgba,&std::free);
    if(decoded.width!=static_cast<std::uint32_t>(width)||decoded.height!=static_cast<std::uint32_t>(height))throw std::runtime_error("Training JPEG dimensions changed");
    return std::vector<std::uint8_t>(pixels.get(),pixels.get()+input.size());
}
}
