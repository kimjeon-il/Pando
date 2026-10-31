#include "land-mask.h"
#include "../map-image/raster-draw.h"
#include <pandoeditor/losslessjson.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>
#include <vector>

using Value=pandoeditor::codecjson::Value;
namespace {
const Value* find(const Value& object,const char* key){if(object.kind!=Value::Object)return nullptr;
    const auto it=object.object.find(key);return it==object.object.end()?nullptr:&it->second;}
const Value& required(const Value& object,const char* key){const auto* value=find(object,key);if(!value)throw std::invalid_argument(std::string("Missing terrain field: ")+key);return *value;}
const std::vector<Value>& array(const Value& value){if(value.kind!=Value::Array)throw std::invalid_argument("Expected terrain array");return value.array;}
double number(const Value& value){const auto result=pandoeditor::codecjson::finiteNumber(value);if(!std::isfinite(result))throw std::invalid_argument("Invalid terrain number");return result;}
int integer(const Value& value,int maximum=16384){const auto n=number(value);if(std::floor(n)!=n||n<1||n>maximum)throw std::invalid_argument("Invalid terrain dimension");return static_cast<int>(n);}
double nearestEven(double value){const auto low=std::floor(value),fraction=value-low;const auto n=static_cast<long long>(low);
    return low+((fraction>0.5||(fraction==0.5&&(n%2)))?1:0);}
using Point=std::pair<double,double>;
struct Canvas {int w,h;std::vector<std::uint8_t>& data;
    void pixel(int x,int y,std::uint32_t color){if(x>=0&&y>=0&&x<w&&y<h)data[std::size_t(y)*w+x]=static_cast<std::uint8_t>(color);}
    void hline(int x0,int y,int x1,std::uint32_t color){if(y<0||y>=h||x1<0||x0>=w)return;
        x0=std::max(0,x0);x1=std::min(w-1,x1);for(int x=x0;x<=x1;++x)pixel(x,y,color);}
};
std::vector<Point> unwrap(const Value& value,std::size_t& pointCount,bool physical){
    const auto& source=array(value);pointCount+=source.size();if(pointCount>2000000)throw std::invalid_argument("Terrain polygon exceeds point budget");
    std::vector<Point> result;result.reserve(source.size());
    for(const auto& raw:source){const auto& pair=array(raw);if(pair.size()<2||(!physical&&pair.size()!=2))throw std::invalid_argument("Invalid terrain coordinate");
        double lon=number(pair[0]),lat=number(pair[1]);if(std::abs(lon)>180||std::abs(lat)>90)throw std::invalid_argument("Terrain coordinate outside WGS84");
        if(!result.empty()){const double delta=lon-result.back().first;
            if(delta>180)lon-=std::ceil((delta-180)/360)*360;else if(delta< -180)lon-=std::floor((delta+180)/360)*360;}
        result.emplace_back(lon,lat);
    }return result;
}
double center(const std::vector<Point>& ring){double sum=0;for(const auto& point:ring)sum+=point.first;return sum/ring.size();}
void drawPolygon(Canvas& canvas,const Value& raw,double x,double y,double levelW,double levelH,std::size_t& pointCount,bool physical){
    const auto& source=array(raw);if(source.empty())return;
    if(physical&&array(source.front()).size()<3)return;
    std::vector<std::vector<Point>> rings;rings.reserve(source.size());
    for(std::size_t i=0;i<source.size();++i)if(!physical||i==0)rings.push_back(unwrap(source[i],pointCount,physical));
    if(rings.front().empty())throw std::invalid_argument("Empty terrain exterior");const double outerCenter=center(rings.front());
    for(std::size_t i=1;i<rings.size();++i)if(!rings[i].empty()){const double shift=nearestEven((outerCenter-center(rings[i]))/360)*360;
        for(auto& point:rings[i])point.first+=shift;}
    int first=-1,last=1;
    if(physical){double minX=std::numeric_limits<double>::infinity(),maxX=-minX;
        for(const auto& point:rings.front()){const auto px=(point.first+180)*levelW/360;minX=std::min(minX,px);maxX=std::max(maxX,px);}
        first=static_cast<int>(std::floor(-maxX/levelW));last=static_cast<int>(std::ceil((levelW-minX)/levelW));
        if(last-first>10000)throw std::invalid_argument("Terrain world wrap exceeds budget");}
    for(int shift=first;shift<=last;++shift){const int worldShift=shift*360;
        auto project=[&](const std::vector<Point>& ring){std::vector<Point> out;out.reserve(ring.size());
            for(const auto& point:ring)out.emplace_back((point.first+worldShift+180)*levelW/360-x,(90-point.second)*levelH/180-y);return out;};
        const auto outer=project(rings.front());double minX=std::numeric_limits<double>::infinity(),maxX=-minX,minY=minX,maxY=-minX;
        for(const auto& point:outer){minX=std::min(minX,point.first);maxX=std::max(maxX,point.first);minY=std::min(minY,point.second);maxY=std::max(maxY,point.second);}
        if(maxX< -1||minX>canvas.w||maxY< -1||minY>canvas.h)continue;
        auto draw=[&](const std::vector<Point>& ring,std::uint32_t color){std::vector<std::pair<int,int>> points;points.reserve(ring.size());
            for(const auto& point:ring){if(std::abs(point.first)>10000000||std::abs(point.second)>10000000)throw std::invalid_argument("Terrain pixel coordinate exceeds budget");
                points.emplace_back(static_cast<int>(point.first),static_cast<int>(point.second));}
            pando::map_image::draw::polygon(canvas,points,color);};
        draw(outer,physical?255:1);for(std::size_t i=1;i<rings.size();++i)if(!rings[i].empty())draw(project(rings[i]),0);
    }
}
}
std::vector<std::uint8_t> terrainLandMask(const std::string& json){
    const auto request=pandoeditor::codecjson::parse(json);const auto& countries=required(request,"countries");
    const auto* fill=find(request,"fillHoles");if(fill&&fill->kind!=Value::Bool)throw std::invalid_argument("Invalid terrain fill mode");
    const bool physical=fill&&fill->raw=="true";
    const int width=integer(required(request,"width"),physical?30000:16384),height=integer(required(request,"height"));
    const double x=number(required(request,"x")),y=number(required(request,"y")),levelW=number(required(request,"levelWidth")),levelH=number(required(request,"levelHeight"));
    if(std::uint64_t(width)*height>(physical?240000000ULL:16777216ULL)||std::abs(x)>1000000||std::abs(y)>1000000||levelW<=0||levelH<=0||levelW>1000000||levelH>1000000)
        throw std::invalid_argument("Invalid terrain mask dimensions");
    std::vector<std::uint8_t> output(std::size_t(width)*height);Canvas canvas{width,height,output};std::size_t pointCount=0;
    const auto* features=find(countries,"features");if(!features)return output;
    for(const auto& feature:array(*features)){const auto* geometry=find(feature,"geometry");if(!geometry||geometry->kind==Value::Null)continue;
        const auto* type=find(*geometry,"type"),*coordinates=find(*geometry,"coordinates");if(!type||type->kind!=Value::String||!coordinates)continue;
        if(type->string=="Polygon")drawPolygon(canvas,*coordinates,x,y,levelW,levelH,pointCount,physical);
        else if(type->string=="MultiPolygon")for(const auto& polygon:array(*coordinates))drawPolygon(canvas,polygon,x,y,levelW,levelH,pointCount,physical);
    }return output;
}
