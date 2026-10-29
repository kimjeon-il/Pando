// Read-only point-to-mainstem screen shared by the independent Hydro audits.
// Input and output are JSON on stdin/stdout. This tool never edits map data.
#include <pandoeditor/losslessjson.h>
#include <geos_c.h>
#include <proj.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <iterator>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
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
Value run(const Value& input){
    const auto crs=utm(field(input,"crs"));const auto& sourceLines=array(field(input,"lines"));const auto& sourcePoints=array(field(input,"points"));
    std::string mode="union_if_line";
    const auto modeField=input.object.find("mode");
    if(modeField!=input.object.end()){
        if(modeField->second.kind!=Value::String)throw std::invalid_argument("Invalid point-screen mode");
        mode=modeField->second.string;
    }
    if(mode!="union_if_line"&&mode!="parts")throw std::invalid_argument("Invalid point-screen mode");
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
    std::vector<Geometry> lines;auto lengths=Value::arr();std::size_t totalVertices=0;
    for(const auto& source:sourceLines){
        const auto& coordinates=array(source);totalVertices+=coordinates.size();
        if(coordinates.size()<2||totalVertices>5000000)throw std::invalid_argument("Invalid point-screen line");
        std::vector<Point> projected;projected.reserve(coordinates.size());
        for(const auto& coordinate:coordinates)projected.push_back(transformed(projection.get(),inputPoint(coordinate),PJ_FWD));
        auto line=geometry(context.get(),projected,false);double length=0;
        if(!GEOSLength_r(context.get(),line.get(),&length)||!std::isfinite(length))throw std::runtime_error("GEOS line length failed");
        if(mode=="parts"&&length<=0)continue;
        lengths.array.push_back(Value::num(length));lines.push_back(std::move(line));
    }
    if(lines.empty())throw std::invalid_argument("No usable point-screen lines");
    // Shapely's original implementation projects onto the unary union only
    // when it is a single LineString; otherwise it searches input parts.
    Geometry merged(nullptr,GeosDeleter{context.get()});bool mergedLine=false;
    if(mode=="union_if_line"){
        std::vector<GEOSGeometry*> clones;clones.reserve(lines.size());
        for(const auto& line:lines){auto* clone=GEOSGeom_clone_r(context.get(),line.get());if(!clone){for(auto* item:clones)GEOSGeom_destroy_r(context.get(),item);throw std::runtime_error("GEOS clone failed");}clones.push_back(clone);}
        auto* collectionRaw=GEOSGeom_createCollection_r(context.get(),GEOS_MULTILINESTRING,clones.data(),static_cast<unsigned int>(clones.size()));
        if(!collectionRaw){for(auto* item:clones)GEOSGeom_destroy_r(context.get(),item);throw std::runtime_error("GEOS collection failed");}
        auto collection=own(context.get(),collectionRaw);merged=own(context.get(),GEOSUnaryUnion_r(context.get(),collection.get()));
        mergedLine=GEOSGeomTypeId_r(context.get(),merged.get())==GEOS_LINESTRING;
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
        if(mergedLine)inspect(merged.get());else for(const auto& line:lines)inspect(line.get());
        const auto geographic=transformed(projection.get(),nearest,PJ_INV);auto coordinate=Value::arr();coordinate.array={Value::num(geographic.x),Value::num(geographic.y)};
        auto result=Value::obj();result.object["distanceMeters"]=Value::num(best);result.object["nearestLonLat"]=coordinate;points.array.push_back(std::move(result));
    }
    auto result=Value::obj();result.object["lineLengthsMeters"]=std::move(lengths);result.object["points"]=std::move(points);return result;
}
}
int main(){
    try{const std::string input((std::istreambuf_iterator<char>(std::cin)),std::istreambuf_iterator<char>());
        if(input.size()>256*1024*1024)throw std::invalid_argument("Point-screen input too large");
        std::cout<<run(pandoeditor::codecjson::parse(input)).encode()<<'\n';return 0;
    }catch(const std::exception& error){std::cerr<<"hydro-point-screen: "<<error.what()<<'\n';return 1;}
}
