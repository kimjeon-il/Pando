#include <pandoeditor/projectcodec.h>
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/project.h>
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
#include <limits>
#include <cmath>

using namespace pandoeditor;
int main() {
    const auto json=codecjson::parse("{\"opaque\":9007199254740993,\"label\":\"한국어 \\ud83d\\ude00\"}");
    assert(json.object.at("opaque").raw=="9007199254740993");
    assert(json.object.at("label").string==u8"한국어 😀");
    assert(codecjson::parse(json.encode()).object.at("opaque").raw=="9007199254740993");
    try { codecjson::parse("{\"a\":1,\"\\u0061\":2}");assert(false); }
    catch(const std::invalid_argument& error) { assert(std::string(error.what()).find("DUPLICATE_KEY")==0); }
    assert(codecjson::Value::num(1.25).encode()=="1.25");
    assert(std::signbit(codecjson::finiteNumber(codecjson::parse("-0"))));
    assert(codecjson::finiteNumber(codecjson::parse("9007199254740993"))==9007199254740992.0);
    assert(codecjson::finiteNumber(codecjson::parse("9223372036854775808"))==9223372036854775808.0);
    assert(codecjson::finiteNumber(codecjson::parse("-9223372036854775808"))==-9223372036854775808.0);
    assert(codecjson::finiteNumber(codecjson::parse("1.25"))==1.25);
    assert(codecjson::finiteNumber(codecjson::parse("1e2"))==100);
    // Captured with Qt 6.8.3 QJsonDocument in a tiny Core-only oracle. These
    // tokens also pin geometry/provenance hashes across the codec extraction.
    const double numbers[]={-0.0,0.0,1.25,1e-7,1e-6,1e20,1e21,9007199254740992.0,
        0.000012345678901234567,1.2345678901234567,std::numeric_limits<double>::denorm_min(),std::numeric_limits<double>::max(),
        1e-4,1234567.25};
    const char* encodedNumbers[]={"0","0","1.25","1e-07","1e-06","1e+20","1e+21","9007199254740992",
        "1.2345678901234568e-05","1.2345678901234567","5e-324","1.7976931348623157e+308","1e-04","1234567.25"};
    for(unsigned i=0;i<14;++i) {
        const auto actual=codecjson::Value::num(numbers[i]).encode();
        if(actual!=encodedNumbers[i])std::cerr<<"Scalar "<<i<<": actual "<<actual<<", expected "<<encodedNumbers[i]<<'\n';
        assert(actual==encodedNumbers[i]);
    }
    assert(codecjson::Value::str(std::string("\0\b\f\n\r\t",6)).encode()=="\"\\u0000\\b\\f\\n\\r\\t\"");
    const std::string nested="{\"a\":[{\"escaped\\\"key\":[1.2300,true,null,\"\\ud800\"]}],\"z\":9007199254740993}";
    assert(codecjson::parse(nested).encode()==nested);
    auto boundary=codecjson::Value::num(1);
    for(int depth=0;depth<128;++depth){auto parent=codecjson::Value::arr();parent.array.push_back(std::move(boundary));boundary=std::move(parent);}
    assert(boundary.encode()==std::string(128,'[')+"1"+std::string(128,']'));
    auto excessive=codecjson::Value::arr();excessive.array.push_back(std::move(boundary));
    try {excessive.encode();assert(false);}catch(const std::invalid_argument& error){assert(std::string(error.what()).find("LIMIT_EXCEEDED")==0);}
    std::ifstream input(PROJECT_CODEC_FIXTURE,std::ios::binary);
    assert(input);
    const std::string bytes{std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>()};
    const projectcodec::PlatformPorts ports{[](const std::string&){throw std::invalid_argument("UNEXPECTED_FLAG");}};
    auto document=projectcodec::decodeWeb(bytes,ports);
    assert(document.units.size()==4);
    assert(document.documentId==codecjson::parse(bytes).object.at("documentId").string);
    Project project;project.replace(document);
    const auto encoded=projectcodec::encodeWeb(project.snapshot(),ports);
    const auto restored=projectcodec::decodeWeb(encoded,ports);
    assert(semanticallyEqual(document,restored));
    auto flagInput=codecjson::parse(bytes);
    flagInput.object.at("territorialEntities").array[0].object.at("properties").object.at("metadata")
        .object["flagDataUrl"]=codecjson::Value::str("garbage flag URL");
    const projectcodec::PlatformPorts webPorts{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
    const auto flagDocument=projectcodec::decodeWeb(flagInput.encode(),webPorts);
    assert(flagDocument.symbols.at(territorialRef("A")).embeddedDataUrl=="garbage flag URL");
    Project flagProject;flagProject.replace(flagDocument);
    const auto flagRoundTrip=codecjson::parse(projectcodec::encodeWeb(flagProject.snapshot(),webPorts));
    assert(flagRoundTrip.object.at("territorialEntities").array[0].object.at("properties").object.at("metadata")
        .object.at("flagDataUrl").string=="garbage flag URL");
    flagInput.object.at("territorialEntities").array[0].object.at("properties").object.at("metadata")
        .object["flagDataUrl"]=codecjson::Value::num(42);
    const auto opaqueFlag=projectcodec::decodeWeb(flagInput.encode(),webPorts);
    assert(!opaqueFlag.symbols.count(territorialRef("A")));
    Project opaqueProject;opaqueProject.replace(opaqueFlag);
    assert(codecjson::parse(projectcodec::encodeWeb(opaqueProject.snapshot(),webPorts)).object.at("territorialEntities")
        .array[0].object.at("properties").object.at("metadata").object.at("flagDataUrl").raw=="42");
    try { projectcodec::decodeWeb(bytes,{});assert(false); }
    catch(const std::invalid_argument& error) { assert(std::string(error.what()).find("CODEC_PLATFORM_REQUIRED")==0); }
    std::cout << "Shared codec: lossless scalars, duplicate keys, Unicode and current Web round trip passed\n";
}
