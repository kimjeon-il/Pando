// Raster primitives adapted from Pillow 12.3.0 Draw.c and _imagingft.c.
// See PILLOW-LICENSE; the supplied Aileron subset states "No Rights Reserved".
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_GLYPH_H
#include FT_STROKER_H
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
namespace {
using Byte=std::uint8_t;
struct Reader {
    const std::vector<Byte>& b;std::size_t at=0;
    std::uint32_t u32(){if(at+4>b.size())throw std::runtime_error("Truncated preview input");
        const auto n=(std::uint32_t(b[at])<<24)|(std::uint32_t(b[at+1])<<16)|(std::uint32_t(b[at+2])<<8)|b[at+3];at+=4;return n;}
    int i32(){return static_cast<std::int32_t>(u32());}
    double f64(){const auto high=u32(),low=u32();std::uint64_t n=(std::uint64_t(high)<<32)|low;double d;std::memcpy(&d,&n,sizeof(d));if(!std::isfinite(d)||std::abs(d)>1000000)throw std::runtime_error("Invalid text coordinate");return d;}
    std::vector<Byte> take(std::size_t n){if(n>b.size()-at)throw std::runtime_error("Truncated preview input");
        auto first=b.begin()+static_cast<std::ptrdiff_t>(at);at+=n;return {first,first+static_cast<std::ptrdiff_t>(n)};}
};
struct Canvas {
    int w,h;std::vector<Byte> data;
    void pixel(int x,int y,std::uint32_t color){if(x<0||y<0||x>=w||y>=h)return;auto i=(std::size_t(y)*w+x)*4;
        data[i]=Byte(color>>16);data[i+1]=Byte(color>>8);data[i+2]=Byte(color);data[i+3]=255;}
    void hline(int x0,int y,int x1,std::uint32_t color){if(y<0||y>=h||x1<0||x0>=w)return;
        x0=std::max(x0,0);x1=std::min(x1,w-1);for(int x=x0;x<=x1;++x)pixel(x,y,color);}
};
int roundUp(double f){return f>=0?int(std::floor(f+.5)):-int(std::floor(std::abs(f)+.5));}
int roundDown(double f){return f>=0?int(std::ceil(f-.5)):-int(std::ceil(std::abs(f)-.5));}
struct Edge {int xmin,xmax,ymin,ymax,x0,y0;float dx;};
Edge edge(int x0,int y0,int x1,int y1){return {std::min(x0,x1),std::max(x0,x1),std::min(y0,y1),std::max(y0,y1),x0,y0,
    y0==y1?0.f:float(x1-x0)/float(y1-y0)};}
void wideLine(Canvas& c,int x0,int y0,int x1,int y1,std::uint32_t color){
    const int dx=x1-x0,dy=y1-y0;if(!dx&&!dy){c.pixel(x0,y0,color);return;}
    const double ratio=1/std::hypot(double(dx),double(dy));const int dxmax=roundDown(ratio*dy),dymax=roundDown(ratio*dx);
    const int v[4][2]={{x0,y0+dymax},{x1,y1+dymax},{x1+dxmax,y1},{x0+dxmax,y0}};
    std::array<Edge,4> es{edge(v[0][0],v[0][1],v[1][0],v[1][1]),edge(v[1][0],v[1][1],v[2][0],v[2][1]),
        edge(v[2][0],v[2][1],v[3][0],v[3][1]),edge(v[3][0],v[3][1],v[0][0],v[0][1])};
    std::vector<const Edge*> active;int ymin=c.h-1,ymax=0;
    for(const auto& e:es){ymin=std::min(ymin,e.ymin);ymax=std::max(ymax,e.ymax);
        if(e.ymin==e.ymax)c.hline(e.xmin,e.ymin,e.xmax,color);else active.push_back(&e);}
    ymin=std::max(ymin,0);ymax=std::min(ymax,c.h);
    for(int y=ymin;y<=ymax;++y){
        std::vector<float> xs;
        for(std::size_t i=0;i<active.size();++i){const auto& e=*active[i];if(y<e.ymin||y>e.ymax)continue;
            xs.push_back(float(y-e.y0)*e.dx+float(e.x0));
            if(y==e.ymax&&y<ymax)xs.push_back(xs.back());
            else if((y==e.ymin||y==e.ymax)&&e.dx!=0){
                for(std::size_t k=0;k<i;++k){const auto& other=*active[k];if((y!=other.ymin&&y!=other.ymax)||other.dx==0)continue;
                    if(std::round(xs.back())==std::round(float(y-other.y0)*other.dx+float(other.x0))){
                        const int offset=y==e.ymax?-1:1;const float a=float(y+offset-e.y0)*e.dx+float(e.x0);
                        if(y+offset>=other.ymin&&y+offset<=other.ymax){const float b=float(y+offset-other.y0)*other.dx+float(other.x0);
                            if(xs.back()>a+1&&xs.back()>b+1)xs.back()=std::round(std::max(a,b))+1;
                            else if(xs.back()<a-1&&xs.back()<b-1)xs.back()=std::round(std::min(a,b))-1;break;}
                    }
                }
            }
        }
        std::sort(xs.begin(),xs.end());for(std::size_t i=1;i<xs.size();i+=2)c.hline(roundUp(xs[i-1]),y,roundDown(xs[i]),color);
    }
}
struct Quarter {int a,b,cx,cy,ex,ey;std::int64_t a2,b2,a2b2;bool done;};
Quarter quarter(int a,int b){return {a,b,a,b%2,a%2,b,std::int64_t(a)*a,std::int64_t(b)*b,std::int64_t(a)*a*b*b,a<0||b<0};}
std::int64_t delta(const Quarter& s,int x,int y){return std::llabs(s.a2*y*y+s.b2*x*x-s.a2b2);}
bool next(Quarter& s,int& x,int& y){if(s.done)return false;x=s.cx;y=s.cy;
    if(s.cx==s.ex&&s.cy==s.ey){s.done=true;return true;}
    int nx=s.cx,ny=s.cy+2;auto d=delta(s,nx,ny);
    if(nx>1){auto d2=delta(s,s.cx-2,s.cy+2);if(d>d2){nx=s.cx-2;ny=s.cy+2;d=d2;}
        d2=delta(s,s.cx-2,s.cy);if(d>d2){nx=s.cx-2;ny=s.cy;}}
    s.cx=nx;s.cy=ny;return true;}
void ellipse(Canvas& canvas,int x0,int y0,int x1,int y1,std::uint32_t color){
    const int a=x1-x0,b=y1-y0;if(a<0||b<0)return;auto outer=quarter(a,b),inner=quarter(a-2,b-2);
    int pr,py;if(!next(outer,pr,py))return;const int left=a%2;int pl=left;bool finished=false;
    while(!finished){const int y=py,r=pr;int l=pl,cx=0,cy=0;bool ok;
        while((ok=next(outer,cx,cy))&&cy<=y){}if(!ok)finished=true;else{pr=cx;py=cy;}
        while((ok=next(inner,cx,cy))&&cy<=y)l=cx;pl=ok?cx:left;
        auto line=[&](int xx0,int yy,int xx1){canvas.hline(x0+(xx0+a)/2,y0+(yy+b)/2,x0+(xx1+a)/2,color);};
        line(-r,-y,-l);if(l>0||l<r)line(l==0?2:l,-y,r);
        if(y>0){line(-r,y,-l);if(l>0||l<r)line(l==0?2:l,y,r);}
    }
}
void rectangle(Canvas& c,int x0,int y0,int x1,int y1,std::uint32_t color,bool fill){
    if(y0>y1)std::swap(y0,y1);
    if(fill){for(int y=std::max(y0,0);y<=std::min(y1,c.h-1);++y)c.hline(x0,y,x1,color);return;}
    for(int i=0;i<2;++i){c.hline(x0,y0+i,x1,color);c.hline(x0,y1-i,x1,color);
        for(int y=std::max(0,y0+2);y<=std::min(c.h-1,y1-2);++y){c.pixel(x0+i,y,color);c.pixel(x1-i,y,color);}}
}
int pixel26(long value){return int((value+32)>>6);}
int mul255(int a,int b){int v=a*b+128;return (v+(v>>8))>>8;}
struct Font {
    FT_Library library=nullptr;FT_Face face=nullptr;std::vector<Byte> bytes;
    explicit Font(std::vector<Byte> data):bytes(std::move(data)){
        if(FT_Init_FreeType(&library)||FT_New_Memory_Face(library,bytes.data(),static_cast<FT_Long>(bytes.size()),0,&face)||
           FT_Set_Char_Size(face,0,640,72,72))throw std::runtime_error("Unable to load preview font");
    }
    ~Font(){if(face)FT_Done_Face(face);if(library)FT_Done_FreeType(library);}
    struct Glyph {FT_UInt index;long advance;};
    void layer(Canvas& canvas,double fx,double fy,const std::string& text,std::uint32_t color,bool stroke){
        std::vector<Glyph> glyphs;glyphs.reserve(text.size());FT_UInt last=0;
        for(unsigned char ch:text){if(ch<32||ch>126)throw std::runtime_error("Invalid preview label");
            const FT_UInt index=FT_Get_Char_Index(face,ch);if(FT_Load_Glyph(face,index,FT_LOAD_DEFAULT))throw std::runtime_error("Preview glyph unavailable");
            if(last&&index&&FT_HAS_KERNING(face)){FT_Vector delta{};if(!FT_Get_Kerning(face,last,index,FT_KERNING_DEFAULT,&delta))glyphs.back().advance+=pixel26(delta.x);}
            glyphs.push_back({index,face->glyph->metrics.horiAdvance});last=index;
        }
        FT_Stroker stroker=nullptr;if(stroke){if(FT_Stroker_New(library,&stroker))throw std::runtime_error("Preview stroke unavailable");
            FT_Stroker_Set(stroker,64,FT_STROKER_LINECAP_ROUND,FT_STROKER_LINEJOIN_ROUND,0);}
        double ix,iy;const double sx=std::modf(fx,&ix),sy=std::modf(fy,&iy);long pen=std::lround(sx*64),ypen=-std::lround(sy*64);
        const int baseY=int(iy)+pixel26(face->size->metrics.ascender);const int startX=int(ix);
        long total=0;for(const auto& g:glyphs)total+=g.advance;
        const int left=std::max(0,startX-16),right=std::min(canvas.w,startX+pixel26(total)+24);
        const int top=std::max(0,baseY-32),bottom=std::min(canvas.h,baseY+24);
        if(right<=left||bottom<=top){if(stroker)FT_Stroker_Done(stroker);return;}
        const int mw=right-left,mh=bottom-top;std::vector<Byte> mask(std::size_t(mw)*mh,0);
        for(const auto& item:glyphs){
            if(FT_Load_Glyph(face,item.index,FT_LOAD_DEFAULT|(stroke?0:FT_LOAD_RENDER))){if(stroker)FT_Stroker_Done(stroker);throw std::runtime_error("Preview glyph load failed");}
            FT_Glyph glyph=nullptr;FT_Bitmap* bitmap;int bx,by;
            if(stroke){if(FT_Get_Glyph(face->glyph,&glyph)||FT_Glyph_StrokeBorder(&glyph,stroker,0,1)||FT_Glyph_To_Bitmap(&glyph,FT_RENDER_MODE_NORMAL,nullptr,1)){
                    if(glyph)FT_Done_Glyph(glyph);FT_Stroker_Done(stroker);throw std::runtime_error("Preview glyph stroke failed");}
                auto bit=reinterpret_cast<FT_BitmapGlyph>(glyph);bitmap=&bit->bitmap;bx=bit->left;by=bit->top;
            }else{bitmap=&face->glyph->bitmap;bx=face->glyph->bitmap_left;by=face->glyph->bitmap_top;}
            if(bitmap->pixel_mode!=FT_PIXEL_MODE_GRAY&&bitmap->rows){if(glyph)FT_Done_Glyph(glyph);if(stroker)FT_Stroker_Done(stroker);throw std::runtime_error("Unsupported preview glyph bitmap");}
            const int x0=startX+pixel26(pen)+bx,y0=baseY-(pixel26(ypen)+by);
            for(unsigned y=0;y<bitmap->rows;++y)for(unsigned x=0;x<bitmap->width;++x){const int tx=x0+int(x),ty=y0+int(y);
                if(tx<left||tx>=right||ty<top||ty>=bottom)continue;const int alpha=bitmap->buffer[std::size_t(y)*bitmap->pitch+x];auto& target=mask[std::size_t(ty-top)*mw+tx-left];
                target=Byte(std::min(255,alpha+mul255(target,255-alpha)));}
            if(glyph)FT_Done_Glyph(glyph);pen+=item.advance;
        }
        if(stroker)FT_Stroker_Done(stroker);
        for(int y=top;y<bottom;++y)for(int x=left;x<right;++x){const int a=mask[std::size_t(y-top)*mw+x-left];if(!a)continue;
            const auto i=(std::size_t(y)*canvas.w+x)*4;const int channels[3]={int(color>>16)&255,int(color>>8)&255,int(color)&255};
            for(int k=0;k<3;++k){const int sum=canvas.data[i+k]*(255-a)+channels[k]*a+128;canvas.data[i+k]=Byte((sum+(sum>>8))>>8);}}
    }
    void text(Canvas& c,double x,double y,const std::string& value,std::uint32_t color,bool stroke){
        if(stroke)layer(c,x,y,value,0xffffff,true);layer(c,x,y,value,color,false);
    }
};
}
int main(){
    try{
#ifdef _WIN32
        if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Cannot set binary mode");
#endif
        std::vector<Byte> input;std::array<char,65536> chunk{};
        while(std::cin){std::cin.read(chunk.data(),chunk.size());const auto n=std::cin.gcount();if(n>0){
            if(input.size()+std::size_t(n)>128ULL*1024*1024)throw std::runtime_error("Preview input exceeds byte budget");input.insert(input.end(),chunk.data(),chunk.data()+n);}}
        if(!std::cin.eof())throw std::runtime_error("Cannot read preview input");Reader r{input};const auto w=r.u32(),h=r.u32(),fontSize=r.u32(),count=r.u32();
        if(w<1||h<1||w>2200||h>2200||fontSize!=12676||count>1000000)throw std::runtime_error("Invalid preview dimensions or commands");
        Font font(r.take(fontSize));Canvas canvas{int(w),int(h),r.take(std::size_t(w)*h*4)};
        for(std::uint32_t i=0;i<count;++i){const auto type=r.u32(),color=r.u32();
            if(type==1){const auto n=r.u32();if(n>1000000)throw std::runtime_error("Too many line points");
                int x0=0,y0=0;for(std::uint32_t p=0;p<n;++p){const int x=r.i32(),y=r.i32();if(std::abs(std::int64_t(x))>1000000||std::abs(std::int64_t(y))>1000000)throw std::runtime_error("Preview coordinate exceeds budget");
                    if(p)wideLine(canvas,x0,y0,x,y,color);x0=x;y0=y;}}
            else if(type>=2&&type<=4){const int x0=r.i32(),y0=r.i32(),x1=r.i32(),y1=r.i32();
                if(std::max({std::abs(std::int64_t(x0)),std::abs(std::int64_t(y0)),std::abs(std::int64_t(x1)),std::abs(std::int64_t(y1))})>1000000)throw std::runtime_error("Preview coordinate exceeds budget");
                if(type==2){if(x1-x0>32||y1-y0>32)throw std::runtime_error("Preview ellipse exceeds budget");ellipse(canvas,x0,y0,x1,y1,color);}
                else rectangle(canvas,x0,y0,x1,y1,color,type==4);}
            else if(type==5){const double x=r.f64(),y=r.f64();const bool stroke=r.u32()!=0;const auto n=r.u32();if(n>10000)throw std::runtime_error("Preview label exceeds budget");
                const auto value=r.take(n);font.text(canvas,x,y,std::string(value.begin(),value.end()),color,stroke);}
            else throw std::runtime_error("Unknown preview command");
        }
        if(r.at!=input.size())throw std::runtime_error("Trailing preview input");
        std::cout.write(reinterpret_cast<const char*>(canvas.data.data()),static_cast<std::streamsize>(canvas.data.size()));
        if(!std::cout)throw std::runtime_error("Cannot write preview pixels");return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
