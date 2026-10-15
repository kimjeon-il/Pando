#include <pandoeditor/referenceimage.h>
#include <pandoeditor/referencetracing.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <stdexcept>
#include <cmath>
#include <algorithm>

namespace {
using emscripten::val;
using namespace pandoeditor;
template<class T> std::vector<T> readVector(const val& value) {
    if(value.isNull()||value.isUndefined())return {};
    const auto size=value["length"].as<unsigned>();
    if(size>67'108'864)throw std::invalid_argument("Reference image buffer is too large.");
    std::vector<T> out(size);
    if(size)val(emscripten::typed_memory_view(size,out.data())).call<void>("set",value);
    return out;
}
template<class T> val webVector(const std::vector<T>& value) {
    return val(emscripten::typed_memory_view(value.size(),value.data())).call<val>("slice");
}
double option(const val& value,const char* key,double fallback) {
    const auto entry=value[key];return entry.isUndefined()?fallback:val::global("Number")(entry).as<double>();
}
ReferencePoint readPoint(const val& value) {return {val::global("Number")(value[0]).as<double>(),val::global("Number")(value[1]).as<double>()};}
val webPoint(ReferencePoint point) {auto out=val::array();out.set(0,point[0]);out.set(1,point[1]);return out;}
std::vector<ReferencePoint> readPoints(const val& value) {std::vector<ReferencePoint> out;if(value.isNull()||value.isUndefined())return out;const auto size=value["length"].as<unsigned>();for(unsigned i=0;i<size;++i){const auto p=readPoint(value[i]);if(std::isfinite(p[0])&&std::isfinite(p[1]))out.push_back(p);}return out;}
val webPoints(const std::vector<ReferencePoint>& points) {auto out=val::array();unsigned i=0;for(auto p:points)out.set(i++,webPoint(p));return out;}
ReferenceGradientField readField(const val& value) {
    ReferenceGradientField f;
    if(value.isNull()||value.isUndefined())return f;
    f.width=int(option(value,"width",0));f.height=int(option(value,"height",0));
    f.sourceWidth=option(value,"sourceWidth",f.width);f.sourceHeight=option(value,"sourceHeight",f.height);
    f.scaleX=option(value,"scaleX",0);f.scaleY=option(value,"scaleY",0);
    f.peakEdgeStrength=option(value,"peakEdgeStrength",0);f.meanEdgeStrength=option(value,"meanEdgeStrength",0);
    f.gradient=readVector<float>(value["gradient"]);f.gradientX=readVector<float>(value["gradientX"]);f.gradientY=readVector<float>(value["gradientY"]);return f;
}
val gradientField(const val& image,const val& options) {
    const auto width=std::max(1,int(std::floor(option(image,"width",0)))),height=std::max(1,int(std::floor(option(image,"height",0))));
    const auto f=buildReferenceGradientField(width,height,readVector<std::uint8_t>(image["data"]),option(options,"sourceWidth",width),option(options,"sourceHeight",height));
    auto out=val::object();out.set("width",f.width);out.set("height",f.height);out.set("sourceWidth",f.sourceWidth);out.set("sourceHeight",f.sourceHeight);out.set("scaleX",f.scaleX);out.set("scaleY",f.scaleY);out.set("peakEdgeStrength",f.peakEdgeStrength);out.set("meanEdgeStrength",f.meanEdgeStrength);out.set("gradient",webVector(f.gradient));out.set("gradientX",webVector(f.gradientX));out.set("gradientY",webVector(f.gradientY));return out;
}
val snap(const val& field,const val& point,const val& options) {
    return webPoint(snapReferenceAnchor(readField(field),readPoint(point),option(options,"radius",8)));
}
val tree(const val& field,const val& anchor,const val& options) {
    ReferenceTraceOptions o;o.searchRadius=option(options,"searchRadius",256);o.snapRadius=option(options,"snapRadius",8);o.gradientWeight=option(options,"gradientWeight",.67);o.directionWeight=option(options,"directionWeight",.23);o.turnWeight=option(options,"turnWeight",.10);o.corridorWeight=option(options,"corridorWeight",.08);o.minimumPeakEdge=option(options,"minimumPeakEdge",.02);o.maxExpansions=option(options,"maxExpansions",650000);
    const auto target=options["target"];const auto result=buildReferenceTraceTree(readField(field),readPoint(anchor),target.isNull()||target.isUndefined()?std::nullopt:std::optional<ReferencePoint>(readPoint(target)),o);
    auto out=val::object();out.set("ok",result.ok);out.set("reason",result.reason);
    if(!result.ok){out.set("parents",val::null());return out;}
    out.set("field",field);out.set("anchor",webPoint(result.anchor));out.set("target",result.target?webPoint(*result.target):val::null());out.set("minX",result.minX);out.set("maxX",result.maxX);out.set("minY",result.minY);out.set("maxY",result.maxY);out.set("boxWidth",result.boxWidth);out.set("boxHeight",result.boxHeight);out.set("startIndex",result.startIndex);out.set("expansions",result.expansions);out.set("parents",webVector(result.parents));out.set("distances",webVector(result.distances));return out;
}
val webResult(const ReferenceTraceResult& result) {
    auto out=val::object();out.set("ok",result.ok);out.set("reason",result.reason);out.set("points",webPoints(result.points));out.set("meanEdgeStrength",result.meanEdgeStrength);return out;
}
val trace(const val& value,const val& target,const val& options) {
    ReferenceTraceTree t;t.ok=!value.isNull()&&!value.isUndefined()&&value["ok"].as<bool>();
    if(!t.ok){auto out=val::object();out.set("ok",false);out.set("reason",value.isNull()||value.isUndefined()?val("invalid-tree"):value["reason"]);out.set("points",val::array());return out;}
    t.minX=int(option(value,"minX",0));t.minY=int(option(value,"minY",0));t.maxX=int(option(value,"maxX",0));t.maxY=int(option(value,"maxY",0));t.boxWidth=int(option(value,"boxWidth",0));t.boxHeight=int(option(value,"boxHeight",0));t.startIndex=int(option(value,"startIndex",0));t.parents=readVector<int>(value["parents"]);t.distances=readVector<double>(value["distances"]);
    return webResult(traceReferencePath(readField(value["field"]),t,readPoint(target),option(options,"snapRadius",8),option(options,"minimumMeanEdge",.035)));
}
val simplify(const val& points,double tolerance){return webPoints(simplifyReferenceTrace(readPoints(points),tolerance));}
val refine(const val& options) {
    const auto result=refineReferenceTrace(readField(options["field"]),readPoints(options["roughPoints"]),option(options,"corridorRadius",12),option(options,"simplifyTolerance",1.5),option(options,"minimumPeakEdge",.02),option(options,"minimumMeanEdge",.06));
    auto out=webResult(result);if(result.ok){out.set("rawPointCount",result.rawPointCount);out.set("simplifiedPointCount",result.points.size());out.set("corridorRadius",result.corridorRadius);}return out;
}
std::string calculate(const std::string& operation,const std::string& input) {
    try {
        const auto value=pandoeditor::codecjson::parse(input);
        return pandoeditor::referenceImageOperation(operation,value).encode();
    } catch(const std::exception& error) {
        auto failure=val::global("Error").new_(std::string(error.what()));
        failure.set("code",std::string("PL-REFERENCE-CALCULATION"));failure.throw_();
    }
    std::terminate();
}
val calculatePlacement(const std::string& operation,const val& input,const val& project,const val& unproject) {
    ReferenceProjection host;
    host.project=[project](ReferencePoint point)->std::optional<ReferencePoint>{const auto value=project(webPoint(point));return value.isNull()||value.isUndefined()?std::nullopt:std::optional<ReferencePoint>(readPoint(value));};
    host.unproject=[unproject](ReferencePoint point)->std::optional<ReferencePoint>{const auto value=unproject(webPoint(point));return value.isNull()||value.isUndefined()?std::nullopt:std::optional<ReferencePoint>(readPoint(value));};
    const auto json=val::global("JSON");
    const auto value=codecjson::parse(json.call<val>("stringify",input).as<std::string>());
    return json.call<val>("parse",referenceImageOperation(operation,value,host).encode());
}
}
EMSCRIPTEN_BINDINGS(pando_reference_image) {
    emscripten::function("referenceImageCalculate",&calculate);
    emscripten::function("referenceImagePlacement",&calculatePlacement);
    emscripten::function("referenceGradientField",&gradientField);
    emscripten::function("referenceSnapAnchor",&snap);
    emscripten::function("referenceTraceTree",&tree);
    emscripten::function("referenceTracePath",&trace);
    emscripten::function("referenceSimplifyTrace",&simplify);
    emscripten::function("referenceRefineTrace",&refine);
}
