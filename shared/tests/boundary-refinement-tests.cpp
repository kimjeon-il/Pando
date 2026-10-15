#include <pandoeditor/boundaryrefinement.h>
#include <cassert>
#include <cmath>
#include <stdexcept>
using namespace pandoeditor;
namespace {Point p(double x,double y){return {x,y};}}
int main() {
    assert(kDefaultBoundaryEdgeDegrees==0.499);
    assert(boundaryMinimumDot(kDefaultBoundaryEdgeDegrees)>0.99996);
    const auto medium=refineDisplayBoundarySegments({{p(0,0),p(8,0)}},2);
    assert(medium.size()>4);
    assert(medium.front().first.x==0 && medium.back().second.x==8);
    const auto fine=refineDisplayBoundarySegments({{p(0,0),p(8,0)}});
    assert(fine.size()>medium.size());
    auto reverse=refineDisplayBoundarySegments({{p(8,0),p(0,0)}},2);
    assert(reverse.size()==medium.size());
    assert(reverse.front().first.x==8 && reverse.back().second.x==0);
    auto near=refineDisplayBoundarySegments({{p(-0.0000005,0),p(0.0000005,0)}},2);
    assert(near.size()==1);
    assert(std::signbit(near[0].first.x) && near[0].second.x==0.000001);
    auto empty=refineDisplayBoundarySegments({});
    assert(empty.empty());
    bool invalid=false;
    try {refineDisplayBoundarySegments({{p(NAN,0),p(2,0)}});}
    catch(const std::invalid_argument&){invalid=true;}
    assert(invalid);
    return 0;
}
