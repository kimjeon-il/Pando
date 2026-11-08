#include <pandoeditor/boundaryoverlap.h>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <utility>
#include <vector>

namespace pandoeditor {
namespace {
constexpr double alignmentEpsilon=1e-7;
constexpr double fragmentEpsilon=1e-9;
void checked(Point point) {
    if(!std::isfinite(point.x)||!std::isfinite(point.y)
       ||std::abs(point.x)>1'000'000||std::abs(point.y)>90.)
        throw std::invalid_argument("INVALID_BOUNDARY_OVERLAP: invalid geographic coordinate");
}
}
std::vector<std::vector<BoundaryEdge>> subtractBoundaryOverlaps(
    const std::vector<BoundaryOverlapRequest>& requests) {
    std::vector<std::vector<BoundaryEdge>> output;
    output.reserve(requests.size());
    for(const auto& request:requests) {
        const auto [start,end]=request.source;
        checked(start);checked(end);
        const double dx=end.x-start.x,dy=end.y-start.y;
        const double length2=dx*dx+dy*dy;
        const double threshold=alignmentEpsilon*std::sqrt(length2);
        std::vector<std::pair<double,double>> intervals;
        intervals.reserve(request.candidates.size());
        for(const auto& candidate:request.candidates) {
            const auto [a,b]=candidate;
            checked(a);checked(b);
            const auto aligned=[&](Point point) {
                return std::abs((point.x-start.x)*dy-(point.y-start.y)*dx)<=threshold;
            };
            if(!aligned(a)||!aligned(b))continue;
            // For a zero-length source the historic JS ratio is NaN, so no
            // candidate can create a positive covered interval.
            if(length2==0)continue;
            const auto project=[&](Point point) {
                return ((point.x-start.x)*dx+(point.y-start.y)*dy)/length2;
            };
            const double aa=project(a),bb=project(b);
            const double first=std::max(0.,std::min(aa,bb));
            const double last=std::min(1.,std::max(aa,bb));
            if(last>first)intervals.emplace_back(first,last);
        }
        std::stable_sort(intervals.begin(),intervals.end(),
            [](const auto& left,const auto& right){return left.first<right.first;});
        std::vector<BoundaryEdge> pieces;
        const auto point=[&](double t) {
            return Point{start.x+dx*t,start.y+dy*t};
        };
        double cursor=0;
        for(const auto& [first,last]:intervals) {
            if(first>cursor+fragmentEpsilon)pieces.emplace_back(point(cursor),point(first));
            cursor=std::max(cursor,last);
        }
        if(cursor<1-fragmentEpsilon)pieces.emplace_back(point(cursor),end);
        output.push_back(std::move(pieces));
    }
    return output;
}
}
