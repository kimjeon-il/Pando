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
bool gisGeometry(val input) {
    const auto packed=val::take_ownership(packGisGeometry(input.as_handle()));
    const auto shapeValue=packed[0],pointsValue=packed[1];
    std::vector<unsigned> shape(shapeValue["length"].as<unsigned>());
    std::vector<double> points(pointsValue["length"].as<unsigned>());
    if(!shape.empty())val(emscripten::typed_memory_view(shape.size(),shape.data())).call<void>("set",shapeValue);
    if(!points.empty())val(emscripten::typed_memory_view(points.size(),points.data())).call<void>("set",pointsValue);
    std::size_t at=0,point=0;MultiPolygon polygons(shape.at(at++));
    for(auto& polygon:polygons){polygon.resize(shape.at(at++));for(auto& ring:polygon){ring.resize(shape.at(at++));for(auto& p:ring){p={points.at(point),points.at(point+1)};point+=2;}}}
    return validateGisGeometry(polygons);
}
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
    emscripten::function("validateGisGeometry",&gisGeometry);
    emscripten::function("wrapPolygonGeometry",&wrapGeometry);
}
