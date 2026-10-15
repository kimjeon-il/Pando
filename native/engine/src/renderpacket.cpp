#include <pandoeditor/map/renderpacket.h>
#include <pandoeditor/boundaryrefinement.h>
#include <earcut.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <unordered_map>
#include <utility>

namespace {
using Position=std::array<double,2>;
constexpr double radians=3.141592653589793238462643383279502884/180;
std::shared_ptr<const std::vector<float>> sphereBuffer(const std::vector<float>& geographic) {
    auto result=std::make_shared<std::vector<float>>();
    result->reserve(geographic.size()/2*3);
    for(std::size_t i=0;i+1<geographic.size();i+=2) {
        const double lon=geographic[i]*radians,lat=geographic[i+1]*radians;
        const double horizontal=std::cos(lat);
        result->push_back(static_cast<float>(horizontal*std::sin(lon)));
        result->push_back(static_cast<float>(std::sin(lat)));
        result->push_back(static_cast<float>(horizontal*std::cos(lon)));
    }
    return result;
}
void requireFinite(pandoeditor::Point point) {
    if(!std::isfinite(point.x)||!std::isfinite(point.y)||point.y< -90||point.y>90)
        throw std::invalid_argument("non-finite or invalid geographic coordinate");
}
std::vector<Position> unwrap(const pandoeditor::Ring& ring,double anchor,bool closed) {
    const auto size=ring.size()-(closed&&ring.size()>1&&
        ring.front().x==ring.back().x&&ring.front().y==ring.back().y?1:0);
    std::vector<Position> result;
    result.reserve(size);
    for(std::size_t i=0;i<size;++i) {
        const auto source=ring[i];requireFinite(source);
        const double previous=result.empty()?anchor:result.back()[0];
        const double longitude=source.x+360*std::round((previous-source.x)/360);
        if(!std::isfinite(longitude)||std::abs(longitude)>std::numeric_limits<float>::max())
            throw std::invalid_argument("unwrapped longitude out of range");
        result.push_back({longitude,source.y});
    }
    return result;
}
void appendPositions(std::vector<float>& buffer,const std::vector<Position>& points) {
    for(const auto& point:points) {
        buffer.push_back(static_cast<float>(point[0]));
        buffer.push_back(static_cast<float>(point[1]));
    }
}

constexpr double MAX_RENDER_EDGE_DEGREES=pandoeditor::kDefaultBoundaryEdgeDegrees;
constexpr double AREA_EPSILON=1e-20;
using Triangle=std::array<std::uint32_t,3>;
std::uint64_t edgeKey(std::uint32_t a,std::uint32_t b) {
    if(a>b)std::swap(a,b);
    return (std::uint64_t(a)<<32)|b;
}
double unwrapLongitude(double longitude,double anchor) {
    return longitude+360*std::round((anchor-longitude)/360);
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
double packedCoordinate(double coordinate) {
    return std::round(coordinate*1'000'000.0)/1'000'000.0;
}
Position packed(const Position& point) {
    return {packedCoordinate(point[0]),packedCoordinate(point[1])};
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
struct ParameterSpace {
    int pole=0;
    Position project(const Position& p) const {
        if(!pole)return p;
        const double distance=pole>0?90-p[1]:90+p[1];
        const double longitude=p[0]*radians;
        return {distance*std::cos(longitude),distance*std::sin(longitude)};
    }
    Position unproject(const Position& p,double anchor) const {
        if(!pole)return {unwrapLongitude(p[0],anchor),p[1]};
        const double distance=std::hypot(p[0],p[1]);
        if(distance<=1e-12)return {anchor,pole>0?90.:-90.};
        const double longitude=std::atan2(p[1],p[0])/radians;
        return {unwrapLongitude(longitude,anchor),
                std::clamp(pole>0?90-distance:distance-90,-90.,90.)};
    }
};
ParameterSpace parameterSpace(const std::vector<Position>& ring) {
    double west=std::numeric_limits<double>::infinity();
    double east=-west,south=west,north=-west;
    for(const auto& p:ring){
        west=std::min(west,p[0]);east=std::max(east,p[0]);
        south=std::min(south,p[1]);north=std::max(north,p[1]);
    }
    return {east-west>=300&&south<=-89.5?-1:east-west>=300&&north>=89.5?1:0};
}
struct BoundaryChain {
    std::vector<std::uint32_t> vertices;
    std::vector<std::uint8_t> visible;
};
std::vector<Triangle> refinePolygon(
    std::vector<Position>& geo,std::vector<Position>& parameter,
    const std::vector<std::uint32_t>& triangulation,const ParameterSpace& space,
    std::vector<BoundaryChain>& chains) {
    std::vector<Triangle> triangles;
    for(std::size_t i=0;i+2<triangulation.size();i+=3){
        const Triangle tri{triangulation[i],triangulation[i+1],triangulation[i+2]};
        if(std::abs(triangleArea(parameter[tri[0]],parameter[tri[1]],parameter[tri[2]]))>AREA_EPSILON)
            triangles.push_back(tri);
    }
    if(triangles.empty())throw std::invalid_argument("polygon triangulation has no nondegenerate triangles");
    std::vector<std::array<double,3>> vectors;
    vectors.reserve(geo.size()*2);
    for(const auto& p:geo)vectors.push_back(unitVector(p));
    const auto minimumDot=pandoeditor::boundaryMinimumDot(MAX_RENDER_EDGE_DEGREES);
    const auto needsSplit=[&](std::uint32_t a,std::uint32_t b) {
        return dot(vectors[a],vectors[b])<minimumDot-1e-14;
    };
    for(int pass=0;pass<40;++pass){
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
        if(splitEdges.empty())return triangles;
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

}

PolygonGeometryPacket makePolygonGeometryPacket(const pandoeditor::Geometry& geometry) {
    if(geometry.type!="Polygon"&&geometry.type!="MultiPolygon")
        throw std::invalid_argument("polygon packet requires polygon geometry");
    auto positions=std::make_shared<std::vector<float>>();
    auto indices=std::make_shared<std::vector<std::uint32_t>>();
    auto globeIndices=std::make_shared<std::vector<std::uint32_t>>();
    auto boundary=std::make_shared<std::vector<float>>();
    auto ringCoordinates=std::make_shared<std::vector<float>>();
    auto ringOffsets=std::make_shared<std::vector<std::uint32_t>>(1,0);
    auto polygonOffsets=std::make_shared<std::vector<std::uint32_t>>(1,0);
    for(const auto& polygon:geometry.polygons) {
        if(polygon.empty()||polygon.front().empty())continue;
        const auto outer=unwrap(polygon.front(),polygon.front().front().x,true);
        if(outer.size()<3)throw std::invalid_argument("polygon shell has fewer than three vertices");
        const auto space=parameterSpace(outer);
        double anchor=0;
        for(const auto& point:outer)anchor+=point[0];
        anchor/=double(outer.size());
        std::vector<Position> geographic,parameter;
        std::vector<std::vector<Position>> parameterRings;
        std::vector<BoundaryChain> boundaryChains;
        parameterRings.reserve(polygon.size());
        boundaryChains.reserve(polygon.size());
        for(std::size_t ringIndex=0;ringIndex<polygon.size();++ringIndex) {
            const auto source=unwrap(polygon[ringIndex],ringIndex?anchor:polygon.front().front().x,true);
            if(source.size()<3)throw std::invalid_argument("polygon ring has fewer than three vertices");
            std::vector<Position> ringParameter;
            BoundaryChain chain;
            for(const auto& point:source) {
                const auto transformed=space.project(point);
                if(!ringParameter.empty()&&ringParameter.back()==transformed)continue;
                if(geographic.size()>=std::numeric_limits<std::uint32_t>::max())
                    throw std::overflow_error("polygon vertex index overflow");
                chain.vertices.push_back(static_cast<std::uint32_t>(geographic.size()));
                geographic.push_back(point);
                parameter.push_back(transformed);
                ringParameter.push_back(transformed);
                ringCoordinates->push_back(static_cast<float>(point[0]));
                ringCoordinates->push_back(static_cast<float>(point[1]));
            }
            if(ringParameter.size()<3)throw std::invalid_argument("polygon ring collapses in projection");
            for(std::size_t i=0;i<chain.vertices.size();++i) {
                const auto a=geographic[chain.vertices[i]];
                const auto b=geographic[chain.vertices[(i+1)%chain.vertices.size()]];
                chain.visible.push_back(!artificialClosure(a,b));
            }
            boundaryChains.push_back(std::move(chain));
            parameterRings.push_back(std::move(ringParameter));
            ringOffsets->push_back(static_cast<std::uint32_t>(ringCoordinates->size()/2));
        }
        polygonOffsets->push_back(static_cast<std::uint32_t>(ringOffsets->size()-1));
        const auto original=mapbox::earcut<std::uint32_t>(parameterRings);
        if(original.empty()||original.size()%3)throw std::invalid_argument("polygon triangulation failed");
        auto triangles=refinePolygon(geographic,parameter,original,space,boundaryChains);
        // Quantized positions and actual retained triangles, not raw source
        // rings, determine which visible boundary edges survive.
        std::vector<Triangle> retained;
        std::set<Triangle> seenTriangles;
        for(const auto& tri:triangles) {
            const auto a=packed(geographic[tri[0]]);
            const auto b=packed(geographic[tri[1]]);
            const auto c=packed(geographic[tri[2]]);
            if(a==b||b==c||c==a)continue;
            const auto oldArea=triangleArea(parameter[tri[0]],parameter[tri[1]],parameter[tri[2]]);
            const auto newArea=triangleArea(space.project(a),space.project(b),space.project(c));
            if(std::abs(newArea)<=AREA_EPSILON||oldArea*newArea<=0)continue;
            auto sorted=tri;std::sort(sorted.begin(),sorted.end());
            if(seenTriangles.insert(sorted).second)retained.push_back(tri);
        }
        if(retained.empty())throw std::invalid_argument("polygon has no retained fill triangles");
        // The globe consumes the original refined triangles. Flat projection
        // clones only vertices that need a different 360-degree unwrap, as
        // in the Web mesh; both views retain the same geodesic edge chains.
        std::vector<Triangle> planar=retained;
        std::map<std::pair<std::uint32_t,int>,std::uint32_t> clones;
        for(auto& triangle:planar){
            const auto anchor=geographic[triangle[0]][0];
            for(auto& index:triangle){
                const double longitude=unwrapLongitude(geographic[index][0],anchor);
                const int wrap=static_cast<int>(std::llround((longitude-geographic[index][0])/360.));
                if(wrap==0)continue;
                const auto key=std::make_pair(index,wrap);
                const auto found=clones.find(key);
                if(found!=clones.end()){index=found->second;continue;}
                if(geographic.size()>=std::numeric_limits<std::uint32_t>::max())
                    throw std::overflow_error("polygon seam clone vertex index overflow");
                const auto derived=static_cast<std::uint32_t>(geographic.size());
                geographic.push_back({longitude,geographic[index][1]});
                clones.emplace(key,derived);
                index=derived;
            }
        }
        const auto base=positions->size()/2;
        if(base+geographic.size()>std::numeric_limits<std::uint32_t>::max())
            throw std::overflow_error("polygon packet vertex index overflow");
        for(const auto& p:geographic){
            const auto q=packed(p);
            positions->push_back(static_cast<float>(q[0]));
            positions->push_back(static_cast<float>(q[1]));
        }
        for(const auto& triangle:planar)
            for(const auto index:triangle)indices->push_back(static_cast<std::uint32_t>(base)+index);
        for(const auto& triangle:retained)
            for(const auto index:triangle)globeIndices->push_back(static_cast<std::uint32_t>(base)+index);
        std::map<std::uint64_t,std::pair<std::pair<std::uint32_t,std::uint32_t>,unsigned>> edges;
        const auto record=[&](std::uint32_t a,std::uint32_t b) {
            const auto key=edgeKey(a,b);
            auto& entry=edges[key];
            if(!entry.second)entry.first={a,b};
            ++entry.second;
        };
        for(const auto& tri:retained) {
            record(tri[0],tri[1]);record(tri[1],tri[2]);record(tri[2],tri[0]);
        }
        std::set<std::uint64_t> rendered;
        const auto emit=[&](std::uint32_t a,std::uint32_t b) {
            const auto key=edgeKey(a,b);
            const auto it=edges.find(key);
            if(it==edges.end()||it->second.second!=1||!rendered.insert(key).second||
               artificialClosure(geographic[a],geographic[b]))return;
            const auto start=packed(geographic[a]),end=packed(geographic[b]);
            if(start==end)return;
            appendPositions(*boundary,{start,end});
        };
        // Source rings preserve dash/chain ordering. Any retained boundary
        // that spans a discarded source vertex is appended from fill topology.
        for(const auto& chain:boundaryChains)
            for(std::size_t i=0;i<chain.vertices.size();++i)
                if(chain.visible[i])emit(chain.vertices[i],chain.vertices[(i+1)%chain.vertices.size()]);
        for(const auto& [key,entry]:edges)
            if(entry.second==1)emit(entry.first.first,entry.first.second);
    }
    if(indices->empty())throw std::invalid_argument("polygon triangulation failed");
    // Both views share geodesically refined source facets. Flat triangles may
    // have seam-specific longitude clones; the globe uses original indices.
    return {positions,sphereBuffer(*positions),indices,globeIndices,
        boundary,sphereBuffer(*boundary),ringCoordinates,ringOffsets,polygonOffsets,
        positions->size()/2,indices->size()/3,globeIndices->size()/3,boundary->size()/4};
}

StrokeGeometryPacket makeStrokeGeometryPacket(const pandoeditor::Geometry& geometry) {
    auto buffer=std::make_shared<std::vector<float>>();
    const auto addRing=[&](const pandoeditor::Ring& ring,bool closed) {
        if(ring.size()<2)return;
        auto points=unwrap(ring,ring.front().x,false);
        for(std::size_t i=1;i<points.size();++i) {
            const auto& a=points[i-1];const auto& b=points[i];
            if(a==b)continue;
            appendPositions(*buffer,{a,b});
        }
        if(closed&&points.front()!=points.back())appendPositions(*buffer,{points.back(),points.front()});
    };
    if(geometry.type=="LineString"||geometry.type=="MultiLineString") {
        for(const auto& line:geometry.lines)addRing(line,false);
    } else if(geometry.type=="Polygon"||geometry.type=="MultiPolygon") {
        const auto packet=makePolygonGeometryPacket(geometry);
        return {packet.boundaryStartsEnds,packet.unitSphereBoundaryStartsEnds,packet.boundarySegmentCount};
    } else throw std::invalid_argument("stroke packet requires line or polygon geometry");
    return {buffer,sphereBuffer(*buffer),buffer->size()/4};
}

PointGeometryPacket makePointGeometryPacket(const pandoeditor::Geometry& geometry) {
    if(geometry.type!="Point"&&geometry.type!="MultiPoint")
        throw std::invalid_argument("point packet requires point geometry");
    auto positions=std::make_shared<std::vector<float>>();
    for(const auto& point:geometry.points) {
        requireFinite(point);
        if(std::abs(point.x)>std::numeric_limits<float>::max())
            throw std::invalid_argument("point longitude out of range");
        positions->push_back(static_cast<float>(point.x));
        positions->push_back(static_cast<float>(point.y));
    }
    return {positions,sphereBuffer(*positions),positions->size()/2};
}
