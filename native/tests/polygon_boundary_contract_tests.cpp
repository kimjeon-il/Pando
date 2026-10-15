#include <pandoeditor/map/renderpacket.h>
#include <pandoeditor/map/geometrypacketcache.h>
#include <pandoeditor/map/renderlod.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace {
using namespace pandoeditor;
void require(bool condition,const char* message) {
    if(!condition)throw std::runtime_error(message);
}
using Endpoint=std::array<std::int64_t,2>;
using Edge=std::pair<Endpoint,Endpoint>;
constexpr double radians=3.14159265358979323846/180.;

Endpoint normalized(double longitude,double latitude) {
    constexpr auto half=180'000'000ll,world=360'000'000ll;
    const auto lon=std::int64_t(std::llround(longitude*1'000'000.));
    const auto wrapped=((lon+half)%world+world)%world-half;
    return {wrapped,std::int64_t(std::llround(latitude*1'000'000.))};
}
Edge edge(double ax,double ay,double bx,double by) {
    Endpoint a=normalized(ax,ay),b=normalized(bx,by);
    if(b<a)std::swap(a,b);
    return {a,b};
}
double sphericalDistance(double lonA,double latA,double lonB,double latB) {
    const auto vector=[](double longitude,double latitude) {
        const double lon=longitude*radians,lat=latitude*radians,horizontal=std::cos(lat);
        return std::array<double,3>{horizontal*std::cos(lon),horizontal*std::sin(lon),std::sin(lat)};
    };
    const auto a=vector(lonA,latA),b=vector(lonB,latB);
    const double dot=std::clamp(a[0]*b[0]+a[1]*b[1]+a[2]*b[2],-1.,1.);
    return std::acos(dot)/radians;
}
Geometry rectangle(double west,double south,double east,double north) {
    return {"Polygon",{},{},{{{{west,south},{east,south},{east,north},{west,north},{west,south}}}}};
}
void checkSharedBoundary(const Geometry& geometry,const char* fixture) {
    const auto packet=makePolygonGeometryPacket(geometry);
    require(packet.triangleCount&&packet.triangleCount==packet.globeTriangleCount,
            "both views retain matching refined triangle counts");
    require(packet.boundarySegmentCount==packet.boundaryStartsEnds->size()/4,
            "refined stroke buffer counts match");
    require(packet.boundarySegmentCount>0&&packet.unitSphereBoundaryStartsEnds->size()==
            packet.boundarySegmentCount*6,"each boundary endpoint has spherical coordinates");
    const auto& positions=*packet.positions;
    const auto& triangles=*packet.globeIndices;
    std::map<Edge,unsigned> faceEdges;
    for(std::size_t i=0;i+2<triangles.size();i+=3) {
        const auto a=triangles[i],b=triangles[i+1],c=triangles[i+2];
        require(a<packet.vertexCount&&b<packet.vertexCount&&c<packet.vertexCount,"fill index range");
        for(const auto [first,last]:{std::pair{a,b},std::pair{b,c},std::pair{c,a}}) {
            const double x=positions[first*2],y=positions[first*2+1];
            const double u=positions[last*2],v=positions[last*2+1];
            require(sphericalDistance(x,y,u,v)<=.50001,"refined fill edge exceeds angular limit");
            ++faceEdges[edge(x,y,u,v)];
        }
    }
    const auto& outline=*packet.boundaryStartsEnds;
    for(std::size_t i=0;i<outline.size();i+=4) {
        const double ax=outline[i],ay=outline[i+1],bx=outline[i+2],by=outline[i+3];
        require(sphericalDistance(ax,ay,bx,by)<=.50001,"stroke edge exceeds angular limit");
        const auto incidence=faceEdges[edge(ax,ay,bx,by)];
        if(incidence!=1) {
            std::ostringstream message;
            message<<fixture<<": visible outline must be one exposed refined fill edge; "
                <<ax<<','<<ay<<" -> "<<bx<<','<<by<<" has "<<incidence<<" incident faces";
            throw std::runtime_error(message.str());
        }
        require(std::abs(std::abs(ay)-90)>1e-7&&std::abs(std::abs(by)-90)>1e-7,
                "artificial polar closure must remain hidden");
    }
}
void rectangleAndSourceImmutability() {
    auto geometry=rectangle(0,0,8,5);
    const auto oldShell=geometry.polygons.front().front();
    const auto packet=makePolygonGeometryPacket(geometry);
    require(packet.vertexCount>4&&packet.triangleCount>2&&packet.boundarySegmentCount>4,
            "long source edges are refined alongside fill");
    require(packet.ringCoordinates->size()==8&&packet.ringOffsets->back()==4,
            "original render rings remain independent of fill subdivision");
    require(geometry.polygons.front().front().size()==oldShell.size()&&
            geometry.polygons.front().front()[1].x==oldShell[1].x,
            "render packets never modify editable source coordinates");
    checkSharedBoundary(geometry,"rectangle");
    const auto standalone=makeStrokeGeometryPacket(geometry);
    require(*standalone.startsEnds==*packet.boundaryStartsEnds,
            "standalone polygon stroke uses identical rendered boundary coordinates");
}
void holesAndDateline() {
    auto geometry=rectangle(0,0,8,6);
    geometry.polygons.front().push_back({{2,2},{2,4},{4,4},{4,2},{2,2}});
    checkSharedBoundary(geometry,"holes");
    auto dateline=rectangle(179,-1,-179,1);
    checkSharedBoundary(dateline,"dateline");
    const auto packet=makePolygonGeometryPacket(dateline);
    for(std::size_t i=0;i<packet.boundaryStartsEnds->size();i+=4)
        require(std::abs((*packet.boundaryStartsEnds)[i]-(*packet.boundaryStartsEnds)[i+2])<180,
                "dateline stroke does not become an unwrapped world chord");
}
void polarClosure() {
    Geometry cap{"Polygon",{},{},{{{
        {-180,80},{-90,80},{0,80},{90,80},{180,80},{180,90},{-180,90},{-180,80}
    }}}};
    checkSharedBoundary(cap,"polar cap");
}
void cacheReusesOnePreparedSurface() {
    GeometryPacketCache cache;
    const ObjectRef owner{"generic","land"};
    const GeometryRef firstVersion{"land-geometry",1};
    const auto geometry=rectangle(0,0,8,5);
    const auto fill=cache.polygon(owner,firstVersion,geometry);
    const auto builds=cache.stats().builds;
    const auto stroke=cache.stroke(owner,firstVersion,geometry);
    require(cache.stats().builds==builds&&cache.stats().hits>0,
            "outline is a hit on the prepared fill, never a second tessellation");
    require(stroke.startsEnds==fill.boundaryStartsEnds&&
            stroke.unitSphereStartsEnds==fill.unitSphereBoundaryStartsEnds,
            "fill and outline share exact immutable buffers");
    auto replacement=rectangle(0,0,9,5);
    const auto next=cache.polygon(owner,{"land-geometry",2},replacement);
    require(next.boundaryStartsEnds!=fill.boundaryStartsEnds,
            "geometry version change invalidates the cached boundary");
}
void renderLodKeepsOnePolygonSubdivisionOwner() {
    const auto source=rectangle(0,0,8,5);
    const auto derived=prepareRenderGeometry(source,RenderLod::Coarse,LodPolicy::Independent,false,true);
    require(derived.polygons.front().front().size()==source.polygons.front().front().size(),
            "LOD simplifies source rings but leaves spherical edge refinement to polygon tessellation");
    checkSharedBoundary(derived,"render LOD");
}
}
int main() {
    try {
        rectangleAndSourceImmutability();
        holesAndDateline();
        polarClosure();
        cacheReusesOnePreparedSurface();
        renderLodKeepsOnePolygonSubdivisionOwner();
        std::cout<<"native polygon common boundary: five focused cases passed\n";
        return 0;
    }catch(const std::exception& error) {
        std::cerr<<"native polygon common boundary: "<<error.what()<<'\n';
        return 1;
    }
}
