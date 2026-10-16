#include <pandoeditor/boundarysplit.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace pandoeditor {
namespace {
constexpr double bucketSize=0.25;
constexpr double maximumInputCoordinate=1'000'000;
void check(Point p) {
    if(!std::isfinite(p.x)||!std::isfinite(p.y)
       ||std::abs(p.x)>maximumInputCoordinate||std::abs(p.y)>90)
        throw std::invalid_argument("INVALID_BOUNDARY_SPLIT: geographic point");
}
std::optional<double> positionOnSegment(Point point,const BoundaryEdge& edge,double epsilon) {
    const auto [a,b]=edge;
    point.x=boundaryLongitudeNear(point.x,(a.x+b.x)/2);
    const double dx=b.x-a.x,dy=b.y-a.y;
    const double length2=dx*dx+dy*dy;
    if(!length2)return {};
    const double t=((point.x-a.x)*dx+(point.y-a.y)*dy)/length2;
    if(t<-epsilon||t>1+epsilon)return {};
    const double x=a.x+dx*t,y=a.y+dy*t;
    const double distance=std::hypot(point.x-x,point.y-y);
    return distance<=epsilon?std::optional<double>{std::max(0.,std::min(1.,t))}:std::nullopt;
}
int bucket(double coordinate) {
    const double index=std::floor(coordinate/bucketSize);
    if(index<double(std::numeric_limits<int>::min())||
       index>double(std::numeric_limits<int>::max()))
        throw std::invalid_argument("INVALID_BOUNDARY_SPLIT: bucket index");
    return int(index);
}
}
double boundaryLongitudeNear(double longitude,double anchor) {
    if(!std::isfinite(longitude)||!std::isfinite(anchor)||std::abs(longitude)>maximumInputCoordinate
       ||std::abs(anchor)>maximumInputCoordinate)
        throw std::invalid_argument("INVALID_BOUNDARY_SPLIT: longitude");
    longitude=std::fmod(longitude,360.);
    while(longitude-anchor>180.)longitude-=360.;
    while(longitude-anchor< -180.)longitude+=360.;
    return longitude==0?0.:longitude;
}
BoundaryEdge connectedBoundaryEdge(BoundaryEdge edge) {
    check(edge.first);check(edge.second);
    edge.first.x=boundaryLongitudeNear(edge.first.x,0.);
    edge.second.x=boundaryLongitudeNear(edge.second.x,edge.first.x);
    return edge;
}
std::vector<std::pair<double,double>> boundaryLongitudeRanges(double west,double east) {
    if(!std::isfinite(west)||!std::isfinite(east)||west>east)
        throw std::invalid_argument("INVALID_BOUNDARY_SPLIT: longitude bounds");
    const double width=east-west;
    if(width>=360.)return {{-180.,180.}};
    west=boundaryLongitudeNear(west,0.);east=west+width;
    if(east>180.)return {{-180.,east-360.},{west,180.}};
    return {{west,east}};
}
std::vector<BoundaryBox> boundaryEdgeBoxes(BoundaryEdge edge) {
    edge=connectedBoundaryEdge(edge);
    std::vector<BoundaryBox> boxes;
    for(const auto [west,east]:boundaryLongitudeRanges(
            std::min(edge.first.x,edge.second.x),std::max(edge.first.x,edge.second.x)))
        boxes.push_back({west,std::min(edge.first.y,edge.second.y),east,std::max(edge.first.y,edge.second.y)});
    return boxes;
}
std::vector<std::vector<BoundarySplitCandidate>> boundarySplitCandidates(
    const std::vector<BoundaryEdge>& edges,const std::vector<Point>& uniqueNodes,
    double epsilon) {
    if(!std::isfinite(epsilon)||epsilon<0||epsilon>1)
        throw std::invalid_argument("INVALID_BOUNDARY_SPLIT: epsilon");
    for(const auto& node:uniqueNodes)check(node);
    for(const auto& edge:edges){check(edge.first);check(edge.second);}
    std::map<std::pair<int,int>,std::vector<std::size_t>> buckets;
    for(std::size_t n=0;n<uniqueNodes.size();++n){
        const auto& point=uniqueNodes[n];
        double longitude=boundaryLongitudeNear(point.x,0.);
        if(longitude==180.)longitude=-180.;
        buckets[{bucket(longitude),bucket(point.y)}].push_back(n);
    }
    std::vector<std::vector<BoundarySplitCandidate>> result;
    result.reserve(edges.size());
    for(const auto& rawEdge:edges){
        const auto edge=connectedBoundaryEdge(rawEdge);
        const int minX=bucket(std::min(edge.first.x,edge.second.x)-epsilon);
        const int maxX=bucket(std::max(edge.first.x,edge.second.x)+epsilon);
        const int minY=bucket(std::min(edge.first.y,edge.second.y)-epsilon);
        const int maxY=bucket(std::max(edge.first.y,edge.second.y)+epsilon);
        const double cells=(double(maxX)-double(minX)+1)
            *(double(maxY)-double(minY)+1);
        std::vector<BoundarySplitCandidate> split;
        const auto add=[&](std::size_t index){
            if(auto t=positionOnSegment(uniqueNodes[index],edge,epsilon))
                split.push_back({index,*t});
        };
        if(cells>4096) {
            for(std::size_t i=0;i<uniqueNodes.size();++i)add(i);
        } else {
            for(const auto [west,east]:boundaryLongitudeRanges(
                    std::min(edge.first.x,edge.second.x)-epsilon,
                    std::max(edge.first.x,edge.second.x)+epsilon))
                for(int x=bucket(west);x<=bucket(east);++x)for(int y=minY;y<=maxY;++y) {
                    const auto it=buckets.find({x,y});
                    if(it!=buckets.end())for(auto index:it->second)add(index);
                }
        }
        std::stable_sort(split.begin(),split.end(),[](const auto& a,const auto& b){
            return a.t<b.t;
        });
        result.push_back(std::move(split));
    }
    return result;
}
}
