#pragma once
// Raster scan conversion adapted from Pillow 12.3.0 Draw.c; see PILLOW-LICENSE.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

namespace pando::map_image::draw {
inline int roundUp(double f){return f>=0?int(std::floor(f+.5)):-int(std::floor(std::abs(f)+.5));}
inline int roundDown(double f){return f>=0?int(std::ceil(f-.5)):-int(std::ceil(std::abs(f)-.5));}
struct Edge {int xmin,xmax,ymin,ymax,x0,y0;float dx;};
inline Edge edge(int x0,int y0,int x1,int y1){return {std::min(x0,x1),std::max(x0,x1),std::min(y0,y1),std::max(y0,y1),x0,y0,
    y0==y1?0.f:float(x1-x0)/float(y1-y0)};}
template<class Canvas> void fillEdges(Canvas& c,const std::vector<Edge>& edges,std::uint32_t color){
    if(edges.empty())return;std::vector<const Edge*> active;int ymin=c.h-1,ymax=0;
    for(const auto& e:edges){ymin=std::min(ymin,e.ymin);ymax=std::max(ymax,e.ymax);
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
template<class Canvas> void wideLine(Canvas& c,int x0,int y0,int x1,int y1,int width,std::uint32_t color){
    const int dx=x1-x0,dy=y1-y0;if(!dx&&!dy){c.pixel(x0,y0,color);return;}
    const double hyp=std::hypot(double(dx),double(dy)),small=(width-1)/2.0;
    const double ratioMax=roundUp(small)/hyp,ratioMin=roundDown(small)/hyp;
    const int dxmin=roundDown(ratioMin*dy),dxmax=roundDown(ratioMax*dy),dymin=roundDown(ratioMin*dx),dymax=roundDown(ratioMax*dx);
    const int v[4][2]={{x0-dxmin,y0+dymax},{x1-dxmin,y1+dymax},{x1+dxmax,y1-dymin},{x0+dxmax,y0-dymin}};
    std::vector<Edge> edges{edge(v[0][0],v[0][1],v[1][0],v[1][1]),edge(v[1][0],v[1][1],v[2][0],v[2][1]),
        edge(v[2][0],v[2][1],v[3][0],v[3][1]),edge(v[3][0],v[3][1],v[0][0],v[0][1])};
    fillEdges(c,edges,color);
}
template<class Canvas> void thinLine(Canvas& c,int x0,int y0,int x1,int y1,std::uint32_t color){
    int dx=x1-x0,dy=y1-y0;const int xs=dx<0?-1:1,ys=dy<0?-1:1;dx=std::abs(dx);dy=std::abs(dy);
    if(dx==0){for(int i=0;i<dy;++i){c.pixel(x0,y0,color);y0+=ys;}}
    else if(dy==0){for(int i=0;i<dx;++i){c.pixel(x0,y0,color);x0+=xs;}}
    else if(dx>dy){const int n=dx;dy+=dy;int e=dy-dx;dx+=dx;
        for(int i=0;i<n;++i){c.pixel(x0,y0,color);if(e>=0){y0+=ys;e-=dx;}e+=dy;x0+=xs;}}
    else{const int n=dy;dx+=dx;int e=dx-dy;dy+=dy;
        for(int i=0;i<n;++i){c.pixel(x0,y0,color);if(e>=0){x0+=xs;e-=dy;}e+=dx;y0+=ys;}}
}
template<class Canvas> void polygon(Canvas& c,const std::vector<std::pair<int,int>>& points,std::uint32_t color){
    if(points.empty())return;std::vector<Edge> edges;edges.reserve(points.size());
    for(std::size_t i=1;i<points.size();++i)edges.push_back(edge(points[i-1].first,points[i-1].second,points[i].first,points[i].second));
    if(points.back()!=points.front())edges.push_back(edge(points.back().first,points.back().second,points.front().first,points.front().second));
    fillEdges(c,edges,color);
}
}
