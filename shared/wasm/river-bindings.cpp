#include <pandoeditor/riverpartition.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
namespace {
std::string calculate(const std::string& operation,const std::string& json){try{return pandoeditor::riverPartitionOperation(operation,pandoeditor::codecjson::parse(json)).encode();}catch(const std::exception& error){auto e=emscripten::val::global("Error").new_(std::string(error.what()));e.set("code",std::string("PL-RIVER-CALCULATION"));e.throw_();}std::terminate();}
}
EMSCRIPTEN_BINDINGS(pando_reference_river){emscripten::function("riverPartitionCalculate",&calculate);}
