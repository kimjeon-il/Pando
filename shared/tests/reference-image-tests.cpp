#include <pandoeditor/referenceimage.h>
#include <pandoeditor/referencetracing.h>
#include <cmath>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>

using namespace pandoeditor;
using V=codecjson::Value;
namespace {
void require(bool ok,const std::string& message){if(!ok)throw std::runtime_error(message);}
const V& get(const V& value,const std::string& key){return value.object.at(key);}
bool yes(const V& value){return value.kind==V::Bool&&value.raw=="true";}
V read(const char* file){std::ifstream stream(std::string(PANDO_REFERENCE_FIXTURE_ROOT)+"/"+file);require(bool(stream),std::string("Missing frozen reference fixture: ")+file);std::stringstream contents;contents<<stream.rdbuf();return codecjson::parse(contents.str());}
void equal(const V& actual,const V& expected,const std::string& path){
    require(actual.kind==expected.kind,path+": type");
    if(expected.kind==V::Number){require(std::abs(codecjson::finiteNumber(actual)-codecjson::finiteNumber(expected))<1e-10,path+": numeric value");return;}
    if(expected.kind==V::Array){require(actual.array.size()==expected.array.size(),path+": array size");for(std::size_t i=0;i<actual.array.size();++i)equal(actual.array[i],expected.array[i],path+"["+std::to_string(i)+"]");return;}
    if(expected.kind==V::Object){for(const auto& [key,value]:expected.object){require(actual.object.count(key),path+": missing "+key);equal(get(actual,key),value,path+"."+key);}return;}
    require(actual.encode()==expected.encode(),path+": value");
}
}
int main(){try{
    int cases=0;
    for(const auto& fixture:read("reference-calibration.json").array){const auto input=get(fixture,"input");const auto before=input.encode();const auto actual=referenceImageOperation("calibration",input);const auto expected=get(fixture,"expected");equal(get(actual,"calibrationOk"),get(expected,"ok"),"calibration.ok");equal(get(actual,"calibrationReason"),get(expected,"reason"),"calibration.reason");equal(get(actual,"mesh"),get(expected,"mesh"),"calibration.mesh");require(input.encode()==before,"calibration mutated input");++cases;}
    for(const auto& operation:{std::string("trace"),std::string("refine")})for(const auto& fixture:read(operation=="trace"?"reference-trace.json":"reference-refine.json").array){
        const auto& source=get(fixture,"input");const auto edge=get(source,"edge").string;
        auto input=codecjson::parse(R"({"record":{"mapQuad":[[10,40],[20,40],[20,30],[10,30]],"cornerPinEnabled":true},"sourceWidth":64,"sourceHeight":64,"image":{"width":64,"height":64,"data":[]}})");
        input.object["anchors"]=get(source,operation=="trace"?"anchors":"uv");auto& rgba=input.object["image"].object["data"].array;
        for(int y=0;y<64;++y)for(int x=0;x<64;++x){const int c=edge=="weak"?128:x>=32&&(edge!="turn"||y<54)?255:0;rgba.insert(rgba.end(),{V::num(c),V::num(c),V::num(c),V::num(255)});}
        equal(referenceImageOperation(operation,input),get(fixture,"expected"),operation);++cases;
    }
    auto input=codecjson::parse(R"({"points":[{"id":"a","image":[0,0],"coordinate":[10,40],"pinned":true},{"id":"b","image":[1,0],"coordinate":[20,40]},{"id":"c","image":[0,1],"coordinate":[10,30]},{"id":"d","image":[1,1],"coordinate":[21,31]}],"mode":"tps"})");
    const auto warp=referenceImageOperation("warp",input);require(yes(get(warp,"ok")),"Pinned TPS fit");require(codecjson::finiteNumber(get(get(warp,"diagnostics"),"hardMaxMeters"))<=.01,"Pinned constraint residual");
    const auto at=projectReferenceImageWarp(warp,{0,0});require(at&&std::abs((*at)[0]-10)<1e-8&&std::abs((*at)[1]-40)<1e-8,"Pinned coordinate");
    std::cout<<"reference image cases: "<<cases+1<<" passed\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
