#include <pandoeditor/boundarysplit.h>
#include <cassert>
#include <cmath>
#include <stdexcept>
#include <vector>
using namespace pandoeditor;
namespace {
Point p(double x,double y){return {x,y};}
BoundaryEdge edge(Point a,Point b){return {a,b};}
}
int main() {
    const std::vector<Point> nodes{p(0,0),p(1,0),p(.25,0),p(.75,0),p(.5,0),p(4,4)};
    auto result=boundarySplitCandidates({edge(p(0,0),p(1,0))},nodes);
    assert(result.size()==1 && result[0].size()==5);
    for(std::size_t i=0;i<result[0].size();++i)
        assert(result[0][i].t==double(i)/4);
    assert(result[0][0].nodeIndex==0 && result[0][4].nodeIndex==1);
    result=boundarySplitCandidates({edge(p(1,0),p(0,0))},nodes);
    assert(result[0].size()==5 && result[0][0].nodeIndex==1 &&
           result[0][4].nodeIndex==0);
    // Date line span forces the >4096-cell broad-phase fallback.
    result=boundarySplitCandidates({edge(p(-179,10),p(179,10))},
        {p(-179,10),p(0,10),p(179,10),p(0,11)});
    assert(result[0].size()==3 && result[0][1].nodeIndex==1);
    result=boundarySplitCandidates({edge(p(1,1),p(1,1))},nodes);
    assert(result[0].empty());
    result=boundarySplitCandidates({},nodes);
    assert(result.empty());
    bool caught=false;
    try{boundarySplitCandidates({edge(p(0,0),p(1,0))},nodes,-1);}
    catch(const std::invalid_argument&){caught=true;}
    assert(caught);
    caught=false;
    try{boundarySplitCandidates({edge(p(NAN,0),p(1,0))},nodes);}
    catch(const std::invalid_argument&){caught=true;}
    assert(caught);
    return 0;
}
