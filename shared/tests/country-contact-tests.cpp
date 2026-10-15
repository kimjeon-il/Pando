#include <pandoeditor/countrycontact.h>
#include <cassert>
#include <cmath>
#include <vector>
using namespace pandoeditor;
namespace {
Point p(double x,double y){return {x,y};}
CountryContactRow row(Point a,Point b,unsigned segment=0){return {{a,b},0,0,segment};}
CountryContactFeature feature(std::initializer_list<CountryContactRow> rows){return {rows};}
}
int main() {
    const auto a=feature({row(p(0,0),p(1,0)),row(p(1,0),p(1,1),1),row(p(1,1),p(0,1),2),row(p(0,1),p(0,0),3)});
    const auto b=feature({row(p(1,0),p(2,0)),row(p(2,0),p(2,1),1),row(p(2,1),p(1,1),2),row(p(1,1),p(1,0),3)});
    const auto result=buildCountryContactPairs({a,b},{{0,1}});
    assert(result.size()==1);
    assert(result[0].segments.size()==1);
    const auto& shared=result[0].segments[0];
    assert(shared.edge.first.x==1&&shared.edge.second.x==1);
    assert(shared.refs.size()==2 && shared.refs[0].owner!=shared.refs[1].owner);
    assert(!result[0].candidates.empty());
    assert(buildCountryContactPairs({a,b},{{1,0}})[0].segments.size()==1);
    const auto far=feature({row(p(40,0),p(41,0))});
    assert(buildCountryContactPairs({a,far},{{0,1}})[0].segments.empty());
    const auto triple=feature({row(p(1,0),p(1,.5)),row(p(1,.5),p(1,1),1)});
    const auto split=buildCountryContactPairs({a,triple},{{0,1}})[0];
    assert(split.segments.size()==2);
    assert(split.segments[0].refs.size()==2&&split.segments[1].refs.size()==2);
    const auto north=feature({row(p(-179,90),p(179,90))});
    const auto south=feature({row(p(-179,90),p(179,90))});
    assert(buildCountryContactPairs({north,south},{{0,1}})[0].segments.empty());
    return 0;
}
