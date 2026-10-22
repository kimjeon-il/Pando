// Compare the indexed geographical predicate against the byte-identical OBJ-097
// reference, compiled as a separate translation unit with renamed exports.
// No visual data, geometry mutation, or app pipeline is replaced.
#include <pandoeditor/geometrypredicates.h>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

using namespace pandoeditor;
namespace pandoeditor {
bool legacyGeometryContains(const Geometry&,const Geometry&);
bool legacyGeometrySignificantOverlap(const Geometry&,const Geometry&);
}

namespace {
Geometry makePolygon(std::vector<Ring> rings) {
    Geometry g;g.type="Polygon";g.polygons.push_back(std::move(rings));return g;
}
Ring rect(double west,double south,double east,double north) {
    return {{west,south},{east,south},{east,north},{west,north},{west,south}};
}
Geometry box(double west,double south,double east,double north) {
    return makePolygon({rect(west,south,east,north)});
}
Geometry denseBox(double west,double south,double east,double north,int sidePoints) {
    Ring ring;
    for(int i=0;i<sidePoints;++i)
        ring.push_back({west+(east-west)*i/sidePoints,south});
    for(int i=0;i<sidePoints;++i)
        ring.push_back({east,south+(north-south)*i/sidePoints});
    for(int i=0;i<sidePoints;++i)
        ring.push_back({east-(east-west)*i/sidePoints,north});
    for(int i=0;i<sidePoints;++i)
        ring.push_back({west,north-(north-south)*i/sidePoints});
    ring.push_back(ring.front());
    return makePolygon({std::move(ring)});
}
uint32_t state=0xd31a5e78;
double next() {
    state^=state<<13;state^=state>>17;state^=state<<5;
    return static_cast<double>(state%1000000)/1000000.;
}
bool same(const Geometry& parent,const Geometry& child,const std::string& label,bool includeOverlap=true) {
    const bool base=legacyGeometryContains(parent,child),newValue=geometryContains(parent,child);
    if(base!=newValue) {
        std::cerr<<"OBJ098_PARITY_FAILURE containment "<<label<<" reference="<<base<<" indexed="<<newValue<<"\n";
        std::exit(1);
    }
    if(includeOverlap) {
        const bool baseOverlap=legacyGeometrySignificantOverlap(parent,child);
        const bool nextOverlap=geometrySignificantOverlap(parent,child);
        if(baseOverlap!=nextOverlap) {
            std::cerr<<"OBJ098_PARITY_FAILURE overlap "<<label<<" reference="<<baseOverlap<<" indexed="<<nextOverlap<<"\n";
            std::exit(2);
        }
    }
    return newValue;
}
template<class Callable>double timedMs(Callable function,int repeats=1) {
    const auto start=std::chrono::steady_clock::now();
    volatile bool consume=false;
    for(int i=0;i<repeats;++i)consume=static_cast<bool>(function())!=static_cast<bool>(consume);
    (void)consume;
    return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count()/repeats;
}
}

int main() {
    std::size_t comparisons=0;
    const auto test=[&](const Geometry& outer,const Geometry& inner,const std::string& name) {
        same(outer,inner,name);same(inner,outer,name+" reversed");
        comparisons+=4;
    };
    const Geometry mainland=box(-180,36,180,82);
    test(mainland,box(45,41,55,47),"full-world-seam east inland");
    test(mainland,box(-173,76,-171,78),"full-world-seam Arctic");
    test(mainland,box(60,5,63,8),"full-world-seam south outside");
    test(box(170,-10,-170,15),box(177,-3,179,1),"explicit dateline crossing east");
    test(box(-179,-10,178,15),box(-178,-3,-175,1),"non-equal dateline wrapping");
    test(box(-181,-8,-174,14),box(178,-2,179,2),"out-of-range longitude unwrapping");
    test(box(-180,85,180,90),box(160,87,168,89),"north pole and seam");
    test(box(-180,-90,180,-85),box(-140,-89,-120,-87),"south pole and seam");
    test(makePolygon({rect(-180,15,180,76),rect(45,30,56,48)}),
         box(46,35,47,36),"explicit hole with seam");
    test(makePolygon({rect(-180,15,180,76),rect(45,30,56,48)}),
         box(57,35,59,36),"outside seam hole");
    test(makePolygon({rect(-179,-8,179,66),rect(-170,3,-160,12)}),
         makePolygon({rect(-172,0,-155,16),rect(-169,5,-165,8)}),"two holes and seam");
    test(makePolygon({rect(10,5,20,20)}),makePolygon({rect(13,11,17,15)}),"ordinary cartesian");
    Geometry multipolygon; multipolygon.type="MultiPolygon";
    multipolygon.polygons={ {rect(177,-10,179,20)}, {rect(-179,-10,-177,20)}, {rect(22,21,30,29)} };
    test(multipolygon,box(177.5,4,178.5,7),"multi-polygon east");
    test(multipolygon,box(-179.5,4,-178.5,7),"multi-polygon west");
    test(multipolygon,box(23,22,25,26),"multi-polygon remote");

    for(int i=0;i<240;++i) {
        const double lat=-84+next()*167;
        const double lon=-178+next()*356;
        const double height=0.01+next()*std::min(6.,88.-std::abs(lat));
        const double width=0.01+next()*8;
        const double west=lon,east=lon+width;
        const auto a=box(west,lat,east,lat+height);
        const auto b=box(west+(next()-.5)*7,lat+(next()-.5)*7,
            east+(next()-.5)*7,lat+height+(next()-.5)*7);
        test(a,b,"seeded "+std::to_string(i));
    }
    for(int i=0;i<60;++i) {
        const double latitude=-85+next()*170;
        const double west=i%2?170+next()*20:-190+next()*10;
        const auto parent=box(west,latitude,west+2.5+next()*6,latitude+2.5);
        const auto subject=box(west+.6,latitude+.5,west+2.,latitude+1.5);
        test(parent,subject,"longitude wrap "+std::to_string(i));
    }
    // Workload containing thousands of parent shoreline vertices, retaining
    // dateline and hole semantics. No time ratio is asserted; CI performance
    // noise and compiler differences must not make correct geometry fail.
    const Geometry big=denseBox(-180,34,180,81,410);
    const Geometry small=denseBox(35,41,40,46,18);
    same(big,small,"dense parent vs republic");
    const double originalMs=timedMs([&](){return legacyGeometryContains(big,small);});
    const double indexedMs=timedMs([&](){return geometryContains(big,small);},3);
    if(!(originalMs>0&&indexedMs>0))return 3;
    std::cout<<std::fixed<<std::setprecision(3)
        <<"OBJ098_PARITY_OK "<<comparisons+2<<" checks "
        <<"OBJ098_DENSE_CONTAINMENT_MS baseline="<<originalMs
        <<" indexed="<<indexedMs
        <<" speedup="<<originalMs/indexedMs<<"\n";
}
