#include <pandoeditor/geometrypredicates.h>
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <random>
#include <string>
#include <vector>

using namespace pandoeditor;
#ifdef PANDO_OBJ098_LEGACY_COMPARE
namespace pandoeditor {
bool geometryContainsLegacy(const Geometry&, const Geometry&);
bool geometrySignificantOverlapLegacy(const Geometry&, const Geometry&);
}
#endif

namespace {
constexpr double pi=3.14159265358979323846264338327950288;
Geometry shape(std::vector<std::vector<Ring>> polygons) {
    Geometry result;
    result.type=polygons.size()==1?"Polygon":"MultiPolygon";
    result.polygons=std::move(polygons);
    return result;
}
Ring rect(double west,double south,double east,double north) {
    return {{west,south},{east,south},{east,north},{west,north},{west,south}};
}
Ring ellipse(double x,double y,double width,double height,int count,double skew=0) {
    Ring ring;
    for(int i=0;i<count;++i) {
        const double t=2*pi*i/count;
        const double ripple=1+skew*std::cos(17*t);
        ring.push_back({x+width*std::cos(t)*ripple,y+height*std::sin(t)*ripple});
    }
    ring.push_back(ring.front());
    return ring;
}
std::uint64_t hash(const Geometry& value) {
    std::uint64_t h=14695981039346656037ull;
    const auto feed=[&](double number) {
        // A semantic before/after coordinate identity check, not a serialization
        // contract; avoids retaining or copying the entire original geometry.
        const auto n=static_cast<std::int64_t>(std::llround(number*100000000.));
        h=(h^static_cast<std::uint64_t>(n))*1099511628211ull;
    };
    for(const auto& poly:value.polygons)for(const auto& ring:poly)for(const auto& point:ring) {
        feed(point.x);feed(point.y);
    }
    return h;
}
struct Checker {
    int count=0,contained=0,uncontained=0;
    std::uint64_t digest=14695981039346656037ull;
    void check(const std::string& label,const Geometry& outer,const Geometry& inner,
               int expected=-1,bool compareOverlap=true) {
        const auto beforeOuter=hash(outer),beforeInner=hash(inner);
        const auto has=geometryContains(outer,inner);
        const auto overlaps=compareOverlap?geometrySignificantOverlap(outer,inner):false;
#ifdef PANDO_OBJ098_LEGACY_COMPARE
        const auto old=geometryContainsLegacy(outer,inner);
        const auto oldOverlap=compareOverlap?geometrySignificantOverlapLegacy(outer,inner):false;
        if(has!=old||overlaps!=oldOverlap) {
            std::cerr<<"OBJ098_MISMATCH "<<label<<" new="<<has<<" old="<<old
                     <<" newOverlap="<<overlaps<<" oldOverlap="<<oldOverlap<<'\n';
            std::abort();
        }
#endif
        if(expected>=0 && has!=(expected!=0)) {
            std::cerr<<"OBJ098_UNEXPECTED "<<label<<" got="<<has<<" expected="<<expected<<'\n';
            std::abort();
        }
        if(beforeOuter!=hash(outer)||beforeInner!=hash(inner)) {
            std::cerr<<"OBJ098_MUTATED_GEOMETRY "<<label<<'\n';std::abort();
        }
        ++count;contained+=has;uncontained+=!has;
        digest=(digest^static_cast<std::uint64_t>(has?1:0))*1099511628211ull;
        digest=(digest^static_cast<std::uint64_t>(overlaps?1:0))*1099511628211ull;
    }
};
}
int main() {
    Checker cases;
    // Small ordinary and periodic seam cases: both date-line split and
    // unwrapped x>180 layouts must preserve the old exact predicates.
    const auto normal=shape({{rect(10,10,20,20)}});
    cases.check("ordinary-interior",normal,shape({{rect(12,12,18,18)}}),1);
    cases.check("ordinary-exterior",normal,shape({{rect(40,12,44,18)}}),0);
    cases.check("ordinary-crossing",normal,shape({{rect(19,15,24,18)}}),0);
    cases.check("ordinary-border",normal,shape({{rect(10,12,14,16)}}),1);
    const auto seam=shape({{rect(175,10,185,30)}});
    cases.check("unwrapped-contained",seam,shape({{rect(179,15,181,20)}}),1);
    cases.check("dateline-split-contained",seam,
                shape({{{{179,15},{-179,15},{-179,20},{179,20},{179,15}}}}),1);
    cases.check("unwrapped-exterior",seam,shape({{rect(155,10,161,25)}}),0);
    cases.check("west-seam-periodic",shape({{rect(-185,10,-175,30)}}),
                shape({{rect(179,15,181,20)}}),1);
    const auto hole=shape({{rect(170,10,190,30),rect(177,16,183,23)}});
    cases.check("seam-hole-interior",hole,shape({{rect(178,18,181,20)}}),0);
    cases.check("seam-hole-clear",hole,shape({{rect(171,11,175,15)}}),1);
    cases.check("seam-hole-crossing",hole,shape({{rect(176,13,179,19)}}),0);
    cases.check("polar-seam-interior",shape({{rect(-190,76,-165,89)}}),
                shape({{rect(172,79,177,83)}}),1);
    cases.check("disjoint-island",shape({{rect(160,5,180,22)},{rect(-90,-40,-80,-30)}}),
                shape({{rect(-88,-38,-84,-34)}}),1);
    cases.check("missing-island",shape({{rect(160,5,180,22)},{rect(-90,-40,-80,-30)}}),
                shape({{rect(20,-38,24,-34)}}),0);
    // Arc tessellations and holes cover the original 180° periodic edge cases.
    for(int n: {6,12,48,128,320}) {
        const auto parent=shape({{ellipse(177,44,14,12,n,0.04)}});
        cases.check("ellipse-seam-"+std::to_string(n),parent,
                    shape({{ellipse(177,44,2.0,1.3,32)}}),1);
        cases.check("ellipse-shifted-"+std::to_string(n),parent,
                    shape({{ellipse(175,42,10,9,24)}}));
        cases.check("ellipse-outside-"+std::to_string(n),parent,
                    shape({{ellipse(110,42,5,4,24)}}),0);
    }
    std::mt19937_64 generator(0x5b4e3d12caceull);
    std::uniform_real_distribution<double> longitude(-202,202),latitude(-70,70),
        widths(2,40),heights(2,16),displacement(-1.4,1.4);
    for(int i=0;i<160;++i) {
        const auto x=longitude(generator),y=latitude(generator);
        const auto width=widths(generator),height=heights(generator);
        const auto parent=shape({{ellipse(x,y,width,height,16+i%83,0.008)}});
        const auto subject=shape({{ellipse(x+displacement(generator)*width,
                     y+displacement(generator)*height,width*.2,height*.2,7+i%63)}});
        cases.check("random-"+std::to_string(i),parent,subject);
    }
    const auto parent=shape({{ellipse(179,48,34,28,2800,0.01)}});
    const auto child=shape({{ellipse(178,48,2,1.5,340,0.02)}});
    const auto before=std::chrono::steady_clock::now();
    cases.check("large-date-line-ring",parent,child,1,false);
    const auto elapsed=std::chrono::duration<double,std::milli>(
        std::chrono::steady_clock::now()-before).count();
    std::cout<<"OBJ098_PARITY "<<cases.count<<" contained="<<cases.contained
             <<" uncontained="<<cases.uncontained<<" digest="<<cases.digest<<'\n';
    std::cout<<"OBJ098_LARGE_GEOGRAPHIC_CONTAINMENT_MS "<<elapsed<<'\n';
}
