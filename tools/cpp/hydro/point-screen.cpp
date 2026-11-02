// Read-only point-to-mainstem screen shared by the independent Hydro audits.
// Input and output are JSON on stdin/stdout. This tool never edits map data.
#include <pandoeditor/losslessjson.h>
#include <geos_c.h>
#include <proj.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <iterator>
#include <limits>
#include <memory>
#include <numeric>
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
