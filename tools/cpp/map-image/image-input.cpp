#include "image-input.h"
#include "image-read.h"
#include "resample.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <string>

namespace pando::map_image {
ImageInput readImage(const std::vector<std::uint8_t>& encoded,const std::string& format,int maximumPixels,int x,int y,int width,int height){
    if(maximumPixels<256||maximumPixels>16777216)throw std::invalid_argument("Pixel budget must be 256..16777216");
    PandoImage decoded{};
    const int success=format=="jpeg"?pando_read_jpeg(encoded.data(),encoded.size(),&decoded):
        format=="webp"?pando_read_webp(encoded.data(),encoded.size(),&decoded):pando_read_png(encoded.data(),encoded.size(),&decoded);
    if(!success)throw std::runtime_error(format+" input: "+decoded.error);
    std::unique_ptr<std::uint8_t,decltype(&std::free)> pixels(decoded.rgba,&std::free);
    const int rawWidth=static_cast<int>(decoded.width),rawHeight=static_cast<int>(decoded.height),orientation=static_cast<int>(decoded.orientation);
    const bool swaps=orientation>=5&&orientation<=8;
    const int originalWidth=swaps?rawHeight:rawWidth,originalHeight=swaps?rawWidth:rawHeight;
    if(width==0&&height==0){x=0;y=0;width=originalWidth;height=originalHeight;}
    if(x<0||y<0||width<2||height<2||x>originalWidth-width||y>originalHeight-height)
        throw std::invalid_argument("Source rectangle exceeds original pixel bounds");
    std::vector<std::uint8_t> crop(static_cast<std::size_t>(width)*height*4,255);
    for(int sy=0;sy<rawHeight;++sy)for(int sx=0;sx<rawWidth;++sx){
        int ox=sx,oy=sy;
        switch(orientation){
        case 2:ox=rawWidth-1-sx;break;
        case 3:ox=rawWidth-1-sx;oy=rawHeight-1-sy;break;
        case 4:oy=rawHeight-1-sy;break;
        case 5:ox=sy;oy=sx;break;
        case 6:ox=rawHeight-1-sy;oy=sx;break;
        case 7:ox=rawHeight-1-sy;oy=rawWidth-1-sx;break;
        case 8:ox=sy;oy=rawWidth-1-sx;break;
        default:break;
        }
        if(ox<x||oy<y||ox>=x+width||oy>=y+height)continue;
        const auto source=(static_cast<std::size_t>(sy)*rawWidth+sx)*4,dest=(static_cast<std::size_t>(oy-y)*width+ox-x)*4;
        const int alpha=pixels.get()[source+3];
        for(int c=0;c<3;++c)crop[dest+c]=static_cast<std::uint8_t>((pixels.get()[source+c]*alpha+255*(255-alpha)+127)/255);
    }
    const double scale=std::min(1.0,std::sqrt(static_cast<double>(maximumPixels)/(static_cast<double>(width)*height)));
    const int outWidth=std::max(2,static_cast<int>(width*scale)),outHeight=std::max(2,static_cast<int>(height*scale));
    auto output=resizeRgba(crop,width,height,outWidth,outHeight);
    return {rawWidth,rawHeight,orientation,originalWidth,originalHeight,x,y,width,height,outWidth,outHeight,std::move(output)};
}
}
