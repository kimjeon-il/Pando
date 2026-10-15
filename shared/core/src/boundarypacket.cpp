#include <pandoeditor/boundarypacket.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>

namespace pandoeditor {
namespace {
constexpr double kStrokeEpsilon=1e-7;
struct Group {
    std::string key;
    std::vector<std::string> owners;
    std::vector<BoundaryEdge> edges;
};
std::string ownerKey(const std::vector<std::string>& ids) {
    std::string key;
    for(const auto& id:ids) {
        if(!key.empty())key+='|';
        key+=id;
    }
    return key;
}
std::vector<Group> collect(const std::vector<SharedStrokeSource>& sources,bool sharedOnly) {
    std::vector<Group> groups;
    std::map<std::string,std::size_t> positions;
    for(const auto& source:sources) {
        if(source.ownerIds.empty() || (sharedOnly&&source.ownerIds.size()<2))
            throw std::invalid_argument("INVALID_SHARED_STROKE: missing source owners");
        if(!std::isfinite(source.edge.first.x)||!std::isfinite(source.edge.first.y)
            ||!std::isfinite(source.edge.second.x)||!std::isfinite(source.edge.second.y))
            throw std::invalid_argument("INVALID_SHARED_STROKE: nonfinite point");
        const auto key=ownerKey(source.ownerIds);
        auto it=positions.find(key);
        if(it==positions.end()) {
            const auto index=groups.size();
            positions.emplace(key,index);
            groups.push_back({key,source.ownerIds,{}});
            it=positions.find(key);
        }
        groups[it->second].edges.push_back(source.edge);
    }
    return groups;
}
double normalizedLongitude(double value) {
    // Geographic source coordinates are normally [-180, 180]. Retain the
    // browser's inclusive +/-180 conventions rather than using std::remainder.
    while(value>180)value-=360;
    while(value< -180)value+=360;
    return value;
}
double nearLongitude(double value,double reference) {
    value=normalizedLongitude(value);
    while(value-reference>180)value-=360;
    while(value-reference< -180)value+=360;
    return value;
}
bool pole(Point point) {
    return std::abs(std::abs(point.y)-90)<=kStrokeEpsilon;
}
bool dateLine(Point point) {
    return std::abs(std::abs(normalizedLongitude(point.x))-180)<=kStrokeEpsilon;
}
void appendDisplayEdge(std::vector<BoundaryEdge>& output,Point a,Point b) {
    // Equivalent to geographic-boundary.js LineString filtering. The chain
    // connects *source* edges first; never reconnect subdivided display edges.
    if((std::abs(a.x-b.x)<=kStrokeEpsilon && std::abs(a.y-b.y)<=kStrokeEpsilon)
        ||pole(a)||pole(b)
        ||(dateLine(a)&&dateLine(b)&&std::abs(a.y-b.y)>kStrokeEpsilon))return;
    Point start{normalizedLongitude(a.x),a.y};
    const double finishLongitude=nearLongitude(b.x,start.x);
    const double delta=finishLongitude-start.x;
    if(std::abs(delta)>180)return;
    if(finishLongitude>180||finishLongitude< -180) {
        const double seam=delta>0?180:-180;
        const double ratio=(seam-start.x)/delta;
        const double latitude=a.y+(b.y-a.y)*ratio;
        output.push_back({start,{seam,latitude}});
        output.push_back({{delta>0?-180.0:180.0,latitude},
            {normalizedLongitude(finishLongitude),b.y}});
    } else output.push_back({start,{finishLongitude,b.y}});
}
}
std::size_t verifySharedStrokeChains(const std::vector<SharedStrokeSource>& sources) {
    std::size_t checked=0;
    for(const auto& group:collect(sources,true)) {
        std::size_t observed=0;
        for(const auto& chain:connectBoundaryChains(group.edges))
            if(chain.size()>=2)observed+=chain.size()-1;
        if(observed!=group.edges.size())
            throw std::runtime_error("Shared border chain conservation failed: "+group.key);
        checked+=observed;
    }
    if(checked!=sources.size())
        throw std::runtime_error("Shared border chain dropped source edges");
    return checked;
}
SharedStrokePacket assembleSharedStrokePacket(
    const std::vector<SharedStrokeSource>& sources,double maxEdgeDegrees) {
    SharedStrokePacket packet;
    for(const auto& group:collect(sources,false)) {
        const std::size_t first=packet.segments.size();
        for(const auto& chain:connectBoundaryChains(group.edges)) {
            std::vector<BoundaryEdge> display;
            for(std::size_t i=1;i<chain.size();++i)
                appendDisplayEdge(display,chain[i-1],chain[i]);
            double phase=0;
            for(const auto& edge:refineDisplayBoundarySegments(display,maxEdgeDegrees)) {
                packet.segments.push_back({edge,group.owners,static_cast<float>(phase)});
                phase+=std::hypot(edge.second.x-edge.first.x,edge.second.y-edge.first.y);
            }
        }
        const auto count=packet.segments.size()-first;
        if(count) {
            packet.ownerRanges.push_back({group.key,first,count});
            for(const auto& owner:group.owners)
                if(std::find(packet.ownerIds.begin(),packet.ownerIds.end(),owner)==packet.ownerIds.end())
                    packet.ownerIds.push_back(owner);
        }
    }
    return packet;
}
} // namespace pandoeditor
