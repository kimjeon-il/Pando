#pragma once
#include <pandoeditor/geometry-types.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace pandoeditor::exactplanar {
// Exact signs of sums of products of the original finite IEEE-754 doubles.
// Binary64 products span powers 2^-2148 through 2^2048. Separate unsigned
// accumulators avoid floating cancellation, underflow, FMA and long-double
// platform differences. The remaining 156 bits exceed size_t's term budget.
// This is a predicate owner: it never manufactures or moves a coordinate.
class ProductSum {
    static_assert(sizeof(double)==8 && std::numeric_limits<double>::is_iec559);
    using Magnitude=std::array<std::uint32_t,136>;
    Magnitude positive_{},negative_{};
    struct Binary {std::uint64_t mantissa;int exponent;bool negative;};
    static Binary binary(double value) {
        if(!std::isfinite(value))throw std::invalid_argument("nonfinite exact predicate input");
        std::uint64_t bits;std::memcpy(&bits,&value,sizeof bits);
        const auto exponent=unsigned((bits>>52)&0x7ff);
        const auto fraction=bits&((std::uint64_t(1)<<52)-1);
        return {fraction|(exponent?std::uint64_t(1)<<52:0),
            exponent?int(exponent)-1075:-1074,bool(bits>>63)};
    }
    static void addWord(Magnitude& out,std::size_t index,std::uint32_t word) {
        std::uint64_t carry=word;
        while(carry) {
            if(index==out.size())throw std::overflow_error("exact predicate accumulator overflow");
            const auto sum=std::uint64_t(out[index])+carry;
            out[index++]=std::uint32_t(sum);carry=sum>>32;
        }
    }
    static void addShifted(Magnitude& out,std::uint64_t value,unsigned bits) {
        const auto index=bits/32,shift=bits%32;
        const auto low=value<<shift;
        addWord(out,index,std::uint32_t(low));
        addWord(out,index+1,std::uint32_t(low>>32));
        if(shift)addWord(out,index+2,std::uint32_t(value>>(64-shift)));
    }
public:
    void add(double left,double right,int sign=1) {
        if(!sign)return;
        if(sign!=1&&sign!=-1)throw std::invalid_argument("invalid exact predicate coefficient");
        const auto a=binary(left),b=binary(right);
        if(!a.mantissa||!b.mantissa)return;
        auto& out=(a.negative!=b.negative)!=(sign<0)?negative_:positive_;
        const auto offset=unsigned(a.exponent+b.exponent+2148);
        for(unsigned i=0;i<2;++i)for(unsigned j=0;j<2;++j)
            addShifted(out,std::uint64_t(std::uint32_t(a.mantissa>>(32*i)))
                *std::uint32_t(b.mantissa>>(32*j)),offset+32*(i+j));
    }
    void ring(const Ring& points,int sign=1) {
        for(std::size_t i=0;i<points.size();++i) {
            const auto a=points[i],b=points[(i+1)%points.size()];
            add(a.x,b.y,sign);add(a.y,b.x,-sign);
        }
    }
    int sign()const noexcept {
        for(std::size_t i=positive_.size();i-->0;)
            if(positive_[i]!=negative_[i])return positive_[i]>negative_[i]?1:-1;
        return 0;
    }
};
inline bool equal(Point a,Point b) {return a.x==b.x&&a.y==b.y;}
inline int orientation(Point a,Point b,Point c) {
    ProductSum sum;
    sum.add(a.x,b.y);sum.add(b.x,c.y);sum.add(c.x,a.y);
    sum.add(a.y,b.x,-1);sum.add(b.y,c.x,-1);sum.add(c.y,a.x,-1);
    return sum.sign();
}
inline int areaSign(const Ring& ring) {ProductSum sum;sum.ring(ring);return sum.sign();}
inline bool onSegment(Point p,Point a,Point b) {
    return p.x>=std::min(a.x,b.x)&&p.x<=std::max(a.x,b.x)
        &&p.y>=std::min(a.y,b.y)&&p.y<=std::max(a.y,b.y)&&orientation(a,b,p)==0;
}
inline bool intersects(Point a,Point b,Point c,Point d) {
    const auto ac=orientation(a,b,c),ad=orientation(a,b,d),ca=orientation(c,d,a),cb=orientation(c,d,b);
    return (ac*ad<0&&ca*cb<0)||(!ac&&onSegment(c,a,b))||(!ad&&onSegment(d,a,b))
        ||(!ca&&onSegment(a,c,d))||(!cb&&onSegment(b,c,d));
}
struct RingIssue {const char* kind;std::size_t coordinateIndex,segmentIndex;};
inline std::optional<RingIssue> ringIssue(const Ring& ring) {
    for(std::size_t i=0;i<ring.size();++i)
        if(!std::isfinite(ring[i].x)||!std::isfinite(ring[i].y))return RingIssue{"invalid-geometry",i,i};
    if(ring.size()<4)return RingIssue{"invalid-geometry",0,0};
    if(!equal(ring.front(),ring.back()))return RingIssue{"open-ring",ring.size()-1,ring.size()-2};
    const auto n=ring.size()-1;
    for(std::size_t i=0;i<n;++i) {
        if(equal(ring[i],ring[i+1]))return RingIssue{"duplicate-vertex",i+1,i};
        const auto a=ring[(i+n-1)%n],b=ring[i],c=ring[(i+1)%n];
        if(onSegment(c,a,b)||onSegment(a,b,c))return RingIssue{"self-intersection",i,(i+n-1)%n};
    }
    if(areaSign(ring)==0)return RingIssue{"zero-area",0,0};
    struct Segment {std::size_t index;Point a,b;double minX,maxX,minY,maxY;};
    std::vector<Segment> segments;segments.reserve(n);
    for(std::size_t i=0;i<n;++i) {const auto a=ring[i],b=ring[i+1];
        segments.push_back({i,a,b,std::min(a.x,b.x),std::max(a.x,b.x),std::min(a.y,b.y),std::max(a.y,b.y)});
    }
    std::stable_sort(segments.begin(),segments.end(),[](const auto& a,const auto& b){return a.minX<b.minX;});
    std::vector<Segment> active;
    for(const auto& current:segments) {
        active.erase(std::remove_if(active.begin(),active.end(),[&](const auto& item){return item.maxX<current.minX;}),active.end());
        for(const auto& item:active) {
            const auto a=item.index,b=current.index;
            if((a>b?a-b:b-a)==1||(a==0&&b==n-1)||(b==0&&a==n-1)
                ||item.maxY<current.minY||item.minY>current.maxY)continue;
            if(intersects(item.a,item.b,current.a,current.b))return RingIssue{"self-intersection",a,a};
        }
        active.push_back(current);
    }
    return {};
}
inline void requireSimpleRing(const Ring& ring) {
    if(const auto issue=ringIssue(ring))throw std::invalid_argument(std::string("INVALID_POLYGON_RING: ")+issue->kind);
}
} // namespace pandoeditor::exactplanar
