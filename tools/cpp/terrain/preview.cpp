// DEM-derived preview pixels; no source files or map assets are modified.
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

namespace {
using Bytes=std::vector<unsigned char>;
std::uint32_t u32(const Bytes& b,std::size_t at){return std::uint32_t(b.at(at))|(std::uint32_t(b.at(at+1))<<8)|
    (std::uint32_t(b.at(at+2))<<16)|(std::uint32_t(b.at(at+3))<<24);}
double f64(const Bytes& b,std::size_t at){std::uint64_t bits=0;for(unsigned i=0;i<8;++i)bits|=std::uint64_t(b.at(at+i))<<(8*i);
    double value;std::memcpy(&value,&bits,sizeof value);return value;}
unsigned char rounded(double value){value=std::clamp(value,0.0,255.0);const auto low=std::floor(value),fraction=value-low;
    auto result=static_cast<unsigned>(low);if(fraction>0.5||(fraction==0.5&&(result%2)))++result;return static_cast<unsigned char>(result);}
double smooth(double h,double low,double high){const auto t=std::clamp((std::max(0.0,h)-low)/(high-low),0.0,1.0);return t*t*(3-2*t);}
double wrap(double value,double width){auto result=std::fmod(value,width);return result<0?result+width:result;}
Bytes compose(const Bytes& in){
    if(in.size()<56||std::memcmp(in.data(),"PDTERR01",8)!=0)throw std::invalid_argument("Invalid terrain preview header");
    const auto width=u32(in,8),height=u32(in,12),tintWidth=u32(in,16),tintHeight=u32(in,20);
    const double originX=f64(in,24),originY=f64(in,32),levelWidth=f64(in,40),levelHeight=f64(in,48);
    const auto pixels=std::uint64_t(width)*height,tintPixels=std::uint64_t(tintWidth)*tintHeight;
    if(!width||!height||!tintWidth||!tintHeight||width>16384||height>16384||tintWidth>16384||tintHeight>16384||
       pixels>16777216||tintPixels>16777216||!std::isfinite(originX)||!std::isfinite(originY)||
       !std::isfinite(levelWidth)||!std::isfinite(levelHeight)||levelWidth<=0||levelHeight<=0||
       in.size()!=56+pixels*5+tintPixels*3)throw std::invalid_argument("Invalid terrain preview dimensions or input length");
    const auto* dem=in.data()+56;const auto* tint=dem+pixels*4;const auto* land=tint+tintPixels*3;
    for(std::uint64_t i=0;i<pixels;++i)if(dem[i*4+3]!=255||land[i]>1)throw std::invalid_argument("Invalid DEM alpha or land mask");
    Bytes out(static_cast<std::size_t>(pixels*4));constexpr double pi=3.1415926535897932384626433832795;
    const double rootHalf=std::sqrt(0.5),neutral=0.27+0.73*rootHalf,northMeters=20015114.442/levelHeight;
    const bool wrapWorld=originX==0&&static_cast<double>(width)==levelWidth;
    auto elevation=[&](std::uint32_t x,std::uint32_t y){const auto i=(std::uint64_t(y)*width+x)*4;
        return static_cast<double>(int(dem[i])*256+int(dem[i+1])-12000);};
    for(std::uint32_t y=0;y<height;++y){const double latitude=90-(y+originY+0.5)*180/levelHeight;
        const double eastMeters=40030228.884*std::max(0.0001,std::cos(latitude*pi/180))/levelWidth;
        const double ty=std::clamp((y+originY+0.5)*tintHeight/levelHeight-0.5,0.0,static_cast<double>(tintHeight-1));
        const auto y0=static_cast<std::uint32_t>(std::floor(ty)),y1=std::min(y0+1,tintHeight-1);const double fy=ty-y0;
        for(std::uint32_t x=0;x<width;++x){const auto i=std::uint64_t(y)*width+x;const double h=elevation(x,y);
            const auto west=wrapWorld?(x+width-1)%width:(x?x-1:0),east=wrapWorld?(x+1)%width:std::min(x+1,width-1);
            const auto north=y?y-1:0,south=std::min(y+1,height-1);
            const double nx=-(elevation(east,y)-elevation(west,y))/eastMeters,ny=(elevation(x,south)-elevation(x,north))/northMeters;
            const double normal=std::sqrt(nx*nx+ny*ny+1);
            double light=0.55*std::max(0.0,(-nx*0.5+ny*0.5+rootHalf)/normal)+0.20*std::max(0.0,(-nx*rootHalf+rootHalf)/normal)
                +0.15*std::max(0.0,(ny*rootHalf+rootHalf)/normal)+0.10*std::max(0.0,(-nx*0.5-ny*0.5+rootHalf)/normal);
            if(std::abs(latitude)>=89.5)light=std::max(0.0,(dem[i*4+2]/255.0-0.42)/0.58);
            const double shade=std::clamp(neutral+((0.27+0.73*light)-neutral)*1.3,0.16,1.0),ratio=std::clamp(shade/neutral,0.38,1.3);
            const double tx=std::clamp(wrap(x+originX+0.5,levelWidth)*tintWidth/levelWidth-0.5,0.0,static_cast<double>(tintWidth-1));
            const auto x0=static_cast<std::uint32_t>(std::floor(tx)),x1=(x0+1)%tintWidth;const double fx=tx-x0;
            const double colors[5][3]={{.43,.62,.39},{.68,.72,.44},{.72,.57,.39},{.72,.68,.62},{.96,.95,.90}};
            const double amounts[4]={smooth(h,0,1000),smooth(h,1000,2500),smooth(h,2500,4500),smooth(h,4500,6500)};
            const double depth=std::pow(std::clamp(-h/8000,0.0,1.0),0.6),oceanStart[3]={.42,.66,.82},oceanEnd[3]={.10,.24,.39};
            for(unsigned c=0;c<3;++c){auto sample=[&](std::uint32_t xx,std::uint32_t yy){return double(tint[(std::uint64_t(yy)*tintWidth+xx)*3+c]);};
                const double n=sample(x0,y0)*(1-fx)+sample(x1,y0)*fx,s=sample(x0,y1)*(1-fx)+sample(x1,y1)*fx;
                double elevationColor=colors[0][c];for(unsigned k=0;k<4;++k)elevationColor=elevationColor*(1-amounts[k])+colors[k+1][c]*amounts[k];
                const double landColor=(n*(1-fy)+s*fy)*0.4+elevationColor*(0.6*255);
                const double ocean=(oceanStart[c]+(oceanEnd[c]-oceanStart[c])*depth)*255;
                out[i*4+c]=rounded((land[i]?landColor:ocean)*ratio);
            }
            out[i*4+3]=rounded((0.58+0.3*smooth(h,0,6000))*ratio*255);
        }
    }
    return out;
}
}
int main(){
#ifdef _WIN32
    _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
#endif
    try{Bytes input;std::array<char,65536> buffer{};
        while(std::cin){std::cin.read(buffer.data(),static_cast<std::streamsize>(buffer.size()));const auto count=std::cin.gcount();
            if(input.size()+static_cast<std::size_t>(count)>256*1024*1024)throw std::invalid_argument("Terrain preview input exceeds budget");
            input.insert(input.end(),buffer.data(),buffer.data()+count);}
        if(!std::cin.eof())throw std::runtime_error("Unable to read terrain preview");
        const auto result=compose(input);std::cout.write(reinterpret_cast<const char*>(result.data()),static_cast<std::streamsize>(result.size()));
        if(!std::cout)throw std::runtime_error("Unable to write terrain preview");return 0;
    }catch(const std::exception& error){std::cerr<<"terrain-preview: "<<error.what()<<'\n';return 1;}
}
