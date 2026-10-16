#include <pandoeditor/placenames.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <stdexcept>

namespace {
using emscripten::val;
std::string text(const val& value){return value.isNull()||value.isUndefined()?std::string{}:value.as<std::string>();}
std::vector<std::string> strings(const val& values){
    std::vector<std::string> result;if(values.isNull()||values.isUndefined())return result;
    const auto size=values["length"].as<unsigned>();for(unsigned i=0;i<size;++i)result.push_back(text(values[i]));return result;
}
val placeNameRows(const val& record,const val& languages,const std::string& mapDate,const std::string& referenceDate){
    pandoeditor::PlaceNameInput input;input.names={text(record["name"]),text(record["nameEn"]),text(record["nameNative"])};
    input.nativeExtras=strings(record["nameNativeExtras"]);const auto timeline=record["nameTimeline"];
    const char* keys[]{"ko","en","native"};std::array<bool,3> selected{};
    for(unsigned i=0;i<3;++i)selected[i]=languages[keys[i]].typeOf().as<std::string>()=="boolean"&&languages[keys[i]].as<bool>();
    if(!timeline.isNull()&&!timeline.isUndefined())for(unsigned n=0;n<timeline["length"].as<unsigned>();++n){
        const auto raw=timeline[n];pandoeditor::PlaceNamePeriod period;period.fromDate=text(raw["fromDate"]);
        if(period.fromDate.empty())period.fromYear=raw["fromYear"].as<int>();
        for(unsigned i=0;i<3;++i)if(!raw[keys[i]].isNull()&&!raw[keys[i]].isUndefined())period.names[i]=text(raw[keys[i]]);
        period.nativeExtras=strings(raw["nativeExtras"]);input.timeline.push_back(std::move(period));
    }
    auto result=val::array();unsigned at=0;
    for(const auto& row:pandoeditor::resolvePlaceNames(input,selected,mapDate,referenceDate)){
        auto value=val::object();value.set("language",row.language);value.set("text",row.text);value.set("modernName",row.modernName);result.set(at++,value);
    }
    return result;
}
}
EMSCRIPTEN_BINDINGS(pandoeditor_places){emscripten::function("placeNameRows",&placeNameRows);}
