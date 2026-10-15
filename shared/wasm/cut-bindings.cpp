#include <pandoeditor/cutgeometry.h>
#include <pandoeditor/projectcodec.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
namespace {
using namespace pandoeditor;
using emscripten::val;
struct PreparedCutPort {
    PreparedCutGeometry source;
    explicit PreparedCutPort(const std::string& json):source(projectcodec::readWebGeometry(codecjson::parse(json))){}
    std::string prepare(const std::string& json)const{return source.prepare(codecjson::parse(json)).encode();}
};
std::string cutIntersection(const std::string& json){const auto a=codecjson::parse(json);Point p[4];for(int i=0;i<4;++i)p[i]={codecjson::finiteNumber(a.array.at(i).array.at(0)),codecjson::finiteNumber(a.array.at(i).array.at(1))};return cutSegmentIntersection(p[0],p[1],p[2],p[3],codecjson::finiteNumber(a.array.at(4))).encode();}
}
EMSCRIPTEN_BINDINGS(pando_cut_calculation){
    emscripten::class_<PreparedCutPort>("PreparedCutGeometry").constructor<std::string>().function("prepare",&PreparedCutPort::prepare);
    emscripten::function("cutSegmentIntersection",&cutIntersection);
}
