#include <pandoeditor/boundaryrefinement.h>
#include <array>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace pandoeditor {
namespace {
constexpr double radians=3.141592653589793238462643383279502884/180.;
constexpr double microdegree=1'000'000.;
using Vector=std::array<double,3>;
Vector direction(Point point) {
    const double longitude=point.x*radians,latitude=point.y*radians;
    const double cosine=std::cos(latitude);
    return {cosine*std::cos(longitude),cosine*std::sin(longitude),std::sin(latitude)};
}
double roundWebMicrodegree(double number) {
    const double scaled=number*microdegree;
    // Math.round rounds all half ties towards positive infinity and retains
    // negative zero; std::round rounds ties away from zero instead.
    double rounded=std::floor(scaled);
    if(scaled-rounded>=.5)rounded+=1;
    const double packed=rounded*0.000001;
    return packed==0&&std::signbit(scaled)?-0.0:packed;
}
Point pack(Point point) {
    return {roundWebMicrodegree(point.x),roundWebMicrodegree(point.y)};
}
}
double boundaryMinimumDot(double requestedDegrees) {
    const double chosen=std::isfinite(requestedDegrees)&&requestedDegrees!=0
        ? requestedDegrees:kDefaultBoundaryEdgeDegrees;
    const double limit=std::max(0.01,chosen);
    return std::cos(std::max(0.01,limit-0.000002)*radians);
}
std::vector<BoundaryEdge> refineDisplayBoundarySegments(
    const std::vector<BoundaryEdge>& source,double maxEdgeDegrees) {
    const double minimumDot=boundaryMinimumDot(maxEdgeDegrees);
    struct Work {Point a,b;unsigned depth;};
    std::vector<BoundaryEdge> result;
    result.reserve(source.size());
    std::vector<Work> stack;
    for(const auto& [a,b]:source) {
        if(!std::isfinite(a.x)||!std::isfinite(a.y)||!std::isfinite(b.x)||!std::isfinite(b.y))
            throw std::invalid_argument("INVALID_BOUNDARY_REFINEMENT: nonfinite endpoint");
        stack.push_back({a,b,0});
        while(!stack.empty()) {
            const auto [left,right,depth]=stack.back();stack.pop_back();
            const Vector x=direction(left),y=direction(right);
            const double dot=x[0]*y[0]+x[1]*y[1]+x[2]*y[2];
            if(dot<minimumDot-1e-14) {
                if(depth>=40)throw std::runtime_error("Display boundary refinement did not converge");
                const Point midpoint{(left.x+right.x)/2,(left.y+right.y)/2};
                stack.push_back({midpoint,right,depth+1});
                stack.push_back({left,midpoint,depth+1});
                continue;
            }
            const Point start=pack(left),end=pack(right);
            if(start.x!=end.x||start.y!=end.y)result.emplace_back(start,end);
            if(result.size()>4'000'000)
                throw std::runtime_error("INVALID_BOUNDARY_REFINEMENT: excessive output");
        }
    }
    return result;
}
}
