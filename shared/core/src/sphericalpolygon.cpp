#include <pandoeditor/sphericalpolygon.h>
#include <pandoeditor/polygonclipping.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>

namespace pandoeditor {
namespace {
constexpr double pi = 3.141592653589793238462643383279502884;
constexpr double rad = pi / 180.;
constexpr double tolerance = 1e-10;
constexpr double sphere = 4 * pi;
constexpr double hemisphere = 2 * pi;

bool near(Point a, Point b) {
    return std::abs(a.x-b.x)<=tolerance && std::abs(a.y-b.y)<=tolerance;
}
void coordinate(Point p) {
    if(!std::isfinite(p.x)||!std::isfinite(p.y)||std::abs(p.y)>90)
        throw std::invalid_argument("INVALID_POLYGON_COORDINATE");
}
bool onSegment(Point p, Point a, Point b) {
    const auto dx=b.x-a.x,dy=b.y-a.y, length=dx*dx+dy*dy;
    if(length<=tolerance*tolerance)return near(p,a);
    const auto ox=p.x-a.x,oy=p.y-a.y;
    const auto position=(ox*dx+oy*dy)/length;
    return position>=-tolerance && position<=1+tolerance &&
           std::abs(ox*dy-oy*dx)<=tolerance*std::sqrt(length);
}
Ring cleanRing(const Ring& original) {
    if(original.size()<3)throw std::invalid_argument("INVALID_POLYGON_RING: short ring");
    Ring ring;
    ring.reserve(original.size()+1);
    for(const auto point:original) {
        coordinate(point);
        if(ring.empty()||!near(ring.back(),point))ring.push_back(point);
    }
    if(ring.empty())throw std::invalid_argument("INVALID_POLYGON_RING: empty ring");
    if(!near(ring.front(),ring.back()))ring.push_back(ring.front());
    else ring.back()=ring.front();
    Ring vertices(ring.begin(),ring.end()-1);
    bool changed=true;
    while(changed&&vertices.size()>=3) {
        changed=false;
        for(std::size_t i=0;i<vertices.size();++i) {
            const auto a=vertices[(i+vertices.size()-1)%vertices.size()];
            const auto b=vertices[i], c=vertices[(i+1)%vertices.size()];
            if(onSegment(c,a,b)||onSegment(a,b,c)) {
                vertices.erase(vertices.begin()+i);
                changed=true;
                break;
            }
        }
    }
    if(vertices.size()<3)throw std::invalid_argument("INVALID_POLYGON_RING: degenerate shell or hole");
    std::set<std::pair<double,double>> distinct;
    for(const auto p:vertices)distinct.insert({p.x,p.y});
    if(distinct.size()<3)throw std::invalid_argument("INVALID_POLYGON_RING: fewer than three unique vertices");
    vertices.push_back(vertices.front());
    return vertices;
}
void checkRing(const Ring& ring) {
    if(ring.size()<4)throw std::invalid_argument("INVALID_POLYGON_RING: short ring");
    for(const auto point:ring)coordinate(point);
    if(ring.front().x!=ring.back().x||ring.front().y!=ring.back().y)
        throw std::invalid_argument("INVALID_POLYGON_RING: open ring");
    std::set<std::pair<double,double>> distinct;
    for(std::size_t i=0;i+1<ring.size();++i) {
        if(near(ring[i],ring[i+1]))throw std::invalid_argument("INVALID_POLYGON_RING: duplicate vertex");
        distinct.insert({ring[i].x,ring[i].y});
    }
    if(distinct.size()<3)throw std::invalid_argument("INVALID_POLYGON_RING: too few vertices");
}
bool worldSeam(const Ring& ring) {
    if(ring.size()!=5)return false;
    std::set<std::pair<double,double>> vertices;
    for(std::size_t i=0;i<4;++i)vertices.insert({ring[i].x,ring[i].y});
    return vertices==std::set<std::pair<double,double>>{
        {-180,-90},{-180,90},{180,-90},{180,90}};
}
double interiorArea(const Ring& ring) {
    const auto signedArea=sphericalRingSignedArea(ring);
    if(!std::isfinite(signedArea))
        throw std::invalid_argument("AMBIGUOUS_SPHERICAL_RING: nonfinite area");
    if(std::abs(signedArea)<=1e-15) {
        for(std::size_t i=0;i<ring.size();++i) {
            if(std::abs(ring[i].y)==90 ||
               (i&&std::abs(ring[i].x-ring[i-1].x)>=180))
                throw std::invalid_argument("AMBIGUOUS_SPHERICAL_RING: seam or pole");
        }
        const auto ox=ring.front().x,oy=ring.front().y;
        double planar=0;
        for(std::size_t i=1;i<ring.size();++i) {
            const auto a=ring[i-1],b=ring[i];
            planar+=(a.x-ox)*(b.y-oy)-(b.x-ox)*(a.y-oy);
        }
        if(planar==0)throw std::invalid_argument("INVALID_POLYGON_RING: zero area");
        const auto tiny=std::max(std::abs(planar)*rad*rad/2,
                                 std::numeric_limits<double>::denorm_min());
        return planar<0?tiny:sphere-tiny;
    }
    const auto area=signedArea<0?sphere+signedArea:signedArea;
    if(!(area>0&&area<sphere))
        throw std::invalid_argument("AMBIGUOUS_SPHERICAL_RING: invalid interior");
    return area;
}
bool canonical(const Ring& ring,bool shell) {
    if(worldSeam(ring)) {
        if(!shell)throw std::invalid_argument("INVALID_POLYGON_HOLE: global seam");
        return true;
    }
    const auto area=interiorArea(ring);
    return shell?area<hemisphere:area>hemisphere;
}
Ring oriented(const Ring& original,bool shell,bool clipped=false) {
    auto ring=cleanRing(original);
    // Clipping uses planar longitude edges. Split those edges before deciding
    // the spherical interior: inserting a midpoint can change that interior.
    // The explicit world seam is already a canonical full-sphere shell.
    if(clipped&&!worldSeam(ring)) {
        Ring segmented;
        segmented.reserve(ring.size());
        segmented.push_back(ring.front());
        for(std::size_t i=1;i<ring.size();++i) {
            const auto a=ring[i-1],b=ring[i];
            const auto count=std::max(1.,std::ceil(std::abs(b.x-a.x)/180.));
            if(count>1000000)throw std::invalid_argument("INVALID_POLYGON: longitude span too large");
            for(int part=1;part<int(count);++part) {
                const auto step=double(part)/count;
                segmented.push_back({a.x+(b.x-a.x)*step,a.y+(b.y-a.y)*step});
            }
            segmented.push_back(b);
        }
        ring=std::move(segmented);
    }
    if(!canonical(ring,shell)) {
        std::reverse(ring.begin(),ring.end()-1);
        ring.back()=ring.front();
    }
    if(!canonical(ring,shell))
        throw std::invalid_argument("AMBIGUOUS_SPHERICAL_RING: winding unresolved");
    return ring;
}
void typeCheck(const Geometry& geometry) {
    if(geometry.type!="Polygon"&&geometry.type!="MultiPolygon")
        throw std::invalid_argument("INVALID_POLYGON: expected Polygon/MultiPolygon");
    if(!geometry.points.empty()||!geometry.lines.empty())
        throw std::invalid_argument("INVALID_POLYGON: mixed geometry dimensions");
    if(geometry.type=="Polygon"&&geometry.polygons.size()!=1)
        throw std::invalid_argument("INVALID_POLYGON: Polygon must have one component");
}
} // namespace

double sphericalRingSignedArea(const Ring& ring) {
    if(ring.size()<4)throw std::invalid_argument("INVALID_POLYGON_RING: short ring");
    double prevLon=ring.front().x*rad;
    double phi=ring.front().y*rad/2+pi/4;
    double prevCos=std::cos(phi),prevSin=std::sin(phi),area=0;
    for(std::size_t i=1;i<ring.size();++i) {
        const auto lon=ring[i].x*rad;
        phi=ring[i].y*rad/2+pi/4;
        const auto cos=std::cos(phi),sin=std::sin(phi),delta=lon-prevLon,k=prevSin*sin;
        area+=std::atan2(k*std::sin(delta),prevCos*cos+k*std::cos(delta));
        prevLon=lon;prevCos=cos;prevSin=sin;
    }
    return area*2;
}
double sphericalPolygonArea(const Geometry& geometry,const GeometryCancellation& cancelled) {
    typeCheck(geometry);
    const auto check=[&]{if(cancelled&&cancelled())throw PolygonCalculationCancelled{};};
    // D3 adder: preserve both rounding residuals, including exact cancellation.
    struct Sum {double s=0,t=0;
        static Sum pair(double a,double b){const double s=a+b,v=s-a,u=s-v;return {s,a-u+(b-v)};}
        void add(double value){const auto low=pair(value,t);const auto high=pair(low.s,s);s=high.s;t=high.t;if(s)t+=low.t;else s=low.t;}
    };
    double result=0;
    for(const auto& polygon:geometry.polygons){check();Sum sum;
        for(const auto& ring:polygon){check();if(ring.empty())continue;
            double previousLongitude=ring.front().x*rad,phi=ring.front().y*rad/2+pi/4;
            double previousCos=std::cos(phi),previousSin=std::sin(phi);
            for(std::size_t i=1;i<ring.size();++i){check();const auto p=ring[i];const double longitude=p.x*rad;
                phi=p.y*rad/2+pi/4;const double delta=longitude-previousLongitude,sign=delta>=0?1:-1,absolute=sign*delta;
                const double cosine=std::cos(phi),sine=std::sin(phi),k=previousSin*sine;
                const double x=previousCos*cosine+k*std::cos(absolute),y=k*sign*std::sin(absolute);
                sum.add(std::atan2(y,x));previousLongitude=longitude;previousCos=cosine;previousSin=sine;
            }
        }
        const double area=2*sum.s;result+=area<0?4*pi+area:area;
    }
    check();return result;
}
Ring normalizeSphericalRing(const Ring& ring,bool shell) {
    return oriented(ring,shell);
}
void requireCanonicalSphericalWinding(const Geometry& geometry) {
    typeCheck(geometry);
    if(geometry.polygons.empty())
        throw std::invalid_argument("INVALID_POLYGON: empty MultiPolygon");
    for(std::size_t p=0;p<geometry.polygons.size();++p) {
        const auto& polygon=geometry.polygons[p];
        if(polygon.empty())throw std::invalid_argument("INVALID_POLYGON: missing shell");
        for(std::size_t r=0;r<polygon.size();++r) {
            const auto& ring=polygon[r];
            try {
                checkRing(ring);
                if(!canonical(ring,r==0))
                    throw std::invalid_argument("INVALID_SPHERICAL_WINDING");
            }catch(const std::exception& error) {
                throw std::invalid_argument("INVALID_POLYGON: component "+std::to_string(p)+
                                            " ring "+std::to_string(r)+": "+error.what());
            }
        }
    }
}
bool hasCanonicalSphericalWinding(const Geometry& geometry) noexcept {
    try {requireCanonicalSphericalWinding(geometry);return true;}
    catch(...) {return false;}
}
namespace {
Geometry normalizeGeometry(const Geometry& source,bool clipped) {
    typeCheck(source);
    if(source.polygons.empty())return source; // An intentional empty clipping result.
    Geometry result;
    result.type=source.polygons.size()==1?"Polygon":"MultiPolygon";
    result.polygons.reserve(source.polygons.size());
    for(std::size_t p=0;p<source.polygons.size();++p) {
        const auto& polygon=source.polygons[p];
        if(polygon.empty())throw std::invalid_argument("INVALID_POLYGON: missing shell "+std::to_string(p));
        Polygon output;
        output.reserve(polygon.size());
        for(std::size_t r=0;r<polygon.size();++r) {
            try { output.push_back(oriented(polygon[r],r==0,clipped)); }
            catch(const std::exception& error) {
                throw std::invalid_argument("INVALID_POLYGON: component "+std::to_string(p)+
                                            " ring "+std::to_string(r)+": "+error.what());
            }
        }
        result.polygons.push_back(std::move(output));
    }
    requireCanonicalSphericalWinding(result);
    return result;
}
}
Geometry normalizeSphericalPolygonGeometry(const Geometry& source) {
    return normalizeGeometry(source,false);
}
Geometry normalizeClippedSphericalPolygonGeometry(const Geometry& source) {
    return normalizeGeometry(source,true);
}
} // namespace pandoeditor
