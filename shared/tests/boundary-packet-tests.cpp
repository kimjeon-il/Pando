#include <pandoeditor/boundarypacket.h>
#include <cassert>
#include <cmath>
#include <stdexcept>
#include <vector>
using namespace pandoeditor;
int main() {
    const auto p=[](double x,double y){return Point{x,y};};
    const std::vector<SharedStrokeSource> source={
        {{p(0,0),p(0,.25)},{"A","B"}},
        {{p(2,0),p(2,.25)},{"C"}},
        {{p(0,.25),p(0,.5)},{"A","B"}},
    };
    const auto packet=assembleSharedStrokePacket(source,2);
    assert(packet.segments.size()==3);
    assert(packet.ownerRanges.size()==2);
    assert(packet.ownerRanges[0].ownerKey=="A|B");
    assert(packet.ownerRanges[0].first==0&&packet.ownerRanges[0].count==2);
    assert(packet.ownerRanges[1].ownerKey=="C");
    assert(packet.ownerRanges[1].first==2&&packet.ownerRanges[1].count==1);
    assert(packet.ownerIds==std::vector<std::string>({"A","B","C"}));
    assert(packet.segments[0].chainPhase==0);
    assert(std::abs(packet.segments[1].chainPhase-.25)<.000001);
    assert(packet.segments[2].chainPhase==0);
    assert(verifySharedStrokeChains({source[0],source[2]})==2);
    bool invalid=false;
    try {verifySharedStrokeChains({source[1]});}
    catch(const std::invalid_argument&) {invalid=true;}
    assert(invalid);

    // Legitimate antimeridian crossings must split, without a 360-degree chord.
    const auto seam=assembleSharedStrokePacket({
        {{p(179.8,30),p(-179.8,30)},{"E","W"}}
    },2);
    assert(seam.segments.size()==2);
    assert(seam.segments[0].edge.second.x==180);
    assert(seam.segments[1].edge.first.x==-180);
    assert(seam.segments[1].chainPhase>0);

    const auto artificial=assembleSharedStrokePacket({
        {{p(180,10),p(180,20)},{"A","B"}},
        {{p(0,90),p(1,89)},{"A","B"}},
    });
    assert(artificial.segments.empty());
    assert(artificial.ownerRanges.empty());
    assert(artificial.ownerIds.empty());
    assert(source[0].edge.first.y==0);
}
