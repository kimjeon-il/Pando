// HydroRIVERS NEXT_DOWN junction repair; native GIS tool, never linked into Web/WASM.
// Mirrors the source-proven ports and microdegree quantization contract.
#include <pandoeditor/losslessjson.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <iterator>
#include <map>
#include <stdexcept>
#include <string>
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
}
int main() {
    try {
        const std::string input{std::istreambuf_iterator<char>{std::cin},std::istreambuf_iterator<char>{}};
        if(input.size()>512*1024*1024)throw std::invalid_argument("Hydro junction request exceeds 512 MiB");
        std::cout<<doRepair(pandoeditor::codecjson::parse(input)).encode()<<'\n';
        return 0;
    }catch(const std::exception& error) {
        std::cerr<<"hydro-connectivity: "<<error.what()<<'\n';
        return 1;
    }
}
