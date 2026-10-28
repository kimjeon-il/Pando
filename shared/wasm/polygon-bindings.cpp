#include <pandoeditor/polygonclipping.h>
#include <pandoeditor/polygonwrapping.h>
#include <pandoeditor/geometrypredicates.h>
#include <pandoeditor/projectcodec.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <emscripten.h>
#include <cmath>
#include <stdexcept>

namespace {
using emscripten::val;
using emscripten::EM_VAL;
using namespace pandoeditor;
// Transfer coordinates in bulk. Per-coordinate emval access dominates large
// polygons even when the sweep itself is fast; these helpers only marshal data.
EM_JS(EM_VAL, packPolygonOperands, (EM_VAL handle), {
    const inputs=Emval.toValue(handle),shape=[],points=[];
    const fail=message=>{const error=new Error(message);error.code='PL-GEOMETRY-CALCULATION';throw error;};
    const array=value=>{if(!Array.isArray(value))fail('Input geometry is not a valid Polygon or MultiPolygon');return value;};
    shape.push(array(inputs).length);
    for(const input of inputs){
        array(input);
        const isPolygon=input.length&&array(input[0]).length&&array(input[0][0]).length&&typeof input[0][0][0]==='number';
        const polygons=isPolygon?[input]:input;shape.push(polygons.length);
        for(const polygon of polygons){array(polygon);if(!polygon.length)fail('Input geometry is not a valid Polygon or MultiPolygon');shape.push(polygon.length);
            for(const ring of polygon){array(ring);shape.push(ring.length);
                for(const point of ring){if(!Array.isArray(point)||point.length<2||typeof point[0]!=='number'||typeof point[1]!=='number'||!Number.isFinite(point[0])||!Number.isFinite(point[1]))fail('Invalid polygon coordinate');points.push(point[0],point[1]);}
            }
        }
    }
    return Emval.toHandle([shape,points]);
});
EM_JS(EM_VAL, unpackPolygonResult, (EM_VAL shapeHandle,EM_VAL pointsHandle), {
    const shape=Emval.toValue(shapeHandle),points=Emval.toValue(pointsHandle),result=[];let at=0,point=0;
    const polygons=shape[at++];for(let p=0;p<polygons;p++){const polygon=[],rings=shape[at++];
        for(let r=0;r<rings;r++){const ring=[],count=shape[at++];for(let i=0;i<count;i++)ring.push([points[point++],points[point++]]);polygon.push(ring);}result.push(polygon);}
    return Emval.toHandle(result);
});
EM_JS(EM_VAL, packGisGeometry, (EM_VAL handle), {
    const input=Emval.toValue(handle),shape=[input.length],points=[];
    for(const polygon of input){
        if(!polygon?.length){shape.push(0);continue;}
        if(!Array.isArray(polygon))throw new TypeError('Invalid GIS polygon');
        shape.push(polygon.length);
        for(const raw of polygon){
            const ring=Array.isArray(raw)?raw:[];shape.push(ring.length);
            for(const point of ring)points.push(Number(point[0]),Number(point[1]));
        }
    }
    return Emval.toHandle([new Uint32Array(shape),new Float64Array(points)]);
});
MultiPolygon readGisGeometry(val input) {
    const auto packed=val::take_ownership(packGisGeometry(input.as_handle()));
    const auto shapeValue=packed[0],pointsValue=packed[1];
    std::vector<unsigned> shape(shapeValue["length"].as<unsigned>());
    std::vector<double> points(pointsValue["length"].as<unsigned>());
    if(!shape.empty())val(emscripten::typed_memory_view(shape.size(),shape.data())).call<void>("set",shapeValue);
    if(!points.empty())val(emscripten::typed_memory_view(points.size(),points.data())).call<void>("set",pointsValue);
    std::size_t at=0,point=0;MultiPolygon polygons(shape.at(at++));
    for(auto& polygon:polygons){polygon.resize(shape.at(at++));for(auto& ring:polygon){ring.resize(shape.at(at++));for(auto& p:ring){p={points.at(point),points.at(point+1)};point+=2;}}}
    return polygons;
}
bool gisGeometry(val input) {return validateGisGeometry(readGisGeometry(input));}
std::vector<MultiPolygon> readOperands(val inputs){
    const auto packed=val::take_ownership(packPolygonOperands(inputs.as_handle()));
    const auto shapeValue=packed[0],pointsValue=packed[1];
    std::vector<unsigned> shape(shapeValue["length"].as<unsigned>());
    std::vector<double> points(pointsValue["length"].as<unsigned>());
    if(!shape.empty())val(emscripten::typed_memory_view(shape.size(),shape.data())).call<void>("set",shapeValue);
    if(!points.empty())val(emscripten::typed_memory_view(points.size(),points.data())).call<void>("set",pointsValue);
    std::size_t at=0,point=0;std::vector<MultiPolygon> operands(shape.at(at++));
    for(auto& operand:operands) {
        operand.resize(shape.at(at++));
        for(auto& polygon:operand) {
            polygon.resize(shape.at(at++));
            for(auto& ring:polygon) {
                ring.resize(shape.at(at++));
                for(auto& coordinate:ring) {
                    coordinate={points.at(point),points.at(point+1)};
                    point+=2;
                }
            }
        }
    }
    return operands;
}
val writeResult(const MultiPolygon& result){
    std::vector<unsigned> shape{static_cast<unsigned>(result.size())};std::vector<double> points;
    for(const auto& polygon:result){shape.push_back(polygon.size());for(const auto& ring:polygon){shape.push_back(ring.size());for(const auto& p:ring){points.push_back(p.x);points.push_back(p.y);}}}
    const val shapeView(emscripten::typed_memory_view(shape.size(),shape.data())),pointsView(emscripten::typed_memory_view(points.size(),points.data()));
    return val::take_ownership(unpackPolygonResult(shapeView.as_handle(),pointsView.as_handle()));
}
val polygonOperation(const std::string& name,val inputs,bool precisionRetry){
    try{
        PolygonOperation operation;
        if(name=="union")operation=PolygonOperation::Union;
        else if(name=="difference")operation=PolygonOperation::Difference;
        else if(name=="intersection")operation=PolygonOperation::Intersection;
        else if(name=="xor")operation=PolygonOperation::Xor;
        else throw std::invalid_argument("Invalid polygon operation");
        return writeResult(clipPolygons(operation,readOperands(inputs),{},precisionRetry));
    }catch(const std::exception& error){auto js=val::global("Error").new_(std::string(error.what()));js.set("code",std::string("PL-GEOMETRY-CALCULATION"));js.throw_();}
    std::terminate();
}
double validationArea(val input) {
    auto operands=val::array();operands.set(0,input);
    return territorialValidationArea(readOperands(operands).front());
}
bool territorialAreaForWeb(double area,const std::string& use) {
    if(use=="overlap")return territorialAreaDecision(area,TerritorialAreaUse::Overlap);
    if(use=="gap")return territorialAreaDecision(area,TerritorialAreaUse::Gap);
    if(use=="verification")return territorialAreaDecision(area,TerritorialAreaUse::Verification);
    throw std::invalid_argument("Invalid territorial validation area use");
}
val territorialSampleForWeb(unsigned length,unsigned maximum) {
    const auto indices=territorialSampleIndices(length,maximum);auto result=val::array();unsigned i=0;
    for(const auto index:indices)result.set(i++,static_cast<unsigned>(index));return result;
}
double gisArea(val input) {
    auto operands=val::array();operands.set(0,input);
    return gisValidationArea(readOperands(operands).front());
}
std::vector<std::vector<GisComponentBounds>> gisBounds(val input) {
    std::vector<std::vector<GisComponentBounds>> result(input["length"].as<unsigned>());
    for(unsigned i=0;i<result.size();++i){
        const auto components=input[i];result[i].resize(components["length"].as<unsigned>());
        for(unsigned j=0;j<result[i].size();++j)for(unsigned k=0;k<4;++k)
            result[i][j][k]=components[j][k].as<double>();
    }
    return result;
}
std::vector<bool> gisAffected(val input) {
    std::vector<bool> result;const auto length=input["length"].as<unsigned>();result.reserve(length);
    for(unsigned i=0;i<length;++i)result.push_back(input[i].as<bool>());
    return result;
}
struct GisCandidatePort {
    GisOverlapCandidateIterator iterator;
    GisCandidatePort(val bounds,val affected,bool scoped):iterator(gisBounds(bounds),gisAffected(affected),scoped){}
    bool isSignificant(double area)const {return iterator.isSignificant(area);}
    val next() {
        const auto candidate=iterator.next();if(!candidate)return val::null();
        auto result=val::object(),pairs=val::array();unsigned index=0;
        result.set("leftIndex",static_cast<unsigned>(candidate->leftIndex));
        result.set("rightIndex",static_cast<unsigned>(candidate->rightIndex));
        for(const auto& pair:candidate->componentPairs){auto row=val::array();row.set(0,static_cast<unsigned>(pair.first));row.set(1,static_cast<unsigned>(pair.second));pairs.set(index++,row);}
        result.set("componentPairs",pairs);return result;
    }
};
std::u16string utf16(val input) {
    std::u16string result;const auto length=input["length"].as<unsigned>();result.reserve(length);
    for(unsigned i=0;i<length;++i)result.push_back(static_cast<char16_t>(input.call<unsigned>("charCodeAt",i)));
    return result;
}
std::vector<std::u16string> utf16List(val input) {
    std::vector<std::u16string> result;const auto length=input["length"].as<unsigned>();result.reserve(length);
    for(unsigned i=0;i<length;++i)result.push_back(utf16(input[i]));return result;
}
std::optional<GisComponentBounds> optionalBounds(val input) {
    if(input.isNull()||input.isUndefined())return std::nullopt;
    GisComponentBounds result;for(unsigned i=0;i<4;++i)result[i]=input[i].as<double>();return result;
}
std::vector<std::optional<GisComponentBounds>> optionalBoundsList(val input) {
    std::vector<std::optional<GisComponentBounds>> result;const auto length=input["length"].as<unsigned>();result.reserve(length);
    for(unsigned i=0;i<length;++i)result.push_back(optionalBounds(input[i]));return result;
}
std::optional<std::set<std::u16string>> territorialKeys(val input) {
    if(input.isNull()||input.isUndefined())return std::nullopt;
    const auto values=utf16List(input);return std::set<std::u16string>(values.begin(),values.end());
}
struct TerritorialCandidatePort {
    TerritorialOverlapCandidateIterator iterator;
    TerritorialCandidatePort(val ids,val bounds,val affected,bool scoped,val keys)
        :iterator(utf16List(ids),optionalBoundsList(bounds),gisAffected(affected),scoped,territorialKeys(keys)){}
    val next() {
        try {
            const auto candidate=iterator.next();if(!candidate)return val::null();
            auto result=val::object();
            result.set("leftIndex",static_cast<unsigned>(candidate->leftIndex));result.set("rightIndex",static_cast<unsigned>(candidate->rightIndex));
            return result;
        } catch(const std::exception& error) {
            if(std::string(error.what())=="TERRITORIAL_COMPONENT_BOUNDS")val::global("TypeError").new_(std::string("Cannot read properties of null (reading '2')")).throw_();
            val::global("Error").new_(std::string(error.what())).throw_();
        }
        std::terminate();
    }
    val components(val left,val right) {
        try {
            const auto values=iterator.components(optionalBoundsList(left),optionalBoundsList(right));
            auto result=val::array();unsigned index=0;
            for(const auto& pair:values){auto row=val::array();row.set(0,static_cast<unsigned>(pair.first));row.set(1,static_cast<unsigned>(pair.second));result.set(index++,row);}
            return result;
        } catch(const std::exception& error) {
            if(std::string(error.what())=="TERRITORIAL_COMPONENT_BOUNDS")val::global("TypeError").new_(std::string("Cannot read properties of null (reading '2')")).throw_();
            val::global("Error").new_(std::string(error.what())).throw_();
        }
        std::terminate();
    }
    val diagnostics()const {
        const auto value=iterator.diagnostics();auto result=val::object();
        result.set("boundsCandidatePairs",static_cast<unsigned>(value.boundsCandidatePairs));
        result.set("componentCandidatePairs",static_cast<unsigned>(value.componentCandidatePairs));
        result.set("componentEvaluated",value.componentEvaluated);return result;
    }
};
Polygon territorialPolygon(val input) {
    auto polygons=val::array();polygons.set(0,input);return readGisGeometry(polygons).front();
}
struct TerritorialPolygonPort {
    TerritorialPolygonIndex index;
    explicit TerritorialPolygonPort(val polygon):index(territorialPolygon(polygon)){}
    bool mayOverlap(const TerritorialPolygonPort& other,val left,val right)const {
        return index.mayOverlap(other.index,*optionalBounds(left),*optionalBounds(right));
    }
};
}
std::string wrapGeometry(const std::string& input){
    try {
        const auto geometry=projectcodec::readWebGeometry(codecjson::parse(input));
        return projectcodec::webGeometryValue(wrapPolygonGeometry(geometry)).encode();
    } catch(const std::exception& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",std::string("PL-GEOMETRY-CALCULATION"));js.throw_();
    }
    std::terminate();
}
EMSCRIPTEN_BINDINGS(pando_polygon_calculation){
    emscripten::function("polygonOperation",&polygonOperation);
    emscripten::function("territorialValidationArea",&validationArea);
    emscripten::function("territorialAreaDecision",&territorialAreaForWeb);
    emscripten::function("territorialSampleIndices",&territorialSampleForWeb);
    emscripten::function("validateGisGeometry",&gisGeometry);
    emscripten::function("gisValidationArea",&gisArea);
    emscripten::class_<GisCandidatePort>("GisOverlapCandidates").constructor<val,val,bool>().function("next",&GisCandidatePort::next).function("isSignificant",&GisCandidatePort::isSignificant);
    emscripten::class_<TerritorialCandidatePort>("TerritorialOverlapCandidates").constructor<val,val,val,bool,val>().function("next",&TerritorialCandidatePort::next).function("components",&TerritorialCandidatePort::components).function("diagnostics",&TerritorialCandidatePort::diagnostics);
    emscripten::class_<TerritorialPolygonPort>("TerritorialPolygonIndex").constructor<val>().function("mayOverlap",&TerritorialPolygonPort::mayOverlap);
    emscripten::function("wrapPolygonGeometry",&wrapGeometry);
}
