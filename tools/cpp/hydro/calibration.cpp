// Native analysis-only Hydro calibration calculations. Runtime data is not written.
#include <pandoeditor/losslessjson.h>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <iterator>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

using Value=pandoeditor::codecjson::Value;
namespace {
constexpr double kMaxExactInteger=9007199254740991.0;
const Value& field(const Value& object,const char* name){
    if(object.kind!=Value::Object)throw std::invalid_argument("Expected calibration object");
    const auto it=object.object.find(name);if(it==object.object.end())throw std::invalid_argument(std::string("Missing calibration field: ")+name);
    return it->second;
}
std::int64_t integer(const Value& value){
    if(value.kind!=Value::Number)throw std::invalid_argument("Expected calibration integer");
    const double n=pandoeditor::codecjson::finiteNumber(value);
    if(std::abs(n)>kMaxExactInteger||std::trunc(n)!=n)throw std::invalid_argument("Invalid calibration integer");
    return static_cast<std::int64_t>(n);
}
struct Reach {std::int64_t id,next,count;double stage;};
Value chain(const Value& input){
    const auto& rows=field(input,"features");
    if(rows.kind!=Value::Array||rows.array.size()>10000000)throw std::invalid_argument("Bounded calibration features required");
    std::vector<Reach> selected;std::map<std::int64_t,std::size_t> index;
    for(const auto& row:rows.array){
        const auto& stage=field(row,"stage");if(stage.kind==Value::Null)continue;
        if(stage.kind!=Value::Number)throw std::invalid_argument("Invalid calibration stage");
        const Reach reach{integer(field(row,"id")),integer(field(row,"next")),integer(field(row,"coordinateCount")),pandoeditor::codecjson::finiteNumber(stage)};
        if(reach.count<0)throw std::invalid_argument("Invalid source coordinate count");
        const auto found=index.find(reach.id);
        if(found==index.end()){index.emplace(reach.id,selected.size());selected.push_back(reach);}else selected[found->second]=reach;
    }
    std::vector<std::size_t> upstream(selected.size(),0);std::int64_t coordinates=0;
    for(const auto& reach:selected){
        if(reach.count>static_cast<std::int64_t>(kMaxExactInteger)-coordinates)throw std::invalid_argument("Coordinate total exceeds exact range");
        coordinates+=reach.count;const auto next=index.find(reach.next);
        if(next!=index.end()&&selected[next->second].stage==reach.stage)++upstream[next->second];
    }
    std::vector<bool> visited(selected.size(),false);std::size_t chains=0,visitedCount=0;
    for(std::size_t i=0;i<selected.size();++i){
        const auto next=index.find(selected[i].next);
        if(upstream[i]==1&&next!=index.end()&&selected[next->second].stage==selected[i].stage)continue;
        if(visited[i])continue;
        ++chains;std::size_t current=i;
        while(!visited[current]){
            visited[current]=true;++visitedCount;const auto downstream=index.find(selected[current].next);
            if(downstream==index.end()||selected[downstream->second].stage!=selected[current].stage||upstream[downstream->second]!=1)break;
            current=downstream->second;
        }
    }
    chains+=selected.size()-visitedCount;
    auto result=Value::obj();result.object["selectedReachCount"]=Value::num(static_cast<double>(selected.size()));
    result.object["chainCount"]=Value::num(static_cast<double>(chains));
    result.object["sourceCoordinateCount"]=Value::num(static_cast<double>(coordinates));
    result.object["coordinatesAfterChaining"]=Value::num(static_cast<double>(coordinates));return result;
}
}
int main(){
    try{
        const std::string input{std::istreambuf_iterator<char>{std::cin},std::istreambuf_iterator<char>{}};
        if(input.size()>512ULL*1024*1024)throw std::invalid_argument("Calibration request exceeds byte budget");
        const auto request=pandoeditor::codecjson::parse(input);const auto& mode=field(request,"mode");
        if(mode.kind!=Value::String||mode.string!="chain")throw std::invalid_argument("Invalid calibration operation");
        std::cout<<chain(request).encode()<<'\n';return 0;
    }catch(const std::exception& error){std::cerr<<"hydro-calibration: "<<error.what()<<'\n';return 1;}
}
