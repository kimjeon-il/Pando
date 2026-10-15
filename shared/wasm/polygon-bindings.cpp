#include <pandoeditor/polygonclipping.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <cmath>
#include <stdexcept>

namespace {
using emscripten::val;
using namespace pandoeditor;
unsigned arrayLength(val input){
    if(!val::global("Array").call<bool>("isArray",input))throw std::invalid_argument("Input geometry is not a valid Polygon or MultiPolygon");
    return input["length"].as<unsigned>();
}
MultiPolygon readMulti(val input){
    const auto length=arrayLength(input);if(!length)return {};
    const bool polygon=arrayLength(input[0])&&arrayLength(input[0][0])&&input[0][0][0].typeOf().as<std::string>()=="number";
    MultiPolygon result;
    for(unsigned i=0;i<(polygon?1:length);++i){
        const val item=polygon?input:input[i];const auto rings=arrayLength(item);Polygon poly;
        if(!rings)throw std::invalid_argument("Input geometry is not a valid Polygon or MultiPolygon");
        for(unsigned j=0;j<rings;++j){Ring ring;const val points=item[j];const auto count=arrayLength(points);
            for(unsigned k=0;k<count;++k){const auto p=points[k];if(arrayLength(p)<2||p[0].typeOf().as<std::string>()!="number"||p[1].typeOf().as<std::string>()!="number")throw std::invalid_argument("Invalid polygon coordinate");
                ring.push_back({p[0].as<double>(),p[1].as<double>()});}
            poly.push_back(std::move(ring));}
        result.push_back(std::move(poly));
    }
    return result;
}
val polygonOperation(const std::string& name,val inputs,bool precisionRetry){
    try{
        PolygonOperation operation;
        if(name=="union")operation=PolygonOperation::Union;
        else if(name=="difference")operation=PolygonOperation::Difference;
        else if(name=="intersection")operation=PolygonOperation::Intersection;
        else if(name=="xor")operation=PolygonOperation::Xor;
        else throw std::invalid_argument("Invalid polygon operation");
        const auto count=arrayLength(inputs);std::vector<MultiPolygon> operands;
        for(unsigned i=0;i<count;++i)operands.push_back(readMulti(inputs[i]));
        const auto result=clipPolygons(operation,operands,{},precisionRetry);auto output=val::array();unsigned p=0;
        for(const auto& polygon:result){auto rings=val::array();unsigned r=0;
            for(const auto& ring:polygon){auto points=val::array();unsigned i=0;
                for(const auto& point:ring){auto pair=val::array();pair.set(0,point.x);pair.set(1,point.y);points.set(i++,pair);}
                rings.set(r++,points);}
            output.set(p++,rings);}
        return output;
    }catch(const std::exception& error){auto js=val::global("Error").new_(std::string(error.what()));js.set("code",std::string("PL-GEOMETRY-CALCULATION"));js.throw_();}
    std::terminate();
}
}
EMSCRIPTEN_BINDINGS(pando_polygon_calculation){emscripten::function("polygonOperation",&polygonOperation);}
