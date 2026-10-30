// Validate one decoded DEM tile and its already-published neighbours.
#include <array>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
using Byte=std::uint8_t;
std::uint32_t u32(const std::vector<Byte>& bytes,std::size_t at){
  if(at+4>bytes.size())throw std::invalid_argument("Truncated DEM tile header");
  return std::uint32_t(bytes[at])|(std::uint32_t(bytes[at+1])<<8)|(std::uint32_t(bytes[at+2])<<16)|(std::uint32_t(bytes[at+3])<<24);
}
int main(){try{
#ifdef _WIN32
  if(_setmode(_fileno(stdin),_O_BINARY)==-1)throw std::runtime_error("Cannot set DEM input mode");
#endif
  std::vector<Byte> input;std::array<char,65536> chunk{};while(std::cin){std::cin.read(chunk.data(),chunk.size());const auto size=std::cin.gcount();
    if(size>0){if(input.size()+std::size_t(size)>160ULL*1024*1024)throw std::invalid_argument("DEM tile input exceeds budget");input.insert(input.end(),chunk.data(),chunk.data()+size);}}
  if(!std::cin.eof()||input.size()<24||std::string(input.begin(),input.begin()+8)!="PDTCHK01")throw std::invalid_argument("Invalid DEM tile input");
  const auto width=u32(input,8),height=u32(input,12),flags=u32(input,16),step=u32(input,20);
  const std::uint64_t pixels=std::uint64_t(width)*height,plane=pixels*4;
  if(width<3||height<3||width>16384||height>16384||pixels>16777216||!step||step>255||(flags&~63u))throw std::invalid_argument("Invalid DEM tile dimensions or flags");
  const std::uint64_t expected=24+plane+((flags&1)?plane:0)+((flags&2)?std::uint64_t(height)*4:0)+
    ((flags&4)?std::uint64_t(width)*4:0)+((flags&8)?std::uint64_t(height)*4:0);
  if(expected!=input.size())throw std::invalid_argument("Invalid DEM tile input length");
  const Byte* tile=input.data()+24;std::size_t at=24+plane;const Byte* reference=nullptr;const Byte* left=nullptr;const Byte* top=nullptr;const Byte* west=nullptr;
  if(flags&1){reference=input.data()+at;at+=plane;}if(flags&2){left=input.data()+at;at+=height*4;}
  if(flags&4){top=input.data()+at;at+=width*4;}if(flags&8)west=input.data()+at;
  for(std::uint32_t y=0;y<height;y++)for(std::uint32_t x=0;x<width;x++){
    const auto i=(std::size_t(y)*width+x)*4;if(tile[i+3]!=255)throw std::invalid_argument("Non-opaque DEM alpha");
    if(!((y==0&&(flags&16))||(y+1==height&&(flags&32)))&&tile[i+2]!=255&&tile[i+2]%step)throw std::invalid_argument("DEM shade quantization differs");
    if(reference){if(tile[i]!=reference[i]||tile[i+1]!=reference[i+1]||tile[i+3]!=reference[i+3])throw std::invalid_argument("DEM elevation or alpha differs from reference");
      if(std::abs(int(tile[i+2])-int(reference[i+2]))>2)throw std::invalid_argument("DEM shade differs from reference");}
  }
  auto equal=[](const Byte* a,const Byte* b){for(int i=0;i<4;i++)if(a[i]!=b[i])return false;return true;};
  if(left)for(std::uint32_t y=0;y<height;y++)if(!equal(left+y*4,tile+(std::size_t(y)*width+1)*4))throw std::invalid_argument("Horizontal DEM gutter differs");
  if(top)for(std::uint32_t x=0;x<width;x++)if(!equal(top+x*4,tile+(std::size_t(width)+x)*4))throw std::invalid_argument("Vertical DEM gutter differs");
  if(west)for(std::uint32_t y=0;y<height;y++)if(!equal(west+y*4,tile+(std::size_t(y)*width+width-1)*4))throw std::invalid_argument("Dateline DEM gutter differs");
  std::cout<<"{\"verified\":true}\n";return 0;
}catch(const std::exception& error){std::cerr<<"terrain-dem-check: "<<error.what()<<'\n';return 1;}}
