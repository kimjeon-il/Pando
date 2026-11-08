#include <pandoeditor/boundarycontact.h>
#include <cassert>
#include <stdexcept>
using namespace pandoeditor;
namespace {
Point p(double x,double y){return {x,y};}
BoundaryInteriorRef ref(Point a,Point b,double side){return {{a,b},side};}
}
int main() {
    const BoundaryEdge horizontal={p(0,0),p(1,0)};
    assert(boundaryOpposingInteriors(horizontal,{ref(p(0,0),p(1,0),1),
                                             ref(p(0,0),p(1,0),-1)}));
    assert(!boundaryOpposingInteriors(horizontal,{ref(p(0,0),p(1,0),1),
                                                  ref(p(0,0),p(1,0),1)}));
    assert(!boundaryOpposingInteriors(horizontal,{ref(p(0,0),p(1,0),1),
                                                  ref(p(1,0),p(0,0),-1)}));
    assert(boundaryOpposingInteriors(horizontal,{ref(p(0,0),p(1,0),1),
                                                 ref(p(1,0),p(0,0),1)}));
    assert(!boundaryOpposingInteriors(horizontal,{}));
    assert(!boundaryOpposingInteriors(horizontal,{ref(p(0,0),p(0,1),1),
                                                  ref(p(0,0),p(0,1),-1)}));
    const BoundaryEdge crossing={p(179.5,20),p(-179.5,20)};
    assert(boundaryOpposingInteriors(crossing,{
        ref(p(179.5,20),p(-179.5,20),1),
        ref(p(-179.5,20),p(179.5,20),1)}));
    assert(!boundaryOpposingInteriors(crossing,{
        ref(p(179.5,20),p(-179.5,20),1),
        ref(p(-179.5,20),p(179.5,20),-1)}));
    bool rejected=false;
    try {boundaryOpposingInteriors({p(0,91),p(1,0)},{});}
    catch(const std::invalid_argument&){rejected=true;}
    assert(rejected);
    return 0;
}
