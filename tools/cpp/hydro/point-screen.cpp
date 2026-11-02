// Read-only point-to-mainstem screen shared by the independent Hydro audits.
// Input and output are JSON on stdin/stdout. This tool never edits map data.
#include <pandoeditor/losslessjson.h>
#include "../map-image/raster-draw.h"
#include <geos_c.h>
#include <proj.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <functional>
#include <iostream>
#include <iterator>
#include <limits>
#include <map>
#include <memory>
#include <numeric>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

using Value=pandoeditor::codecjson::Value;
namespace {
struct Point{double x,y;};
const Value& field(const Value& value,const char* key){
    if(value.kind!=Value::Object)throw std::invalid_argument("Expected point-screen object");
    auto it=value.object.find(key);if(it==value.object.end())throw std::invalid_argument(std::string("Missing point-screen field: ")+key);return it->second;
}
const std::vector<Value>& array(const Value& value){
    if(value.kind!=Value::Array)throw std::invalid_argument("Expected point-screen array");return value.array;
}
Point inputPoint(const Value& value){
    const auto& coordinates=array(value);if(coordinates.size()!=2)throw std::invalid_argument("Expected XY geographic point");
    Point point{pandoeditor::codecjson::finiteNumber(coordinates[0]),pandoeditor::codecjson::finiteNumber(coordinates[1])};
    if(!std::isfinite(point.x)||!std::isfinite(point.y)||std::abs(point.x)>180||std::abs(point.y)>90)
        throw std::invalid_argument("Invalid geographic coordinate");return point;
}
std::string utm(const Value& value){
    if(value.kind!=Value::String)throw std::invalid_argument("Expected UTM CRS");const auto& crs=value.string;
    if(crs.size()!=10||(crs.substr(0,8)!="EPSG:326"&&crs.substr(0,8)!="EPSG:327")||
       crs[8]<'0'||crs[8]>'9'||crs[9]<'0'||crs[9]>'9')throw std::invalid_argument("Expected WGS84 UTM CRS");
    const int zone=(crs[8]-'0')*10+crs[9]-'0';if(zone<1||zone>60)throw std::invalid_argument("Invalid UTM zone");return crs;
}
struct GeosDeleter{GEOSContextHandle_t context;void operator()(GEOSGeometry* geometry)const{if(geometry)GEOSGeom_destroy_r(context,geometry);}};
struct TreeDeleter{GEOSContextHandle_t context;void operator()(GEOSSTRtree* tree)const{if(tree)GEOSSTRtree_destroy_r(context,tree);}};
using Geometry=std::unique_ptr<GEOSGeometry,GeosDeleter>;
Geometry own(GEOSContextHandle_t context,GEOSGeometry* geometry){
    if(!geometry)throw std::runtime_error("GEOS geometry operation failed");return Geometry(geometry,GeosDeleter{context});
}
Point transformed(PJ* operation,Point point,PJ_DIRECTION direction){
    proj_errno_reset(operation);const auto result=proj_trans(operation,direction,proj_coord(point.x,point.y,0,0));
    if(proj_errno(operation)||!std::isfinite(result.xy.x)||!std::isfinite(result.xy.y))throw std::runtime_error("Coordinate transformation failed");
    return {result.xy.x,result.xy.y};
}
Geometry geometry(GEOSContextHandle_t context,const std::vector<Point>& points,bool single){
    auto* seq=GEOSCoordSeq_create_r(context,static_cast<unsigned int>(points.size()),2);
    if(!seq)throw std::runtime_error("GEOS coordinate allocation failed");
    for(unsigned int i=0;i<points.size();++i){
        if(!GEOSCoordSeq_setX_r(context,seq,i,points[i].x)||!GEOSCoordSeq_setY_r(context,seq,i,points[i].y)){
            GEOSCoordSeq_destroy_r(context,seq);throw std::runtime_error("GEOS coordinate assignment failed");
        }
    }
    auto* raw=single?GEOSGeom_createPoint_r(context,seq):GEOSGeom_createLineString_r(context,seq);
    if(!raw){GEOSCoordSeq_destroy_r(context,seq);throw std::runtime_error("GEOS geometry creation failed");}
    return own(context,raw);
}
struct LineSet{
    std::vector<Geometry> lines;std::vector<double> lengths;
    std::array<double,4> bounds{std::numeric_limits<double>::infinity(),std::numeric_limits<double>::infinity(),
        -std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity()};
};
LineSet projectLines(GEOSContextHandle_t context,PJ* projection,const std::vector<Value>& source,
                     std::size_t& totalVertices,bool dropZero,bool validate){
    if(source.empty()||source.size()>100000)throw std::invalid_argument("Invalid point-screen input size");
    LineSet result;
    for(const auto& row:source){
        const auto& coordinates=array(row);totalVertices+=coordinates.size();
        if(coordinates.size()<2||totalVertices>5000000)throw std::invalid_argument("Invalid point-screen line");
        std::vector<Point> projected;projected.reserve(coordinates.size());
        for(const auto& coordinate:coordinates){
            const auto point=transformed(projection,inputPoint(coordinate),PJ_FWD);projected.push_back(point);
            result.bounds[0]=std::min(result.bounds[0],point.x);result.bounds[1]=std::min(result.bounds[1],point.y);
            result.bounds[2]=std::max(result.bounds[2],point.x);result.bounds[3]=std::max(result.bounds[3],point.y);
        }
        auto line=geometry(context,projected,false);double length=0;
        if(validate&&(GEOSisEmpty_r(context,line.get())!=0||GEOSisValid_r(context,line.get())!=1))throw std::invalid_argument("Invalid river line");
        if(!GEOSLength_r(context,line.get(),&length)||!std::isfinite(length))throw std::runtime_error("GEOS line length failed");
        if(dropZero&&length<=0)continue;
        result.lengths.push_back(length);result.lines.push_back(std::move(line));
    }
    if(result.lines.empty())throw std::invalid_argument("No usable point-screen lines");return result;
}
Geometry unionLines(GEOSContextHandle_t context,const std::vector<Geometry>& lines){
    std::vector<GEOSGeometry*> clones;clones.reserve(lines.size());
    for(const auto& line:lines){auto* clone=GEOSGeom_clone_r(context,line.get());if(!clone){for(auto* item:clones)GEOSGeom_destroy_r(context,item);throw std::runtime_error("GEOS clone failed");}clones.push_back(clone);}
    auto* collectionRaw=GEOSGeom_createCollection_r(context,GEOS_MULTILINESTRING,clones.data(),static_cast<unsigned int>(clones.size()));
    if(!collectionRaw){for(auto* item:clones)GEOSGeom_destroy_r(context,item);throw std::runtime_error("GEOS collection failed");}
    auto collection=own(context,collectionRaw);return own(context,GEOSUnaryUnion_r(context,collection.get()));
}
Value numberArray(const std::vector<double>& numbers){auto result=Value::arr();for(double number:numbers)result.array.push_back(Value::num(number));return result;}
Value calibrationImageLayers(const Value& input){
    constexpr int width=1744,height=510,top=48,panelWidth=560,panelHeight=390;
    const auto& sourceBounds=array(field(input,"bounds"));if(sourceBounds.size()!=4)throw std::invalid_argument("Invalid image bounds");
    std::array<double,4> bounds{};for(std::size_t i=0;i<4;++i)bounds[i]=pandoeditor::codecjson::finiteNumber(sourceBounds[i]);
    if(bounds[2]<=bounds[0]||bounds[3]<=bounds[1])throw std::invalid_argument("Invalid image bounds");
    std::vector<std::uint8_t> rgba(std::size_t(width)*height*4);for(std::size_t i=0;i<rgba.size();i+=4){rgba[i]=244;rgba[i+1]=247;rgba[i+2]=251;rgba[i+3]=255;}
    const std::array<int,3> offsets{16,592,1168};
    for(int offset:offsets)for(int y=top;y<=top+panelHeight;++y)for(int x=offset;x<=offset+panelWidth;++x){
        const int dx=std::max({offset+6-x,0,x-(offset+panelWidth-6)}),dy=std::max({top+6-y,0,y-(top+panelHeight-6)});
        const int sideX=std::min(x-offset,offset+panelWidth-x),sideY=std::min(y-top,top+panelHeight-y);
        const bool cornerBorder=(sideY==0&&(sideX==4||sideX==5))||(sideX==0&&(sideY==4||sideY==5));
        const bool cornerFill=(sideX==4&&sideY==1)||(sideX==1&&sideY==4);
        if(dx*dx+dy*dy>36&&!cornerBorder)continue;
        const bool border=!cornerFill&&(cornerBorder||x==offset||x==offset+panelWidth||y==top||y==top+panelHeight||dx*dx+dy*dy>=29);
        const std::size_t at=(std::size_t(y)*width+x)*4;rgba[at]=border?185:234;rgba[at+1]=border?197:240;rgba[at+2]=border?207:244;}
    struct Mask{int w,h;std::vector<std::uint8_t> data;
        void pixel(int x,int y,std::uint32_t value){if(x>=0&&x<w&&y>=0&&y<h)data[std::size_t(y)*w+x]=static_cast<std::uint8_t>(value);}
        void hline(int x0,int y,int x1,std::uint32_t value){if(y<0||y>=h||x1<0||x0>=w)return;
            x0=std::max(0,x0);x1=std::min(w-1,x1);for(int x=x0;x<=x1;++x)pixel(x,y,value);}};
    const auto mapped=[&](const Value& item,int offset){const auto point=inputPoint(item);
        const double x=offset+(point.x-bounds[0])/(bounds[2]-bounds[0])*panelWidth,y=top+(bounds[3]-point.y)/(bounds[3]-bounds[1])*panelHeight;
        if(std::abs(x)>1000000||std::abs(y)>1000000)throw std::invalid_argument("Image coordinate exceeds budget");
        return std::make_pair(static_cast<int>(x),static_cast<int>(y));};
    auto apply=[&](const char* key,int offset,bool polygons,std::array<int,4> color,int lineWidth){
        Mask mask{width,height,std::vector<std::uint8_t>(std::size_t(width)*height)};std::size_t vertices=0;
        const auto ring=[&](const Value& value){std::vector<std::pair<int,int>> points;const auto& coords=array(value);vertices+=coords.size();
            if(vertices>5000000)throw std::invalid_argument("Image coordinate budget exceeded");points.reserve(coords.size());
            for(const auto& point:coords)points.push_back(mapped(point,offset));return points;};
        for(const auto& item:array(field(input,key))){if(polygons){const auto& rings=array(item);for(std::size_t i=0;i<rings.size();++i)
                pando::map_image::draw::polygon(mask,ring(rings[i]),i==0?255:0);}
            else{const auto points=ring(item);for(std::size_t i=1;i<points.size();++i){const auto a=points[i-1],b=points[i];
                if(lineWidth==1)pando::map_image::draw::thinLine(mask,a.first,a.second,b.first,b.second,255);
                else pando::map_image::draw::wideLine(mask,a.first,a.second,b.first,b.second,lineWidth,255);}
                if(points.size()>1)mask.pixel(points.back().first,points.back().second,255);}}
        for(std::size_t i=0;i<mask.data.size();++i)if(mask.data[i]){const auto at=i*4;for(int channel=0;channel<3;++channel){
            const int sum=rgba[at+channel]*(255-color[3])+color[channel]*color[3]+128;rgba[at+channel]=static_cast<std::uint8_t>((sum+(sum>>8))>>8);}}
    };
    for(int offset:{offsets[0],offsets[1]}){apply("basePolygons",offset,true,{145,165,177,148},1);apply("baseLines",offset,false,{102,123,136,210},1);}
    apply("referencePolygons",offsets[0],true,{35,138,166,140},1);apply("referenceLines",offsets[0],false,{23,102,124,230},1);
    apply("hydroPolygons",offsets[1],true,{139,91,194,140},1);apply("hydroLines",offsets[1],false,{98,58,145,220},1);
    apply("referencePolygons",offsets[2],true,{22,166,182,122},1);apply("hydroPolygons",offsets[2],true,{227,70,154,112},1);
    apply("referenceLines",offsets[2],false,{8,124,136,240},2);apply("hydroLines",offsets[2],false,{224,41,132,225},1);
    constexpr char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";std::string encoded;encoded.reserve((rgba.size()+2)/3*4);
    for(std::size_t i=0;i<rgba.size();i+=3){const std::uint32_t value=(std::uint32_t(rgba[i])<<16)|
        (i+1<rgba.size()?std::uint32_t(rgba[i+1])<<8:0)|(i+2<rgba.size()?rgba[i+2]:0);
        encoded.push_back(alphabet[(value>>18)&63]);encoded.push_back(alphabet[(value>>12)&63]);
        encoded.push_back(i+1<rgba.size()?alphabet[(value>>6)&63]:'=');encoded.push_back(i+2<rgba.size()?alphabet[value&63]:'=');}
    auto result=Value::obj();result.object["width"]=Value::num(width);result.object["height"]=Value::num(height);result.object["rgba"]=Value::str(std::move(encoded));return result;
}
// Match pyshp's shapefile winding and hole grouping before GEOS repairs geometry.
double lakeRingArea(const std::vector<Point>& ring){double result=0;for(std::size_t i=1;i<ring.size();++i)
    result+=ring[i].x*(ring[i+1==ring.size()?1:i+1].y-ring[i-1].y);return result;}
bool lakeRingContains(const std::vector<Point>& ring,Point point){bool inside=false,above=ring[0].y>=point.y;Point prior=ring[0];
    for(std::size_t i=1;i<ring.size();++i){const auto current=ring[i];const bool nextAbove=current.y>=point.y;
        if(above!=nextAbove){const bool right=prior.x>=point.x;if(right==(current.x>=point.x)){if(right)inside=!inside;}
            else if(current.x-(current.y-point.y)*(prior.x-current.x)/(prior.y-current.y)>=point.x)inside=!inside;}
        above=nextAbove;prior=current;}return inside;}
Point lakeRingSample(const std::vector<Point>& ring){std::vector<Point> triplet;
    for(std::size_t i=0;i<=ring.size();++i){const Point point=i==ring.size()?ring[1]:ring[i];
        if(std::none_of(triplet.begin(),triplet.end(),[&](Point p){return p.x==point.x&&p.y==point.y;}))triplet.push_back(point);
        if(triplet.size()==3){const auto a=triplet[0],b=triplet[1],c=triplet[2];
            if((a.y-b.y)*(a.x-c.x)!=(a.y-c.y)*(a.x-b.x)){
                const std::vector<Point> triangle{a,b,c,a};const Point centroid{(a.x+b.x+c.x)/3,(a.y+b.y+c.y)/3};
                if(lakeRingArea(triangle)>=0&&lakeRingContains(ring,centroid))return centroid;}
            triplet.erase(triplet.begin());}}
    throw std::invalid_argument("Unable to sample lake polygon ring");}
Value lakePolygonRings(const Value& input){const auto& shapes=array(field(input,"shapes"));
    if(shapes.size()>4096)throw std::invalid_argument("Lake polygon batch exceeds budget");auto geometries=Value::arr();std::size_t vertices=0;
    for(const auto& shape:shapes){struct Ring{Value source;std::vector<Point> points;double area;std::array<double,4> bounds;};
        std::vector<Ring> shells,holes;for(const auto& source:array(shape)){const auto& coords=array(source);vertices+=coords.size();
            if(coords.size()<4||vertices>5000000)throw std::invalid_argument("Invalid lake polygon ring");
            Ring ring{source,{},0,{180,90,-180,-90}};ring.points.reserve(coords.size());
            for(const auto& item:coords){const Point p=inputPoint(item);ring.points.push_back(p);
                ring.bounds[0]=std::min(ring.bounds[0],p.x);ring.bounds[1]=std::min(ring.bounds[1],p.y);
                ring.bounds[2]=std::max(ring.bounds[2],p.x);ring.bounds[3]=std::max(ring.bounds[3],p.y);}
            if(ring.points.front().x!=ring.points.back().x||ring.points.front().y!=ring.points.back().y)
                throw std::invalid_argument("Unclosed lake polygon ring");
            ring.area=lakeRingArea(ring.points);if(ring.area<0)shells.push_back(std::move(ring));else holes.push_back(std::move(ring));}
        if(shells.empty()&&holes.empty())throw std::invalid_argument("Empty lake polygon shape");
        std::vector<std::vector<std::size_t>> assigned(shells.size());std::vector<std::size_t> orphans;
        for(std::size_t h=0;h<holes.size();++h){if(shells.size()==1){assigned[0].push_back(h);continue;}
            std::vector<std::size_t> candidates;for(std::size_t s=0;s<shells.size();++s){const auto a=shells[s].bounds,b=holes[h].bounds;
                if(a[0]<b[0]&&a[1]<b[1]&&a[2]>b[2]&&a[3]>b[3])candidates.push_back(s);}
            if(candidates.size()>1){const auto sample=lakeRingSample(holes[h].points);
                candidates.erase(std::remove_if(candidates.begin(),candidates.end(),[&](std::size_t s){return !lakeRingContains(shells[s].points,sample);}),candidates.end());}
            if(candidates.empty())orphans.push_back(h);else{const auto best=*std::min_element(candidates.begin(),candidates.end(),
                [&](std::size_t a,std::size_t b){return std::abs(shells[a].area)<std::abs(shells[b].area);});assigned[best].push_back(h);}}
        auto polygons=Value::arr();for(std::size_t s=0;s<shells.size();++s){auto polygon=Value::arr();polygon.array.push_back(shells[s].source);
            for(auto h:assigned[s])polygon.array.push_back(holes[h].source);polygons.array.push_back(std::move(polygon));}
        for(auto h:orphans){auto polygon=Value::arr();polygon.array.push_back(holes[h].source);polygons.array.push_back(std::move(polygon));}
        auto geo=Value::obj();geo.object["type"]=Value::str(polygons.array.size()==1?"Polygon":"MultiPolygon");
        geo.object["coordinates"]=polygons.array.size()==1?std::move(polygons.array.front()):std::move(polygons);geometries.array.push_back(std::move(geo));}
    auto result=Value::obj();result.object["geometries"]=std::move(geometries);return result;}
Value canonicalUpstream(const Value& input,bool useOrder){
    const auto exactInteger=[](const Value& value){const double n=pandoeditor::codecjson::finiteNumber(value);
        if(std::abs(n)>9007199254740991.0||std::trunc(n)!=n)throw std::invalid_argument("Invalid river identity");return static_cast<std::int64_t>(n);};
    const auto basin=exactInteger(field(input,"basin"));const auto& source=array(field(input,"candidates"));
    if(source.empty()||source.size()>1000000)throw std::invalid_argument("Bounded upstream candidates required");
    struct Candidate{Value id;std::int64_t numericId,basin,order;double area,flow,score,alignment;bool guided;};
    std::vector<Candidate> candidates;candidates.reserve(source.size());bool same=false;
    for(const auto& row:source){const auto& id=field(row,"id");const auto numericId=exactInteger(id),rowBasin=exactInteger(field(row,"basin")),order=exactInteger(field(row,"order"));
        const double area=pandoeditor::codecjson::finiteNumber(field(row,"area")),flow=pandoeditor::codecjson::finiteNumber(field(row,"flow"));
        const auto& scoreValue=field(row,"score"),&alignmentValue=field(row,"alignment");
        if((scoreValue.kind==Value::Null)!=(alignmentValue.kind==Value::Null))throw std::invalid_argument("Invalid upstream candidate");
        const bool guided=scoreValue.kind!=Value::Null;const double score=guided?pandoeditor::codecjson::finiteNumber(scoreValue):0,
          alignment=guided?pandoeditor::codecjson::finiteNumber(alignmentValue):0;
        if(guided&&(score<0||alignment < -1.0000000001||alignment > 1.0000000001))throw std::invalid_argument("Invalid guided branch score");
        same|=rowBasin==basin;candidates.push_back({id,numericId,rowBasin,order,area,flow,score,alignment,guided});}
    double largest=-std::numeric_limits<double>::infinity();for(const auto& row:candidates)if(!same||row.basin==basin)largest=std::max(largest,row.area);
    const Candidate* bestGuide=nullptr;const Candidate* fallback=nullptr;
    for(const auto& row:candidates){if(same&&row.basin!=basin)continue;
        if(!fallback||std::make_tuple(row.area,row.flow,useOrder?row.order:0,row.numericId)>
          std::make_tuple(fallback->area,fallback->flow,useOrder?fallback->order:0,fallback->numericId))fallback=&row;
        if(row.guided&&row.area>=largest*0.10&&(!bestGuide||
          std::make_tuple(row.score,-row.alignment,-row.area,-row.flow,row.numericId)<
          std::make_tuple(bestGuide->score,-bestGuide->alignment,-bestGuide->area,-bestGuide->flow,bestGuide->numericId)))bestGuide=&row;
    }
    const auto* selected=bestGuide&&bestGuide->score<=0.16?bestGuide:fallback;
    if(!selected)throw std::runtime_error("No upstream candidate");auto result=Value::obj();result.object["id"]=selected->id;return result;
}
// Geographic-degree score used to choose a named upstream branch at a confluence.
Value guidedBranchScore(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    std::size_t vertices=0;
    const auto readLine=[&](const char* key){const auto& source=array(field(input,key));vertices+=source.size();
        if(source.size()<2||vertices>1000000)throw std::invalid_argument("Bounded branch lines required");
        std::vector<Point> result;result.reserve(source.size());for(const auto& point:source)result.push_back(inputPoint(point));return result;};
    const auto current=readLine("current"),candidate=readLine("candidate"),reference=readLine("reference");
    const std::array<Point,2> currentEnds{current.front(),current.back()},candidateEnds{candidate.front(),candidate.back()};
    std::size_t ci=0,ui=0;double closest=std::numeric_limits<double>::infinity();
    for(std::size_t i=0;i<2;++i)for(std::size_t j=0;j<2;++j){const double gap=std::hypot(currentEnds[i].x-candidateEnds[j].x,currentEnds[i].y-candidateEnds[j].y);
        if(gap<closest){closest=gap;ci=i;ui=j;}}
    const auto confluence=currentEnds[ci],downEnd=currentEnds[1-ci],upEnd=candidateEnds[1-ui];
    const auto unit=[](double x,double y){const auto length=std::hypot(x,y);return length>0?Point{x/length,y/length}:Point{0,0};};
    const auto downstream=unit(downEnd.x-confluence.x,downEnd.y-confluence.y),upstream=unit(upEnd.x-confluence.x,upEnd.y-confluence.y);
    auto referenceLine=geometry(context.get(),reference,false),candidateLine=geometry(context.get(),candidate,false),point=geometry(context.get(),{confluence},true);
    double length=0,distance=0;if(!GEOSLength_r(context.get(),referenceLine.get(),&length)||!std::isfinite(length)||length<0||
       !GEOSDistance_r(context.get(),candidateLine.get(),referenceLine.get(),&distance)||!std::isfinite(distance)||distance<0)
        throw std::runtime_error("Guided branch geometry failed");
    const double position=length>0?GEOSProject_r(context.get(),referenceLine.get(),point.get()):0;
    if(!std::isfinite(position)||position<0)throw std::runtime_error("Guided branch projection failed");
    const double delta=std::min(0.025,std::max(length*0.08,1e-5));
    auto before=own(context.get(),GEOSInterpolate_r(context.get(),referenceLine.get(),std::max(0.0,position-delta)));
    auto after=own(context.get(),GEOSInterpolate_r(context.get(),referenceLine.get(),std::min(length,position+delta)));
    double bx,by,ax,ay;if(!GEOSGeomGetX_r(context.get(),before.get(),&bx)||!GEOSGeomGetY_r(context.get(),before.get(),&by)||
       !GEOSGeomGetX_r(context.get(),after.get(),&ax)||!GEOSGeomGetY_r(context.get(),after.get(),&ay))throw std::runtime_error("Guided branch tangent failed");
    auto tangent=unit(ax-bx,ay-by);if(tangent.x*downstream.x+tangent.y*downstream.y<0){tangent.x=-tangent.x;tangent.y=-tangent.y;}
    const double alignment=-upstream.x*tangent.x-upstream.y*tangent.y;
    auto result=Value::obj();result.object["score"]=Value::num(distance+std::max(0.0,1-alignment)*0.04);
    result.object["alignment"]=Value::num(alignment);return result;
}
// Match ReferenceGuides.nearest in geographic degrees, sharing one indexed tree per batch.
Value referenceGuides(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& source=array(field(input,"references")),&queries=array(field(input,"queries"));
    const double maximum=pandoeditor::codecjson::finiteNumber(field(input,"maxDistance"));
    if(source.size()>100000||queries.size()>100000||maximum<0)throw std::invalid_argument("Invalid Hydro reference guide batch");
    std::vector<Geometry> references;references.reserve(source.size());std::map<const GEOSGeometry*,std::size_t> indexes;
    std::unique_ptr<GEOSSTRtree,TreeDeleter> tree(GEOSSTRtree_create_r(context.get(),10),TreeDeleter{context.get()});
    if(!tree)throw std::runtime_error("GEOS reference tree failed");
    std::size_t vertices=0;
    const auto line=[&](const Value& row){const auto& coords=array(row);vertices+=coords.size();
        if(coords.size()<2||vertices>5000000)throw std::invalid_argument("Invalid Hydro reference line");
        std::vector<Point> points;points.reserve(coords.size());for(const auto& coordinate:coords)points.push_back(inputPoint(coordinate));
        return geometry(context.get(),points,false);};
    for(const auto& row:source){auto item=line(row);const auto* raw=item.get();indexes.emplace(raw,references.size());
        GEOSSTRtree_insert_r(context.get(),tree.get(),raw,const_cast<GEOSGeometry*>(raw));references.push_back(std::move(item));}
    auto matches=Value::arr();matches.array.reserve(queries.size());
    for(const auto& row:queries){if(array(row).empty()){matches.array.push_back(Value());continue;}
        auto query=line(row);if(references.empty()){matches.array.push_back(Value());continue;}
        const auto* nearest=GEOSSTRtree_nearest_r(context.get(),tree.get(),query.get());
        const auto found=indexes.find(nearest);double distance=0;
        if(found==indexes.end()||!GEOSDistance_r(context.get(),query.get(),nearest,&distance)||!std::isfinite(distance)||distance<0)
            throw std::runtime_error("GEOS nearest reference failed");
        if(distance>maximum){matches.array.push_back(Value());continue;}
        auto match=Value::obj();match.object["index"]=Value::num(static_cast<double>(found->second));
        match.object["distance"]=Value::num(distance);matches.array.push_back(std::move(match));}
    auto result=Value::obj();result.object["matches"]=std::move(matches);return result;
}
Value longestSourceLines(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& reaches=array(field(input,"reaches"));if(reaches.size()>100000)throw std::invalid_argument("Hydro reach batch exceeds budget");
    std::size_t vertices=0;auto indices=Value::arr();indices.array.reserve(reaches.size());
    for(const auto& reach:reaches){const auto& parts=array(reach);double longest=-1;Value selected;
        for(std::size_t i=0;i<parts.size();++i){const auto& coords=array(parts[i]);if(coords.size()<2)continue;
            vertices+=coords.size();if(vertices>5000000)throw std::invalid_argument("Hydro line vertices exceed budget");
            std::vector<Point> points;points.reserve(coords.size());for(const auto& point:coords)points.push_back(inputPoint(point));
            auto line=geometry(context.get(),points,false);double length=0;
            if(!GEOSLength_r(context.get(),line.get(),&length)||!std::isfinite(length))throw std::runtime_error("GEOS line length failed");
            if(length>longest){longest=length;selected=Value::num(static_cast<double>(i));}}
        indices.array.push_back(std::move(selected));}
    auto result=Value::obj();result.object["indices"]=std::move(indices);return result;
}
void collectReferenceIndex(void* item,void* user){
    static_cast<std::vector<std::size_t>*>(user)->push_back(*static_cast<std::size_t*>(item));
}
Value osmWaterwayMatches(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& candidates=array(field(input,"candidates")),&targets=array(field(input,"targets"));
    if(candidates.size()>1000000||targets.size()>100000)throw std::invalid_argument("Hydro OSM match batch exceeds budget");
    const auto bounds=[](const Value& source,bool nonempty){const auto& row=array(source);
        if(row.size()!=4)throw std::invalid_argument("Invalid Hydro OSM bounds");std::array<double,4> box{};
        for(std::size_t i=0;i<4;++i)box[i]=pandoeditor::codecjson::finiteNumber(row[i]);
        if(box[2]<box[0]||box[3]<box[1]||(nonempty&&(box[2]==box[0]||box[3]==box[1])))
            throw std::invalid_argument("Invalid Hydro OSM bounds");return box;};
    std::vector<std::array<double,4>> boxes;std::vector<Geometry> geometries;std::vector<std::size_t> ids;
    boxes.reserve(candidates.size());geometries.reserve(candidates.size());ids.reserve(candidates.size());
    std::unique_ptr<GEOSSTRtree,TreeDeleter> tree(GEOSSTRtree_create_r(context.get(),10),TreeDeleter{context.get()});
    if(!tree)throw std::runtime_error("GEOS OSM tree failed");
    for(const auto& row:candidates){const auto box=bounds(row,true);boxes.push_back(box);ids.push_back(ids.size());
        geometries.push_back(own(context.get(),GEOSGeom_createRectangle_r(context.get(),box[0],box[1],box[2],box[3])));
        GEOSSTRtree_insert_r(context.get(),tree.get(),geometries.back().get(),&ids.back());}
    auto matches=Value::arr();matches.array.reserve(targets.size());
    for(const auto& row:targets){const auto target=bounds(row,false);const double sx=std::max(target[2]-target[0],0.05),
        sy=std::max(target[3]-target[1],0.05),buffer=std::max(sx,sy)*0.08+0.05;
        auto envelope=own(context.get(),GEOSGeom_createRectangle_r(context.get(),target[0]-buffer,target[1]-buffer,target[2]+buffer,target[3]+buffer));
        std::vector<std::size_t> found;GEOSSTRtree_query_r(context.get(),tree.get(),envelope.get(),collectReferenceIndex,&found);
        std::vector<std::pair<double,std::size_t>> scores;
        for(const auto index:found){const auto& box=boxes[index];
            const double intersection=std::max(0.0,std::min(target[2],box[2])-std::max(target[0],box[0]))*
              std::max(0.0,std::min(target[3],box[3])-std::max(target[1],box[1]));
            const double area=(target[2]-target[0])*(target[3]-target[1])+(box[2]-box[0])*(box[3]-box[1])-intersection;
            const double overlap=area?intersection/area:0;
            const double edge=std::abs(box[0]-target[0])/sx+std::abs(box[2]-target[2])/sx+
              std::abs(box[1]-target[1])/sy+std::abs(box[3]-target[3])/sy;
            const double center=std::hypot(((box[0]+box[2])-(target[0]+target[2]))/(2*sx),
              ((box[1]+box[3])-(target[1]+target[3]))/(2*sy));
            if(overlap>=0.12||(center<=0.35&&edge<=2.5))scores.emplace_back(edge+center*0.8-overlap*2.0,index);}
        std::sort(scores.begin(),scores.end());
        if(scores.empty()||(scores.size()>1&&scores[1].first<=scores[0].first+0.15))matches.array.push_back(Value());
        else matches.array.push_back(Value::num(static_cast<double>(scores[0].second)));}
    auto result=Value::obj();result.object["matches"]=std::move(matches);return result;
}
// Calculate screen-space metrics on already clipped source lines and polygons.
Value calibrationScreen(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& bounds=array(field(input,"bounds"));if(bounds.size()!=4)throw std::invalid_argument("Invalid calibration screen bounds");
    std::array<double,4> box{};for(std::size_t i=0;i<4;++i)box[i]=pandoeditor::codecjson::finiteNumber(bounds[i]);
    const double width=pandoeditor::codecjson::finiteNumber(field(input,"width")),height=pandoeditor::codecjson::finiteNumber(field(input,"height"));
    if(box[2]<=box[0]||box[3]<=box[1]||width<=0||height<=0)throw std::invalid_argument("Invalid calibration screen dimensions");
    const double sx=width/(box[2]-box[0]),sy=height/(box[3]-box[1]),
      px=111.320*std::cos((box[1]+box[3])/2*3.14159265358979323846/180),py=110.574;
    const auto& lines=array(field(input,"lines")),&polygons=array(field(input,"polygons"));
    if(lines.size()>100000||polygons.size()>100000)throw std::invalid_argument("Calibration screen batch exceeds budget");
    std::size_t vertices=0;double lineLength=0,lineLengthKm=0,polygonArea=0;
    for(const auto& source:lines){const auto& coords=array(source);if(coords.size()<2)throw std::invalid_argument("Invalid calibration line");
        vertices+=coords.size();if(vertices>5000000)throw std::invalid_argument("Calibration coordinates exceed budget");
        auto previous=inputPoint(coords.front());for(std::size_t i=1;i<coords.size();++i){const auto current=inputPoint(coords[i]);
            lineLength+=std::hypot((current.x-previous.x)*sx,(current.y-previous.y)*sy);
            lineLengthKm+=std::hypot(current.x*px-previous.x*px,current.y*py-previous.y*py);previous=current;}}
    struct ReaderDeleter{GEOSContextHandle_t context;void operator()(GEOSGeoJSONReader* value)const{if(value)GEOSGeoJSONReader_destroy_r(context,value);}};
    std::unique_ptr<GEOSGeoJSONReader,ReaderDeleter> reader(GEOSGeoJSONReader_create_r(context.get()),ReaderDeleter{context.get()});
    if(!reader)throw std::runtime_error("GEOS GeoJSON reader failed");
    for(const auto& source:polygons){const auto json=source.encode();auto polygon=own(context.get(),GEOSGeoJSONReader_readGeometry_r(context.get(),reader.get(),json.c_str()));
        if(GEOSGeomTypeId_r(context.get(),polygon.get())!=GEOS_POLYGON)throw std::invalid_argument("Calibration polygon required");
        double area=0;if(!GEOSArea_r(context.get(),polygon.get(),&area)||!std::isfinite(area)||area<0)throw std::runtime_error("GEOS calibration area failed");polygonArea+=area;}
    const double areaPx=polygonArea*width*height/((box[2]-box[0])*(box[3]-box[1]));
    if(!std::isfinite(lineLength)||!std::isfinite(lineLengthKm)||!std::isfinite(areaPx))throw std::invalid_argument("Invalid calibration screen result");
    auto result=Value::obj();result.object["lineLengthPx"]=Value::num(lineLength);result.object["lineLengthKm"]=Value::num(lineLengthKm);
    result.object["polygonAreaPx"]=Value::num(areaPx);result.object["polygonAreaKm2"]=Value::num(polygonArea*std::abs(px*py));return result;
}
Value calibrationRiverDuplicates(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& sources=array(field(input,"baseLines")),&rivers=array(field(input,"rivers"));
    const double latitude=pandoeditor::codecjson::finiteNumber(field(input,"centerLat")),distance=pandoeditor::codecjson::finiteNumber(field(input,"distanceKm"));
    if(sources.size()>100000||rivers.size()>100000||std::abs(latitude)>90||distance<0)throw std::invalid_argument("Invalid calibration river batch");
    const double scaleX=111.320*std::cos(latitude*3.14159265358979323846/180),scaleY=110.574;
    std::size_t vertices=0;
    const auto project=[&](const Value& value){const auto& source=array(value);vertices+=source.size();
        if(source.size()<2||vertices>5000000)throw std::invalid_argument("Invalid calibration river line");
        std::vector<Point> points;points.reserve(source.size());for(const auto& row:source){const auto point=inputPoint(row);points.push_back({point.x*scaleX,point.y*scaleY});}return points;};
    std::vector<Geometry> base;std::vector<std::vector<Point>> basePoints;std::map<const GEOSGeometry*,std::size_t> indexes;
    base.reserve(sources.size());basePoints.reserve(sources.size());
    std::unique_ptr<GEOSSTRtree,TreeDeleter> tree(GEOSSTRtree_create_r(context.get(),10),TreeDeleter{context.get()});
    if(!tree)throw std::runtime_error("GEOS calibration tree failed");
    for(const auto& source:sources){auto points=project(source);auto line=geometry(context.get(),points,false);const auto* raw=line.get();
        indexes.emplace(raw,base.size());GEOSSTRtree_insert_r(context.get(),tree.get(),raw,const_cast<GEOSGeometry*>(raw));
        basePoints.push_back(std::move(points));base.push_back(std::move(line));}
    struct BufferDeleter{GEOSContextHandle_t context;void operator()(GEOSBufferParams* value)const{if(value)GEOSBufferParams_destroy_r(context,value);}};
    struct PreparedDeleter{GEOSContextHandle_t context;void operator()(const GEOSPreparedGeometry* value)const{if(value)GEOSPreparedGeom_destroy_r(context,value);}};
    std::unique_ptr<GEOSBufferParams,BufferDeleter> params(GEOSBufferParams_create_r(context.get()),BufferDeleter{context.get()});
    if(!params||!GEOSBufferParams_setEndCapStyle_r(context.get(),params.get(),GEOSBUF_CAP_FLAT)||
      !GEOSBufferParams_setJoinStyle_r(context.get(),params.get(),GEOSBUF_JOIN_ROUND)||
      !GEOSBufferParams_setQuadrantSegments_r(context.get(),params.get(),16))throw std::runtime_error("GEOS buffer setup failed");
    Geometry corridor(nullptr,GeosDeleter{context.get()});
    std::unique_ptr<const GEOSPreparedGeometry,PreparedDeleter> prepared(nullptr,PreparedDeleter{context.get()});
    if(!base.empty()){auto merged=unionLines(context.get(),base);corridor=own(context.get(),GEOSBufferWithParams_r(context.get(),merged.get(),params.get(),distance));
        prepared.reset(GEOSPrepare_r(context.get(),corridor.get()));if(!prepared)throw std::runtime_error("GEOS calibration preparation failed");}
    const auto direction=[](const std::vector<Point>& line){double longest=-1,dx=0,dy=0;
        for(std::size_t i=1;i<line.size();++i){const double x=line[i].x-line[i-1].x,y=line[i].y-line[i-1].y,length=std::hypot(x,y);
            if(length>longest){longest=length;dx=x;dy=y;}}const double norm=std::hypot(dx,dy);return norm>0?Point{dx/norm,dy/norm}:Point{0,0};};
    auto output=Value::arr();output.array.reserve(rivers.size());
    for(const auto& source:rivers){const auto& parts=array(source);std::vector<Geometry> lines;std::vector<std::vector<Point>> allPoints;
        std::size_t total=0,hits=0,main=0;double maximum=-1;
        for(const auto& part:parts){auto points=project(part);auto line=geometry(context.get(),points,false);double length=0;
            if(!GEOSLength_r(context.get(),line.get(),&length)||!std::isfinite(length))throw std::runtime_error("GEOS calibration line length failed");
            if(length>maximum){maximum=length;main=lines.size();}
            if(prepared){const int samples=std::max(5,std::min(9,static_cast<int>(std::ceil(length/25.0))+2));
                for(int i=0;i<samples;++i){auto point=own(context.get(),GEOSInterpolateNormalized_r(context.get(),line.get(),static_cast<double>(i)/(samples-1)));
                    const auto covered=GEOSPreparedCovers_r(context.get(),prepared.get(),point.get());if(covered==2)throw std::runtime_error("GEOS calibration coverage failed");
                    hits+=covered==1;++total;}}
            allPoints.push_back(std::move(points));lines.push_back(std::move(line));}
        const double fraction=static_cast<double>(hits)/std::max<std::size_t>(total,1);bool duplicate=false;
        if(prepared&&fraction>=0.18){const auto* nearest=GEOSSTRtree_nearest_r(context.get(),tree.get(),lines[main].get());
            const auto found=indexes.find(nearest);double separation=0;
            if(found==indexes.end()||!GEOSDistance_r(context.get(),lines[main].get(),nearest,&separation))throw std::runtime_error("GEOS calibration nearest line failed");
            const auto a=direction(allPoints[main]),b=direction(basePoints[found->second]);
            const double alignment=separation<=distance?std::abs(a.x*b.x+a.y*b.y):0;
            duplicate=fraction>=0.70||alignment>=0.62;}
        auto result=Value::obj();result.object["duplicate"]=Value::boolean(duplicate);result.object["duplicateFraction"]=Value::num(fraction);
        output.array.push_back(std::move(result));}
    auto result=Value::obj();result.object["rivers"]=std::move(output);return result;
}
Value calibrationLakeDuplicates(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& sources=array(field(input,"basePolygons")),&lakes=array(field(input,"lakes"));
    const double latitude=pandoeditor::codecjson::finiteNumber(field(input,"centerLat")),distance=pandoeditor::codecjson::finiteNumber(field(input,"distanceKm"));
    if(sources.size()>100000||lakes.size()>100000||std::abs(latitude)>90||distance<0)throw std::invalid_argument("Invalid calibration lake batch");
    const double scaleX=111.320*std::cos(latitude*3.14159265358979323846/180),scaleY=110.574;
    struct ReaderDeleter{GEOSContextHandle_t context;void operator()(GEOSGeoJSONReader* value)const{if(value)GEOSGeoJSONReader_destroy_r(context,value);}};
    std::unique_ptr<GEOSGeoJSONReader,ReaderDeleter> reader(GEOSGeoJSONReader_create_r(context.get()),ReaderDeleter{context.get()});
    if(!reader)throw std::runtime_error("GEOS GeoJSON reader failed");std::size_t vertices=0;
    const auto polygon=[&](const Value& source){const auto& type=field(source,"type"),&coordinates=field(source,"coordinates");
        if(type.kind!=Value::String||(type.string!="Polygon"&&type.string!="MultiPolygon"))throw std::invalid_argument("Calibration polygon required");
        const auto projectRings=[&](const Value& value){auto rings=Value::arr();for(const auto& ring:array(value)){auto output=Value::arr();
            const auto& points=array(ring);vertices+=points.size();if(points.size()<4||vertices>5000000)throw std::invalid_argument("Invalid calibration polygon ring");
            for(const auto& item:points){const auto p=inputPoint(item);auto point=Value::arr();point.array={Value::num(p.x*scaleX),Value::num(p.y*scaleY)};
                output.array.push_back(std::move(point));}rings.array.push_back(std::move(output));}return rings;};
        auto projected=Value::obj();projected.object["type"]=type;
        if(type.string=="Polygon")projected.object["coordinates"]=projectRings(coordinates);
        else{auto parts=Value::arr();for(const auto& value:array(coordinates))parts.array.push_back(projectRings(value));projected.object["coordinates"]=std::move(parts);}
        return own(context.get(),GEOSGeoJSONReader_readGeometry_r(context.get(),reader.get(),projected.encode().c_str()));};
    std::vector<Geometry> base;std::vector<std::size_t> ids;base.reserve(sources.size());ids.reserve(sources.size());
    std::unique_ptr<GEOSSTRtree,TreeDeleter> tree(GEOSSTRtree_create_r(context.get(),10),TreeDeleter{context.get()});
    if(!tree)throw std::runtime_error("GEOS calibration lake tree failed");
    for(const auto& row:sources){base.push_back(polygon(row));ids.push_back(ids.size());
        GEOSSTRtree_insert_r(context.get(),tree.get(),base.back().get(),&ids.back());}
    auto output=Value::arr();output.array.reserve(lakes.size());
    for(const auto& row:lakes){auto lake=polygon(row);std::vector<std::size_t> found;
        GEOSSTRtree_query_r(context.get(),tree.get(),lake.get(),collectReferenceIndex,&found);
        double lakeArea=0;if(!GEOSArea_r(context.get(),lake.get(),&lakeArea))throw std::runtime_error("GEOS calibration lake area failed");
        double best=0;bool duplicate=false;
        for(const auto index:found){auto intersection=own(context.get(),GEOSIntersection_r(context.get(),lake.get(),base[index].get()));
            double area=0,baseArea=0;if(!GEOSArea_r(context.get(),intersection.get(),&area)||!GEOSArea_r(context.get(),base[index].get(),&baseArea))
                throw std::runtime_error("GEOS calibration lake overlap failed");if(area<=0)continue;
            const double combined=lakeArea+baseArea-area,iou=combined?area/combined:0,coverage=lakeArea?area/lakeArea:0;best=std::max(best,coverage);
            auto center=own(context.get(),GEOSGetCentroid_r(context.get(),lake.get())),baseCenter=own(context.get(),GEOSGetCentroid_r(context.get(),base[index].get()));
            auto boundary=own(context.get(),GEOSBoundary_r(context.get(),lake.get())),baseBoundary=own(context.get(),GEOSBoundary_r(context.get(),base[index].get()));
            double centers=0,boundaries=0;if(!GEOSDistance_r(context.get(),center.get(),baseCenter.get(),&centers)||
              !GEOSDistance_r(context.get(),boundary.get(),baseBoundary.get(),&boundaries))throw std::runtime_error("GEOS calibration lake distance failed");
            if(iou>=0.08||coverage>=0.08||(centers<=distance&&boundaries<=distance*2)){duplicate=true;break;}}
        auto result=Value::obj();result.object["duplicate"]=Value::boolean(duplicate);result.object["duplicateFraction"]=Value::num(best);
        output.array.push_back(std::move(result));}
    auto result=Value::obj();result.object["lakes"]=std::move(output);return result;
}
Value calibrationClip(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& bounds=array(field(input,"bounds")),&sources=array(field(input,"geometries"));
    if(bounds.size()!=4||sources.size()>100000)throw std::invalid_argument("Invalid calibration clipping batch");
    std::array<double,4> box{};for(std::size_t i=0;i<4;++i)box[i]=pandoeditor::codecjson::finiteNumber(bounds[i]);
    if(box[2]<=box[0]||box[3]<=box[1])throw std::invalid_argument("Invalid calibration clipping bounds");
    auto region=own(context.get(),GEOSGeom_createRectangle_r(context.get(),box[0],box[1],box[2],box[3]));
    struct ReaderDeleter{GEOSContextHandle_t context;void operator()(GEOSGeoJSONReader* value)const{if(value)GEOSGeoJSONReader_destroy_r(context,value);}};
    struct WriterDeleter{GEOSContextHandle_t context;void operator()(GEOSGeoJSONWriter* value)const{if(value)GEOSGeoJSONWriter_destroy_r(context,value);}};
    struct TextDeleter{GEOSContextHandle_t context;void operator()(char* value)const{if(value)GEOSFree_r(context,value);}};
    std::unique_ptr<GEOSGeoJSONReader,ReaderDeleter> reader(GEOSGeoJSONReader_create_r(context.get()),ReaderDeleter{context.get()});
    std::unique_ptr<GEOSGeoJSONWriter,WriterDeleter> writer(GEOSGeoJSONWriter_create_r(context.get()),WriterDeleter{context.get()});
    if(!reader||!writer)throw std::runtime_error("GEOS GeoJSON setup failed");
    auto output=Value::arr();output.array.reserve(sources.size());
    for(const auto& source:sources){auto geometry=own(context.get(),GEOSGeoJSONReader_readGeometry_r(context.get(),reader.get(),source.encode().c_str()));
        const auto valid=GEOSisValid_r(context.get(),geometry.get());if(valid==2)throw std::runtime_error("GEOS source validity failed");
        if(!valid)geometry=own(context.get(),GEOSBuffer_r(context.get(),geometry.get(),0,16));
        auto clipped=own(context.get(),GEOSIntersection_r(context.get(),geometry.get(),region.get()));
        std::unique_ptr<char,TextDeleter> json(GEOSGeoJSONWriter_writeGeometry_r(context.get(),writer.get(),clipped.get(),-1),TextDeleter{context.get()});
        if(!json)throw std::runtime_error("GEOS clipped GeoJSON failed");output.array.push_back(pandoeditor::codecjson::parse(json.get()));}
    auto result=Value::obj();result.object["geometries"]=std::move(output);return result;
}
Value calibrationRiverFeatures(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& bounds=array(field(input,"bounds")),&reaches=array(field(input,"reaches"));
    if(bounds.size()!=4||reaches.size()>100000)throw std::invalid_argument("Invalid calibration river feature batch");
    std::array<double,4> box{};for(std::size_t i=0;i<4;++i)box[i]=pandoeditor::codecjson::finiteNumber(bounds[i]);
    const double width=pandoeditor::codecjson::finiteNumber(field(input,"width")),height=pandoeditor::codecjson::finiteNumber(field(input,"height"));
    if(box[2]<=box[0]||box[3]<=box[1]||width<=0||height<=0)throw std::invalid_argument("Invalid calibration dimensions");
    const double sx=width/(box[2]-box[0]),sy=height/(box[3]-box[1]),
      px=111.320*std::cos((box[1]+box[3])/2*3.14159265358979323846/180),py=110.574;
    auto region=own(context.get(),GEOSGeom_createRectangle_r(context.get(),box[0],box[1],box[2],box[3]));
    std::size_t vertices=0;auto output=Value::arr();
    const double flows[]={1,1.3,1.7,2.1,2.5,3,3.5,4},areas[]={-.5,-.25,0,.25,.5,.7};
    for(const auto& reach:reaches){const auto& id=field(reach,"id"),&next=field(reach,"next"),&main=field(reach,"mainRiver"),&orderValue=field(reach,"order");
        const double sourceId=pandoeditor::codecjson::finiteNumber(id),nextId=pandoeditor::codecjson::finiteNumber(next),mainId=pandoeditor::codecjson::finiteNumber(main),
          order=pandoeditor::codecjson::finiteNumber(orderValue),flow=pandoeditor::codecjson::finiteNumber(field(reach,"flow")),
          upstream=pandoeditor::codecjson::finiteNumber(field(reach,"upstreamArea"));
        for(const double value:{sourceId,nextId,mainId,order})if(std::trunc(value)!=value||std::abs(value)>9007199254740991.0)
            throw std::invalid_argument("Invalid calibration river identity");
        if(sourceId<=0||nextId<0)throw std::invalid_argument("Invalid calibration river identity");
        double maximum=-std::numeric_limits<double>::infinity();for(const auto fw:flows)for(const auto aw:areas)
            maximum=std::max(maximum,order+fw*std::log10(std::max(flow,1e-6))+aw*std::log10(std::max(upstream,1e-6)));
        if(maximum<5)continue;
        const auto& sourceParts=array(field(reach,"parts"));std::size_t sourceCoordinates=0;auto parts=Value::arr();double length=0,screen=0;
        std::function<void(const GEOSGeometry*)> collect=[&](const GEOSGeometry* item){
            const int type=GEOSGeomTypeId_r(context.get(),item);if(type==GEOS_LINESTRING){
                const auto* sequence=GEOSGeom_getCoordSeq_r(context.get(),item);unsigned int count=0;
                if(!sequence||!GEOSCoordSeq_getSize_r(context.get(),sequence,&count))throw std::runtime_error("GEOS calibration coordinates failed");
                if(count<2)return;auto line=Value::arr();Point previous{};
                for(unsigned int i=0;i<count;++i){Point point{};if(!GEOSCoordSeq_getX_r(context.get(),sequence,i,&point.x)||!GEOSCoordSeq_getY_r(context.get(),sequence,i,&point.y))
                    throw std::runtime_error("GEOS calibration coordinate failed");
                    if(i){length+=std::hypot(point.x*px-previous.x*px,point.y*py-previous.y*py);
                        screen+=std::hypot((point.x-previous.x)*sx,(point.y-previous.y)*sy);}previous=point;
                    auto coordinate=Value::arr();coordinate.array={Value::num(point.x),Value::num(point.y)};line.array.push_back(std::move(coordinate));}
                parts.array.push_back(std::move(line));return;}
            if(type==GEOS_MULTILINESTRING||type==GEOS_GEOMETRYCOLLECTION){const int count=GEOSGetNumGeometries_r(context.get(),item);
                if(count<0)throw std::runtime_error("GEOS calibration geometry count failed");for(int i=0;i<count;++i)collect(GEOSGetGeometryN_r(context.get(),item,i));}
        };
        for(const auto& source:sourceParts){const auto& coords=array(source);if(coords.size()<2)continue;sourceCoordinates+=coords.size();vertices+=coords.size();
            if(vertices>5000000)throw std::invalid_argument("Calibration river coordinates exceed budget");
            std::vector<Point> points;points.reserve(coords.size());for(const auto& point:coords)points.push_back(inputPoint(point));
            auto line=geometry(context.get(),points,false),clipped=own(context.get(),GEOSIntersection_r(context.get(),line.get(),region.get()));collect(clipped.get());}
        if(parts.array.empty())continue;
        auto row=Value::obj();row.object["sourceId"]=id;row.object["nextDown"]=next;row.object["mainRiver"]=main;row.object["order"]=orderValue;
        row.object["flow"]=Value::num(flow);row.object["upstreamArea"]=Value::num(upstream);row.object["parts"]=std::move(parts);
        row.object["sourceCoordinateCount"]=Value::num(static_cast<double>(sourceCoordinates));row.object["lengthKm"]=Value::num(length);
        row.object["screenLength"]=Value::num(screen);row.object["duplicate"]=Value::boolean(false);row.object["duplicateFraction"]=Value::num(0);
        row.object["assignedStage"]=Value();output.array.push_back(std::move(row));}
    auto result=Value::obj();result.object["rivers"]=std::move(output);return result;
}
Value calibrationLakeFeatures(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    const auto& bounds=array(field(input,"bounds")),&lakes=array(field(input,"lakes"));
    if(bounds.size()!=4||lakes.size()>100000)throw std::invalid_argument("Invalid calibration lake feature batch");
    std::array<double,4> box{};for(std::size_t i=0;i<4;++i)box[i]=pandoeditor::codecjson::finiteNumber(bounds[i]);
    const double width=pandoeditor::codecjson::finiteNumber(field(input,"width")),height=pandoeditor::codecjson::finiteNumber(field(input,"height"));
    if(box[2]<=box[0]||box[3]<=box[1]||width<=0||height<=0)throw std::invalid_argument("Invalid calibration dimensions");
    auto region=own(context.get(),GEOSGeom_createRectangle_r(context.get(),box[0],box[1],box[2],box[3]));
    struct ReaderDeleter{GEOSContextHandle_t context;void operator()(GEOSGeoJSONReader* value)const{if(value)GEOSGeoJSONReader_destroy_r(context,value);}};
    struct WriterDeleter{GEOSContextHandle_t context;void operator()(GEOSGeoJSONWriter* value)const{if(value)GEOSGeoJSONWriter_destroy_r(context,value);}};
    struct TextDeleter{GEOSContextHandle_t context;void operator()(char* value)const{if(value)GEOSFree_r(context,value);}};
    std::unique_ptr<GEOSGeoJSONReader,ReaderDeleter> reader(GEOSGeoJSONReader_create_r(context.get()),ReaderDeleter{context.get()});
    std::unique_ptr<GEOSGeoJSONWriter,WriterDeleter> writer(GEOSGeoJSONWriter_create_r(context.get()),WriterDeleter{context.get()});
    if(!reader||!writer)throw std::runtime_error("GEOS GeoJSON setup failed");auto output=Value::arr();
    for(const auto& source:lakes){const auto& id=field(source,"id"),&name=field(source,"name"),&geometryValue=field(source,"geometry");
        const double numericId=pandoeditor::codecjson::finiteNumber(id),area=pandoeditor::codecjson::finiteNumber(field(source,"areaKm2")),
          shore=pandoeditor::codecjson::finiteNumber(field(source,"shorelineKm"));
        if(numericId<=0||std::trunc(numericId)!=numericId||numericId>9007199254740991.0||name.kind!=Value::String)
            throw std::invalid_argument("Invalid calibration lake identity");
        if(area<1)continue;
        auto original=own(context.get(),GEOSGeoJSONReader_readGeometry_r(context.get(),reader.get(),geometryValue.encode().c_str()));
        const auto valid=GEOSisValid_r(context.get(),original.get());if(valid==2)throw std::runtime_error("GEOS lake validity failed");
        if(!valid)original=own(context.get(),GEOSBuffer_r(context.get(),original.get(),0,16));
        const int sourceCoordinates=GEOSGetNumCoordinates_r(context.get(),original.get());
        if(sourceCoordinates<0)throw std::runtime_error("GEOS lake coordinate count failed");
        auto clipped=own(context.get(),GEOSIntersection_r(context.get(),original.get(),region.get()));auto polygons=Value::arr();
        std::function<void(const GEOSGeometry*)> collect=[&](const GEOSGeometry* item){const auto empty=GEOSisEmpty_r(context.get(),item);
            if(empty==2)throw std::runtime_error("GEOS lake empty check failed");if(empty)return;const int type=GEOSGeomTypeId_r(context.get(),item);
            if(type==GEOS_POLYGON){std::unique_ptr<char,TextDeleter> json(GEOSGeoJSONWriter_writeGeometry_r(context.get(),writer.get(),item,-1),TextDeleter{context.get()});
                if(!json)throw std::runtime_error("GEOS lake GeoJSON failed");auto polygon=pandoeditor::codecjson::parse(json.get());
                polygons.array.push_back(field(polygon,"coordinates"));return;}
            if(type==GEOS_MULTIPOLYGON||type==GEOS_GEOMETRYCOLLECTION){const int count=GEOSGetNumGeometries_r(context.get(),item);
                if(count<0)throw std::runtime_error("GEOS lake geometry count failed");for(int i=0;i<count;++i)collect(GEOSGetGeometryN_r(context.get(),item,i));}};
        collect(clipped.get());if(polygons.array.empty())continue;
        double clippedArea=0;if(!GEOSArea_r(context.get(),clipped.get(),&clippedArea))throw std::runtime_error("GEOS clipped lake area failed");
        auto geo=Value::obj();geo.object["type"]=Value::str(polygons.array.size()==1?"Polygon":"MultiPolygon");
        geo.object["coordinates"]=polygons.array.size()==1?std::move(polygons.array.front()):std::move(polygons);
        auto row=Value::obj();row.object["sourceId"]=id;row.object["name"]=name;row.object["areaKm2"]=Value::num(area);
        row.object["shorelineKm"]=Value::num(shore);row.object["geometry"]=std::move(geo);
        row.object["sourceCoordinateCount"]=Value::num(sourceCoordinates);
        row.object["screenArea"]=Value::num(clippedArea*width*height/((box[2]-box[0])*(box[3]-box[1])));
        row.object["duplicate"]=Value::boolean(false);row.object["duplicateFraction"]=Value::num(0);row.object["assignedStage"]=Value();
        output.array.push_back(std::move(row));}
    auto result=Value::obj();result.object["lakes"]=std::move(output);return result;
}
Value calibrationReferenceFeatures(const Value& input){
    const auto& kind=field(input,"kind");if(kind.kind!=Value::String||(kind.string!="river"&&kind.string!="lake"))
        throw std::invalid_argument("Invalid calibration reference kind");
    const auto& geometries=array(field(input,"geometries"));if(geometries.size()>1000)throw std::invalid_argument("Calibration reference batch exceeds budget");
    auto clipRequest=Value::obj();clipRequest.object["bounds"]=field(input,"bounds");clipRequest.object["geometries"]=field(input,"geometries");
    const auto clipped=calibrationClip(clipRequest);auto output=Value::arr();output.array.reserve(geometries.size());
    for(const auto& geo:array(field(clipped,"geometries"))){auto lines=Value::arr(),polygons=Value::arr();
        std::function<void(const Value&)> collect=[&](const Value& item){const auto& type=field(item,"type");if(type.kind!=Value::String)
                throw std::runtime_error("Invalid calibration reference geometry");
            if(type.string=="GeometryCollection"){for(const auto& child:array(field(item,"geometries")))collect(child);return;}
            if(type.string=="LineString"){const auto& coords=field(item,"coordinates");if(!array(coords).empty())lines.array.push_back(coords);return;}
            if(type.string=="MultiLineString"){for(const auto& line:array(field(item,"coordinates")))if(!array(line).empty())lines.array.push_back(line);return;}
            if(type.string=="Polygon"){if(!array(field(item,"coordinates")).empty())polygons.array.push_back(item);return;}
            if(type.string=="MultiPolygon"){for(const auto& coords:array(field(item,"coordinates")))if(!array(coords).empty()){
                auto polygon=Value::obj();polygon.object["type"]=Value::str("Polygon");polygon.object["coordinates"]=coords;polygons.array.push_back(std::move(polygon));}}
        };collect(geo);
        const bool river=kind.string=="river",present=river?!lines.array.empty():!polygons.array.empty();auto row=Value::obj();
        row.object["count"]=Value::num(present?1:0);
        if(present){auto screenInput=Value::obj();screenInput.object["bounds"]=field(input,"bounds");screenInput.object["width"]=field(input,"width");
            screenInput.object["height"]=field(input,"height");screenInput.object["lines"]=river?std::move(lines):Value::arr();
            screenInput.object["polygons"]=river?Value::arr():std::move(polygons);const auto metrics=calibrationScreen(screenInput);
            if(river){row.object["lengthKm"]=field(metrics,"lineLengthKm");row.object["screenLength"]=field(metrics,"lineLengthPx");}
            else{row.object["areaKm2"]=field(metrics,"polygonAreaKm2");row.object["screenArea"]=field(metrics,"polygonAreaPx");}}
        else if(river){row.object["lengthKm"]=Value::num(0);row.object["screenLength"]=Value::num(0);}
        else{row.object["areaKm2"]=Value::num(0);row.object["screenArea"]=Value::num(0);}
        output.array.push_back(std::move(row));}
    auto result=Value::obj();result.object["features"]=std::move(output);return result;
}
Value sharedBoundaryDistances(const Value& input){
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    struct ReaderDeleter{GEOSContextHandle_t context;void operator()(GEOSGeoJSONReader* reader)const{if(reader)GEOSGeoJSONReader_destroy_r(context,reader);}};
    std::unique_ptr<GEOSGeoJSONReader,ReaderDeleter> reader(GEOSGeoJSONReader_create_r(context.get()),ReaderDeleter{context.get()});
    if(!reader)throw std::runtime_error("GEOS GeoJSON reader failed");
    const auto country=[&](const char* key){const auto& source=field(input,key);const auto json=source.encode();
        auto result=own(context.get(),GEOSGeoJSONReader_readGeometry_r(context.get(),reader.get(),json.c_str()));
        const int type=GEOSGeomTypeId_r(context.get(),result.get());
        if(type!=GEOS_POLYGON&&type!=GEOS_MULTIPOLYGON)throw std::invalid_argument("Country geometry must be a polygon");
        return result;};
    auto left=country("left"),right=country("right");
    auto leftBoundary=own(context.get(),GEOSBoundary_r(context.get(),left.get()));
    auto rightBoundary=own(context.get(),GEOSBoundary_r(context.get(),right.get()));
    auto shared=own(context.get(),GEOSIntersection_r(context.get(),leftBoundary.get(),rightBoundary.get()));
    const char empty=GEOSisEmpty_r(context.get(),shared.get());
    if(empty==1)throw std::invalid_argument("Shared country boundary is empty");
    if(empty!=0)throw std::runtime_error("Shared country boundary check failed");
    const auto& points=array(field(input,"points"));if(points.empty()||points.size()>1000000)throw std::invalid_argument("Bounded boundary points required");
    std::vector<double> distances;distances.reserve(points.size());
    for(const auto& source:points){auto point=geometry(context.get(),{inputPoint(source)},true);double distance=0;
        if(!GEOSDistance_r(context.get(),shared.get(),point.get(),&distance)||!std::isfinite(distance)||distance<0)
            throw std::runtime_error("Shared country boundary distance failed");
        distances.push_back(distance);}
    auto result=Value::obj();result.object["distances"]=numberArray(distances);return result;
}
Value sampleDistances(GEOSContextHandle_t context,const LineSet& source,const GEOSGeometry* target,int count){
    const double total=std::accumulate(source.lengths.begin(),source.lengths.end(),0.0);
    if(!std::isfinite(total)||total<=0)throw std::invalid_argument("Invalid total river length");
    auto distances=Value::arr();
    for(int index=0;index<count;++index){
        const double position=total*(index+0.5)/count;double before=0;std::size_t part=0;
        for(;part+1<source.lines.size()&&position>before+source.lengths[part];++part)before+=source.lengths[part];
        const auto local=std::min(source.lengths[part],position-before);
        auto point=own(context,GEOSInterpolate_r(context,source.lines[part].get(),local));double distance=0;
        if(!GEOSDistance_r(context,point.get(),target,&distance)||!std::isfinite(distance))throw std::runtime_error("GEOS sample distance failed");
        distances.array.push_back(Value::num(distance));
    }
    return distances;
}
Value run(const Value& input){
    if(input.kind!=Value::Object)throw std::invalid_argument("Expected point-screen object");
    const auto requested=input.object.find("mode");
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="calibration-image-layers")
        return calibrationImageLayers(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="lake-polygon-rings")
        return lakePolygonRings(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="calibration-reference-features")
        return calibrationReferenceFeatures(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="calibration-lake-features")
        return calibrationLakeFeatures(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="calibration-river-features")
        return calibrationRiverFeatures(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="calibration-clip")
        return calibrationClip(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="calibration-lake-duplicates")
        return calibrationLakeDuplicates(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="calibration-river-duplicates")
        return calibrationRiverDuplicates(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="calibration-screen")
        return calibrationScreen(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="osm-waterway-match")
        return osmWaterwayMatches(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="longest-lines")
        return longestSourceLines(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="reference-guides")
        return referenceGuides(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&
      (requested->second.string=="guided-branches"||requested->second.string=="canonical-upstreams"||requested->second.string=="guided-upstreams")){
        const auto& mode=requested->second.string;const bool branches=mode=="guided-branches";
        const auto& source=array(field(input,branches?"branches":"groups"));
        if(source.size()>10000)throw std::invalid_argument("Hydro guide batch exceeds budget");
        auto rows=Value::arr();rows.array.reserve(source.size());
        for(const auto& row:source)rows.array.push_back(branches?guidedBranchScore(row):canonicalUpstream(row,mode=="canonical-upstreams"));
        auto result=Value::obj();result.object[branches?"branches":"groups"]=std::move(rows);return result;
    }
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&
      (requested->second.string=="canonical-upstream"||requested->second.string=="guided-upstream"))
        return canonicalUpstream(input,requested->second.string=="canonical-upstream");
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="guided-branch")
        return guidedBranchScore(input);
    if(requested!=input.object.end()&&requested->second.kind==Value::String&&requested->second.string=="shared-boundary")
        return sharedBoundaryDistances(input);
    const auto crs=utm(field(input,"crs"));const auto& sourceLines=array(field(input,"lines"));const auto& sourcePoints=array(field(input,"points"));
    std::string mode="union_if_line";
    const auto modeField=input.object.find("mode");
    if(modeField!=input.object.end()){
        if(modeField->second.kind!=Value::String)throw std::invalid_argument("Invalid point-screen mode");
        mode=modeField->second.string;
    }
    if(mode!="union_if_line"&&mode!="parts"&&mode!="tree"&&mode!="vector")throw std::invalid_argument("Invalid point-screen mode");
    if(sourceLines.empty()||sourceLines.size()>100000||sourcePoints.size()>10000)
        throw std::invalid_argument("Invalid point-screen input size");
    using ProjContext=std::unique_ptr<PJ_CONTEXT,decltype(&proj_context_destroy)>;
    using Proj=std::unique_ptr<PJ,decltype(&proj_destroy)>;
    ProjContext projContext(proj_context_create(),proj_context_destroy);if(!projContext)throw std::runtime_error("PROJ context failed");
    Proj raw(proj_create_crs_to_crs(projContext.get(),"EPSG:4326",crs.c_str(),nullptr),proj_destroy);
    if(!raw)throw std::runtime_error("PROJ CRS creation failed");
    Proj projection(proj_normalize_for_visualization(projContext.get(),raw.get()),proj_destroy);
    if(!projection)throw std::runtime_error("PROJ axis normalization failed");
    using GeosContext=std::unique_ptr<GEOSContextHandle_HS,decltype(&GEOS_finish_r)>;
    GeosContext context(GEOS_init_r(),GEOS_finish_r);if(!context)throw std::runtime_error("GEOS context failed");
    std::size_t totalVertices=0;
    auto hydro=projectLines(context.get(),projection.get(),sourceLines,totalVertices,mode!="union_if_line",mode=="vector");
    auto& lines=hydro.lines;
    if(mode=="vector"){
        if(!sourcePoints.empty())throw std::invalid_argument("Vector mode does not accept points");
        const double sampleCount=pandoeditor::codecjson::finiteNumber(field(input,"samples"));
        if(!std::isfinite(sampleCount)||std::floor(sampleCount)!=sampleCount||sampleCount<1||sampleCount>1000)
            throw std::invalid_argument("Invalid vector sample count");
        auto reference=projectLines(context.get(),projection.get(),array(field(input,"referenceLines")),totalVertices,true,true);
        auto hydroUnion=unionLines(context.get(),hydro.lines),referenceUnion=unionLines(context.get(),reference.lines);
        auto result=Value::obj(),bounds=Value::arr();for(double value:reference.bounds)bounds.array.push_back(Value::num(value));
        result.object["lineLengthsMeters"]=numberArray(hydro.lengths);result.object["referenceLengthsMeters"]=numberArray(reference.lengths);
        result.object["referenceBoundsMeters"]=std::move(bounds);
        result.object["hydroToReferenceMeters"]=sampleDistances(context.get(),hydro,referenceUnion.get(),static_cast<int>(sampleCount));
        result.object["referenceToHydroMeters"]=sampleDistances(context.get(),reference,hydroUnion.get(),static_cast<int>(sampleCount));
        return result;
    }
    // Shapely's original implementation projects onto the unary union only
    // when it is a single LineString; otherwise it searches input parts.
    Geometry merged(nullptr,GeosDeleter{context.get()});bool mergedLine=false;
    if(mode=="union_if_line"){
        merged=unionLines(context.get(),lines);
        mergedLine=GEOSGeomTypeId_r(context.get(),merged.get())==GEOS_LINESTRING;
    }
    std::unique_ptr<GEOSSTRtree,TreeDeleter> tree(nullptr,TreeDeleter{context.get()});
    if(mode=="tree"){
        tree.reset(GEOSSTRtree_create_r(context.get(),10));if(!tree)throw std::runtime_error("GEOS tree creation failed");
        for(const auto& line:lines)GEOSSTRtree_insert_r(context.get(),tree.get(),line.get(),line.get());
    }
    auto points=Value::arr();
    for(const auto& source:sourcePoints){
        auto point=geometry(context.get(),{transformed(projection.get(),inputPoint(source),PJ_FWD)},true);
        double best=std::numeric_limits<double>::infinity();Point nearest{};
        const auto inspect=[&](const GEOSGeometry* line){
            const double distance=GEOSProject_r(context.get(),line,point.get());if(distance<0||!std::isfinite(distance))throw std::runtime_error("GEOS projection failed");
            auto candidate=own(context.get(),GEOSInterpolate_r(context.get(),line,distance));double separation=0,x=0,y=0;
            if(!GEOSDistance_r(context.get(),point.get(),candidate.get(),&separation)||!GEOSGeomGetX_r(context.get(),candidate.get(),&x)||
               !GEOSGeomGetY_r(context.get(),candidate.get(),&y)||!std::isfinite(separation))throw std::runtime_error("GEOS closest point failed");
            if(separation<best){best=separation;nearest={x,y};}
        };
        if(mergedLine)inspect(merged.get());
        else if(tree){const auto* line=GEOSSTRtree_nearest_r(context.get(),tree.get(),point.get());if(!line)throw std::runtime_error("GEOS nearest-line query failed");inspect(line);}
        else for(const auto& line:lines)inspect(line.get());
        const auto geographic=transformed(projection.get(),nearest,PJ_INV);auto coordinate=Value::arr();coordinate.array={Value::num(geographic.x),Value::num(geographic.y)};
        auto result=Value::obj();result.object["distanceMeters"]=Value::num(best);result.object["nearestLonLat"]=coordinate;points.array.push_back(std::move(result));
    }
    auto result=Value::obj();result.object["lineLengthsMeters"]=numberArray(hydro.lengths);result.object["points"]=std::move(points);return result;
}
}
int main(){
    try{const std::string input((std::istreambuf_iterator<char>(std::cin)),std::istreambuf_iterator<char>());
        if(input.size()>256*1024*1024)throw std::invalid_argument("Point-screen input too large");
        std::cout<<run(pandoeditor::codecjson::parse(input)).encode()<<'\n';return 0;
    }catch(const std::exception& error){std::cerr<<"hydro-point-screen: "<<error.what()<<'\n';return 1;}
}
