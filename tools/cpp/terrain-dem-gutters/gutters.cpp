// Reconcile one RGBA DEM tile against saved neighbor edges.
#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
using Byte=std::uint8_t;
int main(){try{
#ifdef _WIN32
  if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Cannot set binary mode");
#endif
  std::vector<Byte> input;std::array<char,65536> chunk{};
  while(std::cin){std::cin.read(chunk.data(),chunk.size());auto size=std::cin.gcount();if(size>0){
    if(input.size()+std::size_t(size)>80ULL*1024*1024)throw std::invalid_argument("DEM gutter input exceeds budget");
    input.insert(input.end(),chunk.data(),chunk.data()+size);}}
  if(!std::cin.eof()||input.size()<20||!std::equal(input.begin(),input.begin()+8,"PDEMGUT1"))throw std::invalid_argument("Invalid DEM gutter header");
  std::size_t at=8;auto number=[&](){if(at+4>input.size())throw std::invalid_argument("Truncated DEM gutter input");
    auto v=std::uint32_t(input[at])|(std::uint32_t(input[at+1])<<8)|(std::uint32_t(input[at+2])<<16)|(std::uint32_t(input[at+3])<<24);at+=4;return v;};
  const auto width=number(),height=number(),flags=number();
  if(width<3||height<3||width>16384||height>16384||std::uint64_t(width)*height>16777216||flags>3)throw std::invalid_argument("Invalid DEM tile dimensions");
  struct Edge{std::uint32_t w,h;std::size_t left,right,top,bottom,topGutter,bottomGutter;};std::array<Edge,8> edges{};
  auto bytes=[&](std::size_t count){if(count>input.size()-at)throw std::invalid_argument("Truncated DEM edge");auto start=at;at+=count;return start;};
  for(auto& e:edges){e.w=number();e.h=number();if(e.w<3||e.h<3||e.w>16384||e.h>16384)throw std::invalid_argument("Invalid neighbor dimensions");
    e.left=bytes(e.h*4);e.right=bytes(e.h*4);e.top=bytes(e.w*4);e.bottom=bytes(e.w*4);e.topGutter=bytes(e.w*4);e.bottomGutter=bytes(e.w*4);}
  if(edges[0].h!=height||edges[1].h!=height||edges[2].w!=width||edges[3].w!=width||input.size()-at!=std::uint64_t(width)*height*4)
    throw std::invalid_argument("Neighbor or image dimensions differ");
  std::vector<Byte> output(input.begin()+at,input.end());
  auto copy=[&](std::uint32_t y,std::uint32_t x,std::size_t base,std::uint32_t pixel){std::copy_n(input.begin()+base+pixel*4,4,output.begin()+(std::size_t(y)*width+x)*4);};
  const auto &west=edges[0],&east=edges[1],&north=edges[2],&south=edges[3],&nw=edges[4],&ne=edges[5],&sw=edges[6],&se=edges[7];
  for(std::uint32_t y=1;y<height-1;y++){copy(y,0,west.right,y);copy(y,width-1,east.left,y);}
  for(std::uint32_t x=1;x<width-1;x++){if(flags&1)copy(0,x,north.bottom,x);if(flags&2)copy(height-1,x,south.top,x);}
  copy(0,0,(flags&1)?nw.bottom:west.topGutter,((flags&1)?nw.w:west.w)-2);
  copy(0,width-1,(flags&1)?ne.bottom:east.topGutter,1);
  copy(height-1,0,(flags&2)?sw.top:west.bottomGutter,((flags&2)?sw.w:west.w)-2);
  copy(height-1,width-1,(flags&2)?se.top:east.bottomGutter,1);
  std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()));
  if(!std::cout)throw std::runtime_error("Cannot write DEM gutter result");return 0;
}catch(const std::exception& error){std::cerr<<"terrain-dem-gutters: "<<error.what()<<'\n';return 1;}}
