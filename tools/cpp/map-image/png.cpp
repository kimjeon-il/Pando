#include "png.h"
#include <zlib.h>
#include <algorithm>
#include <array>
#include <cstdint>
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
std::vector<std::uint8_t> encodePngRgba(const std::vector<std::uint8_t>& input,int width,int height){
    if(width<1||height<1||width>16384||height>16384||static_cast<std::int64_t>(width)*height>16777216)
        throw std::invalid_argument("Image dimensions exceed the 16MP graph budget");
    const auto stride=static_cast<std::size_t>(width)*4;
    if(input.size()!=stride*height)throw std::invalid_argument("RGBA input byte length differs from dimensions");
    std::vector<std::uint8_t> scanlines((stride+1)*height);
    for(int y=0;y<height;++y)std::copy_n(input.begin()+static_cast<std::size_t>(y)*stride,stride,scanlines.begin()+static_cast<std::size_t>(y)*(stride+1)+1);
    uLongf length=compressBound(static_cast<uLong>(scanlines.size()));std::vector<std::uint8_t> compressed(length);
    if(compress2(compressed.data(),&length,scanlines.data(),static_cast<uLong>(scanlines.size()),6)!=Z_OK)
        throw std::runtime_error("PNG compression failed");
    compressed.resize(length);
    std::vector<std::uint8_t> output{137,80,78,71,13,10,26,10},header;header.reserve(13);
    number(header,static_cast<std::uint32_t>(width));number(header,static_cast<std::uint32_t>(height));
    header.insert(header.end(),{8,6,0,0,0});
    chunk(output,{'I','H','D','R'},header);chunk(output,{'I','D','A','T'},compressed);chunk(output,{'I','E','N','D'},{});
    return output;
}
}
