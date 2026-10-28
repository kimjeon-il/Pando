#include <pandoeditor/geometrypredicates.h>
#include <cmath>
#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>
#include <memory>

namespace pandoeditor {
namespace {
constexpr double epsilon=1e-10;
double cross(Point a,Point b,Point c) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
bool onSegment(Point a,Point b,Point p) { return std::abs(cross(a,b,p))<=epsilon && p.x>=std::min(a.x,b.x)-epsilon && p.x<=std::max(a.x,b.x)+epsilon && p.y>=std::min(a.y,b.y)-epsilon && p.y<=std::max(a.y,b.y)+epsilon; }
int location(const Ring& ring,Point p) {
    if(ring.size()<3)return 0; bool inside=false;
    for(std::size_t i=0,j=ring.size()-1;i<ring.size();j=i++) { auto a=ring[j],b=ring[i]; if(onSegment(a,b,p))return 2; if((a.y>p.y)!=(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside; }
    return inside?1:0;
}
int location(const Geometry& g,Point p) {
    for(const auto& poly:g.polygons) { if(poly.empty())continue; const auto outer=location(poly.front(),p); if(outer==2)return 2; if(outer!=1)continue; bool hole=false; for(std::size_t i=1;i<poly.size();++i){auto h=location(poly[i],p);if(h==2)return 2;if(h==1)hole=true;} if(!hole)return 1; } return 0;
}
double ringArea(const Ring& ring) { double sum=0;for(std::size_t i=1;i<ring.size();++i)sum+=ring[i-1].x*ring[i].y-ring[i].x*ring[i-1].y;return std::abs(sum)*.5; }
int sign(double x) { return x>epsilon?1:x<-epsilon?-1:0; }
bool properCross(Point a,Point b,Point c,Point d) { auto a1=sign(cross(a,b,c)),a2=sign(cross(a,b,d)),b1=sign(cross(c,d,a)),b2=sign(cross(c,d,b));return a1*a2<0&&b1*b2<0; }
template<class F> void edges(const Geometry& g,F f){for(const auto& p:g.polygons)for(const auto& r:p)for(std::size_t i=1;i<r.size();++i)f(r[i-1],r[i]);}
bool crosses(const Geometry&a,const Geometry&b){bool hit=false;edges(a,[&](Point x,Point y){edges(b,[&](Point u,Point v){hit=hit||properCross(x,y,u,v);});});return hit;}
Point interior(const Ring& r) { if(r.empty())return {}; Point p{};for(std::size_t i=0;i+1<r.size();++i){p.x+=r[i].x;p.y+=r[i].y;}const double n=std::max<std::size_t>(1,r.size()-1);p.x/=n;p.y/=n;return p; }
// Only seam-crossing inputs use this read-only longitude view. Boolean
// geometry remains owned by the app's pinned calculator; predicates never
// rewrite rings, geometry bindings or serialized project data.
bool needsGeographicView(const Geometry& geometry) {
    bool westSeam=false,eastSeam=false;
    for(const auto& polygon:geometry.polygons)for(const auto& ring:polygon)for(std::size_t index=0;index<ring.size();++index) {
        const auto x=ring[index].x;if(x< -180||x>180)return true;westSeam|=x== -180;eastSeam|=x==180;
        if(index){const auto jump=std::abs(x-ring[index-1].x);if(jump>180&&jump<360)return true;}
    }
    // Already clipped seam components can contain opposite halves of the same
    // hole/notch even though no individual edge crosses a longitude strip.
    return westSeam&&eastSeam;
}
Geometry geographicView(const Geometry& source) {
    Geometry result=source;
    for(std::size_t p=0;p<source.polygons.size();++p) {
        const auto& polygon=source.polygons[p];if(polygon.empty()||polygon.front().empty())continue;
        const auto reference=polygon.front().front().x;
        for(std::size_t r=0;r<polygon.size();++r) {
            auto previous=reference;
            for(std::size_t index=0;index<polygon[r].size();++index) {
                auto x=polygon[r][index].x;if(!std::isfinite(x)||!std::isfinite(polygon[r][index].y))return {};
                const bool fullWorld=index&&std::abs(x-polygon[r][index-1].x)==360;
                if(!fullWorld){while(x-previous>180)x-=360;while(x-previous< -180)x+=360;}
                result.polygons[p][r][index].x=x;previous=x;
            }
        }
    }
    return result;
}
std::pair<double,double> longitudeRange(const Ring& ring) {
    double west=ring.front().x,east=west;for(const auto point:ring){west=std::min(west,point.x);east=std::max(east,point.x);}return {west,east};
}
int periodicRingLocation(const Ring& ring,Point point) {
    if(ring.size()<3)return 0;const auto [west,east]=longitudeRange(ring);bool boundary=false;
    const auto first=std::ceil((west-point.x-epsilon)/360),last=std::floor((east-point.x+epsilon)/360);
    for(auto copy=first;copy<=last;++copy) {const auto found=location(ring,{point.x+copy*360,point.y});if(found==1)return 1;boundary|=found==2;}
    return boundary?2:0;
}
int periodicLocation(const Geometry& geometry,Point point) {
    bool boundary=false;
    for(const auto& polygon:geometry.polygons) {
        if(polygon.empty())continue;const auto outer=periodicRingLocation(polygon.front(),point);if(!outer)continue;
        bool hole=false,holeBoundary=false;
        for(std::size_t index=1;index<polygon.size();++index) {const auto found=periodicRingLocation(polygon[index],point);hole|=found==1;holeBoundary|=found==2;}
        // A full-world shell's artificial seam may run through the excluded
        // periodic half of a hole; outer-boundary membership is not land there.
        if(hole)continue;
        if(outer==1&&!holeBoundary)return 1;boundary|=outer==2||holeBoundary;
    }
    return boundary?2:0;
}
std::vector<double> periodicCuts(const Geometry& geometry,Point a,Point b) {
    std::vector<double> cuts{0,1};const auto dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    if(length<=epsilon*epsilon)return cuts;
    edges(geometry,[&](Point c,Point d){
        if(std::max(c.y,d.y)<std::min(a.y,b.y)-epsilon||std::min(c.y,d.y)>std::max(a.y,b.y)+epsilon)return;
        const auto first=std::ceil((std::min(a.x,b.x)-std::max(c.x,d.x)-epsilon)/360);
        const auto last=std::floor((std::max(a.x,b.x)-std::min(c.x,d.x)+epsilon)/360);
        for(auto copy=first;copy<=last;++copy) {
            const Point start{c.x+copy*360,c.y},finish{d.x+copy*360,d.y};
            const auto sx=finish.x-start.x,sy=finish.y-start.y,denominator=dx*sy-dy*sx;
            if(std::abs(denominator)>epsilon) {
                const auto t=((start.x-a.x)*sy-(start.y-a.y)*sx)/denominator;
                const auto u=((start.x-a.x)*dy-(start.y-a.y)*dx)/denominator;
                if(t>=-epsilon&&t<=1+epsilon&&u>=-epsilon&&u<=1+epsilon)cuts.push_back(std::clamp(t,0.,1.));
            } else if(std::abs(cross(a,b,start))<=epsilon) {
                for(const auto point:{start,finish}){const auto t=((point.x-a.x)*dx+(point.y-a.y)*dy)/length;if(t>=-epsilon&&t<=1+epsilon)cuts.push_back(std::clamp(t,0.,1.));}
            }
        }
    });
    std::sort(cuts.begin(),cuts.end());cuts.erase(std::unique(cuts.begin(),cuts.end(),[](double a,double b){return std::abs(a-b)<=1e-12;}),cuts.end());return cuts;
}
// A local, disposable broad phase for the exact periodic predicates below.
// This is never stored with the original Geometry or timeline source refs.
// Use latitude coverage only to eliminate edges that cannot intersect the
// queried segment; the existing longitude shift and cross-product predicates
// are still responsible for every actual intersection decision.
// Query buckets include the old epsilon margin; stamp deduplication avoids
// re-processing an edge whose latitude envelope spans multiple buckets.
class LatitudeEdgeIndex {
    struct Edge {Point a,b;double south,north;};
    static constexpr int bucketCount=91;
    static constexpr double bucketSize=2.;
    static constexpr int maximumBucketSpan=16;
    std::vector<Edge> edges_;
    std::array<std::vector<std::uint32_t>,bucketCount> bins_;
    std::vector<std::uint32_t> tall_;
    mutable std::vector<std::uint32_t> stamps_;
    mutable std::uint32_t visit_=0;
    static int bucket(double latitude) {
        return std::clamp(static_cast<int>(std::floor((latitude+90.)/bucketSize)),0,bucketCount-1);
    }
public:
    void add(Point a,Point b) {
        const auto south=std::min(a.y,b.y),north=std::max(a.y,b.y);
        const auto id=static_cast<std::uint32_t>(edges_.size());
        edges_.push_back({a,b,south,north});
        stamps_.push_back(0);
        const int first=bucket(south),last=bucket(north);
        // Extremely long meridian/seam segments are uncommon; avoid holding
        // each of them in every geographic latitude bucket.
        if(last-first>maximumBucketSpan) {tall_.push_back(id);return;}
        for(int i=first;i<=last;++i)bins_[i].push_back(id);
    }
    template<class F> void forLatitude(double south,double north,F&& fn) const {
        if(edges_.empty())return;
        if(++visit_==0){std::fill(stamps_.begin(),stamps_.end(),0);visit_=1;}
        const auto visitId=visit_;
        const auto test=[&](std::uint32_t id) {
            if(stamps_[id]==visitId)return;
            stamps_[id]=visitId;
            const auto& edge=edges_[id];
            if(edge.north<south-epsilon||edge.south>north+epsilon)return;
            fn(edge.a,edge.b);
        };
        for(const auto id:tall_)test(id);
        for(int bin=bucket(south-epsilon),last=bucket(north+epsilon);bin<=last;++bin)
            for(const auto id:bins_[bin])test(id);
    }
};
struct PreparedPeriodicRing {
    const Ring* source=nullptr;
    double west=std::numeric_limits<double>::infinity(),east=-std::numeric_limits<double>::infinity();
    double south=std::numeric_limits<double>::infinity(),north=-std::numeric_limits<double>::infinity();
    std::unique_ptr<LatitudeEdgeIndex> indexed;
    explicit PreparedPeriodicRing(const Ring& ring):source(&ring) {
        for(const auto p:ring) {
            west=std::min(west,p.x);east=std::max(east,p.x);
            south=std::min(south,p.y);north=std::max(north,p.y);
        }
        if(ring.size()<48)return;
        indexed=std::make_unique<LatitudeEdgeIndex>();
        for(std::size_t i=0,j=ring.size()-1;i<ring.size();j=i++)
            indexed->add(ring[j],ring[i]);
    }
    int locationAt(Point point) const {
        if(!indexed)return location(*source,point);
        bool inside=false,boundary=false;
        indexed->forLatitude(point.y,point.y,[&](Point a,Point b) {
            if(onSegment(a,b,point))boundary=true;
            if((a.y>point.y)!=(b.y>point.y) &&
                point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
        });
        return boundary?2:inside?1:0;
    }
    int periodicLocationAt(Point point) const {
        if(source->size()<3||point.y<south-epsilon||point.y>north+epsilon)return 0;
        bool boundary=false;
        const auto first=std::ceil((west-point.x-epsilon)/360),last=std::floor((east-point.x+epsilon)/360);
        for(auto copy=first;copy<=last;++copy) {
            const auto found=locationAt({point.x+copy*360,point.y});
            if(found==1)return 1;
            boundary|=found==2;
        }
        return boundary?2:0;
    }
};
struct PreparedPeriodicPolygon {
    std::vector<PreparedPeriodicRing> rings;
};
struct PreparedPeriodicGeometry {
    struct OuterBounds {double west,east,south,north;};
    std::vector<PreparedPeriodicPolygon> polygons;
    // Read-only, conservative periodic envelopes. A point classified as land
    // must be inside at least one exterior ring's envelope (modulo 360°).
    // These avoid running expensive periodic edge cuts for a remote parent's
    // coast when checking a small child such as the Armenian SSR.
    std::vector<OuterBounds> exteriorBounds;
    LatitudeEdgeIndex edges;
    explicit PreparedPeriodicGeometry(const Geometry& geometry) {
        polygons.reserve(geometry.polygons.size());
        exteriorBounds.reserve(geometry.polygons.size());
        for(const auto& polygon:geometry.polygons) {
            PreparedPeriodicPolygon item;item.rings.reserve(polygon.size());
            for(const auto& ring:polygon) {
                item.rings.emplace_back(ring);
                for(std::size_t i=1;i<ring.size();++i)edges.add(ring[i-1],ring[i]);
            }
            if(!item.rings.empty() && item.rings.front().source->size()>=3) {
                const auto& outer=item.rings.front();
                exteriorBounds.push_back({outer.west,outer.east,outer.south,outer.north});
            }
            polygons.push_back(std::move(item));
        }
    }
    bool mayCoverNear(Point a,Point b,double offset) const {
        // The caller tests at most length*1e-5 away from points on [a,b].
        // Include the old on-segment epsilon and full periodic repetitions.
        const auto south=std::min(a.y,b.y)-offset,north=std::max(a.y,b.y)+offset;
        const auto west=std::min(a.x,b.x)-offset,east=std::max(a.x,b.x)+offset;
        for(const auto& bounds:exteriorBounds) {
            if(bounds.north<south || bounds.south>north)continue;
            const auto first=std::ceil((west-bounds.east)/360.);
            const auto last=std::floor((east-bounds.west)/360.);
            if(first<=last)return true;
        }
        return false;
    }
    int locationAt(Point point) const {
        bool boundary=false;
        for(const auto& polygon:polygons) {
            if(polygon.rings.empty())continue;
            const auto outer=polygon.rings.front().periodicLocationAt(point);
            if(!outer)continue;
            bool hole=false,holeBoundary=false;
            for(std::size_t i=1;i<polygon.rings.size();++i) {
                const auto found=polygon.rings[i].periodicLocationAt(point);
                hole|=found==1;holeBoundary|=found==2;
            }
            if(hole)continue;
            if(outer==1&&!holeBoundary)return 1;
            boundary|=outer==2||holeBoundary;
        }
        return boundary?2:0;
    }
    std::vector<double> cuts(Point a,Point b) const {
        std::vector<double> result{0,1};
        const auto dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
        if(length<=epsilon*epsilon)return result;
        edges.forLatitude(std::min(a.y,b.y),std::max(a.y,b.y),[&](Point c,Point d) {
            // Preserve the exact longitude periodicity and collinear handling
            // from periodicCuts. Latitude buckets are only conservative.
            const auto first=std::ceil((std::min(a.x,b.x)-std::max(c.x,d.x)-epsilon)/360);
            const auto last=std::floor((std::max(a.x,b.x)-std::min(c.x,d.x)+epsilon)/360);
            for(auto copy=first;copy<=last;++copy) {
                const Point start{c.x+copy*360,c.y},finish{d.x+copy*360,d.y};
                const auto sx=finish.x-start.x,sy=finish.y-start.y,denominator=dx*sy-dy*sx;
                if(std::abs(denominator)>epsilon) {
                    const auto t=((start.x-a.x)*sy-(start.y-a.y)*sx)/denominator;
                    const auto u=((start.x-a.x)*dy-(start.y-a.y)*dx)/denominator;
                    if(t>=-epsilon&&t<=1+epsilon&&u>=-epsilon&&u<=1+epsilon)result.push_back(std::clamp(t,0.,1.));
                } else if(std::abs(cross(a,b,start))<=epsilon) {
                    for(const auto point:{start,finish}) {
                        const auto t=((point.x-a.x)*dx+(point.y-a.y)*dy)/length;
                        if(t>=-epsilon&&t<=1+epsilon)result.push_back(std::clamp(t,0.,1.));
                    }
                }
            }
        });
        std::sort(result.begin(),result.end());
        result.erase(std::unique(result.begin(),result.end(),[](double a,double b){return std::abs(a-b)<=1e-12;}),result.end());
        return result;
    }
};
bool geographicContains(const Geometry& container,const Geometry& subject) {
    if(container.polygons.empty()||subject.polygons.empty())return false;
    const PreparedPeriodicGeometry containedBy(container),containedGeometry(subject);
    bool contained=true;
    edges(subject,[&](Point a,Point b){
        if(!contained)return;auto cuts=containedBy.cuts(a,b);const auto own=containedGeometry.cuts(a,b);cuts.insert(cuts.end(),own.begin(),own.end());std::sort(cuts.begin(),cuts.end());
        const auto outside=[&](double t){const Point point{a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t};return containedGeometry.locationAt(point)!=0&&containedBy.locationAt(point)==0;};
        for(const auto t:cuts)if(outside(t)){contained=false;return;}
        for(std::size_t index=1;index<cuts.size();++index)if(outside((cuts[index-1]+cuts[index])/2)){contained=false;return;}
    });
    if(!contained)return false;
    // Preserve the original geographic hole/seam witness checks. Test the
    // subject first to avoid full-world lookups at points outside its extent.
    edges(container,[&](Point a,Point b){
        if(!contained)return;
        const auto dx=b.x-a.x,dy=b.y-a.y,length=std::hypot(dx,dy);if(length<=epsilon)return;
        // This second pass can only reject when a nearby sample is inside
        // the subject (not on its boundary). Its sampled points are at most
        // length*1e-5 away from [a,b], so remote parent edges cannot affect
        // the predicate. No exact intersection/winding rule is changed.
        if(!containedGeometry.mayCoverNear(a,b,length*1e-5+2*epsilon))return;
        auto cuts=containedGeometry.cuts(a,b);const auto other=containedBy.cuts(a,b);cuts.insert(cuts.end(),other.begin(),other.end());std::sort(cuts.begin(),cuts.end());
        for(std::size_t index=1;index<cuts.size()&&contained;++index) {
            if(cuts[index]-cuts[index-1]<=1e-12)continue;const auto t=(cuts[index-1]+cuts[index])/2;const Point middle{a.x+dx*t,a.y+dy*t};
            auto distance=length*(cuts[index]-cuts[index-1])*1e-5;
            for(int attempt=0;attempt<10&&contained;++attempt,distance*=.1)for(const auto side:{-1.,1.}) {
                const Point sample{middle.x-side*dy/length*distance,middle.y+side*dx/length*distance};
                if(containedGeometry.locationAt(sample)==1&&containedBy.locationAt(sample)==0){contained=false;break;}
            }
        }
    });
    return contained;
}
bool geographicOverlap(const Geometry& left,const Geometry& right) {
    const auto enters=[](const Geometry& boundary,const Geometry& other) {
        bool inside=false;edges(boundary,[&](Point a,Point b){if(inside)return;auto cuts=periodicCuts(other,a,b);const auto own=periodicCuts(boundary,a,b);cuts.insert(cuts.end(),own.begin(),own.end());std::sort(cuts.begin(),cuts.end());
            const auto enters=[&](double t){const Point point{a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t};return periodicLocation(boundary,point)!=0&&periodicLocation(other,point)==1;};
            for(const auto t:cuts)if(enters(t)){inside=true;return;}
            for(std::size_t index=1;index<cuts.size();++index)if(enters((cuts[index-1]+cuts[index])/2)){inside=true;return;}
        });return inside;
    };
    if(enters(left,right)||enters(right,left))return true;
    // Coincident components can overlap while unrelated islands mean neither
    // whole geometry contains the other. Find a witness in both filled sides,
    // rather than mistaking shared boundary-only samples for zero overlap.
    bool overlap=false;edges(left,[&](Point a,Point b){
        if(overlap)return;auto cuts=periodicCuts(right,a,b);const auto own=periodicCuts(left,a,b);cuts.insert(cuts.end(),own.begin(),own.end());std::sort(cuts.begin(),cuts.end());
        const auto dx=b.x-a.x,dy=b.y-a.y,length=std::hypot(dx,dy);if(length<=epsilon)return;
        for(std::size_t index=1;index<cuts.size()&&!overlap;++index) {
            if(cuts[index]-cuts[index-1]<=1e-12)continue;const auto t=(cuts[index-1]+cuts[index])/2;const Point middle{a.x+dx*t,a.y+dy*t};auto distance=length*(cuts[index]-cuts[index-1])*1e-5;
            for(int attempt=0;attempt<10&&!overlap;++attempt,distance*=.1)for(const auto side:{-1.,1.}) {
                const Point sample{middle.x-side*dy/length*distance,middle.y+side*dx/length*distance};
                if(periodicLocation(left,sample)==1&&periodicLocation(right,sample)==1){overlap=true;break;}
            }
        }
    });
    return overlap;
}

}
std::vector<TerritorialRingIssue> validateTerritorialRing(const Ring& ring) {
    std::vector<TerritorialRingIssue> issues;
    const auto original = [&](const char* kind, std::size_t index) {
        TerritorialRingIssue result; result.kind=kind;
        if(index<ring.size()){result.coordinate=ring[index];result.coordinateIndex=index;}
        return result;
    };
    for(std::size_t i=0;i<ring.size();++i)if(!std::isfinite(ring[i].x)||!std::isfinite(ring[i].y)) {
        TerritorialRingIssue result;result.kind="invalid-geometry";result.vertexIndex=i;issues.push_back(result);return issues;
    }
    if(ring.size()<4){issues.push_back(original("invalid-geometry",0));return issues;}
    const auto equal=[](Point a,Point b){return std::abs(a.x-b.x)<=1e-10&&std::abs(a.y-b.y)<=1e-10;};
    if(!equal(ring.front(),ring.back()))issues.push_back(original("open-ring",ring.size()-1));
    double area=0;
    for(std::size_t i=1;i<ring.size();++i)area+=ring[i-1].x*ring[i].y-ring[i].x*ring[i-1].y;
    if(std::abs(area/2)<=1e-14)issues.push_back(original("zero-area",0));
    for(std::size_t i=1;i<ring.size();++i)if(equal(ring[i-1],ring[i])){
        auto result=original("duplicate-vertex",i);result.vertexIndex=i;issues.push_back(result);
    }
    struct Segment {std::size_t index;Point a,b;double minX,maxX,minY,maxY;};
    std::vector<Segment> segments;segments.reserve(ring.size()-1);
    for(std::size_t i=1;i<ring.size();++i){const auto a=ring[i-1],b=ring[i];segments.push_back({i-1,a,b,std::min(a.x,b.x),std::max(a.x,b.x),std::min(a.y,b.y),std::max(a.y,b.y)});}
    std::stable_sort(segments.begin(),segments.end(),[](const auto& a,const auto& b){return a.minX!=b.minX?a.minX<b.minX:a.minY<b.minY;});
    std::vector<Segment> active;
    constexpr double tolerance=1e-12;
    for(const auto& current:segments){
        active.erase(std::remove_if(active.begin(),active.end(),[&](const auto& candidate){return !(candidate.maxX>=current.minX-tolerance);}),active.end());
        for(const auto& candidate:active){
            const auto a=candidate.index,b=current.index,n=segments.size();
            if((a>b?a-b:b-a)==1||(a==0&&b==n-1)||(b==0&&a==n-1)||candidate.maxY<current.minY-tolerance||candidate.minY>current.maxY+tolerance)continue;
            const auto p=candidate.a,q=candidate.b,r=current.a,s=current.b;
            const auto denominator=(p.x-q.x)*(r.y-s.y)-(p.y-q.y)*(r.x-s.x);
            if(std::abs(denominator)<=tolerance)continue;
            const auto d1=p.x*q.y-p.y*q.x,d2=r.x*s.y-r.y*s.x;
            const Point hit{(d1*(r.x-s.x)-(p.x-q.x)*d2)/denominator,(d1*(r.y-s.y)-(p.y-q.y)*d2)/denominator};
            const auto inside=[=](Point h,Point l,Point u){return h.x>=std::min(l.x,u.x)-tolerance&&h.x<=std::max(l.x,u.x)+tolerance&&h.y>=std::min(l.y,u.y)-tolerance&&h.y<=std::max(l.y,u.y)+tolerance;};
            if(!inside(hit,p,q)||!inside(hit,r,s))continue;
            TerritorialRingIssue result;result.kind="self-intersection";result.coordinate=hit;result.segmentIndex=a;issues.push_back(result);return issues;
        }
        active.push_back(current);
    }
    return issues;
}
double territorialValidationArea(const MultiPolygon& polygons) noexcept {
    double total=0;
    for(const auto& polygon:polygons) {
        const double exterior=polygon.empty()?0:ringArea(polygon.front());
        double holes=0;
        for(std::size_t i=1;i<polygon.size();++i)holes+=ringArea(polygon[i]);
        total+=std::max(0.,exterior-holes);
    }
    return total;
}
double planarArea(const Geometry& g) noexcept { double sum=0;for(const auto& p:g.polygons)for(std::size_t i=0;i<p.size();++i)sum+=(i?-1:1)*ringArea(p[i]);return std::abs(sum); }
bool significantArea(double value,double reference) noexcept { return value>std::max(1e-10,std::abs(reference)*1e-9); }
bool geometryContains(const Geometry& container,const Geometry& subject) {
    if(container.polygons.empty()||subject.polygons.empty())return false;
    if(needsGeographicView(container)||needsGeographicView(subject))return geographicContains(geographicView(container),geographicView(subject));
    if(crosses(container,subject))return false;
    for(const auto& poly:subject.polygons) { if(poly.empty())return false; for(const auto& p:poly.front())if(location(container,p)==0)return false; }
    // A container hole may not be covered by the subject's filled area.
    for(const auto& poly:container.polygons)for(std::size_t i=1;i<poly.size();++i)if(location(subject,interior(poly[i]))==1)return false;
    return true;
}
bool geometrySignificantOverlap(const Geometry& a,const Geometry& b) {
    if(a.polygons.empty()||b.polygons.empty())return false;
    if(needsGeographicView(a)||needsGeographicView(b))return geographicOverlap(geographicView(a),geographicView(b));
    if(crosses(a,b)) return true;
    // Aligned edges may overlap without any proper crossing (and a polygon's
    // vertex average can lie in a hole). Check boundary samples in both ways.
    bool interiorHit=false;
    edges(a,[&](Point p,Point q){interiorHit=interiorHit||location(b,p)==1||location(b,{(p.x+q.x)/2,(p.y+q.y)/2})==1;});
    edges(b,[&](Point p,Point q){interiorHit=interiorHit||location(a,p)==1||location(a,{(p.x+q.x)/2,(p.y+q.y)/2})==1;});
    if(interiorHit||geometryContains(a,b)||geometryContains(b,a))return true;
    for(const auto& p:a.polygons)if(!p.empty()&&location(b,interior(p.front()))==1&&significantArea(planarArea(a),planarArea(b)))return true;
    for(const auto& p:b.polygons)if(!p.empty()&&location(a,interior(p.front()))==1&&significantArea(planarArea(b),planarArea(a)))return true;
    return false;
}
}
