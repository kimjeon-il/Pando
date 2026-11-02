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
                if(coordinates.size()<2)continue;double lon=std::fmod(rawLon+180.0,360.0);if(lon<0)lon+=360.0;lon-=180.0;if(lon==-180.0)lon=180.0;
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
Value featurePolicy(const Value& request){
    const auto order=integer(field(request,"order"));const double flow=pandoeditor::codecjson::finiteNumber(field(request,"flow")),
      area=pandoeditor::codecjson::finiteNumber(field(request,"upstreamArea")),lake=pandoeditor::codecjson::finiteNumber(field(request,"lakeArea")),
      zoom=pandoeditor::codecjson::finiteNumber(field(request,"zoom"));
    const double score=static_cast<double>(order)+4.0*std::log10(std::max(flow,1e-6))-0.5*std::log10(std::max(area,1e-6));
    const double rawWidth=0.5+0.19*std::log2(1.0+std::max(flow,0.0))+0.06*std::max(static_cast<double>(order)-1.0,0.0);
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
// Decide an outlet class from source-bound geometry and raster observations.
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
    double longitude=std::fmod(x+180.0,360.0);if(longitude<0)longitude+=360.0;longitude-=180.0;if(longitude==-180.0)longitude=180.0;
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
}
int main() {
    try {
        const std::string input{std::istreambuf_iterator<char>{std::cin},std::istreambuf_iterator<char>{}};
        if(input.size()>512*1024*1024)throw std::invalid_argument("Hydro junction request exceeds 512 MiB");
        auto request=pandoeditor::codecjson::parse(input);const auto mode=request.object.find("mode");
        if(mode==request.object.end())std::cout<<doRepair(std::move(request)).encode()<<'\n';
        else if(str(mode->second)=="audit")std::cout<<doAudit(std::move(request)).encode()<<'\n';
        else if(str(mode->second)=="logical-chains")std::cout<<logicalChains(request).encode()<<'\n';
        else if(str(mode->second)=="river-systems")std::cout<<riverSystems(request).encode()<<'\n';
        else if(str(mode->second)=="width-profile")std::cout<<widthProfile(request).encode()<<'\n';
        else if(str(mode->second)=="feature-policy")std::cout<<featurePolicy(request).encode()<<'\n';
        else if(str(mode->second)=="outlet-decision")std::cout<<outletDecision(request).encode()<<'\n';
        else throw std::invalid_argument("Invalid Hydro operation");
        return 0;
    }catch(const std::exception& error) {
        std::cerr<<"hydro-connectivity: "<<error.what()<<'\n';
        return 1;
    }
}
