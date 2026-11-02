// HydroRIVERS NEXT_DOWN junction repair; native GIS tool, never linked into Web/WASM.
// Mirrors the source-proven ports and microdegree quantization contract.
#include <pandoeditor/losslessjson.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <iterator>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>

using Value = pandoeditor::codecjson::Value;
namespace {
constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kMetersPerDegree = 111195.08;
struct Point { double lon,lat; };
using Key = std::pair<std::int64_t,std::int64_t>;
struct Segment { Value* value; std::int64_t fid; std::int64_t part; bool aligned; std::string system; };
struct RawReach { std::string region; std::int64_t next; Point start,end; };
using Parts = std::map<std::int64_t,std::vector<Segment>>;
using Raw = std::map<std::int64_t,RawReach>;
using Bounds = std::map<std::int64_t,std::pair<Segment*,Segment*>>;
struct Port { Segment* segment; int index; };
struct Plan { std::vector<Port> ports; Point point; std::vector<std::int64_t> sources; };

const Value& field(const Value& input,const char* name) {
    if(input.kind!=Value::Object)throw std::invalid_argument("Expected Hydro object");
    const auto it=input.object.find(name);
    if(it==input.object.end())throw std::invalid_argument("Missing Hydro field: "+std::string(name));
    return it->second;
}
Value& field(Value& input,const char* name) {
    if(input.kind!=Value::Object)throw std::invalid_argument("Expected Hydro object");
    const auto it=input.object.find(name);
    if(it==input.object.end())throw std::invalid_argument("Missing Hydro field: "+std::string(name));
    return it->second;
}
const std::vector<Value>& elements(const Value& input) {
    if(input.kind!=Value::Array)throw std::invalid_argument("Expected Hydro array");
    return input.array;
}
std::int64_t integer(const Value& value) {
    const double number=pandoeditor::codecjson::finiteNumber(value);
    if(!std::isfinite(number)||std::abs(number)>9007199254740991.0||std::trunc(number)!=number)
        throw std::invalid_argument("Invalid Hydro integer");
    return static_cast<std::int64_t>(number);
}
std::int64_t sourceId(const std::string& text) {
    if(text.empty()||text.find_first_not_of("0123456789")!=std::string::npos)
        throw std::invalid_argument("Invalid Hydro source key");
    const auto id=std::stoll(text);
    if(id<=0)throw std::invalid_argument("Non-positive Hydro source key");
    return id;
}
std::string str(const Value& value) {
    if(value.kind!=Value::String)throw std::invalid_argument("Expected Hydro string");
    return value.string;
}
Point point(const Value& value) {
    const auto& arr=elements(value);
    if(arr.size()!=2)throw std::invalid_argument("Hydro point must have longitude and latitude");
    const Point p{pandoeditor::codecjson::finiteNumber(arr[0]),pandoeditor::codecjson::finiteNumber(arr[1])};
    if(!std::isfinite(p.lon)||!std::isfinite(p.lat)||std::abs(p.lon)>180||std::abs(p.lat)>90)
        throw std::invalid_argument("Invalid Hydro coordinate");
    return p;
}
Value encodedPoint(const Point& value) {
    auto result=Value::arr();
    result.array={Value::num(value.lon),Value::num(value.lat)};
    return result;
}
double normalizedLongitude(double value){
    auto longitude=std::fmod(value+180.0,360.0);if(longitude<0)longitude+=360.0;longitude-=180.0;
    return longitude==-180.0?180.0:longitude;
}
std::int64_t halfEvenMicro(double value) {
    const auto scaled=value*1'000'000.0;
    const double down=std::floor(scaled), frac=scaled-down;
    auto rounded=static_cast<std::int64_t>(down);
    if(frac>0.5 || (frac==0.5 && rounded%2!=0))++rounded;
    return rounded;
}
Key key(const Point& p) { return {halfEvenMicro(p.lon),halfEvenMicro(p.lat)}; }
double distance(Point a,Point b) {
    auto lon=std::fmod(b.lon-a.lon+180.0,360.0);
    if(lon<0)lon+=360.0;
    lon-=180.0;
    const double mean=(a.lat+b.lat)*kPi/360.0;
    return std::hypot(lon*kMetersPerDegree*std::cos(mean),(b.lat-a.lat)*kMetersPerDegree);
}
Value& portValue(const Port port) {
    Value& points=field(*port.segment->value,"points");
    if(points.kind!=Value::Array || points.array.empty())throw std::invalid_argument("Missing Hydro polyline");
    return points.array.at(port.index==0?0:points.array.size()-1);
}
Point portPoint(Port port) {return point(portValue(port));}
std::pair<Segment*,Segment*> endpoints(std::vector<Segment>& parts) {
    if(parts.empty())throw std::invalid_argument("Empty Hydro source parts");
    if(parts.size()==1)return {&parts[0],&parts[0]};
    std::map<Key,int> starts,ends;
    for(auto& part:parts){++starts[key(portPoint({&part,0}))];++ends[key(portPoint({&part,-1}))];}
    std::vector<Segment*> first,last;
    for(auto& part:parts) {
        const auto a=key(portPoint({&part,0})), b=key(portPoint({&part,-1}));
        if(starts[a]>ends[a])first.push_back(&part);
        if(ends[b]>starts[b])last.push_back(&part);
    }
    if(first.size()!=1||last.size()!=1)return {nullptr,nullptr};
    return {first[0],last[0]};
}
Parts loadParts(Value& input) {
    Parts parts;
    if(input.kind!=Value::Object)throw std::invalid_argument("Expected Hydro parts map");
    for(auto& [id,rows]:input.object) {
        const auto source=sourceId(id);
        if(rows.kind!=Value::Array || rows.array.empty())throw std::invalid_argument("Missing Hydro source part rows");
        auto& out=parts[source];
        for(auto& row:rows.array) {
            const auto& coords=elements(field(row,"points"));
            if(coords.empty())throw std::invalid_argument("Empty Hydro polyline");
            for(const auto& coordinate:coords)static_cast<void>(point(coordinate));
            const auto& aligned=field(row,"aligned");
            if(aligned.kind!=Value::Bool)throw std::invalid_argument("Expected Hydro aligned boolean");
            out.push_back({&row,integer(field(row,"fid")),integer(field(row,"part")),
                aligned.raw=="true",str(field(row,"system"))});
        }
    }
    return parts;
}
Raw loadRaw(const Value& input) {
    Raw result;
    if(input.kind!=Value::Object)throw std::invalid_argument("Expected Hydro original-source map");
    for(const auto& [id,row]:input.object) {
        const auto source=sourceId(id);
        result.emplace(source,RawReach{str(field(row,"region")),integer(field(row,"next")),
            point(field(row,"start")),point(field(row,"end"))});
    }
    return result;
}
std::map<std::int64_t,Plan> plans(Parts& parts,const Raw& raw) {
    Bounds boundaries;
    for(auto& [source,segments]:parts)boundaries.emplace(source,endpoints(segments));
    std::map<std::int64_t,std::vector<std::int64_t>> upstreams;
    for(const auto& [source,original]:raw)if(parts.count(original.next))upstreams[original.next].push_back(source);
    std::map<std::int64_t,Plan> result;
    for(auto& [downstream,sources]:upstreams) {
        if(!boundaries.count(downstream)||!raw.count(downstream))continue;
        Segment* start=boundaries.at(downstream).first;
        if(!start)continue;
        std::vector<Port> ports{{start,0}};
        bool valid=true;
        for(const auto source:sources) {
            const auto it=boundaries.find(source);
            if(it==boundaries.end()||!it->second.second||!raw.count(source)) {valid=false;break;}
            ports.push_back({it->second.second,-1});
        }
        if(!valid)continue;
        const auto system=ports.front().segment->system;
        if(std::any_of(ports.begin(),ports.end(),[&](Port port){return port.segment->system!=system;}))continue;
        if(std::any_of(sources.begin(),sources.end(),[&](auto id){
            return distance(raw.at(id).end,raw.at(downstream).start)>0.5;}))continue;
        std::vector<Point> anchors;
        for(auto port:ports)if(port.segment->aligned)anchors.push_back(portPoint(port));
        const Point chosen=anchors.empty()?portPoint(ports.front()):anchors.front();
        if(std::any_of(anchors.begin(),anchors.end(),[&](auto item){return distance(chosen,item)>0.5;}))continue;
        if(std::any_of(ports.begin(),ports.end(),[&](auto item){return distance(chosen,portPoint(item))>25000.0;}))continue;
        const auto fixed=key(chosen);
        result.emplace(downstream,Plan{std::move(ports),Point{fixed.first/1'000'000.0,
            fixed.second/1'000'000.0},sources});
    }
    return result;
}
Value doAudit(Value request) {
    auto parts=loadParts(field(request,"parts"));
    const auto raw=loadRaw(field(request,"raw"));
    const auto& ordered=elements(field(request,"sourceOrder"));
    std::vector<std::int64_t> sourceOrder;std::set<std::int64_t> seen;
    for(const auto& value:ordered){const auto id=integer(value);
        if(!raw.count(id)||!seen.insert(id).second)throw std::invalid_argument("Invalid Hydro audit source order");sourceOrder.push_back(id);}
    if(seen.size()!=raw.size())throw std::invalid_argument("Incomplete Hydro audit source order");
    const std::vector<std::string> regions={"eu","as","si","af","sa","na","ar","au","gr"};
    std::map<std::string,std::map<std::string,std::int64_t>> stats;
    for(const auto& region:regions)stats[region]={};
    Bounds boundaries;for(auto& [source,segments]:parts)boundaries.emplace(source,endpoints(segments));
    const auto candidates=plans(parts,raw);auto issues=Value::arr();
    for(const auto source:sourceOrder){const auto& original=raw.at(source);
        if(!stats.count(original.region))throw std::invalid_argument("Invalid Hydro audit region");
        auto& counts=stats.at(original.region);++counts["selectedReaches"];
        const auto downstream=original.next;if(!downstream){++counts["naturalTerminals"];continue;}
        auto issue=Value::obj();issue.object["region"]=Value::str(original.region);
        issue.object["source"]=Value::num(static_cast<double>(source));issue.object["downstream"]=Value::num(static_cast<double>(downstream));
        std::string cause;bool repairable=false;
        if(!raw.count(downstream))cause="missing-downstream";
        else {
            ++counts["expectedConnections"];
            if(!boundaries.count(source)||!boundaries.count(downstream))throw std::invalid_argument("Missing Hydro source parts");
            auto* upstream=boundaries.at(source).second;auto* next=boundaries.at(downstream).first;
            if(!upstream||!next)cause="ambiguous-source-parts";
            else {
                const auto a=portPoint({upstream,-1}),b=portPoint({next,0});
                if(key(a)==key(b)){++counts["connected"];continue;}
                const auto originalGap=distance(original.end,raw.at(downstream).start),gap=distance(a,b);
                cause=originalGap>0.5?"original-mismatch":(upstream->aligned||next->aligned?"border-alignment":"chain-connection");
                repairable=candidates.count(downstream)!=0;
                issue.object["gapM"]=Value::num(gap);issue.object["originalGapM"]=Value::num(originalGap);
                issue.object["originalEnd"]=encodedPoint(original.end);issue.object["originalDownstreamStart"]=encodedPoint(raw.at(downstream).start);
                issue.object["displayEnd"]=encodedPoint(a);issue.object["displayDownstreamStart"]=encodedPoint(b);
                issue.object["upstream"]=*upstream->value;issue.object["upstream"].object.erase("points");
                issue.object["downstreamPart"]=*next->value;issue.object["downstreamPart"].object.erase("points");
            }
        }
        issue.object["cause"]=Value::str(cause);issue.object["repairable"]=Value::boolean(repairable);
        ++counts["issues"];++counts[repairable?"repairable":"unresolved"];++counts[cause];issues.array.push_back(std::move(issue));
    }
    auto regionJson=Value::obj();for(const auto& [name,counts]:stats){auto item=Value::obj();
        for(const auto& [key,count]:counts)item.object[key]=Value::num(static_cast<double>(count));regionJson.object[name]=std::move(item);}
    auto result=Value::obj();result.object["regions"]=std::move(regionJson);result.object["issues"]=std::move(issues);return result;
}
Value doRepair(Value request) {
    auto& jsonParts=field(request,"parts");
    auto parts=loadParts(jsonParts);
    const auto raw=loadRaw(field(request,"raw"));
    const auto region=str(field(request,"region"));
    auto changes=Value::arr();
    for(const auto& [downstream,plan]:plans(parts,raw)) {
        if(raw.at(downstream).region!=region)continue;
        for(const auto port:plan.ports) {
            auto& value=portValue(port);
            const Point before=point(value);
            if(key(before)==key(plan.point))continue;
            auto change=Value::obj();
            change.object["region"]=Value::str(region);
            change.object["downstream"]=Value::num(static_cast<double>(downstream));
            auto sourceIds=Value::arr();
            for(const auto id:plan.sources)sourceIds.array.push_back(Value::num(static_cast<double>(id)));
            change.object["sources"]=std::move(sourceIds);
            change.object["fid"]=Value::num(static_cast<double>(port.segment->fid));
            change.object["part"]=Value::num(static_cast<double>(port.segment->part));
            change.object["index"]=Value::num(port.index);
            change.object["before"]=encodedPoint(before);
            change.object["after"]=encodedPoint(plan.point);
            changes.array.push_back(std::move(change));
            value=encodedPoint(plan.point);
        }
    }
    auto result=Value::obj();
    result.object["parts"]=std::move(jsonParts);
    result.object["changes"]=std::move(changes);
    return result;
}
// Assemble upstream-to-downstream logical objects after the caller has selected
// the canonical incoming reach at each confluence.
Value logicalChains(const Value& request){
    const auto& input=elements(field(request,"reaches")),&choices=elements(field(request,"canonical"));
    if(input.size()>1000000||choices.size()>input.size())throw std::invalid_argument("Hydro chain input exceeds budget");
    std::vector<std::int64_t> order;std::map<std::int64_t,std::int64_t> next,canonical;
    for(const auto& row:input){const auto id=integer(field(row,"id")),downstream=integer(field(row,"next"));
        if(id<=0||downstream<0||!next.emplace(id,downstream).second)throw std::invalid_argument("Invalid or duplicate Hydro reach identity");
        order.push_back(id);}
    std::map<std::int64_t,std::vector<std::int64_t>> upstream;
    for(const auto id:order){const auto downstream=next.at(id);if(!downstream)continue;
        if(!next.count(downstream))throw std::invalid_argument("Selected Hydro downstream is missing");upstream[downstream].push_back(id);}
    for(const auto& row:choices){const auto downstream=integer(field(row,"downstream")),selected=integer(field(row,"upstream"));
        const auto found=upstream.find(downstream);
        if(found==upstream.end()||std::find(found->second.begin(),found->second.end(),selected)==found->second.end()||
          !canonical.emplace(downstream,selected).second)throw std::invalid_argument("Invalid canonical Hydro upstream");}
    if(canonical.size()!=upstream.size())throw std::invalid_argument("Canonical Hydro upstream is missing");
    std::map<std::int64_t,std::size_t> pending,owner;std::vector<std::int64_t> queue;
    for(const auto id:order){pending[id]=upstream[id].size();if(!pending[id])queue.push_back(id);}
    std::vector<std::vector<std::int64_t>> chains;std::size_t visited=0;
    while(!queue.empty()){const auto id=queue.back();queue.pop_back();
        if(!owner.count(id)){owner[id]=chains.size();chains.emplace_back();}
        chains[owner.at(id)].push_back(id);++visited;const auto downstream=next.at(id);if(!downstream)continue;
        if(--pending.at(downstream)==0){const auto selected=canonical.at(downstream);
            if(!owner.count(selected))throw std::runtime_error("Canonical upstream was not processed");owner[downstream]=owner.at(selected);queue.push_back(downstream);}}
    if(visited!=order.size())throw std::invalid_argument("Hydro reach network contains a cycle");
    auto output=Value::arr();for(const auto& chain:chains){auto values=Value::arr();for(const auto id:chain)values.array.push_back(Value::num(static_cast<double>(id)));output.array.push_back(std::move(values));}
    auto result=Value::obj();result.object["chains"]=std::move(output);return result;
}
Value riverSystems(const Value& request){
    struct Reach{std::int64_t id,main;double area,flow,stage;bool noStage;std::string border;const Value* parts;};
    const auto& input=elements(field(request,"chains"));if(input.size()>1000000)throw std::invalid_argument("Hydro system input exceeds budget");
    std::vector<std::vector<Reach>> chains;std::map<std::int64_t,std::vector<std::size_t>> groups;std::size_t total=0;
    auto fragments=Value::arr();
    for(std::size_t index=0;index<input.size();++index){const auto& rows=elements(input[index]);total+=rows.size();
        if(rows.empty()||total>1000000)throw std::invalid_argument("Nonempty bounded Hydro chains required");
        std::vector<Reach> chain;std::map<std::int64_t,std::size_t> counts;auto fragmentsForChain=Value::arr();
        for(const auto& row:rows){const auto id=integer(field(row,"id")),main=integer(field(row,"mainRiver"));
            const double area=pandoeditor::codecjson::finiteNumber(field(row,"upstreamArea")),flow=pandoeditor::codecjson::finiteNumber(field(row,"flow"));
            const auto& stageValue=field(row,"stage"),&border=field(row,"borderPair"),&parts=field(row,"parts");
            if(id<=0||(stageValue.kind!=Value::Null&&stageValue.kind!=Value::Number)||
              (border.kind!=Value::Null&&border.kind!=Value::Array)||parts.kind!=Value::Array)throw std::invalid_argument("Invalid Hydro system reach");
            const bool noStage=stageValue.kind==Value::Null;const double stage=noStage?0:pandoeditor::codecjson::finiteNumber(stageValue);
            const auto borderKey=border.encode();
            if(chain.empty()||chain.back().noStage!=noStage||(!noStage&&chain.back().stage!=stage)||chain.back().border!=borderKey)
                fragmentsForChain.array.push_back(Value::arr());
            fragmentsForChain.array.back().array.push_back(Value::num(static_cast<double>(id)));
            chain.push_back({id,main,area,flow,stage,noStage,borderKey,&parts});if(main)++counts[main];
        }
        auto system=chain.back().id;std::size_t frequency=0;
        for(const auto& [id,count]:counts)if(count>frequency||(count==frequency&&id>system)){frequency=count;system=id;}
        groups[system].push_back(index);chains.push_back(std::move(chain));fragments.array.push_back(std::move(fragmentsForChain));
    }
    auto systems=Value::arr();std::size_t pointsSeen=0;
    for(const auto& [system,indexes]:groups){std::size_t mainstem=indexes.front();bool found=false;
        for(const auto index:indexes){for(const auto& row:chains[index])if(row.id==system){mainstem=index;found=true;break;}if(found)break;}
        if(!found)for(const auto index:indexes){const auto& a=chains[index],&b=chains[mainstem];
            if(std::make_tuple(a.back().area,a.back().flow,a.size())>std::make_tuple(b.back().area,b.back().flow,b.size()))mainstem=index;}
        bool anyPoint=false,usable=false;double west=180,south=std::numeric_limits<double>::infinity(),east=-180,north=-std::numeric_limits<double>::infinity();
        for(const auto index:indexes)for(const auto& reach:chains[index])for(const auto& part:elements(*reach.parts)){
            const auto& coordinates=elements(part);if(!coordinates.empty())anyPoint=true;
            pointsSeen+=coordinates.size();if(pointsSeen>10000000)throw std::invalid_argument("Hydro system coordinates exceed budget");
            for(const auto& coordinate:coordinates){const auto& pair=elements(coordinate);if(pair.size()!=2)throw std::invalid_argument("Invalid Hydro system point");
                const double rawLon=pandoeditor::codecjson::finiteNumber(pair[0]),lat=pandoeditor::codecjson::finiteNumber(pair[1]);
                if(coordinates.size()<2)continue;const double lon=normalizedLongitude(rawLon);
                west=std::min(west,lon);east=std::max(east,lon);south=std::min(south,lat);north=std::max(north,lat);usable=true;}}
        auto item=Value::obj(),list=Value::arr(),bounds=Value::arr();list.array.push_back(Value::num(static_cast<double>(mainstem)));
        for(const auto index:indexes)if(index!=mainstem)list.array.push_back(Value::num(static_cast<double>(index)));
        const std::vector<double> range=usable?std::vector<double>{west,south,east,north}:anyPoint?std::vector<double>{-180,-90,180,90}:std::vector<double>{0,0,0,0};
        for(const auto value:range)bounds.array.push_back(Value::num(value));
        item.object["systemId"]=Value::num(static_cast<double>(system));item.object["chainIndexes"]=std::move(list);
        item.object["mainstemIndex"]=Value::num(static_cast<double>(mainstem));item.object["bounds"]=std::move(bounds);systems.array.push_back(std::move(item));
    }
    auto result=Value::obj();result.object["systems"]=std::move(systems);result.object["fragments"]=std::move(fragments);return result;
}
Value widthProfile(const Value& request){
    const auto& reaches=elements(field(request,"reaches"));if(reaches.size()>1000000)throw std::invalid_argument("Hydro width input exceeds budget");
    auto output=Value::arr();std::size_t pointsSeen=0;
    for(const auto& reach:reaches){const double start=pandoeditor::codecjson::finiteNumber(field(reach,"width")),end=pandoeditor::codecjson::finiteNumber(field(reach,"endWidth"));
        for(const auto& part:elements(field(reach,"parts"))){const auto& coordinates=elements(part);if(coordinates.size()<2)continue;
            pointsSeen+=coordinates.size();if(pointsSeen>10000000)throw std::invalid_argument("Hydro width coordinates exceed budget");
            std::vector<double> cumulative; cumulative.reserve(coordinates.size());cumulative.push_back(0);double lastX=0,lastY=0;
            for(std::size_t i=0;i<coordinates.size();++i){const auto& xy=elements(coordinates[i]);if(xy.size()!=2)throw std::invalid_argument("Invalid Hydro width point");
                const double x=pandoeditor::codecjson::finiteNumber(xy[0]),y=pandoeditor::codecjson::finiteNumber(xy[1]);
                if(i){const double mean=((lastY+y)/2.0)*(kPi/180.0),dx=(x-lastX)*std::cos(mean),dy=y-lastY;
                    const double next=cumulative.back()+std::hypot(dx,dy);if(!std::isfinite(next))throw std::invalid_argument("Invalid Hydro width length");cumulative.push_back(next);}
                lastX=x;lastY=y;}
            auto widths=Value::arr();const auto total=cumulative.back();for(const auto distance:cumulative){
                const double value=total<=1e-12?start:start+(end-start)*distance/total;
                if(!std::isfinite(value))throw std::invalid_argument("Invalid Hydro width value");widths.array.push_back(Value::num(value));}
            output.array.push_back(std::move(widths));}}
    auto result=Value::obj();result.object["widths"]=std::move(output);return result;
}
double riverScore(std::int64_t order,double flow,double area){
    return static_cast<double>(order)+4.0*std::log10(std::max(flow,1e-6))-0.5*std::log10(std::max(area,1e-6));
}
double riverWidth(std::int64_t order,double flow){
    return 0.5+0.19*std::log2(1.0+std::max(flow,0.0))+0.06*std::max(static_cast<double>(order)-1.0,0.0);
}
Value featurePolicy(const Value& request){
    const auto order=integer(field(request,"order"));const double flow=pandoeditor::codecjson::finiteNumber(field(request,"flow")),
      area=pandoeditor::codecjson::finiteNumber(field(request,"upstreamArea")),lake=pandoeditor::codecjson::finiteNumber(field(request,"lakeArea")),
      zoom=pandoeditor::codecjson::finiteNumber(field(request,"zoom"));
    const double score=riverScore(order,flow,area),rawWidth=riverWidth(order,flow);
    if(!std::isfinite(score)||!std::isfinite(rawWidth))throw std::invalid_argument("Invalid Hydro feature score");
    const double riverThresholds[]={14.4744,12.4307,11.2137,10.55},lakeThresholds[]={250.0,100.0,40.0,40.0},zoomThresholds[]={6.0,6.7,7.0,7.5};
    Value river,lakeStage;int zoomStage=3;
    for(int stage=0;stage<4;++stage)if(score>=riverThresholds[stage]){river=Value::num(stage);break;}
    for(int stage=0;stage<4;++stage)if(lake>=lakeThresholds[stage]){lakeStage=Value::num(stage);break;}
    for(int stage=0;stage<4;++stage)if(zoom<=zoomThresholds[stage]+1e-9){zoomStage=stage;break;}
    auto result=Value::obj();result.object["score"]=Value::num(score);result.object["riverStage"]=river;
    result.object["width"]=Value::num(std::max(0.55,std::min(2.6,rawWidth)));
    result.object["lakeStage"]=lakeStage;result.object["minZoomStage"]=Value::num(zoomStage);return result;
}
Value featurePolicies(const Value& request){
    const auto& input=elements(field(request,"features"));
    if(input.size()>100000)throw std::invalid_argument("Hydro feature policy batch exceeds budget");
    auto output=Value::arr();output.array.reserve(input.size());
    for(const auto& row:input)output.array.push_back(featurePolicy(row));
    auto result=Value::obj();result.object["features"]=std::move(output);return result;
}
// Preserve canonical source vertices while cutting by projected line distance.
Value borderSubstrings(const Value& request){
    const auto& input=elements(field(request,"requests"));if(input.size()>10000)throw std::invalid_argument("Hydro border substring batch exceeds budget");
    auto lines=Value::arr();std::size_t vertices=0;
    for(const auto& item:input){const auto& source=elements(field(item,"source")),&metric=elements(field(item,"metric"));
        const double start=pandoeditor::codecjson::finiteNumber(field(item,"start")),end=pandoeditor::codecjson::finiteNumber(field(item,"end"));
        auto output=Value::arr();vertices+=source.size();if(vertices>5000000)throw std::invalid_argument("Hydro border substring vertices exceed budget");
        if(source.size()!=metric.size()||source.size()<2){lines.array.push_back(std::move(output));continue;}
        std::vector<Point> points,projected;std::vector<double> cumulative{0};points.reserve(source.size());projected.reserve(source.size());
        for(std::size_t i=0;i<source.size();++i){points.push_back(point(source[i]));const auto& coords=elements(metric[i]);
            if(coords.size()!=2)throw std::invalid_argument("Invalid Hydro border projected point");
            projected.push_back({pandoeditor::codecjson::finiteNumber(coords[0]),pandoeditor::codecjson::finiteNumber(coords[1])});
            if(i)cumulative.push_back(cumulative.back()+std::hypot(projected[i].lon-projected[i-1].lon,projected[i].lat-projected[i-1].lat));}
        double lower=std::max(0.0,start),upper=std::min(cumulative.back(),end);if(lower>upper)std::swap(lower,upper);
        if(upper-lower<=1e-6){lines.array.push_back(std::move(output));continue;}
        const auto interpolate=[&](double at){for(std::size_t i=0;i+1<cumulative.size();++i)if(at<=cumulative[i+1]+1e-9){
                const auto span=cumulative[i+1]-cumulative[i],ratio=span<=1e-12?0.0:(at-cumulative[i])/span;
                return Point{points[i].lon+(points[i+1].lon-points[i].lon)*ratio,points[i].lat+(points[i+1].lat-points[i].lat)*ratio};}
            return points.back();};
        std::vector<Point> chosen{interpolate(lower)};for(std::size_t i=1;i+1<points.size();++i)
            if(lower<cumulative[i]&&cumulative[i]<upper)chosen.push_back(points[i]);chosen.push_back(interpolate(upper));
        std::vector<Point> deduplicated;for(const auto& itemPoint:chosen){const auto quantized=Key{halfEvenMicro(normalizedLongitude(itemPoint.lon)),
                halfEvenMicro(std::max(-90.0,std::min(90.0,itemPoint.lat)))};
            if(deduplicated.empty()||quantized!=Key{halfEvenMicro(normalizedLongitude(deduplicated.back().lon)),
                halfEvenMicro(std::max(-90.0,std::min(90.0,deduplicated.back().lat)))})deduplicated.push_back(itemPoint);}
        if(start>end)std::reverse(deduplicated.begin(),deduplicated.end());for(const auto& itemPoint:deduplicated)output.array.push_back(encodedPoint(itemPoint));
        lines.array.push_back(std::move(output));
    }
    auto result=Value::obj();result.object["lines"]=std::move(lines);return result;
}
Value borderGroupAcceptance(const Value& request){
    const auto& chains=elements(field(request,"chains"));if(chains.size()>100000)throw std::invalid_argument("Hydro border chain batch exceeds budget");
    auto accepted=Value::arr();std::size_t budget=0;
    for(const auto& chainValue:chains){const auto& chain=elements(chainValue);budget+=chain.size();
        if(budget>1000000)throw std::invalid_argument("Hydro border chains exceed budget");
        auto flags=Value::arr();flags.array.assign(chain.size(),Value::boolean(false));std::size_t cursor=0;
        while(cursor<chain.size()){if(chain[cursor].kind==Value::Null){++cursor;continue;}
            const auto lineIndex=integer(field(chain[cursor],"lineIndex"));if(lineIndex<0)throw std::invalid_argument("Invalid Hydro border index");
            std::size_t end=cursor;double total=0;std::size_t samples=0,covered=0;double maximum=0;
            while(end<chain.size()&&chain[end].kind!=Value::Null&&integer(field(chain[end],"lineIndex"))==lineIndex){
                const auto length=pandoeditor::codecjson::finiteNumber(field(chain[end],"length"));if(length<0)throw std::invalid_argument("Invalid Hydro border length");
                total+=length;const auto& distances=elements(field(chain[end],"distances"));samples+=distances.size();
                for(const auto& value:distances){const auto distance=pandoeditor::codecjson::finiteNumber(value);if(distance<0)throw std::invalid_argument("Invalid Hydro border distance");
                    if(distance<=5.0)++covered;maximum=std::max(maximum,distance);}++end;}
            if(total>=10.0&&samples&&static_cast<double>(covered)/samples>=.70&&maximum<=12.0)
                for(std::size_t i=cursor;i<end;++i)flags.array[i]=Value::boolean(true);
            cursor=end;}
        accepted.array.push_back(std::move(flags));}
    auto result=Value::obj();result.object["accepted"]=std::move(accepted);return result;
}
// Keep regional source metadata in one native process while indexed geometry is
// fetched on demand.  The eight retained upstream candidates match the source
// generator's (basin area, flow, source ID) heap ordering.
class SourceSelection {
    struct Row{std::int64_t id,next,basin,order,index;double flow,area,score,width;bool endorheic,seed;};
    std::vector<Row> rows;
    std::unordered_map<std::int64_t,std::size_t> byId;
    std::unordered_map<std::int64_t,std::vector<std::size_t>> upstream;
    bool prepared=false;
    auto rank(std::size_t index) const {const auto& row=rows[index];return std::make_tuple(row.area,row.flow,row.id);}
    Value encodeRow(const Row& row) const {
        auto result=Value::obj();result.object["id"]=Value::num(static_cast<double>(row.id));
        result.object["next"]=Value::num(static_cast<double>(row.next));result.object["mainRiver"]=Value::num(static_cast<double>(row.basin));
        result.object["order"]=Value::num(static_cast<double>(row.order));result.object["recordIndex"]=Value::num(static_cast<double>(row.index));
        result.object["flow"]=Value::num(row.flow);result.object["upstreamArea"]=Value::num(row.area);result.object["endorheic"]=Value::boolean(row.endorheic);
        result.object["score"]=Value::num(row.score);result.object["width"]=Value::num(row.width);
        Value stage;const double thresholds[]={14.4744,12.4307,11.2137,10.55};
        for(int i=0;i<4;++i)if(row.score>=thresholds[i]){stage=Value::num(i);break;}
        result.object["stage"]=stage;return result;
    }
public:
    Value add(const Value& request){
        if(prepared)throw std::invalid_argument("Hydro selection already prepared");
        const auto& input=elements(field(request,"rows"));if(input.size()>100000)throw std::invalid_argument("Hydro selection batch exceeds budget");
        for(const auto& item:input){const auto id=integer(field(item,"id")),next=integer(field(item,"next")),basin=integer(field(item,"mainRiver")),
            order=integer(field(item,"order")),index=integer(field(item,"recordIndex"));
            const double flow=pandoeditor::codecjson::finiteNumber(field(item,"flow")),area=pandoeditor::codecjson::finiteNumber(field(item,"upstreamArea"));
            const auto& endorheic=field(item,"endorheic");
            if(id<=0||next<0||index<0||endorheic.kind!=Value::Bool||byId.count(id))throw std::invalid_argument("Invalid or duplicate Hydro selection record");
            const double score=riverScore(order,flow,area),width=riverWidth(order,flow);
            if(!std::isfinite(score)||!std::isfinite(width))throw std::invalid_argument("Invalid Hydro selection score");
            const auto position=rows.size();byId.emplace(id,position);
            rows.push_back({id,next,basin,order,index,flow,area,score,std::max(0.55,std::min(2.6,width)),endorheic.raw=="true",score>=10.55});
            if(next){auto& candidates=upstream[next];candidates.push_back(position);
                std::sort(candidates.begin(),candidates.end(),[this](auto a,auto b){return rank(a)<rank(b);});
                if(candidates.size()>8)candidates.erase(candidates.begin());}
        }
        auto result=Value::obj();result.object["count"]=Value::num(static_cast<double>(rows.size()));return result;
    }
    Value prepare(){
        if(prepared)throw std::invalid_argument("Hydro selection already prepared");prepared=true;
        std::unordered_map<std::int64_t,std::size_t> incoming;
        for(const auto& row:rows)if(row.seed)incoming.emplace(row.id,0);
        for(const auto& row:rows)if(row.seed){auto it=incoming.find(row.next);if(it!=incoming.end())++it->second;}
        auto seeds=Value::arr(),continuity=Value::arr(),named=Value::arr(),medium=Value::arr();
        for(const auto& row:rows){if(row.seed){seeds.array.push_back(Value::num(static_cast<double>(row.id)));
                if(incoming.at(row.id)==0){auto& target=(row.order>=5&&row.flow>=75.0&&row.score>=10.86)?continuity:named;
                    target.array.push_back(Value::num(static_cast<double>(row.id)));}}
            if(!row.next&&row.area>=2500.0)medium.array.push_back(Value::num(static_cast<double>(row.id)));}
        auto result=Value::obj();result.object["seeds"]=std::move(seeds);result.object["continuityRoots"]=std::move(continuity);
        result.object["namedCandidates"]=std::move(named);result.object["mediumRoots"]=std::move(medium);return result;
    }
    Value candidates(const Value& request) const {
        if(!prepared)throw std::invalid_argument("Hydro selection not prepared");
        const auto& ids=elements(field(request,"ids"));if(ids.size()>4096)throw std::invalid_argument("Hydro candidate batch exceeds budget");
        auto groups=Value::arr();for(const auto& value:ids){const auto id=integer(value);if(id<=0)throw std::invalid_argument("Invalid Hydro candidate ID");
            auto group=Value::obj(),candidates=Value::arr();group.object["id"]=Value::num(static_cast<double>(id));
            const auto current=byId.find(id);group.object["current"]=current==byId.end()?Value():encodeRow(rows[current->second]);
            const auto found=upstream.find(id);if(found!=upstream.end())for(const auto position:found->second)candidates.array.push_back(encodeRow(rows[position]));
            group.object["candidates"]=std::move(candidates);groups.array.push_back(std::move(group));}
        auto result=Value::obj();result.object["groups"]=std::move(groups);return result;
    }
    Value records(const Value& request) const {
        if(!prepared)throw std::invalid_argument("Hydro selection not prepared");
        const auto& ids=elements(field(request,"ids"));if(ids.size()>4096)throw std::invalid_argument("Hydro record batch exceeds budget");
        auto records=Value::arr();for(const auto& value:ids){const auto id=integer(value);if(id<=0)throw std::invalid_argument("Invalid Hydro record ID");
            const auto found=byId.find(id);records.array.push_back(found==byId.end()?Value():encodeRow(rows[found->second]));}
        auto result=Value::obj();result.object["records"]=std::move(records);return result;
    }
};
void selectionStream(){
    SourceSelection selection;std::string line;
    while(std::getline(std::cin,line)){if(line.size()>32*1024*1024)throw std::invalid_argument("Hydro selection request exceeds budget");
        const auto request=pandoeditor::codecjson::parse(line);const auto op=str(field(request,"op"));Value result;
        if(op=="add")result=selection.add(request);else if(op=="prepare")result=selection.prepare();
        else if(op=="candidates")result=selection.candidates(request);else if(op=="records")result=selection.records(request);
        else throw std::invalid_argument("Invalid Hydro selection operation");
        std::cout<<result.encode()<<std::endl;}
}
// Match Hydro's selected-network downstream width propagation before rendering.
Value propagateWidths(const Value& request){
    const auto& input=elements(field(request,"reaches"));
    if(input.size()>1000000)throw std::invalid_argument("Hydro width network exceeds budget");
    struct Reach {std::int64_t id,next;double width;std::size_t incoming=0;};
    std::vector<Reach> rows;rows.reserve(input.size());std::map<std::int64_t,std::size_t> lookup;
    for(const auto& row:input){const auto id=integer(field(row,"id")),next=integer(field(row,"next"));
        const auto width=pandoeditor::codecjson::finiteNumber(field(row,"width"));
        if(id<=0||next<0||width<0||!lookup.emplace(id,rows.size()).second)throw std::invalid_argument("Invalid Hydro width reach");
        rows.push_back({id,next,width,0});}
    for(const auto& row:rows){const auto next=lookup.find(row.next);if(next!=lookup.end())++rows[next->second].incoming;}
    std::vector<std::size_t> queue;queue.reserve(rows.size());
    for(std::size_t i=0;i<rows.size();++i)if(!rows[i].incoming)queue.push_back(i);
    std::size_t processed=0;
    while(!queue.empty()){const auto index=queue.back();queue.pop_back();++processed;const auto next=lookup.find(rows[index].next);
        if(next==lookup.end())continue;auto& downstream=rows[next->second];downstream.width=std::max(downstream.width,rows[index].width);
        if(--downstream.incoming==0)queue.push_back(next->second);}
    if(processed!=rows.size())throw std::invalid_argument("Hydro width network contains a cycle");
    auto output=Value::arr();output.array.reserve(rows.size());
    for(const auto& row:rows){const auto next=lookup.find(row.next);auto item=Value::obj();
        item.object["id"]=Value::num(static_cast<double>(row.id));item.object["width"]=Value::num(row.width);
        item.object["endWidth"]=Value::num(next==lookup.end()?row.width:rows[next->second].width);output.array.push_back(std::move(item));}
    auto result=Value::obj();result.object["reaches"]=std::move(output);return result;
}
Value fragmentGeometries(const Value& request){
    const auto& fragments=elements(field(request,"fragments"));
    if(fragments.size()>100000)throw std::invalid_argument("Hydro geometry batch exceeds budget");
    std::size_t points=0;auto geometries=Value::arr();geometries.array.reserve(fragments.size());
    for(const auto& fragment:fragments){auto parts=Value::arr();
        for(const auto& reach:elements(fragment)){const auto& source=elements(field(reach,"parts"));const auto& snap=field(reach,"renderSnap");
            if(snap.kind!=Value::Null){const auto& target=elements(snap);if(target.size()!=2)throw std::invalid_argument("Invalid Hydro render snap");
                for(const auto& value:target)pandoeditor::codecjson::finiteNumber(value);}
            for(std::size_t i=0;i<source.size();++i){const auto& coords=elements(source[i]);if(coords.size()<2)continue;
                points+=coords.size();if(points>10000000)throw std::invalid_argument("Hydro geometry coordinates exceed budget");
                for(const auto& point:coords){const auto& xy=elements(point);if(xy.size()!=2)throw std::invalid_argument("Invalid Hydro geometry point");
                    for(const auto& value:xy)pandoeditor::codecjson::finiteNumber(value);}
                auto part=source[i];if(snap.kind!=Value::Null&&i+1==source.size())part.array.back()=snap;
                parts.array.push_back(std::move(part));}}
        auto row=Value::obj();row.object["type"]=Value::str(parts.array.size()==1?"LineString":"MultiLineString");
        row.object["coordinates"]=parts.array.size()==1?std::move(parts.array.front()):std::move(parts);
        geometries.array.push_back(std::move(row));}
    auto result=Value::obj();result.object["geometries"]=std::move(geometries);return result;
}
// Decide an outlet class from source-bound geometry and raster observations.
Value excludeTerminalBasins(const Value& request){
    const auto& source=elements(field(request,"reaches"));if(source.size()>1000000)throw std::invalid_argument("Hydro terminal network exceeds budget");
    struct Reach{std::int64_t id,next;std::string classification;};std::vector<Reach> rows;rows.reserve(source.size());
    std::set<std::int64_t> identities,excluded;std::map<std::int64_t,std::vector<std::int64_t>> upstream;auto terminals=Value::arr();
    const std::set<std::string> allowed{"sea","lake","endorheic","unresolved-land","excluded-small-land",
        "excluded-undisplayed-water","excluded-unresolved-source-terminal"};
    for(const auto& item:source){const auto id=integer(field(item,"id")),next=integer(field(item,"next"));const auto& value=field(item,"terminalClass");
        if(id<=0||next<0||!identities.insert(id).second)throw std::invalid_argument("Invalid or duplicate Hydro terminal identity");
        std::string classification;if(value.kind==Value::String)classification=value.string;else if(value.kind!=Value::Null)
            throw std::invalid_argument("Invalid Hydro terminal class");
        if((next==0&&(classification.empty()||!allowed.count(classification)))||(next!=0&&!classification.empty()))
            throw std::invalid_argument("Invalid Hydro terminal classification");
        if(classification=="unresolved-land")classification="excluded-unresolved-source-terminal";
        const bool remove=classification=="excluded-small-land"||classification=="excluded-undisplayed-water"||
            classification=="excluded-unresolved-source-terminal";
        if(remove){excluded.insert(id);auto terminal=Value::obj();terminal.object["id"]=Value::num(static_cast<double>(id));
            terminal.object["terminalClass"]=Value::str(classification);terminals.array.push_back(std::move(terminal));}
        if(next)upstream[next].push_back(id);rows.push_back({id,next,std::move(classification)});
    }
    std::vector<std::int64_t> stack(excluded.begin(),excluded.end());while(!stack.empty()){
        const auto id=stack.back();stack.pop_back();auto it=upstream.find(id);if(it==upstream.end())continue;
        for(auto candidate:it->second)if(excluded.insert(candidate).second)stack.push_back(candidate);}
    auto kept=Value::arr(),removed=Value::arr();for(const auto& row:rows)
        (excluded.count(row.id)?removed:kept).array.push_back(Value::num(static_cast<double>(row.id)));
    auto result=Value::obj();result.object["kept"]=std::move(kept);result.object["excluded"]=std::move(removed);result.object["terminals"]=std::move(terminals);return result;
}
Value outletDecision(const Value& request){
    const auto boolean=[&](const char* name){const auto& value=field(request,name);if(value.kind!=Value::Bool)throw std::invalid_argument("Expected outlet boolean");return value.raw=="true";};
    const auto& lake=field(request,"lakeDistance");const bool lakeCovers=boolean("lakeCovers"),onLand=boolean("onLand"),water=boolean("undisplayedWater");
    if(lake.kind==Value::Null&&lakeCovers)throw std::invalid_argument("Lake coverage needs a lake distance");
    const double lakeDistance=lake.kind==Value::Null?0:pandoeditor::codecjson::finiteNumber(lake),
      coast=pandoeditor::codecjson::finiteNumber(field(request,"coastDistance")),outside=pandoeditor::codecjson::finiteNumber(field(request,"outsideLength")),
      maxKm=pandoeditor::codecjson::finiteNumber(field(request,"maxKm"));
    if(lakeDistance<0||coast<0||outside<0)throw std::invalid_argument("Invalid outlet distance");
    const auto& target=elements(field(request,"target"));if(target.size()!=2)throw std::invalid_argument("Outlet target needs two coordinates");
    const double x=pandoeditor::codecjson::finiteNumber(target[0]),y=pandoeditor::codecjson::finiteNumber(target[1]);
    const double longitude=normalizedLongitude(x);
    std::string classification;double distance=coast;bool snap=false;
    if(lake.kind!=Value::Null&&(lakeCovers||lakeDistance<=1.0)){classification="lake";distance=lakeDistance;}
    else if(coast<=1e-5){classification="sea";distance=0;}
    else if(coast<=2.0||(coast<=maxKm&&onLand&&outside<=1e-5)||(coast<=maxKm&&!onLand&&water)){classification="sea";snap=true;}
    else if(!onLand)classification="excluded-small-land";
    else if(water)classification="excluded-undisplayed-water";
    else classification="unresolved-land";
    auto result=Value::obj();result.object["class"]=Value::str(classification);result.object["distanceKm"]=Value::num(distance);
    if(snap){auto coordinates=Value::arr();coordinates.array={Value::num(longitude),Value::num(y)};result.object["snap"]=std::move(coordinates);}
    else result.object["snap"]=Value();return result;
}
Value outletDecisions(const Value& request){
    const auto& observations=elements(field(request,"observations"));
    if(observations.size()>100000)throw std::invalid_argument("Hydro outlet batch exceeds budget");
    auto decisions=Value::arr();decisions.array.reserve(observations.size());
    for(const auto& observation:observations)decisions.array.push_back(outletDecision(observation));
    auto result=Value::obj();result.object["decisions"]=std::move(decisions);return result;
}
Value outletSample(const Value& request){
    const auto& source=elements(field(request,"source")),&target=elements(field(request,"target")),&rgb=elements(field(request,"rgb"));
    if(source.size()!=2||target.size()!=2||rgb.size()!=3)throw std::invalid_argument("Explicit outlet point and RGB required");
    const auto width=integer(field(request,"width")),height=integer(field(request,"height"));
    if(width<=0||height<=0||width>2147483647||height>2147483647)throw std::invalid_argument("Invalid outlet raster dimensions");
    const double sx=pandoeditor::codecjson::finiteNumber(source[0]),sy=pandoeditor::codecjson::finiteNumber(source[1]),
      tx=pandoeditor::codecjson::finiteNumber(target[0]),ty=pandoeditor::codecjson::finiteNumber(target[1]);
    const double distance=std::hypot(normalizedLongitude(sx-tx)*111.32*std::cos(sy*(kPi/180.0)),(sy-ty)*110.57);
    if(!std::isfinite(distance))throw std::invalid_argument("Invalid outlet distance");
    const auto pixel=[](double coordinate,std::int64_t size){if(coordinate<=0)return std::int64_t{0};
        if(coordinate>=static_cast<double>(size))return size-1;return static_cast<std::int64_t>(coordinate);};
    const auto px=pixel((normalizedLongitude(sx)+180.0)/360.0*width,width),py=pixel((90.0-sy)/180.0*height,height);
    std::int64_t low=255,high=0;for(const auto& value:rgb){const auto channel=integer(value);if(channel<0||channel>255)throw std::invalid_argument("Invalid outlet raster channel");
        low=std::min(low,channel);high=std::max(high,channel);}
    auto result=Value::obj(),coordinates=Value::arr();coordinates.array={Value::num(static_cast<double>(px)),Value::num(static_cast<double>(py))};
    result.object["distanceKm"]=Value::num(distance);result.object["pixel"]=std::move(coordinates);
    result.object["undisplayedWater"]=Value::boolean(high-low<=1&&low>=249);return result;
}
}
int main(int argc,char** argv) {
    try {
        if(argc==2&&std::string(argv[1])=="--selection-stream"){selectionStream();return 0;}
        if(argc!=1)throw std::invalid_argument("Invalid Hydro command line");
        const std::string input{std::istreambuf_iterator<char>{std::cin},std::istreambuf_iterator<char>{}};
        if(input.size()>512*1024*1024)throw std::invalid_argument("Hydro junction request exceeds 512 MiB");
        auto request=pandoeditor::codecjson::parse(input);const auto mode=request.object.find("mode");
        if(mode==request.object.end())std::cout<<doRepair(std::move(request)).encode()<<'\n';
        else if(str(mode->second)=="audit")std::cout<<doAudit(std::move(request)).encode()<<'\n';
        else if(str(mode->second)=="logical-chains")std::cout<<logicalChains(request).encode()<<'\n';
        else if(str(mode->second)=="river-systems")std::cout<<riverSystems(request).encode()<<'\n';
        else if(str(mode->second)=="width-profile")std::cout<<widthProfile(request).encode()<<'\n';
        else if(str(mode->second)=="feature-policy")std::cout<<featurePolicy(request).encode()<<'\n';
        else if(str(mode->second)=="feature-policies")std::cout<<featurePolicies(request).encode()<<'\n';
        else if(str(mode->second)=="border-substrings")std::cout<<borderSubstrings(request).encode()<<'\n';
        else if(str(mode->second)=="border-group-acceptance")std::cout<<borderGroupAcceptance(request).encode()<<'\n';
        else if(str(mode->second)=="propagate-widths")std::cout<<propagateWidths(request).encode()<<'\n';
        else if(str(mode->second)=="fragment-geometries")std::cout<<fragmentGeometries(request).encode()<<'\n';
        else if(str(mode->second)=="exclude-terminal-basins")std::cout<<excludeTerminalBasins(request).encode()<<'\n';
        else if(str(mode->second)=="outlet-decision")std::cout<<outletDecision(request).encode()<<'\n';
        else if(str(mode->second)=="outlet-decisions")std::cout<<outletDecisions(request).encode()<<'\n';
        else if(str(mode->second)=="outlet-sample")std::cout<<outletSample(request).encode()<<'\n';
        else throw std::invalid_argument("Invalid Hydro operation");
        return 0;
    }catch(const std::exception& error) {
        std::cerr<<"hydro-connectivity: "<<error.what()<<'\n';
        return 1;
    }
}
