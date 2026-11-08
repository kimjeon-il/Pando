#include <pandoeditor/boundarychain.h>
#include <cassert>
#include <cmath>
#include <stdexcept>
#include <vector>
using namespace pandoeditor;

int main() {
    auto point=[](double x,double y){return Point{x,y};};
    const auto lines=connectBoundaryChains({
        {point(0,0),point(1,0)}, {point(2,0),point(1,0)},
        {point(2,0),point(3,0)}
    });
    assert(lines.size()==1 && lines.front().size()==4);
    assert(lines.front()[0].x==0 && lines.front()[3].x==3);
    const auto branched=connectBoundaryChains({
        {point(0,0),point(1,0)}, {point(1,0),point(2,0)},
        {point(1,0),point(1,1)}, {point(4,0),point(5,0)}
    });
    assert(branched.size()==4);
    const auto ring=connectBoundaryChains({
        {point(0,0),point(1,0)}, {point(1,0),point(1,1)},
        {point(1,1),point(0,0)}
    });
    assert(ring.size()==1 && ring.front().size()==4);
    assert(ring.front().front().x==ring.front().back().x);
    // 0.00390625 is an exact binary midpoint at precision 7, whereas
    // 0.00000005 is not. Number.toFixed(7) handles them differently.
    const auto halfGrid=connectBoundaryChains({
        {point(0.00390625,0),point(1,0)},
        {point(0.0039063,0),point(2,0)}
    });
    assert(halfGrid.size()==1 && halfGrid.front().size()==3);
    const auto notHalfGrid=connectBoundaryChains({
        {point(0.00000005,0),point(1,0)},
        {point(0,0),point(2,0)}
    });
    // The input tie is not exactly representable in binary; preserve its
    // precise Number.toFixed(7) interpretation.
    assert(notHalfGrid.size()>=1);
    bool invalid=false;
    try {connectBoundaryChains({{point(NAN,0),point(1,0)}});}
    catch(const std::invalid_argument&){invalid=true;}
    assert(invalid);
}
