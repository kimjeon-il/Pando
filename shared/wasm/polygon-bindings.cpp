#include <pandoeditor/polygonclipping.h>
#include <pandoeditor/polygonwrapping.h>
#include <pandoeditor/geometrypredicates.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/sphericalpolygon.h>
#include <pandoeditor/territorialmutation.h>
#include <pandoeditor/gisexchange.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <emscripten.h>
#include <cmath>
#include <stdexcept>

namespace {
using emscripten::val;
using emscripten::EM_VAL;
using namespace pandoeditor;
EM_JS(EM_VAL, packDisplayAreas, (EM_VAL handle), {
    const inputs=Emval.toValue(handle),shape=[inputs.length],points=[];
    for(const polygons of inputs){shape.push(polygons.length);
        for(const polygon of polygons){shape.push(polygon.length);
            for(const raw of polygon){const ring=raw===undefined?[]:raw;
                if(ring.length<3){shape.push(0,0);continue;}
                const last=ring.length-1,closed=ring[0][0]===ring[last][0]&&ring[0][1]===ring[last][1];
                shape.push(ring.length,closed?1:0);
                for(const point of ring)points.push(Number(point[0]||0),Number(point[1]||0));
            }
        }
    }
    return Emval.toHandle([new Uint32Array(shape),new Float64Array(points)]);
});
EM_JS(EM_VAL, packDisplayLines, (EM_VAL handle), {
    const inputs=Emval.toValue(handle),shape=[inputs.length],points=[];
    for(const line of inputs){shape.push(line.length);
        for(let i=0;i<line.length;i++){
            const point=line[i],valid=Array.isArray(point);
            shape.push(valid?1:0);
            if(valid&&(Array.isArray(line[i-1])||Array.isArray(line[i+1])))points.push(Number(point[0]||0),Number(point[1]||0));
            else points.push(0,0);
        }
    }
    return Emval.toHandle([new Uint32Array(shape),new Float64Array(points)]);
});
std::pair<std::vector<unsigned>,std::vector<double>> readDisplayPacked(val packed) {
    const auto shapeValue=packed[0],pointsValue=packed[1];
    std::vector<unsigned> shape(shapeValue["length"].as<unsigned>());
    std::vector<double> points(pointsValue["length"].as<unsigned>());
    if(!shape.empty())val(emscripten::typed_memory_view(shape.size(),shape.data())).call<void>("set",shapeValue);
    if(!points.empty())val(emscripten::typed_memory_view(points.size(),points.data())).call<void>("set",pointsValue);
    return {std::move(shape),std::move(points)};
}
val displayAreasForWeb(val input) {
    auto [shape,points]=readDisplayPacked(val::take_ownership(packDisplayAreas(input.as_handle())));
    std::size_t at=0,position=0;auto result=val::array();const auto count=shape.at(at++);
    for(unsigned index=0;index<count;++index){
        std::vector<std::vector<DisplayMetricRing>> polygons(shape.at(at++));
        for(auto& polygon:polygons){polygon.resize(shape.at(at++));for(auto& ring:polygon){
            const auto length=shape.at(at++);ring.closed=shape.at(at++);ring.points.resize(length);
            for(auto& point:ring.points){point={points.at(position),points.at(position+1)};position+=2;}
        }}
        result.set(index,displayGeometryAreaKm2(polygons));
    }
    return result;
}
val displayLinesForWeb(val input) {
    auto [shape,points]=readDisplayPacked(val::take_ownership(packDisplayLines(input.as_handle())));
    std::size_t at=0,position=0;auto result=val::array();const auto count=shape.at(at++);
    for(unsigned index=0;index<count;++index){
        std::vector<std::optional<Point>> line(shape.at(at++));
        for(auto& point:line){const auto valid=shape.at(at++);if(valid)point=Point{points.at(position),points.at(position+1)};position+=2;}
        result.set(index,displayLineDistanceKm(line));
    }
    return result;
}
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
std::string selectionParentKey(val value) {
    std::string result;const auto length=value["length"].as<unsigned>();result.reserve(length*2);
    for(unsigned i=0;i<length;++i){const auto unit=value.call<unsigned>("charCodeAt",i);result.push_back(char(unit&255));result.push_back(char(unit>>8));}
    return result;
}
val subunitSelectionForWeb(val kinds,val parents,val locks,val polygons,bool deferConnectivity) {
    const auto count=kinds["length"].as<unsigned>();
    if(parents["length"].as<unsigned>()!=count||locks["length"].as<unsigned>()!=count||polygons["length"].as<unsigned>()!=count)
        throw std::invalid_argument("Invalid subunit selection inputs");
    std::vector<Geometry> geometries(count);std::vector<SubunitSelectionItem> items;items.reserve(count);
    for(unsigned i=0;i<count;++i){auto parent=selectionParentKey(parents[i]);
        items.push_back({kinds[i].as<std::string>()=="general"&&!parent.empty(),locks[i].as<bool>(),std::move(parent),nullptr});}
    std::vector<std::size_t> sequence;
    auto status=inspectSubunitSelection(items,true);
    if(status==SubunitSelectionStatus::Valid&&!deferConnectivity){
        for(unsigned i=0;i<count;++i){geometries[i].type="MultiPolygon";geometries[i].polygons=readGisGeometry(polygons[i]);items[i].geometry=&geometries[i];}
        status=inspectSubunitSelection(items,false,true,&sequence);
    }
    const char* code=nullptr;
    switch(status){
    case SubunitSelectionStatus::Valid:code="valid";break;
    case SubunitSelectionStatus::InvalidSelection:code="invalid-selection";break;
    case SubunitSelectionStatus::DifferentParent:code="different-parent";break;
    case SubunitSelectionStatus::Locked:code="locked";break;
    case SubunitSelectionStatus::Disconnected:code="disconnected";break;
    }
    if(!code)throw std::invalid_argument("Invalid subunit selection status");
    auto result=val::object(),order=val::array();unsigned index=0;
    for(const auto row:sequence)order.set(index++,unsigned(row));
    result.set("status",std::string(code));result.set("order",order);return result;
}
bool territorialAdjacentForWeb(val left,val right) {
    Geometry a,b;a.type=b.type="MultiPolygon";a.polygons=readGisGeometry(left);b.polygons=readGisGeometry(right);
    return inspectSubunitSelection({{false,false,"",&b},{false,false,"",&a}},false,false)==SubunitSelectionStatus::Valid;
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
val gisTerritoryGeometryForWeb(val ids,val hasGeometry,val countryShapes,val featureShapes,val groups) {
    const auto countryCount=ids["length"].as<unsigned>(),featureCount=featureShapes["length"].as<unsigned>();
    if(hasGeometry["length"].as<unsigned>()!=countryCount||countryShapes["length"].as<unsigned>()!=countryCount)
        throw std::invalid_argument("INVALID_GIS_PLAN: country arrays");
    auto operands=val::array();unsigned position=0;
    for(unsigned i=0;i<countryCount;++i)operands.set(position++,countryShapes[i]);
    for(unsigned i=0;i<featureCount;++i)operands.set(position++,featureShapes[i]);
    auto shapes=readOperands(operands);std::vector<GisCountryShape> countries;countries.reserve(countryCount);
    for(unsigned i=0;i<countryCount;++i)countries.push_back({selectionParentKey(ids[i]),hasGeometry[i].as<bool>(),std::move(shapes[i])});
    std::vector<MultiPolygon> features;features.reserve(featureCount);
    for(unsigned i=0;i<featureCount;++i)features.push_back(std::move(shapes[countryCount+i]));
    std::vector<GisCountryAssignmentGroup> selected;const auto count=groups["length"].as<unsigned>();selected.reserve(count);
    for(unsigned i=0;i<count;++i){const auto row=groups[i],indexes=row["features"];GisCountryAssignmentGroup group;group.index=row["index"].as<int>();
        for(unsigned j=0;j<indexes["length"].as<unsigned>();++j)group.features.push_back(indexes[j].as<unsigned>());selected.push_back(std::move(group));}
    const auto plan=planGisTerritoryGeometry(countries,features,selected);
    auto result=val::object(),outputGroups=val::array(),absorbed=val::array();
    result.set("status",std::string(plan.status==GisTerritoryPlanStatus::Valid?"valid":
        plan.status==GisTerritoryPlanStatus::Overlap?"overlap":"missing-owner"));
    result.set("left",unsigned(plan.left));result.set("right",unsigned(plan.right));result.set("missing",unsigned(plan.missing));
    for(unsigned i=0;i<plan.groups.size();++i){const auto& group=plan.groups[i];auto row=val::object(),donors=val::array(),indices=val::array();
        row.set("index",unsigned(group.index));row.set("geometry",writeResult(group.geometry));row.set("importedArea",group.importedArea);
        row.set("existingArea",group.existingArea);row.set("newArea",group.newArea);
        for(unsigned j=0;j<group.features.size();++j)indices.set(j,unsigned(group.features[j]));
        for(unsigned j=0;j<group.donors.size();++j){auto donor=val::object();donor.set("index",unsigned(group.donors[j].index));
            donor.set("area",group.donors[j].area);donor.set("absorbed",group.donors[j].absorbed);donors.set(j,donor);}
        row.set("features",indices);row.set("donors",donors);outputGroups.set(i,row);
    }
    for(unsigned i=0;i<plan.absorbed.size();++i)absorbed.set(i,unsigned(plan.absorbed[i]));
    result.set("groups",outputGroups);result.set("absorbed",absorbed);result.set("totalArea",plan.totalArea);
    result.set("transferArea",plan.transferArea);result.set("existingArea",plan.existingArea);result.set("newArea",plan.newArea);return result;
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
    if(use=="containment")return territorialAreaDecision(area,TerritorialAreaUse::Containment);
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
    emscripten::function("subunitSelectionDecision",&subunitSelectionForWeb);
    emscripten::function("territorialGeometriesAdjacent",&territorialAdjacentForWeb);
    emscripten::function("planGisTerritoryGeometry",&gisTerritoryGeometryForWeb);
    emscripten::function("displayGeometryAreasKm2",&displayAreasForWeb);
    emscripten::function("displayLineDistancesKm",&displayLinesForWeb);
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
