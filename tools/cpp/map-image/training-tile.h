#pragma once
#include "training-scan.h"
#include <cstring>

namespace pando::map_image {
inline void appendTrainingFloat(std::vector<std::uint8_t>& output,float value){
    std::uint32_t bits;static_assert(sizeof(bits)==sizeof(value));std::memcpy(&bits,&value,sizeof(bits));
    for(int shift=0;shift<32;shift+=8)output.push_back(static_cast<std::uint8_t>(bits>>shift));
}
inline std::vector<std::uint8_t> trainingTile(const std::vector<std::uint8_t>& image,int width,int height,int x,int y,
    const std::vector<std::uint8_t>& target,const std::vector<std::uint8_t>& known,bool augment,std::uint64_t epoch,std::uint64_t index){
    constexpr int size=512,overviewSize=256;constexpr std::size_t pixels=std::size_t(size)*size;
    if(width<2||height<2||std::uint64_t(width)*height>16777216||image.size()!=std::size_t(width)*height*4||
       x<0||y<0||x>=width||y>=height||target.size()!=pixels||known.size()!=pixels)throw std::invalid_argument("Invalid training tile input");
    for(std::size_t i=3;i<image.size();i+=4)if(image[i]!=255)throw std::invalid_argument("Training image must be opaque");
    std::vector<std::uint8_t> tile(pixels*4,255);
    const int visibleWidth=std::min(size,width-x),visibleHeight=std::min(size,height-y);
    for(int sy=0;sy<visibleHeight;++sy)std::copy_n(image.begin()+(std::size_t(y+sy)*width+x)*4,std::size_t(visibleWidth)*4,tile.begin()+std::size_t(sy)*size*4);
    auto overview=resizeOpaqueBilinear(image,width,height,overviewSize,overviewSize);
    if(augment){tile=trainingScan(tile,size,size,epoch,index);overview=trainingScan(overview,overviewSize,overviewSize,epoch,index);}
    std::vector<std::uint8_t> out;out.reserve((3*pixels+3*overviewSize*overviewSize+4+14*pixels)*4);
    const float mean[]={.485f,.456f,.406f},deviation[]={.229f,.224f,.225f};
    const auto appendRgb=[&](const std::vector<std::uint8_t>& rgba){for(int c=0;c<3;++c)for(std::size_t p=0;p<rgba.size()/4;++p){
        volatile float scaled=float(rgba[p*4+c])/255.f;volatile float centered=scaled-mean[c];const float value=centered/deviation[c];appendTrainingFloat(out,value);}};
    appendRgb(tile);appendRgb(overview);
    appendTrainingFloat(out,float(double(x)/width));appendTrainingFloat(out,float(double(y)/height));
    appendTrainingFloat(out,float(double(visibleWidth)/width));appendTrainingFloat(out,float(double(visibleHeight)/height));
    for(const auto* bits:{&target,&known})for(int channel=0;channel<7;++channel)for(const auto value:*bits)appendTrainingFloat(out,(value&(1<<channel))?1.f:0.f);
    return out;
}
}
