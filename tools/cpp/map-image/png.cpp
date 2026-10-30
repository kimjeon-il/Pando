#include "png.h"
#include <zlib.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <stdexcept>
#include <vector>

namespace pando::map_image {
namespace {
void number(std::vector<std::uint8_t>& result,std::uint32_t value){
    for(int shift:{24,16,8,0})result.push_back(static_cast<std::uint8_t>(value>>shift));
}
void chunk(std::vector<std::uint8_t>& result,const std::array<char,4>& name,const std::vector<std::uint8_t>& data){
    number(result,static_cast<std::uint32_t>(data.size()));const auto start=result.size();
    result.insert(result.end(),name.begin(),name.end());result.insert(result.end(),data.begin(),data.end());
    const auto crc=crc32(0,result.data()+start,static_cast<uInt>(4+data.size()));number(result,static_cast<std::uint32_t>(crc));
}
}
static std::vector<std::uint8_t> encodePng(const std::vector<std::uint8_t>& input,int width,int height,int channels){
    if(width<1||height<1||width>16384||height>16384||static_cast<std::int64_t>(width)*height>16777216)
        throw std::invalid_argument("Image dimensions exceed the 16MP graph budget");
    const auto stride=static_cast<std::size_t>(width)*channels;
    if(input.size()!=stride*height)throw std::invalid_argument("PNG input byte length differs from dimensions");
    std::vector<std::uint8_t> scanlines((stride+1)*height),candidate(stride),best(stride);
    for(int y=0;y<height;++y){
        const auto source=static_cast<std::size_t>(y)*stride,target=static_cast<std::size_t>(y)*(stride+1);
        std::uint64_t bestScore=std::numeric_limits<std::uint64_t>::max();int bestFilter=0;
        for(int filter=0;filter<5;++filter){
            std::uint64_t score=0;
            for(std::size_t x=0;x<stride;++x){
                const int left=x>=static_cast<std::size_t>(channels)?input[source+x-channels]:0,up=y?input[source-stride+x]:0,
                    upperLeft=y&&x>=static_cast<std::size_t>(channels)?input[source-stride+x-channels]:0;
                int predictor=0;
                if(filter==1)predictor=left;
                else if(filter==2)predictor=up;
                else if(filter==3)predictor=(left+up)/2;
                else if(filter==4){
                    const int p=left+up-upperLeft,da=std::abs(p-left),db=std::abs(p-up),dc=std::abs(p-upperLeft);
                    predictor=da<=db&&da<=dc?left:db<=dc?up:upperLeft;
                }
                const int value=(static_cast<int>(input[source+x])-predictor)&255;
                candidate[x]=static_cast<std::uint8_t>(value);score+=value<128?value:256-value;
            }
            if(score<bestScore){bestScore=score;bestFilter=filter;best=candidate;}
        }
        scanlines[target]=static_cast<std::uint8_t>(bestFilter);
        std::copy(best.begin(),best.end(),scanlines.begin()+target+1);
    }
    uLongf length=compressBound(static_cast<uLong>(scanlines.size()));std::vector<std::uint8_t> compressed(length);
    if(compress2(compressed.data(),&length,scanlines.data(),static_cast<uLong>(scanlines.size()),6)!=Z_OK)
        throw std::runtime_error("PNG compression failed");
    compressed.resize(length);
    std::vector<std::uint8_t> output{137,80,78,71,13,10,26,10},header;header.reserve(13);
    number(header,static_cast<std::uint32_t>(width));number(header,static_cast<std::uint32_t>(height));
    header.insert(header.end(),{8,static_cast<std::uint8_t>(channels==1?0:6),0,0,0});
    chunk(output,{'I','H','D','R'},header);chunk(output,{'I','D','A','T'},compressed);chunk(output,{'I','E','N','D'},{});
    return output;
}
std::vector<std::uint8_t> encodePngRgba(const std::vector<std::uint8_t>& input,int width,int height){return encodePng(input,width,height,4);}
std::vector<std::uint8_t> encodePngGray(const std::vector<std::uint8_t>& input,int width,int height){return encodePng(input,width,height,1);}
}
