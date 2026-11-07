#include <pandoeditor/polygonmesh.h>
#include <earcut.hpp>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <unordered_map>

namespace pandoeditor {
namespace {
using Position=MeshPosition;
constexpr double radians=3.141592653589793238462643383279502884/180.;
constexpr double parameterEpsilon=1e-12;
bool samePoint(const Position& a,const Position& b) {
    return std::abs(a[0]-b[0])<=parameterEpsilon&&std::abs(a[1]-b[1])<=parameterEpsilon;
}
constexpr double AREA_EPSILON=1e-20;
using Triangle=MeshTriangle;
std::uint64_t edgeKey(std::uint32_t a,std::uint32_t b) {
    if(a>b)std::swap(a,b);
    return (std::uint64_t(a)<<32)|b;
}
double unwrapLongitude(double longitude,double anchor) {
    while(longitude>180)longitude-=360;
    while(longitude< -180)longitude+=360;
    while(longitude-anchor>180)longitude-=360;
    while(longitude-anchor< -180)longitude+=360;
    return longitude;
}
std::array<double,3> unitVector(const Position& value) {
    const auto lon=value[0]*radians,lat=value[1]*radians;
    const double horizontal=std::cos(lat);
    return {horizontal*std::cos(lon),horizontal*std::sin(lon),std::sin(lat)};
}
double dot(const std::array<double,3>& a,const std::array<double,3>& b) {
    return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
}
double triangleArea(const Position& a,const Position& b,const Position& c) {
    return ((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
}
bool artificialClosure(const Position& a,const Position& b) {
    const auto pole=[](const Position& p){return std::abs(std::abs(p[1])-90)<=1e-7;};
    const auto seam=[](const Position& p){
        auto lon=std::fmod(p[0],360.);
        if(lon>180)lon-=360;
        if(lon< -180)lon+=360;
        return std::abs(std::abs(lon)-180)<=1e-7;
    };
    return pole(a)||pole(b)||(seam(a)&&seam(b)&&std::abs(a[1]-b[1])>1e-7);
}
MeshParameterSpace parameterSpace(const std::vector<Position>& ring) {
    double west=std::numeric_limits<double>::infinity();
    double east=-west,south=west,north=-west;
    for(const auto& p:ring){
        west=std::min(west,p[0]);east=std::max(east,p[0]);
        south=std::min(south,p[1]);north=std::max(north,p[1]);
    }
    return {east-west>=300&&south<=-89.5?-1:east-west>=300&&north>=89.5?1:0};
}
std::vector<Triangle> refinePolygon(
    std::vector<Position>& geo,std::vector<Position>& parameter,
    const std::vector<std::uint32_t>& triangulation,const MeshParameterSpace& space,
    std::vector<MeshBoundaryChain>& chains,std::vector<Triangle>& removed,
    double maxEdgeDegrees,bool validate,const std::function<void()>& checkCancelled) {
    std::vector<Triangle> triangles;
    for(std::size_t i=0;i+2<triangulation.size();i+=3){
        const Triangle tri{triangulation[i],triangulation[i+1],triangulation[i+2]};
        if(std::abs(triangleArea(parameter[tri[0]],parameter[tri[1]],parameter[tri[2]]))>AREA_EPSILON)
            triangles.push_back(tri);
        else removed.push_back(tri);
    }
    if(triangles.empty())throw std::invalid_argument("polygon triangulation has no nondegenerate triangles");
    std::vector<std::array<double,3>> vectors;
    vectors.reserve(geo.size()*2);
    for(const auto& p:geo)vectors.push_back(unitVector(p));
    const auto minimumDot=pandoeditor::boundaryMinimumDot(maxEdgeDegrees);
    const auto needsSplit=[&](std::uint32_t a,std::uint32_t b) {
        return dot(vectors[a],vectors[b])<minimumDot-1e-14;
    };
    const auto area=[&](const std::vector<Triangle>& values) {
        double sum=0;for(const auto& t:values)sum+=std::abs(triangleArea(parameter[t[0]],parameter[t[1]],parameter[t[2]]));return sum;
    };
    const double sourceArea=validate?area(triangles):0;
    for(int pass=0;pass<40;++pass){
        if(checkCancelled)checkCancelled();
        std::unordered_map<std::uint64_t,std::uint32_t> midpointIndices;
        std::vector<std::pair<std::uint32_t,std::uint32_t>> splitEdges;
        const auto mark=[&](std::uint32_t a,std::uint32_t b){
            if(!needsSplit(a,b))return;
            const auto key=edgeKey(a,b);
            if(midpointIndices.emplace(key,0).second)splitEdges.emplace_back(a,b);
        };
        for(const auto& tri:triangles){
            mark(tri[0],tri[1]);mark(tri[1],tri[2]);mark(tri[2],tri[0]);
        }
        if(splitEdges.empty()) {
            if(validate&&std::abs(area(triangles)-sourceArea)>std::max(1e-10,sourceArea*1e-10))
                throw std::runtime_error("polygon refinement does not preserve projected area");
            return triangles;
        }
        for(const auto& edge:splitEdges){
            const auto [a,b]=edge;
            const Position mid{(parameter[a][0]+parameter[b][0])/2,
                               (parameter[a][1]+parameter[b][1])/2};
            const double anchor=(geo[a][0]+geo[b][0])/2;
            if(geo.size()>=std::numeric_limits<std::uint32_t>::max())
                throw std::overflow_error("refined polygon vertex index overflow");
            const auto index=static_cast<std::uint32_t>(geo.size());
            parameter.push_back(mid);
            geo.push_back(space.unproject(mid,anchor));
            vectors.push_back(unitVector(geo.back()));
            midpointIndices[edgeKey(a,b)]=index;
        }
        // Track the same boundary splits as the triangles, without changing
        // the editable input rings or introducing artificial polar seams.
        for(auto& chain:chains){
            std::vector<std::uint32_t> nextVertices;
            std::vector<std::uint8_t> nextVisible;
            nextVertices.reserve(chain.vertices.size()*2);
            nextVisible.reserve(chain.visible.size()*2);
            for(std::size_t i=0;i<chain.vertices.size();++i){
                const auto a=chain.vertices[i],b=chain.vertices[(i+1)%chain.vertices.size()];
                nextVertices.push_back(a);nextVisible.push_back(chain.visible[i]);
                if(const auto it=midpointIndices.find(edgeKey(a,b));it!=midpointIndices.end()){
                    nextVertices.push_back(it->second);nextVisible.push_back(chain.visible[i]);
                }
            }
            chain.vertices=std::move(nextVertices);chain.visible=std::move(nextVisible);
        }
        std::vector<Triangle> next;
        next.reserve(triangles.size()*4);
        const auto add=[&](std::uint32_t a,std::uint32_t b,std::uint32_t c) {
            if(std::abs(triangleArea(parameter[a],parameter[b],parameter[c]))>AREA_EPSILON)
                next.push_back({a,b,c});
            else removed.push_back({a,b,c});
        };
        const auto midpoint=[&](std::uint32_t a,std::uint32_t b) {
            const auto it=midpointIndices.find(edgeKey(a,b));
            return it==midpointIndices.end()?std::numeric_limits<std::uint32_t>::max():it->second;
        };
        constexpr auto none=std::numeric_limits<std::uint32_t>::max();
        for(const auto& t:triangles){
            const auto a=t[0],b=t[1],c=t[2];
            const auto ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);
            const int mask=(ab!=none?1:0)|(bc!=none?2:0)|(ca!=none?4:0);
            if(mask==0)add(a,b,c);
            else if(mask==1){add(a,ab,c);add(ab,b,c);}
            else if(mask==2){add(b,bc,a);add(bc,c,a);}
            else if(mask==4){add(c,ca,b);add(ca,a,b);}
            else if(mask==3){
                add(ab,b,bc);
                if(dot(vectors[a],vectors[bc])>=dot(vectors[ab],vectors[c])){
                    add(a,ab,bc);add(a,bc,c);
                }else{add(a,ab,c);add(ab,bc,c);}
            }else if(mask==6){
                add(bc,c,ca);
                if(dot(vectors[b],vectors[ca])>=dot(vectors[bc],vectors[a])){
                    add(b,bc,ca);add(b,ca,a);
                }else{add(b,bc,a);add(bc,ca,a);}
            }else if(mask==5){
                add(ca,a,ab);
                if(dot(vectors[c],vectors[ab])>=dot(vectors[ca],vectors[b])){
                    add(c,ca,ab);add(c,ab,b);
                }else{add(c,ca,b);add(ca,ab,b);}
            }else{
                add(a,ab,ca);add(ab,b,bc);add(ca,bc,c);add(ab,bc,ca);
            }
        }
        triangles=std::move(next);
    }
    for(const auto& triangle:triangles)
        for(const auto [a,b]:{std::pair{triangle[0],triangle[1]},
                            std::pair{triangle[1],triangle[2]},
                            std::pair{triangle[2],triangle[0]}})
            if(needsSplit(a,b))throw std::runtime_error("polygon spherical refinement did not converge");
    return triangles;
}

std::vector<Position> unwrapRing(const Ring& ring,double anchor,bool anchored) {
    auto size=ring.size();
    if(size>1&&samePoint({ring.front().x,ring.front().y},{ring.back().x,ring.back().y}))--size;
    std::vector<Position> result;result.reserve(size);
    for(std::size_t i=0;i<size;++i) {
        const auto p=ring[i];
        if(!std::isfinite(p.x)||!std::isfinite(p.y)||p.y< -90||p.y>90||std::abs(p.x)>1e9)
            throw std::invalid_argument("polygon has invalid geographic coordinate");
        const auto longitude=result.empty()&&!anchored?p.x:unwrapLongitude(p.x,result.empty()?anchor:result.back()[0]);
        result.push_back({longitude,p.y});
    }
    return result;
}
double ringArea(const std::vector<Position>& ring) {
    double sum=0;const auto origin=ring.front();
    for(std::size_t i=0;i<ring.size();++i){const auto a=ring[i],b=ring[(i+1)%ring.size()];
        sum+=(a[0]-origin[0])*(b[1]-origin[1])-(b[0]-origin[0])*(a[1]-origin[1]);}
    return std::abs(sum/2);
}
}
MeshPosition MeshParameterSpace::project(const MeshPosition& p) const {
    if(!pole)return p;
    const double distance=pole>0?90-p[1]:90+p[1],longitude=p[0]*radians;
    return {distance*std::cos(longitude),distance*std::sin(longitude)};
}
MeshPosition MeshParameterSpace::unproject(const MeshPosition& p,double anchor) const {
    if(!pole)return {unwrapLongitude(p[0],anchor),p[1]};
    const double distance=std::hypot(p[0],p[1]);
    if(distance<=parameterEpsilon)return {anchor,pole>0?90.:-90.};
    return {unwrapLongitude(std::atan2(p[1],p[0])/radians,anchor),
        std::clamp(pole>0?90-distance:distance-90,-90.,90.)};
}
PolygonFillMesh buildPolygonFillMesh(const Polygon& polygon,double maxEdgeDegrees,bool validate,
    const std::function<void()>& checkCancelled) {
    if(checkCancelled)checkCancelled();
    if(polygon.empty())throw std::invalid_argument("polygon has no shell");
    const auto outer=unwrapRing(polygon.front(),0,false);
    if(outer.size()<3)throw std::invalid_argument("polygon shell has fewer than three vertices");
    PolygonFillMesh mesh;mesh.space=parameterSpace(outer);
    double anchor=0;for(const auto& p:outer)anchor+=p[0];anchor/=double(outer.size());
    std::vector<std::vector<Position>> rings;rings.reserve(polygon.size());
    for(std::size_t ringIndex=0;ringIndex<polygon.size();++ringIndex) {
        if(checkCancelled)checkCancelled();
        const auto source=ringIndex?unwrapRing(polygon[ringIndex],anchor,true):outer;
        std::vector<Position> clean,parameter;
        for(const auto& point:source) {
            const auto projected=mesh.space.project(point);
            if(!parameter.empty()&&samePoint(parameter.back(),projected))continue;
            clean.push_back(point);parameter.push_back(projected);
        }
        if(parameter.size()>1&&samePoint(parameter.front(),parameter.back())){clean.pop_back();parameter.pop_back();}
        if(parameter.size()<3)throw std::invalid_argument("polygon ring collapses in projection");
        MeshBoundaryChain chain;
        for(std::size_t i=0;i<clean.size();++i){
            if(mesh.geographic.size()>=std::numeric_limits<std::uint32_t>::max())
                throw std::overflow_error("polygon vertex index overflow");
            chain.vertices.push_back(static_cast<std::uint32_t>(mesh.geographic.size()));
            chain.visible.push_back(!artificialClosure(clean[i],clean[(i+1)%clean.size()]));
            mesh.geographic.push_back(clean[i]);mesh.parameter.push_back(parameter[i]);
        }
        mesh.sourceRingOffsets.push_back(static_cast<std::uint32_t>(mesh.geographic.size()));
        mesh.boundaryChains.push_back(std::move(chain));rings.push_back(std::move(parameter));
    }
    const auto original=mapbox::earcut<std::uint32_t>(rings);
    double expected=ringArea(rings.front());for(std::size_t i=1;i<rings.size();++i)expected-=ringArea(rings[i]);
    if(original.empty()||original.size()%3||expected<=AREA_EPSILON)
        throw std::invalid_argument("polygon triangulation has empty or degenerate area");
    double actual=0;
    for(std::size_t i=0;i<original.size();i+=3){
        for(std::size_t j=0;j<3;++j)if(original[i+j]>=mesh.parameter.size())
            throw std::invalid_argument("polygon triangulation vertex out of range");
        actual+=std::abs(triangleArea(mesh.parameter[original[i]],mesh.parameter[original[i+1]],mesh.parameter[original[i+2]]));
    }
    if(std::abs(actual-expected)>std::max(1e-9,expected*1e-8))
        throw std::invalid_argument("polygon triangulation does not preserve shell/hole area");
    const double limit=std::isfinite(maxEdgeDegrees)?std::max(kDefaultBoundaryEdgeDegrees,maxEdgeDegrees):kDefaultBoundaryEdgeDegrees;
    mesh.triangles=refinePolygon(mesh.geographic,mesh.parameter,original,mesh.space,mesh.boundaryChains,
        mesh.removedTriangles,limit,validate,checkCancelled);
    return mesh;
}
}
