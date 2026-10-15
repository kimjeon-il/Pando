#include <pandoeditor/boundaryoverlap.h>
#include <cassert>
#include <cmath>
#include <stdexcept>
using namespace pandoeditor;
namespace {
Point p(double x,double y){return {x,y};}
BoundaryEdge e(Point a,Point b){return {a,b};}
}
int main() {
    auto result=subtractBoundaryOverlaps({{
        e(p(0,0),p(10,0)),
        {e(p(3,0),p(5,0)),e(p(8,0),p(6,0)),e(p(5,0),p(6,0))}
    }});
    assert(result.size()==1 && result[0].size()==2);
    assert(result[0][0].first.x==0 && result[0][0].second.x==3);
    assert(result[0][1].first.x==8 && result[0][1].second.x==10);
    result=subtractBoundaryOverlaps({{
        e(p(0,0),p(10,0)),{e(p(-1,0),p(12,0))}
    },{
        e(p(10,0),p(0,0)),{e(p(4,0),p(6,0))}
    },{
        e(p(0,0),p(10,0)),{e(p(2,0.001),p(8,0.001))}
    }});
    assert(result.size()==3);
    assert(result[0].empty());
    assert(result[1].size()==2 && result[1][0].first.x==10
           && result[1][0].second.x==6 && result[1][1].first.x==4);
    assert(result[2].size()==1 && result[2][0].second.x==10);
    result=subtractBoundaryOverlaps({{e(p(1,1),p(1,1)),{}}});
    assert(result[0].size()==1 && result[0][0].first.x==1);
    bool invalid=false;
    try{subtractBoundaryOverlaps({{e(p(NAN,0),p(1,0)),{}}});}
    catch(const std::invalid_argument&){invalid=true;}
    assert(invalid);
    return 0;
}
