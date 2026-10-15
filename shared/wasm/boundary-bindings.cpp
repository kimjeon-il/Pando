#include <pandoeditor/boundarychain.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using emscripten::val;
using namespace pandoeditor;
void requireArray(val value,const char* code) {
    if(!val::global("Array").call<bool>("isArray",value))throw std::invalid_argument(code);
}
Point readPoint(val input) {
    requireArray(input,"INVALID_BOUNDARY_COORDINATE");
    if(input["length"].as<unsigned>()!=2
       ||input[0].typeOf().as<std::string>()!="number"
       ||input[1].typeOf().as<std::string>()!="number")
        throw std::invalid_argument("INVALID_BOUNDARY_COORDINATE: expected two numbers");
    const double lon=input[0].as<double>(),lat=input[1].as<double>();
    if(!std::isfinite(lon)||!std::isfinite(lat))
        throw std::invalid_argument("INVALID_BOUNDARY_COORDINATE: nonfinite point");
    return {lon,lat};
}
val webPoint(Point input) {
    auto output=val::array();
    output.set(0,input.x);output.set(1,input.y);return output;
}
val boundaryConnectForWeb(val input) {
    try {
        requireArray(input,"INVALID_BOUNDARY_SEGMENT");
        const auto count=input["length"].as<unsigned>();
        if(count>2'000'000)throw std::invalid_argument("INVALID_BOUNDARY_SEGMENT: excessive edges");
        std::vector<BoundaryEdge> edges;edges.reserve(count);
        for(unsigned i=0;i<count;++i) {
            const auto item=input[i];
            requireArray(item,"INVALID_BOUNDARY_SEGMENT");
            if(item["length"].as<unsigned>()!=2)
                throw std::invalid_argument("INVALID_BOUNDARY_SEGMENT: expected endpoints");
            edges.emplace_back(readPoint(item[0]),readPoint(item[1]));
        }
        const auto chains=connectBoundaryChains(edges);
        auto output=val::array();
        unsigned i=0;
        for(const auto& chain:chains) {
            auto line=val::array();
            unsigned j=0;
            for(const auto& point:chain)line.set(j++,webPoint(point));
            output.set(i++,line);
        }
        return output;
    }catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-BOUNDARY-001"));
        js.throw_();
    }
    std::terminate();
}
}
EMSCRIPTEN_BINDINGS(pandoeditor_boundary_chains) {
    emscripten::function("boundaryConnectChains",&boundaryConnectForWeb);
}
