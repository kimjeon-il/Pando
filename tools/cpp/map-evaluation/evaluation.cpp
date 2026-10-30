#include "../map-image/raster-draw.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <iomanip>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
using Byte=std::uint8_t;
struct Reader {
  std::vector<Byte> data;std::size_t at=0;
  std::uint32_t u32(){if(at+4>data.size())throw std::runtime_error("Truncated evaluation input");auto v=(std::uint32_t(data[at])<<24)|(std::uint32_t(data[at+1])<<16)|(std::uint32_t(data[at+2])<<8)|data[at+3];at+=4;return v;}
  int i32(){return static_cast<std::int32_t>(u32());}
  double f64(){std::uint64_t bits=std::uint64_t(u32())<<32;bits|=u32();double v;std::memcpy(&v,&bits,8);return v;}
  std::vector<Byte> plane(std::size_t n){if(n>data.size()-at)throw std::runtime_error("Truncated evaluation plane");std::vector<Byte> out(data.begin()+at,data.begin()+at+n);at+=n;return out;}
};
struct Canvas{
  int w,h;std::vector<Byte>& data;
  void pixel(int x,int y,std::uint32_t){if(x>=0&&x<w&&y>=0&&y<h)data[std::size_t(y)*w+x]=1;}
  void hline(int x0,int y,int x1,std::uint32_t c){for(int x=std::max(0,x0);x<=std::min(w-1,x1);++x)pixel(x,y,c);}
};
std::vector<Byte> dilate(const std::vector<Byte>& input,int w,int h,double radius){
  std::vector<Byte> result(input.size());
  const int maxY=std::min(h-1,int(std::min(radius,double(h))));
  std::vector<int> prefix(std::size_t(w)+1);
  for(int sy=0;sy<h;++sy){prefix[0]=0;for(int x=0;x<w;++x)prefix[x+1]=prefix[x]+input[std::size_t(sy)*w+x];
    if(!prefix[w])continue;
    for(int dy=-maxY;dy<=maxY;++dy){int y=sy+dy;if(y<0||y>=h)continue;
      const auto remaining=radius*radius-double(dy)*dy;if(remaining<0)continue;
      const int dx=std::min(w-1,int(std::min(std::sqrt(remaining),double(w))));
      for(int x=0;x<w;++x)if(prefix[std::min(w,x+dx+1)]!=prefix[std::max(0,x-dx)])result[std::size_t(y)*w+x]=1;
    }
  }
  return result;
}
std::vector<Byte> crossProximity(const std::vector<Byte>& source,int sx,int sy,int sw,int sh,int tx,int ty,int tw,int th,double radius){
  constexpr std::int64_t inf=std::numeric_limits<std::int64_t>::max()/4;
  std::vector<Byte> result(std::size_t(tw)*th);
  std::vector<std::int64_t> horizontal(std::size_t(tw)*sh,inf);
  std::vector<int> points,vertices(sh);
  std::vector<long double> boundaries(std::size_t(sh)+1);
  const double radius2=radius*radius;
  for(int bit=0;bit<3;++bit){
    std::fill(horizontal.begin(),horizontal.end(),inf);
    for(int y=0;y<sh;++y){
      points.clear();for(int x=0;x<sw;++x)if(source[std::size_t(y)*sw+x]&(1<<bit))points.push_back(sx+x);
      if(points.empty())continue;
      std::size_t nearest=0;
      for(int x=0;x<tw;++x){const auto gx=tx+x;
        while(nearest+1<points.size()&&std::abs(std::int64_t(points[nearest+1])-gx)<std::abs(std::int64_t(points[nearest])-gx))++nearest;
        const auto dx=std::int64_t(points[nearest])-gx;horizontal[std::size_t(y)*tw+x]=dx*dx;
      }
    }
    for(int x=0;x<tw;++x){
      int last=-1;
      for(int y=0;y<sh;++y){const auto f=horizontal[std::size_t(y)*tw+x];if(f==inf)continue;
        const std::int64_t gy=std::int64_t(sy)+y;long double boundary=-std::numeric_limits<long double>::infinity();
        while(last>=0){const auto py=vertices[last];const std::int64_t gp=std::int64_t(sy)+py;
          boundary=static_cast<long double>((f+gy*gy)-(horizontal[std::size_t(py)*tw+x]+gp*gp))/(2*(gy-gp));
          if(boundary>boundaries[last])break;--last;
        }
        ++last;vertices[last]=y;boundaries[last]=last?boundary:-std::numeric_limits<long double>::infinity();
        boundaries[last+1]=std::numeric_limits<long double>::infinity();
      }
      if(last<0)continue;
      int selected=0;
      for(int y=0;y<th;++y){const std::int64_t gy=std::int64_t(ty)+y;
        while(selected<last&&boundaries[selected+1]<gy)++selected;
        const int py=vertices[selected];const auto dy=gy-(std::int64_t(sy)+py);
        if(double(horizontal[std::size_t(py)*tw+x]+dy*dy)<=radius2)result[std::size_t(y)*tw+x]|=Byte(1<<bit);
      }
    }
  }
  return result;
}
std::string base64(const std::vector<Byte>& bytes){
  static const char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string result;result.reserve((bytes.size()+2)/3*4);
  for(std::size_t i=0;i<bytes.size();i+=3){const auto n=std::uint32_t(bytes[i])<<16|(i+1<bytes.size()?std::uint32_t(bytes[i+1])<<8:0)|(i+2<bytes.size()?bytes[i+2]:0);
    result.push_back(alphabet[(n>>18)&63]);result.push_back(alphabet[(n>>12)&63]);result.push_back(i+1<bytes.size()?alphabet[(n>>6)&63]:'=');result.push_back(i+2<bytes.size()?alphabet[n&63]:'=');}
  return result;
}
int main(){try{
#ifdef _WIN32
  if(_setmode(_fileno(stdin),_O_BINARY)==-1)throw std::runtime_error("Cannot set binary input");
#endif
  Reader r;std::array<char,65536> chunk{};while(std::cin){std::cin.read(chunk.data(),chunk.size());auto n=std::cin.gcount();if(n>0){if(r.data.size()+std::size_t(n)>64ULL*1024*1024)throw std::runtime_error("Evaluation input exceeds budget");r.data.insert(r.data.end(),chunk.data(),chunk.data()+n);}}
  if(r.data.size()>=8&&std::string(r.data.begin(),r.data.begin()+8)=="PXCOR001"){
    r.at=8;const auto sx=r.u32(),sy=r.u32(),sw=r.u32(),sh=r.u32(),tx=r.u32(),ty=r.u32(),tw=r.u32(),th=r.u32();const auto radius=r.f64();
    if(!sw||!sh||!tw||!th||sw>1024||sh>1024||tw>1024||th>1024||sx>65535||sy>65535||tx>65535||ty>65535||
       sx+sw>65535||sy+sh>65535||tx+tw>65535||ty+th>65535||!std::isfinite(radius)||radius<0)throw std::runtime_error("Invalid proximity windows");
    auto source=r.plane(std::size_t(sw)*sh);if(r.at!=r.data.size()||std::any_of(source.begin(),source.end(),[](Byte value){return value&~7;}))throw std::runtime_error("Invalid proximity input");
    std::cout<<"{\"data\":\""<<base64(crossProximity(source,int(sx),int(sy),int(sw),int(sh),int(tx),int(ty),int(tw),int(th),radius))<<"\"}"<<std::endl;
    if(!std::cout)throw std::runtime_error("Cannot write proximity output");return 0;
  }
  if(r.data.size()>=8&&std::string(r.data.begin(),r.data.begin()+8)=="PDIAG001"){
    r.at=8;const auto w=r.u32(),h=r.u32();const std::uint64_t pixels=std::uint64_t(w)*h,values=pixels*7;
    if(!w||!h||w>16384||h>16384||values>16000000||r.data.size()!=16+values*6)throw std::runtime_error("Invalid diagnostic tensor dimensions");
    const char* channels[]={"international","administrative","coast","hydro","transport","text","frame"};
    const auto targetAt=16+values*4,knownAt=targetAt+values;
    std::cout<<std::setprecision(17)<<'{';
    for(std::size_t channel=0;channel<7;++channel){std::uint64_t supervised=0,truth=0,predicted=0,overlap=0;
      float minimum=std::numeric_limits<float>::infinity(),maximum=-minimum;
      for(std::size_t i=0;i<pixels;++i){const auto index=channel*pixels+i,at=16+index*4;
        const std::uint32_t bits=std::uint32_t(r.data[at])|(std::uint32_t(r.data[at+1])<<8)|(std::uint32_t(r.data[at+2])<<16)|(std::uint32_t(r.data[at+3])<<24);
        float value;std::memcpy(&value,&bits,sizeof(value));if(!std::isfinite(value))throw std::runtime_error("Non-finite diagnostic probability");
        minimum=std::min(minimum,value);maximum=std::max(maximum,value);
        const bool valid=r.data[knownAt+index],positive=r.data[targetAt+index],selected=value>=0.55f;
        supervised+=valid;truth+=valid&&positive;predicted+=valid&&selected;overlap+=valid&&positive&&selected;
      }
      if(channel)std::cout<<',';
      std::cout<<'"'<<channels[channel]<<"\":{\"supervisedPixels\":"<<supervised<<",\"targetPixels\":"<<truth
        <<",\"predictedPixels\":"<<predicted<<",\"overlapPixels\":"<<overlap<<",\"probabilityMin\":"<<double(minimum)<<",\"probabilityMax\":"<<double(maximum)<<'}';
    }
    std::cout<<'}';if(!std::cout)throw std::runtime_error("Cannot write diagnostic statistics");return 0;
  }
  const bool scoped=r.data.size()>=8&&std::string(r.data.begin(),r.data.begin()+8)=="PEVAL002";
  if(scoped)r.at=8;
  const auto w=r.u32(),h=r.u32(),lines=r.u32();const std::size_t n=std::size_t(w)*h;
  if(!w||!h||w>16384||h>16384||n>16777216||lines>1000000)throw std::runtime_error("Invalid evaluation dimensions");
  const auto coreX=scoped?r.u32():0,coreY=scoped?r.u32():0,coreW=scoped?r.u32():w,coreH=scoped?r.u32():h;
  if(!coreW||!coreH||coreX>=w||coreY>=h||coreW>w-coreX||coreH>h-coreY)throw std::runtime_error("Invalid evaluation core");
  auto target=r.plane(n),known=r.plane(n),prediction=r.plane(n);
  std::array<std::vector<Byte>,3> truth,tolerance,recalled,allowed,predicted;
  for(int c=0;c<3;++c){truth[c].resize(n);tolerance[c].resize(n);recalled[c].resize(n);allowed[c].resize(n);predicted[c].resize(n);for(std::size_t i=0;i<n;++i)predicted[c][i]=((known[i]&prediction[i])>>c)&1;}
  for(std::uint32_t line=0;line<lines;++line){const auto c=r.u32();const double radius=r.f64();const auto count=r.u32();
    if(c>=3||!std::isfinite(radius)||radius<2||count<2||count>1000000)throw std::runtime_error("Invalid evaluation line");
    std::vector<std::pair<int,int>> points;points.reserve(count);for(std::uint32_t j=0;j<count;++j){int x=r.i32(),y=r.i32();if(std::abs(std::int64_t(x))>1000000||std::abs(std::int64_t(y))>1000000)throw std::runtime_error("Invalid evaluation point");points.emplace_back(x,y);}
    std::vector<Byte> center(n),validCenter(n);Canvas canvas{int(w),int(h),center};
    for(std::size_t j=1;j<points.size();++j)pando::map_image::draw::thinLine(canvas,points[j-1].first,points[j-1].second,points[j].first,points[j].second,1);
    canvas.pixel(points.back().first,points.back().second,1);
    for(std::size_t i=0;i<n;++i)validCenter[i]=center[i]&&((known[i]>>c)&1);
    auto rawAllowed=dilate(center,w,h,radius),nearTruth=dilate(validCenter,w,h,radius),nearPrediction=dilate(predicted[c],w,h,radius);
    for(std::size_t i=0;i<n;++i){truth[c][i]|=validCenter[i];tolerance[c][i]|=nearTruth[i];recalled[c][i]|=validCenter[i]&&nearPrediction[i];allowed[c][i]|=rawAllowed[i];}
  }
  if(r.at!=r.data.size())throw std::runtime_error("Trailing evaluation input");
  std::cout<<"{\"counts\":[";
  for(int c=0;c<3;++c){std::array<std::uint64_t,4> count{};for(std::uint32_t y=coreY;y<coreY+coreH;++y)for(std::uint32_t x=coreX;x<coreX+coreW;++x){const auto i=std::size_t(y)*w+x;count[0]+=predicted[c][i]&&tolerance[c][i];count[1]+=predicted[c][i];count[2]+=recalled[c][i];count[3]+=truth[c][i];}
    if(c)std::cout<<',';std::cout<<'['<<count[0]<<','<<count[1]<<','<<count[2]<<','<<count[3]<<']';}
  std::cout<<"],\"confounderCounts\":[";
  for(int k=3;k<7;++k){if(k>3)std::cout<<',';std::cout<<'[';for(int c=0;c<3;++c){std::uint64_t falsePositive=0,pixels=0;
      for(std::uint32_t y=coreY;y<coreY+coreH;++y)for(std::uint32_t x=coreX;x<coreX+coreW;++x){const auto i=std::size_t(y)*w+x;
        if((target[i]&(1<<k))&&(known[i]&(1<<k))&&(known[i]&(1<<c))&&!allowed[c][i]){++pixels;falsePositive+=(prediction[i]>>c)&1;}}
      if(c)std::cout<<',';std::cout<<'['<<falsePositive<<','<<pixels<<']';}std::cout<<']';}std::cout<<"]}";
  if(!std::cout)throw std::runtime_error("Cannot write evaluation");return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
