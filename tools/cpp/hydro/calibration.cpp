// Native analysis-only Hydro calibration calculations. Runtime data is not written.
#include <pandoeditor/losslessjson.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <iterator>
#include <limits>
#include <map>
#include <set>
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
double number(const Value& value){
    if(value.kind!=Value::Number)throw std::invalid_argument("Expected calibration number");
    return pandoeditor::codecjson::finiteNumber(value);
}
struct Feature { double order,first,second,metricFirst,metricSecond; };
struct StageMetrics { double first,second; };
struct Region { std::vector<Feature> features; std::array<StageMetrics,4> targets,baselines; };
struct Scored {double score,first,second;};
std::array<double,2> lineDirection(const Value& line,std::size_t& pointCount){
    if(line.kind!=Value::Array)throw std::invalid_argument("Calibration line coordinates required");
    pointCount+=line.array.size();if(pointCount>10000000)throw std::invalid_argument("Too many calibration coordinates");
    std::array<double,2> previous{},best{};double bestLength=-1.0;bool first=true;
    for(const auto& point:line.array){
        if(point.kind!=Value::Array||point.array.size()!=2)throw std::invalid_argument("Calibration point needs two coordinates");
        const std::array<double,2> current{number(point.array[0]),number(point.array[1])};
        if(!first){const double dx=current[0]-previous[0],dy=current[1]-previous[1],length=std::hypot(dx,dy);
            if(!std::isfinite(length))throw std::invalid_argument("Invalid calibration segment length");
            if(length>bestLength){bestLength=length;best={dx,dy};}}
        previous=current;first=false;
    }
    if(bestLength<=0.0)return {0.0,0.0};return {best[0]/bestLength,best[1]/bestLength};
}
Value directions(const Value& input){
    const auto& pairs=field(input,"pairs");if(pairs.kind!=Value::Array||pairs.array.size()>1000000)
        throw std::invalid_argument("Bounded calibration line pairs required");
    Value result=Value::arr();result.array.reserve(pairs.array.size());std::size_t count=0;
    for(const auto& pair:pairs.array){const auto left=lineDirection(field(pair,"left"),count),right=lineDirection(field(pair,"right"),count);
        result.array.push_back(Value::num(std::abs(left[0]*right[0]+left[1]*right[1])));}
    return result;
}
double featureScore(const Feature& feature,double firstWeight,double secondWeight){
    const double result=feature.order+firstWeight*std::log10(std::max(feature.first,1e-6))+
        secondWeight*std::log10(std::max(feature.second,1e-6));
    if(!std::isfinite(result))throw std::invalid_argument("Invalid calibration score");
    return result;
}
Value assign(const Value& input){
    const auto& kind=field(input,"kind"),&stages=field(input,"stages"),&thresholds=field(input,"thresholds"),
        &weights=field(input,"weights"),&features=field(input,"features");
    if(kind.kind!=Value::String||(kind.string!="river"&&kind.string!="lake")||stages.kind!=Value::Array||stages.array.size()!=4||
       thresholds.kind!=Value::Array||thresholds.array.size()!=4||weights.kind!=Value::Array||weights.array.size()!=2||
       features.kind!=Value::Array||features.array.size()>10000000)throw std::invalid_argument("Invalid calibration assignment request");
    const bool river=kind.string=="river";std::array<double,4> stageValues{},thresholdValues{};
    for(std::size_t i=0;i<4;++i){stageValues[i]=number(stages.array[i]);thresholdValues[i]=number(thresholds.array[i]);}
    const double firstWeight=number(weights.array[0]),secondWeight=number(weights.array[1]);Value result=Value::arr();
    result.array.reserve(features.array.size());
    for(const auto& row:features.array){
        const auto& duplicate=field(row,"duplicate");if(duplicate.kind!=Value::Bool)throw std::invalid_argument("Invalid duplicate flag");
        if(duplicate.raw=="true"){result.array.emplace_back();continue;}
        const Feature feature{river?number(field(row,"order")):0.0,number(field(row,"first")),number(field(row,"second")),0.0,0.0};
        const double score=featureScore(feature,firstWeight,secondWeight);Value selected;
        for(std::size_t i=0;i<4;++i)if(score>=thresholdValues[i]){selected=Value::num(stageValues[i]);break;}
        result.array.push_back(std::move(selected));
    }
    return result;
}

// Match Python math.fsum's non-overlapping partials for the nonnegative errors.
double accurateSum(const std::vector<double>& values){
    std::vector<double> partials;
    for(double x:values){
        if(std::isinf(x))return x;
        std::size_t i=0;
        for(double y:partials){
            if(std::abs(x)<std::abs(y))std::swap(x,y);
            const double hi=x+y,lo=y-(hi-x);
            if(lo!=0.0)partials[i++]=lo;
            x=hi;
        }
        partials.resize(i);partials.push_back(x);
    }
    if(partials.empty())return 0.0;
    double hi=partials.back();partials.pop_back();double lo=0.0;
    while(!partials.empty()){
        const double x=hi,y=partials.back();partials.pop_back();
        hi=x+y;lo=y-(hi-x);if(lo!=0.0)break;
    }
    if(!partials.empty()&&((lo<0.0&&partials.back()<0.0)||(lo>0.0&&partials.back()>0.0))){
        const double y=lo*2.0,x=hi+y;if(y==x-hi)hi=x;
    }
    return hi;
}
double logError(double value,double target){
    const double ratio=target<=0.0?(value<=0.0?1.0:std::numeric_limits<double>::infinity()):value/target;
    return std::abs(std::log(std::max(ratio,1e-9)));
}
Value optimize(const Value& input){
    const auto& kindValue=field(input,"kind");
    if(kindValue.kind!=Value::String||(kindValue.string!="river"&&kindValue.string!="lake"))throw std::invalid_argument("Invalid calibration kind");
    const bool river=kindValue.string=="river";
    const auto& stagesValue=field(input,"stages"),&regionsValue=field(input,"regions"),&weightsValue=field(input,"weights");
    if(stagesValue.kind!=Value::Array||stagesValue.array.size()!=4||regionsValue.kind!=Value::Array||
       regionsValue.array.size()>1000||weightsValue.kind!=Value::Array||weightsValue.array.empty()||weightsValue.array.size()>1000)
        throw std::invalid_argument("Bounded calibration stages, regions and weights required");
    for(const auto& stage:stagesValue.array)(void)number(stage);
    std::vector<Region> regions;std::size_t totalFeatures=0;
    for(const auto& regionValue:regionsValue.array){
        Region region;const auto& features=field(regionValue,"features"),&targets=field(regionValue,"targets"),&baselines=field(regionValue,"baselines");
        if(features.kind!=Value::Array||targets.kind!=Value::Array||targets.array.size()!=4||baselines.kind!=Value::Array||baselines.array.size()!=4)
            throw std::invalid_argument("Invalid calibration region");
        totalFeatures+=features.array.size();if(totalFeatures>10000000)throw std::invalid_argument("Too many calibration features");
        for(const auto& row:features.array)region.features.push_back({river?number(field(row,"order")):0.0,number(field(row,"first")),
            number(field(row,"second")),number(field(row,"metricFirst")),river?number(field(row,"metricSecond")):1.0});
        for(std::size_t i=0;i<4;++i){region.targets[i]={number(field(targets.array[i],"first")),number(field(targets.array[i],"second"))};
            region.baselines[i]={number(field(baselines.array[i],"first")),number(field(baselines.array[i],"second"))};}
        regions.push_back(std::move(region));
    }
    double bestObjective=std::numeric_limits<double>::infinity(),bestFirst=0,bestSecond=0;std::array<double,4> bestThresholds{};
    bool haveBest=false,haveThresholds=false;
    for(const auto& pair:weightsValue.array){
        if(pair.kind!=Value::Array||pair.array.size()!=2)throw std::invalid_argument("Invalid calibration weight pair");
        const double firstWeight=number(pair.array[0]),secondWeight=number(pair.array[1]);
        std::vector<std::vector<Scored>> scored(regions.size());std::vector<double> values;values.reserve(totalFeatures);
        for(std::size_t i=0;i<regions.size();++i)for(const auto& feature:regions[i].features){
            const double score=featureScore(feature,firstWeight,secondWeight);
            scored[i].push_back({score,feature.metricFirst,feature.metricSecond});values.push_back(score);
        }
        std::array<double,4> selected{};double total=std::numeric_limits<double>::infinity();
        if(!values.empty()){
            std::sort(values.begin(),values.end());std::set<double,std::greater<double>> candidates;
            candidates.insert(values.front()-1e-9);candidates.insert(values.back()+1e-9);
            for(int i=0;i<=220;++i){const auto at=static_cast<std::size_t>(std::nearbyint(static_cast<double>(i)*(values.size()-1)/220.0));
                candidates.insert(values[std::min(values.size()-1,at)]);}
            const std::vector<double> thresholds(candidates.begin(),candidates.end());
            struct Prefix {std::vector<double> scores,first,second;};std::vector<Prefix> prefixes;
            for(auto& rows:scored){
                std::stable_sort(rows.begin(),rows.end(),[](const Scored& a,const Scored& b){return a.score>b.score;});
                Prefix prefix;prefix.first.push_back(0);prefix.second.push_back(0);
                for(const auto& row:rows){prefix.scores.push_back(row.score);prefix.first.push_back(prefix.first.back()+row.first);
                    prefix.second.push_back(prefix.second.back()+row.second);}
                prefixes.push_back(std::move(prefix));
            }
            double previous=std::numeric_limits<double>::infinity();total=0.0;
            for(std::size_t stage=0;stage<4;++stage){
                double chosen=0,best=std::numeric_limits<double>::infinity();bool allowed=false;
                for(const double threshold:thresholds){
                    if(threshold>previous+1e-9)continue;if(!allowed){chosen=threshold;allowed=true;}
                    std::vector<double> errors;
                    for(std::size_t i=0;i<regions.size();++i){const auto& prefix=prefixes[i];
                        const auto count=static_cast<std::size_t>(std::upper_bound(prefix.scores.begin(),prefix.scores.end(),threshold,std::greater<double>())-prefix.scores.begin());
                        const auto& base=regions[i].baselines[stage];const auto& target=regions[i].targets[stage];
                        const double a=prefix.first[count]+base.first,b=prefix.second[count]+base.second;
                        if(stage==3)errors.push_back(logError(a,target.first));
                        errors.push_back(logError(river?b:a,river?target.second:target.first));
                        if(!river&&stage==3){errors[errors.size()-2]=logError(a,target.first);errors.back()=logError(b,target.second);}
                    }
                    const double maximum=errors.empty()?0.0:*std::max_element(errors.begin(),errors.end());
                    const double objective=maximum*0.7+(errors.empty()?0.0:accurateSum(errors)/errors.size())*0.3;
                    if(objective<best){best=objective;chosen=threshold;}
                }
                if(!allowed)throw std::runtime_error("No allowed calibration threshold");
                selected[stage]=chosen;previous=chosen;total+=best;
            }
        }
        if(!haveBest||total<bestObjective){haveBest=true;bestObjective=total;bestFirst=firstWeight;bestSecond=secondWeight;
            bestThresholds=selected;haveThresholds=!values.empty();}
    }
    Value result=Value::obj(),weights=Value::arr(),thresholds=Value::arr();weights.array.push_back(Value::num(bestFirst));weights.array.push_back(Value::num(bestSecond));
    if(haveThresholds)for(double value:bestThresholds)thresholds.array.push_back(Value::num(value));
    result.object["weights"]=std::move(weights);result.object["thresholds"]=std::move(thresholds);
    result.object["objective"]=std::isfinite(bestObjective)?Value::num(bestObjective):Value{};return result;
}
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
        if(mode.kind!=Value::String)throw std::invalid_argument("Invalid calibration operation");
        const auto result=mode.string=="chain"?chain(request):mode.string=="optimize"?optimize(request):
            mode.string=="assign"?assign(request):mode.string=="directions"?directions(request):throw std::invalid_argument("Invalid calibration operation");
        std::cout<<result.encode()<<'\n';return 0;
    }catch(const std::exception& error){std::cerr<<"hydro-calibration: "<<error.what()<<'\n';return 1;}
}
