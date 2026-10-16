#include <pandoeditor/countrycontact.h>
#include <algorithm>
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
    const auto date=feature({row(p(179,0),p(-179,0)),row(p(-179,0),p(-179,1),1),
        row(p(-179,1),p(179,1),2),row(p(179,1),p(179,0),3)});
    const auto greenwich=feature({row(p(0,1),p(1,1)),row(p(1,1),p(1,2),1),
        row(p(1,2),p(0,2),2),row(p(0,2),p(0,1),3)});
    assert(buildCountryContactPairs({date,greenwich},{{0,1}})[0].segments.empty());
    assert(buildCountryContactPairs({date,greenwich},{{1,0}})[0].segments.empty());
    const auto adjacent=feature({row(p(179,1),p(-179,1)),row(p(-179,1),p(-179,2),1),
        row(p(-179,2),p(179,2),2),row(p(179,2),p(179,1),3)});
    const auto seamContact=buildCountryContactPairs({date,adjacent},{{0,1}})[0];
    assert(seamContact.segments.size()==2);
    for(const auto& segment:seamContact.segments) {
        assert(std::abs(segment.edge.first.x)>=179&&std::abs(segment.edge.second.x)>=179);
        assert(std::abs(segment.edge.first.x-segment.edge.second.x)<=1);
        assert(segment.refs.size()==2);
        assert(std::any_of(segment.refs.begin(),segment.refs.end(),[](const auto& ref){return ref.owner==0&&ref.row==2;}));
        assert(std::any_of(segment.refs.begin(),segment.refs.end(),[](const auto& ref){return ref.owner==1&&ref.row==0;}));
    }
    return 0;
}
