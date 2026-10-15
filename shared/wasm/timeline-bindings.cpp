#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/timeline-resolver.h>
#include <pandoeditor/losslessjson.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <cmath>
#include <cstdint>
#include <exception>
#include <initializer_list>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

using emscripten::val;
using namespace pandoeditor;
namespace {
// A platform transport, not a second timeline implementation. The same
// TimelineRecords/TimelineValidationContext go to Qt and this WASM boundary.
[[noreturn]] void fail(const char* code,const char* detail) {throw TimelineError(code,detail);}
bool is(const val& value,const char* expected) {
    return value.typeOf().as<std::string>()==expected;
}
bool arrayValue(const val& value) {
    return val::global("Array").call<bool>("isArray",value);
}
void array(const val& value,const char* code) {
    if(!arrayValue(value))fail(code,"Expected an array.");
}
void shape(const val& value,std::initializer_list<const char*> fields,const char* code) {
    if(value.isNull()||!is(value,"object")||arrayValue(value))
        fail(code,"Expected an object.");
    auto keys=val::global("Object").call<val>("keys",value);
    if(keys["length"].as<unsigned>()!=fields.size())fail(code,"Unexpected or missing fields.");
    for(auto field:fields)
        if(!val::global("Object").call<bool>("hasOwn",value,std::string(field)))
            fail(code,"Missing field.");
}
std::string readText(const val& value,const char* code,bool permitEmpty=true) {
    if(!is(value,"string"))fail(code,"Expected a string.");
    // Retain exact UTF-16 text semantics, matching the existing Web codec.
    const auto result=codecjson::parse(val::global("JSON").call<val>(
        "stringify",value).as<std::string>()).string;
    if(!permitEmpty&&result.empty())fail(code,"Expected a nonempty string.");
    return result;
}
val webText(const std::string& source) {
    return val::global("JSON").call<val>("parse",codecjson::Value::str(source).encode());
}
std::optional<std::string> endpoint(const val& value) {
    if(value.isNull())return std::nullopt;
    return readText(value,"TIMELINE_INTERVAL");
}
val webEndpoint(const std::optional<std::string>& value) {
    return value?webText(*value):val::null();
}
std::uint32_t version(const val& value) {
    if(!is(value,"number"))fail("TIMELINE_GEOMETRY","Version must be an integer.");
    const auto number=value.as<double>();
    if(!std::isfinite(number)||std::floor(number)!=number||number<1||number>4294967295.)
        fail("TIMELINE_GEOMETRY","Invalid geometry version.");
    return static_cast<std::uint32_t>(number);
}
GeometryRef readRef(const val& value) {
    shape(value,{"id","version"},"TIMELINE_GEOMETRY");
    auto id=readText(value["id"],"TIMELINE_GEOMETRY",false);
    return {id,version(value["version"])};
}
val webRef(const GeometryRef& ref) {
    auto value=val::object();
    value.set("id",webText(ref.id));value.set("version",ref.version);
    return value;
}
Validity readValidity(const val& record) {
    return {endpoint(record["validFrom"]),endpoint(record["validTo"])};
}
val common(const std::string& id,const std::string& entityId,const Validity& validity) {
    auto output=val::object();
    output.set("id",webText(id));
    output.set("entityId",webText(entityId));
    output.set("validFrom",webEndpoint(validity.from));
    output.set("validTo",webEndpoint(validity.to));
    return output;
}
TimelineRecords readRecords(const val& input) {
    shape(input,{"schemaVersion","lifetimes","geometryBindings","parentRelations"},"TIMELINE_SCHEMA");
    const auto ver=input["schemaVersion"];
    if(!is(ver,"number")||ver.as<double>()!=1)fail("TIMELINE_SCHEMA","Unsupported timeline schema.");
    TimelineRecords records;
    const auto lifetimes=input["lifetimes"],bindings=input["geometryBindings"],parents=input["parentRelations"];
    array(lifetimes,"TIMELINE_SCHEMA");array(bindings,"TIMELINE_SCHEMA");array(parents,"TIMELINE_SCHEMA");
    const auto readCommon=[](const val& value)->std::pair<std::string,std::string>{
        return {readText(value["id"],"TIMELINE_ID",false),
                readText(value["entityId"],"TIMELINE_ID",false)};
    };
    for(unsigned i=0;i<lifetimes["length"].as<unsigned>();++i) {
        const auto row=lifetimes[i];
        shape(row,{"id","entityId","validFrom","validTo"},"TIMELINE_SCHEMA");
        const auto [id,entity]=readCommon(row);
        records.lifetimes.push_back({id,entity,readValidity(row)});
    }
    for(unsigned i=0;i<bindings["length"].as<unsigned>();++i) {
        const auto row=bindings[i];
        shape(row,{"id","entityId","validFrom","validTo","geometryRef"},"TIMELINE_SCHEMA");
        const auto [id,entity]=readCommon(row);
        records.geometryBindings.push_back({id,entity,readValidity(row),readRef(row["geometryRef"])});
    }
    for(unsigned i=0;i<parents["length"].as<unsigned>();++i) {
        const auto row=parents[i];
        shape(row,{"id","entityId","validFrom","validTo","parentId","coverageMode"},"TIMELINE_SCHEMA");
        const auto [id,entity]=readCommon(row);
        records.parentRelations.push_back({id,entity,readValidity(row),
            readText(row["parentId"],"TIMELINE_PARENT"),
            readText(row["coverageMode"],"TIMELINE_COVERAGE")});
    }
    return records;
}
val webRecords(const TimelineRecords& records) {
    auto result=val::object(),lifetimes=val::array(),bindings=val::array(),parents=val::array();
    result.set("schemaVersion",records.schemaVersion);
    unsigned index=0;
    for(const auto& row:records.lifetimes)
        lifetimes.set(index++,common(row.id,row.entityId,row.validity));
    index=0;
    for(const auto& row:records.geometryBindings) {
        auto value=common(row.id,row.entityId,row.validity);
        value.set("geometryRef",webRef(row.geometryRef));bindings.set(index++,value);
    }
    index=0;
    for(const auto& row:records.parentRelations) {
        auto value=common(row.id,row.entityId,row.validity);
        value.set("parentId",webText(row.parentId));
        value.set("coverageMode",webText(row.coverageMode));parents.set(index++,value);
    }
    result.set("lifetimes",lifetimes);result.set("geometryBindings",bindings);
    result.set("parentRelations",parents);return result;
}
TimelineValidationContext context(const val& value) {
    if(value.isNull()||!is(value,"object")||arrayValue(value)
        ||!arrayValue(value["entities"])||!is(value["geometryExists"],"function"))
        fail("TIMELINE_CONTEXT","Entity catalog and geometry repository are required.");
    TimelineValidationContext result;
    const auto entities=value["entities"];
    for(unsigned i=0;i<entities["length"].as<unsigned>();++i) {
        const auto identity=entities[i];
        if(identity.isNull()||!is(identity,"object")||arrayValue(identity))
            fail("TIMELINE_ENTITY","Expected an identity.");
        result.entities.push_back({readText(identity["id"],"TIMELINE_ID",false),
            readText(identity["entityKind"],"TIMELINE_KIND")});
    }
    const auto exists=value["geometryExists"];
    result.geometryExists=[exists](const GeometryRef& ref) {
        const val response=exists(webRef(ref));
        return is(response,"boolean")&&response.as<bool>();
    };
    return result;
}
val webWorld(const ResolvedWorld& world) {
    auto result=val::object(),entities=val::array();
    result.set("month",webText(world.month));
    unsigned index=0;
    for(const auto& row:world.entities) {
        auto value=val::object(),ancestors=val::array();
        value.set("id",webText(row.id));value.set("geometryRef",webRef(row.geometryRef));
        value.set("parentId",webText(row.parentId));value.set("coverageMode",webText(row.coverageMode));
        value.set("rootId",webText(row.rootId));
        value.set("validFrom",webEndpoint(row.validity.from));value.set("validTo",webEndpoint(row.validity.to));
        unsigned j=0;for(const auto& ancestor:row.ancestors)ancestors.set(j++,webText(ancestor));
        value.set("ancestors",ancestors);entities.set(index++,value);
    }
    result.set("entities",entities);return result;
}
template<typename F> auto boundary(F&& function)->decltype(function()) {
    try{return function();}
    catch(const TimelineError& error) {
        auto js=val::global("Error").new_(std::string(error.what()));
        js.set("code",error.code);js.throw_();
    }catch(const std::exception& error) {
        const std::string detail=error.what();
        auto js=val::global("Error").new_(detail);
        js.set("code",detail.rfind("INVALID_DATE:",0)==0?
            std::string("PL-TEMPORAL-001"):std::string("TIMELINE_CALC_ERROR"));
        js.throw_();
    }
    std::terminate();
}
// The same as-of-end rule is used by the Qt library catalog. Source/target
// validity are independent of the current document's timeline cursor.
Validity libraryValidity(const val& input) {
    if(input.isNull()||!is(input,"object")||arrayValue(input)
        ||!val::global("Object").call<bool>("hasOwn",input,std::string("validFrom"))
        ||!val::global("Object").call<bool>("hasOwn",input,std::string("validTo")))
        fail("PL-LIB-DATE","Both validity endpoints are required.");
    const auto endpointValue=[](val item)->std::optional<std::string> {
        if(item.isNull())return std::nullopt;
        return readText(item,"PL-LIB-DATE");
    };
    return {endpointValue(input["validFrom"]),endpointValue(input["validTo"])};
}
bool versionExistsAt(val lifetime,const std::string& referenceDate) {
    return boundary([&] {
        return validityContainsAtEnd(libraryValidity(lifetime),parseTemporal(referenceDate));
    });
}
int selectGeometryVersion(val lifetime,val versions,val referenceDate) {
    return boundary([&] {
        array(versions,"PL-LIB-GEOMETRY");
        std::vector<Validity> candidates;
        const auto count=versions["length"].as<unsigned>();
        candidates.reserve(count);
        for(unsigned i=0;i<count;++i)candidates.push_back(libraryValidity(versions[i]));
        std::optional<std::string> date;
        if(!referenceDate.isNull()&&!referenceDate.isUndefined())
            date=readText(referenceDate,"PL-LIB-DATE");
        const auto index=selectTimelineVersion(libraryValidity(lifetime),candidates,date);
        return index?static_cast<int>(*index):-1;
    });
}
val normalizeRecords(val input,val contextInput) {
    return boundary([&] {
        const auto records=readRecords(input);
        const auto ctx=context(contextInput);
        return webRecords(normalizeTimelineRecords(records,ctx));
    });
}
std::string initialMonth(val input,const std::string& currentMonth) {
    return boundary([&]{return initialTimelineMonth(readRecords(input),currentMonth);});
}
val resolvedWorld(val input,val contextInput,const std::string& month) {
    return boundary([&] {return webWorld(resolveWorld(readRecords(input),context(contextInput),month));});
}
val editRecord(val input,const std::string& collection,const std::string& entityId,
               const std::string& month,val patch) {
    return boundary([&] {
        const auto original=readRecords(input);
        if(patch.isNull()||!is(patch,"object")||arrayValue(patch))
            fail("TIMELINE_EDIT_PATCH","A patch object is required.");
        TimelineEditPatch changes;
        const auto keys=val::global("Object").call<val>("keys",patch);
        for(unsigned i=0;i<keys["length"].as<unsigned>();++i) {
            const auto key=keys[i].as<std::string>();
            if(collection=="geometryBindings"&&key=="geometryRef")changes.geometryRef=readRef(patch["geometryRef"]);
            else if(collection=="parentRelations"&&key=="parentId")
                changes.parentId=readText(patch["parentId"],"TIMELINE_PARENT");
            else if(collection=="parentRelations"&&key=="coverageMode")
                changes.coverageMode=readText(patch["coverageMode"],"TIMELINE_COVERAGE");
            else fail("TIMELINE_EDIT_PATCH","Unsupported timeline patch field.");
        }
        const auto outcome=editTimelineRecordAtMonth(original,collection,entityId,month,changes);
        auto output=val::object();
        output.set("changed",outcome.changed);
        output.set("records",outcome.changed?webRecords(outcome.records):val::null());
        return output;
    });
}
val truncateEntity(val input,const std::string& entityId,const std::string& month) {
    return boundary([&]{return webRecords(truncateTimelineEntityAtMonth(readRecords(input),entityId,month));});
}
}
EMSCRIPTEN_BINDINGS(pandoeditor_timeline_calculations) {
    emscripten::function("timelineNormalizeRecords",&normalizeRecords);
    emscripten::function("timelineInitialMonth",&initialMonth);
    emscripten::function("timelineResolveWorld",&resolvedWorld);
    emscripten::function("timelineEditRecord",&editRecord);
    emscripten::function("timelineTruncateEntity",&truncateEntity);
    emscripten::function("timelineVersionExistsAt",&versionExistsAt);
    emscripten::function("timelineSelectGeometryVersion",&selectGeometryVersion);
}
