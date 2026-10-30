#include "../map-image/raster-draw.h"
#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <utility>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
namespace {
using Byte=std::uint8_t;
struct Reader{
    const std::vector<Byte>& data;std::size_t at=0;
    std::uint32_t u32(){if(at+4>data.size())throw std::runtime_error("Truncated review input");
        const auto n=(std::uint32_t(data[at])<<24)|(std::uint32_t(data[at+1])<<16)|(std::uint32_t(data[at+2])<<8)|data[at+3];at+=4;return n;}
    int i32(){return static_cast<std::int32_t>(u32());}
};
struct Canvas{
    int w,h;std::vector<Byte>& data;Byte bits;bool clear;
    void pixel(int x,int y,std::uint32_t){if(x<0||y<0||x>=w||y>=h)return;auto& value=data[std::size_t(y)*w+x];
        value=clear?Byte(value&~bits):Byte(value|bits);}
    void hline(int x0,int y,int x1,std::uint32_t color){if(y<0||y>=h||x1<0||x0>=w)return;
        x0=std::max(0,x0);x1=std::min(w-1,x1);for(int x=x0;x<=x1;++x)pixel(x,y,color);}
};
}
int main(){
    try{
#ifdef _WIN32
        if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Cannot set binary mode");
#endif
        std::vector<Byte> input;std::array<char,65536> chunk{};
        while(std::cin){std::cin.read(chunk.data(),chunk.size());const auto n=std::cin.gcount();if(n>0){
            if(input.size()+std::size_t(n)>64ULL*1024*1024)throw std::runtime_error("Review input exceeds byte budget");input.insert(input.end(),chunk.data(),chunk.data()+n);}}
        if(!std::cin.eof())throw std::runtime_error("Cannot read review input");Reader r{input};
        const auto originalW=r.u32(),originalH=r.u32();const int originX=r.i32(),originY=r.i32();
        const auto width=r.u32(),height=r.u32(),count=r.u32();
        if(!originalW||!originalH||originalW>65535||originalH>65535||!width||!height||width>16384||height>16384||
           std::uint64_t(width)*height>16777216||count>1000000||std::abs(std::int64_t(originX))>1000000||std::abs(std::int64_t(originY))>1000000)
            throw std::runtime_error("Invalid review dimensions or commands");
        std::vector<Byte> target(std::size_t(width)*height),known(target.size());
        for(std::uint32_t command=0;command<count;++command){
            const auto type=r.u32(),channel=r.u32(),lineWidth=r.u32(),n=r.u32();
            if(type<1||type>4||(type!=4&&channel>=7)||(type==2&&(!lineWidth||lineWidth>65535))||n>1000000||n<(type==2?2u:3u))
                throw std::runtime_error("Invalid review shape");
            std::vector<std::pair<int,int>> points;points.reserve(n);
            for(std::uint32_t i=0;i<n;++i){const int x=r.i32(),y=r.i32();
                if(std::abs(std::int64_t(x))>1000000||std::abs(std::int64_t(y))>1000000)throw std::runtime_error("Review coordinate exceeds budget");
                points.emplace_back(x,y);}
            Canvas canvas{int(width),int(height),(type==1||type==4)?known:target,Byte(type==4?255:(1u<<channel)),type==4};
            if(type==2){
                for(std::size_t i=1;i<points.size();++i){const auto [x0,y0]=points[i-1];const auto [x1,y1]=points[i];
                    if(lineWidth==1)pando::map_image::draw::thinLine(canvas,x0,y0,x1,y1,1);
                    else pando::map_image::draw::wideLine(canvas,x0,y0,x1,y1,int(lineWidth),1);}
                if(lineWidth==1)canvas.pixel(points.back().first,points.back().second,1);
            }else pando::map_image::draw::polygon(canvas,points,1);
        }
        if(r.at!=input.size())throw std::runtime_error("Trailing review input");
        for(std::uint32_t y=0;y<height;++y)for(std::uint32_t x=0;x<width;++x)
            if(std::int64_t(originX)+x<0||std::int64_t(originY)+y<0||std::int64_t(originX)+x>=originalW||std::int64_t(originY)+y>=originalH)
                known[std::size_t(y)*width+x]=0;
        std::cout.write(reinterpret_cast<const char*>(target.data()),static_cast<std::streamsize>(target.size()));
        std::cout.write(reinterpret_cast<const char*>(known.data()),static_cast<std::streamsize>(known.size()));
        if(!std::cout)throw std::runtime_error("Cannot write review masks");return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
