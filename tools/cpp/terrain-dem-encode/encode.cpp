// Encode source elevation and deterministic hillshade for one DEM tile.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
using Byte=std::uint8_t;
std::uint32_t u32(const std::vector<Byte>& bytes,std::size_t at){if(at+4>bytes.size())throw std::invalid_argument("Truncated DEM encode header");
  return std::uint32_t(bytes[at])|(std::uint32_t(bytes[at+1])<<8)|(std::uint32_t(bytes[at+2])<<16)|(std::uint32_t(bytes[at+3])<<24);}
std::int64_t even(double value){const auto lower=std::floor(value),fraction=value-lower;auto result=static_cast<std::int64_t>(lower);
  if(fraction>0.5||(fraction==0.5&&result%2))++result;return result;}
int main(){try{
#ifdef _WIN32
  if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Cannot set DEM binary mode");
#endif
  std::vector<Byte> input;std::array<char,65536> chunk{};while(std::cin){std::cin.read(chunk.data(),chunk.size());const auto size=std::cin.gcount();
    if(size>0){if(input.size()+std::size_t(size)>80ULL*1024*1024)throw std::invalid_argument("DEM encode input exceeds budget");input.insert(input.end(),chunk.data(),chunk.data()+size);}}
  if(!std::cin.eof()||input.size()<28||std::string(input.begin(),input.begin()+8)!="PDEMENC1")throw std::invalid_argument("Invalid DEM encode input");
  const auto width=u32(input,8),height=u32(input,12),levelWidth=u32(input,16),levelHeight=u32(input,20);
  const auto north=static_cast<std::int32_t>(u32(input,24));const std::uint64_t count=std::uint64_t(width)*height;
  if(!width||!height||width>16384||height>16384||count>16777216||!levelWidth||!levelHeight||levelWidth>1000000||levelHeight>1000000||
    std::abs(std::int64_t(north))>1000000||input.size()!=28+count*4)throw std::invalid_argument("Invalid DEM encode dimensions");
  std::vector<float> heights(count);for(std::size_t i=0;i<count;i++){const auto bits=u32(input,28+i*4);std::memcpy(&heights[i],&bits,4);
    if(!std::isfinite(heights[i])||heights[i]<-12000||heights[i]>53535)throw std::invalid_argument("Elevation outside valid encoding range");}
  constexpr double pi=3.1415926535897932384626433832795,radius=6371008.8;
  const double metersNorth=pi*radius/levelHeight,azimuth=315*pi/180,altitude=45*pi/180;
  const double lx=std::sin(azimuth)*std::cos(altitude),ly=std::cos(azimuth)*std::cos(altitude),lz=std::sin(altitude);
  std::vector<Byte> shade(count),output(count*5);
  for(std::uint32_t y=0;y<height;y++){
    const double latitude=std::clamp(90.0-(double(north)+y+0.5)*180.0/levelHeight,-89.95,89.95);
    const double metersEast=2*pi*radius*std::cos(latitude*pi/180)/levelWidth;
    for(std::uint32_t x=0;x<width;x++){
      const auto index=std::size_t(y)*width+x,west=std::size_t(y)*width+(x?x-1:x),east=std::size_t(y)*width+std::min(x+1,width-1),
        above=std::size_t(y?y-1:y)*width+x,below=std::size_t(std::min(y+1,height-1))*width+x;
      const float deltaEast=heights[east]-heights[west],deltaNorth=heights[above]-heights[below];
      const double dzEast=double(deltaEast)/(2*metersEast);const float dzNorth=deltaNorth/float(2*metersNorth);
      const float northSquare=dzNorth*dzNorth,northLight=dzNorth*float(ly);
      const double norm=std::sqrt(dzEast*dzEast+double(northSquare)+1),diffuse=std::max(0.0,(-dzEast*lx-double(northLight)+lz)/norm);
      shade[index]=static_cast<Byte>(even(std::clamp(.42+.58*diffuse,0.0,1.0)*255));
    }
  }
  auto compact=[&](std::size_t index){return Byte(std::min(255,((int(shade[index])+2)/4)*4));};
  for(std::uint32_t y=0;y<height;y++)for(std::uint32_t x=0;x<width;x++){
    const auto index=std::size_t(y)*width+x;const auto packed=even(heights[index])+12000;Byte tone=compact(index);
    const auto world=std::int64_t(north)+y;if(world<0||world>=levelHeight){
      if(levelHeight<=1350){const auto real=world<0?-std::int64_t(north):std::int64_t(levelHeight)-1-north;
        if(real<0||real>=height)throw std::invalid_argument("Missing real polar DEM row");tone=compact(std::size_t(real)*width+x);}
      else tone=shade[index];}
    output[index]=shade[index];const auto at=count+index*4;output[at]=Byte(packed>>8);output[at+1]=Byte(packed&255);output[at+2]=tone;output[at+3]=255;
  }
  std::cout.write(reinterpret_cast<const char*>(output.data()),static_cast<std::streamsize>(output.size()));
  if(!std::cout)throw std::runtime_error("Cannot write encoded DEM");return 0;
}catch(const std::exception& error){std::cerr<<"terrain-dem-encode: "<<error.what()<<'\n';return 1;}}
