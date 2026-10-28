#include <pandoeditor/document-session.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/sphericalpolygon.h>
#include <pandoeditor/geometrypredicates.h>
#include <pandoeditor/temporal.h>
#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/webcommands.h>
#include <pandoeditor/webcontentcommands.h>
#include <pandoeditor/webpresentationcommands.h>
#include <pandoeditor/webterritorialcommands.h>
#include <pandoeditor/webobjectcommands.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <emscripten.h>
#include <emscripten/version.h>
#include <cmath>
#include <initializer_list>
#include <algorithm>

using emscripten::val;
using namespace pandoeditor;
namespace {
[[noreturn]] void fail(const std::string& code,const std::string& detail) { throw TimelineError(code,detail); }
bool type(const val& value,const char* expected) { return value.typeOf().as<std::string>()==expected; }
void array(const val& value,const char* code) {
    if(!val::global("Array").call<bool>("isArray",value))fail(code,"An array is required.");
}
void shape(const val& value,std::initializer_list<const char*> fields,const char* code="TIMELINE_SCHEMA") {
    if(value.isNull()||!type(value,"object")||val::global("Array").call<bool>("isArray",value))
        fail(code,"An object is required.");
    const auto keys=val::global("Object").call<val>("keys",value);
    if(keys["length"].as<unsigned>()!=fields.size())fail(code,"Unexpected or missing fields.");
    for(const auto* field:fields)
        if(!val::global("Object").call<bool>("hasOwn",value,std::string(field)))fail(code,"Missing field.");
}
std::string text(const val& value,const char* code,bool empty=false) {
    if(!type(value,"string"))fail(code,"A string is required.");
    // Emscripten's direct UTF-8 string conversion merges lone UTF-16 units.
    // JSON.stringify escapes those units, and the shared Web parser preserves
    // their exact interpreted value for names and annotations.
    const auto result=codecjson::parse(val::global("JSON").call<val>("stringify",value).as<std::string>()).string;
    if(!empty&&result.empty())fail(code,"A nonempty string is required.");
    return result;
}
val webString(const std::string& value) {return val::global("JSON").call<val>("parse",codecjson::Value::str(value).encode());}
val optional(const std::optional<std::string>& value) { return value?webString(*value):val::null(); }
val geometry(const GeometryRef& ref) { auto value=val::object();value.set("id",webString(ref.id));value.set("version",ref.version);return value; }
val object(const ObjectRef& ref) { auto value=val::object();value.set("domain",webString(ref.domain));value.set("id",webString(ref.id));return value; }
val world(const ResolvedWorld& result) {
    auto value=val::object(),entities=val::array();value.set("month",result.month);
    unsigned i=0;for(const auto& row:result.entities) {
        auto v=val::object();v.set("objectRef",object(row.objectRef));v.set("geometryRef",geometry(row.geometryRef));v.set("rendering",val::global("JSON").call<val>("parse",row.rendering));
        v.set("parentId",webString(row.parentId));v.set("coverageMode",webString(row.coverageMode));v.set("rootId",webString(row.rootId));
        v.set("validFrom",optional(row.validity.from));v.set("validTo",optional(row.validity.to));
        auto ancestors=val::array();unsigned j=0;for(const auto& id:row.ancestors)ancestors.set(j++,webString(id));
        auto properties=val::object();for(const auto& [name,json]:row.properties)properties.set(name,val::global("JSON").call<val>("parse",json));
        v.set("properties",properties);v.set("ancestors",ancestors);entities.set(i++,v);
    }
    value.set("entities",entities);return value;
}
template<class Function> auto boundary(Function function)->decltype(function()) {
    try { return function(); }
    catch(const TimelineError& error) {
        auto value=val::global("Error").new_(std::string(error.what()));value.set("code",error.code);value.throw_();
    } catch(const std::exception& error) {
        const std::string message=error.what();
        if(message.rfind("URI_MALFORMED:",0)==0)val::global("URIError").new_(std::string("URI malformed")).throw_();
        auto value=val::global("Error").new_(message);
        auto code=message.substr(0,message.find(':'));
        if(code.empty()||!std::all_of(code.begin(),code.end(),[](char ch){return (ch>='A'&&ch<='Z')||(ch>='0'&&ch<='9')||ch=='_'||ch=='-';}))code="CORE_SESSION_ERROR";
        if(message.rfind("INVALID_DATE:",0)==0)code="PL-TEMPORAL-001";
        value.set("code",code);value.throw_();
    }
    std::terminate();
}
std::u16string referenceUtf16(const val& input) {
    if(!type(input,"string"))fail("INVALID_REFERENCE_GRAPH","Reference IDs must be strings.");
    std::u16string result;const auto length=input["length"].as<unsigned>();result.reserve(length);
    for(unsigned i=0;i<length;++i)result.push_back(static_cast<char16_t>(input.call<unsigned>("charCodeAt",i)));
    return result;
}
val referenceWebString(const std::u16string& input) {
    auto chunks=val::array();unsigned part=0;
    for(std::size_t start=0;start<input.size();start+=8192) {
        auto units=val::array();unsigned index=0;
        for(std::size_t i=start;i<std::min(input.size(),start+8192);++i)units.set(index++,unsigned(input[i]));
        chunks.set(part++,val::global("String")["fromCharCode"].call<val>("apply",val::null(),units));
    }
    return chunks.call<val>("join",std::string(""));
}
TerritorialRootNode<std::u16string> rootNodeForWeb(const val& feature) {
    const auto properties=feature["properties"],rawId=feature["id"],rawParent=properties["parentId"],kind=properties["entityKind"];
    const auto string=val::global("String"),boolean=val::global("Boolean");
    const auto identifier=rawId.isNull()||rawId.isUndefined()?val(std::string("")):string(rawId);
    const auto parent=boolean(rawParent).as<bool>()?string(rawParent):val(std::string(""));
    const bool isString=type(kind,"string");
    return {referenceUtf16(identifier),referenceUtf16(parent),isString&&kind.as<std::string>()=="regional",
        isString&&kind.as<std::string>()=="general"};
}
val territorialRootForWeb(const val& feature,const val& lookup) {
    return boundary([&] {
        if(!type(lookup,"function"))fail("INVALID_REFERENCE_GRAPH","A territorial lookup is required.");
        const auto result=inspectTerritorialRoot(rootNodeForWeb(feature),[&](const std::u16string& id)->std::optional<TerritorialRootNode<std::u16string>>{
            const auto parent=lookup(referenceWebString(id));
            if(!val::global("Boolean")(parent).as<bool>())return std::nullopt;
            return rootNodeForWeb(parent);
        });
        const char* status=nullptr;
        switch(result.status){
        case TerritorialRootStatus::Valid:status="valid";break;
        case TerritorialRootStatus::RegionalParent:status="regional-parent";break;
        case TerritorialRootStatus::Cycle:status="cycle";break;
        case TerritorialRootStatus::MissingParent:
        case TerritorialRootStatus::WrongParentKind:status="invalid-parent";break;
        }
        auto value=val::object();value.set("status",std::string(status));value.set("rootId",referenceWebString(result.root));return value;
    });
}
val referenceGraphForWeb(const val& ids,const val& parents) {
    return boundary([&] {
        array(ids,"INVALID_REFERENCE_GRAPH");array(parents,"INVALID_REFERENCE_GRAPH");
        const auto length=ids["length"].as<unsigned>();
        if(parents["length"].as<unsigned>()!=length)fail("INVALID_REFERENCE_GRAPH","Reference arrays must have equal length.");
        std::vector<std::u16string> values;values.reserve(length);
        std::map<std::u16string,std::optional<std::u16string>> graph;
        for(unsigned i=0;i<length;++i){auto id=referenceUtf16(ids[i]),parent=referenceUtf16(parents[i]);
            values.push_back(id);graph[id]=parent.empty()?std::nullopt:std::optional<std::u16string>(std::move(parent));}
        std::set<std::u16string> seen;auto output=val::array();
        for(unsigned i=0;i<length;++i){const auto& id=values[i];auto row=val::object();
            const auto status=id.empty()?"empty":seen.insert(id).second?"ok":"duplicate";
            const auto chain=inspectReferenceChain(graph,id);
            row.set("idStatus",std::string(status));row.set("cycle",chain==ReferenceChainStatus::Cycle);
            row.set("missing",chain==ReferenceChainStatus::Missing);output.set(i,row);
        }
        return output;
    });
}
val distributionReferencesForWeb(const val& layerIds,const val& territoryIds,const val& layers,
    const val& modes,const val& territories,const val& values) {
    return boundary([&] {
        for(const auto& v:{layerIds,territoryIds,layers,modes,territories,values})array(v,"INVALID_REFERENCE_GRAPH");
        const auto length=layers["length"].as<unsigned>();
        if(modes["length"].as<unsigned>()!=length||territories["length"].as<unsigned>()!=length||
            values["length"].as<unsigned>()!=length)fail("INVALID_REFERENCE_GRAPH","Reference arrays must have equal length.");
        std::set<std::u16string> knownLayers,knownTerritories;
        for(unsigned i=0;i<layerIds["length"].as<unsigned>();++i)knownLayers.insert(referenceUtf16(layerIds[i]));
        for(unsigned i=0;i<territoryIds["length"].as<unsigned>();++i)knownTerritories.insert(referenceUtf16(territoryIds[i]));
        auto output=val::array();
        for(unsigned i=0;i<length;++i){
            const auto layer=referenceUtf16(layers[i]),modeName=referenceUtf16(modes[i]),territory=referenceUtf16(territories[i]);
            const auto mode=modeName==u"territorial"?DistributionReferenceMode::Territorial:
                modeName==u"geometry"?DistributionReferenceMode::Geometry:DistributionReferenceMode::Invalid;
            const bool finite=type(values[i],"number")&&std::isfinite(values[i].as<double>());
            const auto status=inspectDistributionReference(knownLayers.count(layer),mode,finite,knownTerritories.count(territory));
            auto row=val::object();row.set("missingLayer",status.missingLayer);row.set("invalidMode",status.invalidMode);
            row.set("invalidValue",status.invalidValue);row.set("missingTerritory",status.missingTerritory);output.set(i,row);
        }
        return output;
    });
}
EM_JS(emscripten::EM_VAL, packTerritorialRing, (emscripten::EM_VAL handle), {
    const ring=Emval.toValue(handle), points=new Float64Array(ring.length*2);
    for(let i=0;i<ring.length;++i){if(ring.length<4&&!Array.isArray(ring[i]))continue;points[i*2]=Number(ring[i][0]);points[i*2+1]=Number(ring[i][1]);}
    return Emval.toHandle(points);
});
val territorialRingValidationForWeb(const val& input) {
    return boundary([&] {
        array(input,"INVALID_GEOMETRY");
        const auto count=input["length"].as<unsigned>();
        const auto packed=val::take_ownership(packTerritorialRing(input.as_handle()));
        std::vector<double> points(count*2);
        if(!points.empty())val(emscripten::typed_memory_view(points.size(),points.data())).call<void>("set",packed);
        Ring ring;ring.reserve(count);
        for(unsigned i=0;i<count;++i)ring.push_back({points[i*2],points[i*2+1]});
        auto output=val::array();unsigned index=0;
        for(const auto& issue:validateTerritorialRing(ring)){
            auto row=val::object();row.set("kind",issue.kind);
            if(issue.coordinateIndex)row.set("coordinate",input[static_cast<unsigned>(*issue.coordinateIndex)]);
            else if(issue.kind=="self-intersection") {auto coordinate=val::array();coordinate.set(0,issue.coordinate.x);coordinate.set(1,issue.coordinate.y);row.set("coordinate",coordinate);}
            if(issue.vertexIndex)row.set("vertexIndex",static_cast<unsigned>(*issue.vertexIndex));
            if(issue.segmentIndex)row.set("segmentIndex",static_cast<unsigned>(*issue.segmentIndex));
            output.set(index++,row);
        }
        return output;
    });
}
val polygonGeometry(const val& input,bool clipped) {
    return boundary([&] {
        const auto encoded=val::global("JSON").call<val>("stringify",input).as<std::string>();
        const auto source=projectcodec::readWebGeometry(codecjson::parse(encoded));
        const auto result=clipped?normalizeClippedSphericalPolygonGeometry(source)
                                 :normalizeSphericalPolygonGeometry(source);
        return val::global("JSON").call<val>("parse",projectcodec::webGeometryValue(result).encode());
    });
}
val polygonRing(const val& input,bool shell) {
    return boundary([&] {
        auto source=val::object();source.set("type",std::string("Polygon"));
        auto coordinates=val::array();coordinates.set(0,input);source.set("coordinates",coordinates);
        const auto encoded=val::global("JSON").call<val>("stringify",source).as<std::string>();
        const auto parsed=projectcodec::readWebGeometry(codecjson::parse(encoded));
        Geometry output;output.type="Polygon";
        output.polygons.push_back({normalizeSphericalRing(parsed.polygons.at(0).at(0),shell)});
        return val::global("JSON").call<val>("parse",projectcodec::webGeometryValue(output).encode())["coordinates"][0];
    });
}
// P5-3: Web receives immutable plain-date values, while all calendar/interval
// arithmetic stays in the same C++ core that Qt links. No JavaScript calendar kernel.
val temporalKeyForWeb(const TemporalKey& key) {
    auto output=val::array();
    output.set(0,key.year);output.set(1,key.month);output.set(2,key.day);
    return output;
}
val temporalValueForWeb(const TemporalValue& input) {
    auto output=val::object();
    output.set("source",webString(input.text));
    output.set("canonical",webString(input.canonical));
    output.set("precision",webString(input.precision));
    output.set("year",input.year);
    output.set("month",input.month?val(*input.month):val::null());
    output.set("day",input.day?val(*input.day):val::null());
    output.set("startKey",temporalKeyForWeb(input.startKey));
    output.set("endKey",temporalKeyForWeb(input.endKey));
    return output;
}
std::optional<std::string> temporalEndpointForWeb(const val& value) {
    return value.isNull()||value.isUndefined()?std::nullopt:std::optional<std::string>(text(value,"PL-TEMPORAL-001",true));
}
val temporalParseForWeb(const std::string& input) {
    return boundary([&]{return temporalValueForWeb(parseTemporal(input));});
}
val temporalMonthEndForWeb(const std::string& input) {
    return boundary([&]{return temporalValueForWeb(temporalMonthEnd(input));});
}
int temporalCompareForWeb(const std::string& left,const std::string& right,bool leftEnd,bool rightEnd) {
    return boundary([&]{return compareTemporal(parseTemporal(left),parseTemporal(right),
        leftEnd?TemporalBoundary::End:TemporalBoundary::Start,
        rightEnd?TemporalBoundary::End:TemporalBoundary::Start);});
}
val temporalNormalizeIntervalForWeb(val from,val to) {
    return boundary([&] {
        TemporalInterval interval;
        try {interval=normalizeTemporalInterval(temporalEndpointForWeb(from),temporalEndpointForWeb(to));}
        catch(const std::invalid_argument& error) {
            if(std::string(error.what())=="INVALID_DATE: reversed interval")
                fail("PL-TEMPORAL-INTERVAL","유효기간 시작은 종료보다 늦을 수 없습니다.");
            throw;
        }
        auto result=val::object();
        result.set("validFrom",optional(interval.validFrom));
        result.set("validTo",optional(interval.validTo));
        return result;
    });
}
bool temporalContainsForWeb(val from,val to,const std::string& point) {
    return boundary([&]{return temporalContains(
        normalizeTemporalInterval(temporalEndpointForWeb(from),temporalEndpointForWeb(to)),parseTemporal(point));});
}
bool temporalIntervalsOverlapForWeb(val fromA,val toA,val fromB,val toB) {
    return boundary([&] {return temporalIntervalsOverlap(
        normalizeTemporalInterval(temporalEndpointForWeb(fromA),temporalEndpointForWeb(toA)),
        normalizeTemporalInterval(temporalEndpointForWeb(fromB),temporalEndpointForWeb(toB)));});
}
std::string temporalShiftMonthForWeb(const std::string& month,int delta) {
    return boundary([&]{return shiftTemporalMonth(month,delta);});
}
int integer(const val& value,const char* code); // Shared strict JS-number validator below.
TemporalKey temporalKeyFromWeb(const val& input) {
    array(input,"PL-TEMPORAL-001");
    if(input["length"].as<unsigned>()!=3)fail("PL-TEMPORAL-001","A year/month/day tuple is required.");
    return {integer(input[0],"PL-TEMPORAL-001"),integer(input[1],"PL-TEMPORAL-001"),
        integer(input[2],"PL-TEMPORAL-001")};
}
int temporalCompareKeysForWeb(val a,val b) {
    return boundary([&] {
        const auto left=temporalKeyFromWeb(a),right=temporalKeyFromWeb(b);
        return left==right?0:left<right?-1:1;
    });
}
val temporalFollowingDayForWeb(val date) {
    return boundary([&]{return temporalKeyForWeb(temporalFollowingDay(temporalKeyFromWeb(date)));});
}
// P5-1: source of truth is sphericalRingSignedArea in shared/core.
// Keep this Web boundary read-only; later migration can remove the separate
// browser JavaScript integral after fixture parity is established.
Ring checkedSphericalRing(const val& input) {
    array(input,"INVALID_POLYGON_RING");
    const auto length=input["length"].as<unsigned>();
    if(length<4||length>2'000'000)
        fail("INVALID_POLYGON_RING","Expected 4..2,000,000 coordinates.");
    Ring ring;ring.reserve(length);
    for(unsigned index=0;index<length;++index) {
        const val coordinate=input[index];
        array(coordinate,"INVALID_POLYGON_COORDINATE");
        if(coordinate["length"].as<unsigned>()!=2||!type(coordinate[0],"number")
           ||!type(coordinate[1],"number"))
            fail("INVALID_POLYGON_COORDINATE","Expected a numeric longitude/latitude pair.");
        const double longitude=coordinate[0].as<double>();
        const double latitude=coordinate[1].as<double>();
        if(!std::isfinite(longitude)||!std::isfinite(latitude)||std::abs(latitude)>90)
            fail("INVALID_POLYGON_COORDINATE","Expected finite geographic coordinates.");
        ring.push_back({longitude,latitude});
    }
    if(ring.front().x!=ring.back().x||ring.front().y!=ring.back().y)
        fail("INVALID_POLYGON_RING","Ring must be closed.");
    return ring;
}
double sphericalRingAreaForWeb(const val& input) {
    return boundary([&]{return sphericalRingSignedArea(checkedSphericalRing(input));});
}
val sphericalRingAreasForWeb(const val& inputs) {
    return boundary([&] {
        array(inputs,"INVALID_POLYGON_RING");
        const auto count=inputs["length"].as<unsigned>();
        if(count>16'384)fail("INVALID_POLYGON_RING","Batch exceeds 16,384 rings.");
        auto values=val::array();
        for(unsigned index=0;index<count;++index)
            values.set(index,sphericalRingSignedArea(checkedSphericalRing(inputs[index])));
        return values;
    });
}
bool canonicalPolygonGeometry(const val& input) {
    try {
        const auto encoded=val::global("JSON").call<val>("stringify",input).as<std::string>();
        return hasCanonicalSphericalWinding(projectcodec::readWebGeometry(codecjson::parse(encoded)));
    }catch(...) {return false;}
}
val documentState(const DocumentSessionState& state) {
    auto value=val::object();value.set("epoch",state.epoch);value.set("stateRevision",state.stateRevision);
    value.set("revision",static_cast<double>(state.revision));value.set("checkpoint",static_cast<double>(state.checkpoint));
    value.set("undoCommandId",state.undoCommandId);value.set("redoCommandId",state.redoCommandId);
    value.set("dirty",state.dirty);value.set("canUndo",state.canUndo);value.set("canRedo",state.canRedo);
    value.set("timelineCursor",state.timelineCursor);
    value.set("presentationRevision",static_cast<double>(state.presentationRevision));
    value.set("presentationCheckpoint",static_cast<double>(state.presentationCheckpoint));
    auto dirtyIds=val::array();unsigned dirtyIndex=0;for(const auto& id:state.dirtyTerritorialIds)dirtyIds.set(dirtyIndex++,webString(id));value.set("dirtyTerritorialIds",dirtyIds);
    value.set("documentDirty",state.documentDirty);value.set("presentationDirty",state.presentationDirty);value.set("timelineEditsEnabled",state.timelineEditsEnabled);value.set("storageBaselineId",state.storageBaselineId);return value;
}
val selectionValue(const SelectionRef& ref) {
    auto value=val::object();value.set("domain",webString(ref.domain));value.set("type",webString(ref.type));value.set("id",webString(ref.id));return value;
}
val selectionSnapshot(const SelectionState& selection) {
    auto value=val::object(),items=val::array();unsigned i=0;
    for(const auto& ref:selection.items())items.set(i++,selectionValue(ref));
    value.set("selectionRevision",static_cast<double>(selection.revision()));
    value.set("hoverRevision",static_cast<double>(selection.hoverRevision()));value.set("items",items);
    value.set("primary",selection.primary()?selectionValue(*selection.primary()):val::null());
    value.set("hover",selection.hover()?selectionValue(*selection.hover()):val::null());return value;
}
SelectionRef selectionRef(const val& value) {
    if(value.isNull()||value.isUndefined()||!type(value,"object"))return {};
    const auto field=[&](const char* key){return type(value[key],"string")?trimWebText(text(value[key],"CORE_SELECTION_REF",true)):std::string{};};
    SelectionRef ref{field("domain"),field("type"),field("id")};
    if(!ref.domain.empty()&&!ref.type.empty()&&!ref.id.empty())(void)selectionRefKey(ref);
    return ref;
}
std::vector<SelectionRef> selectionRefs(const val& value) {
    array(value,"CORE_SELECTION_REF");std::vector<SelectionRef> result;
    for(unsigned i=0;i<value["length"].as<unsigned>();++i)result.push_back(selectionRef(value[i]));return result;
}
val commandOutcome(const DocumentSessionOutcome& outcome,const DocumentSession& session) {
    auto value=val::object();value.set("ok",outcome.result.ok());
    value.set("changed",outcome.result.changed()||outcome.candidateId!=0);
    value.set("candidateId",outcome.candidateId);value.set("state",documentState(session.projectState()));
    value.set("selection",selectionSnapshot(session.selection()));
    const char* status=outcome.result.status==CommandStatus::Prepared?"prepared":outcome.result.status==CommandStatus::Applied?"applied"
        :outcome.result.status==CommandStatus::NoOp?"noop":"rejected";
    value.set("status",std::string(status));
    if(!outcome.result.ok()) {
        auto error=val::object();error.set("code",outcome.domainErrorCode.empty()?std::string(commandErrorCode(outcome.result.error)):outcome.domainErrorCode);
        error.set("message",outcome.result.detail);value.set("error",error);
    }else value.set("error",val::null());
    if(!outcome.delta.empty()) {
        auto delta=val::global("JSON").call<val>("parse",outcome.delta);const auto presentation=delta["presentation"];
        if(!presentation.isNull()&&!presentation.isUndefined()) {
            auto settings=presentation["labelSettings"];
            for(const auto& [ref,setting]:session.project().document().presentation.webPresentation.labelSettings)
                if(setting.maxZoom&&*setting.maxZoom==INFINITY) {
                    const auto key=webString(ref.domain+":"+ref.id);
                    if(val::global("Object").call<bool>("hasOwn",settings,key)) {
                        auto row=settings[key];row.set("maxZoom",INFINITY);settings.set(key,row);
                    }
                }
        }
        value.set("delta",delta);
    }
    return value;
}
projectcodec::PlatformPorts documentPorts(const val& options) {
    if(options.isNull()||!type(options,"object")||!type(options["validateFlagDataUrl"],"function"))
        fail("CODEC_PLATFORM_REQUIRED","A synchronous flag validator is required.");
    const auto validator=options["validateFlagDataUrl"];
    return {[validator](const std::string& url) {
        const auto result=validator(webString(url));
        if(!result.isUndefined()&&!result.isNull()&&type(result,"object")&&type(result["then"],"function"))
            fail("CODEC_PLATFORM_ASYNC","The flag validator must finish before preparing a candidate.");
        if(type(result,"boolean")&&!result.as<bool>())fail("INVALID_FLAG","The platform rejected the flag.");
    },true,codecjson::ParsedTextPolicy::PreserveUtf16};
}
std::vector<ObjectRef> commandTargets(const val& input) {
    const auto rows=input["targets"];array(rows,"CORE_COMMAND_TARGETS");std::vector<ObjectRef> result;
    for(unsigned i=0;i<rows["length"].as<unsigned>();++i) {
        const auto value=rows[i];shape(value,{"domain","id"},"CORE_COMMAND_TARGETS");
        result.push_back({text(value["domain"],"CORE_COMMAND_TARGETS"),text(value["id"],"CORE_COMMAND_TARGETS")});
    }
    return result;
}
std::uint32_t commandEpoch(const val& input) {
    const auto value=input["expectedEpoch"];
    if(!type(value,"number"))fail("CORE_COMMAND_EPOCH","An integer epoch is required.");
    const auto epoch=value.as<double>();
    if(!std::isfinite(epoch)||std::floor(epoch)!=epoch||epoch<0||epoch>4294967295.0)fail("CORE_COMMAND_EPOCH","Invalid epoch.");
    return static_cast<std::uint32_t>(epoch);
}
int integer(const val& value,const char* code) {
    if(!type(value,"number"))fail(code,"An integer is required.");const auto number=value.as<double>();
    if(!std::isfinite(number)||std::floor(number)!=number||number<-2147483648.0||number>2147483647.0)
        fail(code,"Invalid integer.");return static_cast<int>(number);
}
Point draftPoint(const val& value) {
    array(value,"CORE_DRAFT_COORDINATE");if(value["length"].as<unsigned>()!=2)fail("CORE_DRAFT_COORDINATE","A coordinate pair is required.");
    if(!type(value[0],"number")||!type(value[1],"number"))fail("CORE_DRAFT_COORDINATE","Numeric coordinates are required.");
    const Point point{value[0].as<double>(),value[1].as<double>()};
    if(!std::isfinite(point.x)||!std::isfinite(point.y))fail("CORE_DRAFT_COORDINATE","Finite coordinates are required.");return point;
}
Ring draftCoordinates(const val& value) {
    array(value,"CORE_DRAFT_COORDINATE");Ring result;result.reserve(value["length"].as<unsigned>());
    for(unsigned i=0;i<value["length"].as<unsigned>();++i)result.push_back(draftPoint(value[i]));return result;
}
val coordinateValue(Point point) {auto value=val::array();value.set(0,point.x);value.set(1,point.y);return value;}
val draftValue(const DocumentSession& session) {
    const auto& draft=session.draft();auto value=val::object(),coordinates=val::array();unsigned index=0;
    for(const auto point:draft.coordinates())coordinates.set(index++,coordinateValue(point));
    value.set("active",session.draftActive());value.set("shape",draft.geometry().type=="Polygon"?"polygon":"line");
    value.set("coords",coordinates);value.set("selectedVertexIndex",draft.selectedVertexIndex()<0?val::null():val(draft.selectedVertexIndex()));
    value.set("inputPhase",draft.inputPhase());value.set("insertMode",draft.vertexInsertMode());
    auto target=val::null();if(draft.insertTarget()){target=val::object();target.set("segmentIndex",draft.insertTarget()->segmentIndex);target.set("coordinate",coordinateValue(draft.insertTarget()->coordinate));}
    value.set("insertTarget",target);value.set("dragging",draft.dragging());value.set("historyCount",static_cast<double>(draft.historyCount()));
    value.set("futureCount",static_cast<double>(draft.futureCount()));value.set("revision",static_cast<double>(draft.revision()));return value;
}
CommandArguments typedArguments(const std::string& id,const val& payload) {
    CommandArguments args;
    if(id=="territorial.field") {
        shape(payload,{"id","field","value"},"CORE_COMMAND_PAYLOAD");
        const auto name=text(payload["field"],"CORE_COMMAND_PAYLOAD");TerritorialField field;
        if(name=="name")field=TerritorialField::Name;else if(name=="notes")field=TerritorialField::Notes;
        else if(name=="validFrom")field=TerritorialField::ValidFrom;else if(name=="validTo")field=TerritorialField::ValidTo;
        else fail("CORE_COMMAND_FIELD","Unsupported territorial field.");
        args.action=TerritorialFieldEdit{territorialRef(text(payload["id"],"CORE_COMMAND_PAYLOAD")),field,
            payload["value"].isNull()?"":text(payload["value"],"CORE_COMMAND_PAYLOAD",true)};
    }else fail("CORE_COMMAND_UNSUPPORTED","Command transport has not been mapped: "+id);
    return args;
}
CommandRequest typedRequest(const ProjectSnapshot& candidate,const val& input,const projectcodec::PlatformPorts& ports) {
    const auto id=text(input["commandId"],"CORE_COMMAND_ID");const auto targets=commandTargets(input);
    if(id=="document.source-info") {
        if(!targets.empty())fail("CORE_COMMAND_TARGETS","Source metadata has no object targets.");
        const auto payload=input["payload"],next=payload["next"];CommandArguments args;
        args.action=DocumentSourceInfoAppend{next.isUndefined()?std::string("null"):val::global("JSON").call<val>("stringify",next).as<std::string>(),text(payload["mergedAt"],"CORE_SOURCE_INFO")};
        return {id,candidate.instanceId(),candidate.document().documentId,candidate.revision(),{},std::move(args)};
    }
    if(id=="objects.remove") {
        const auto payload=codecjson::parse(val::global("JSON").call<val>("stringify",input["payload"]).as<std::string>());
        auto request=readWebObjectRemoval(candidate,payload);
        std::set<ObjectRef> declared(targets.begin(),targets.end()),expected(request.targets.begin(),request.targets.end());
        if(declared!=expected)fail("CORE_COMMAND_TARGETS","Removal targets must match their typed identities.");
        return request;
    }
    if(id=="territorial.metadata") {
        const auto payload=input["payload"];const auto entity=text(payload["id"],"CORE_COMMAND_PAYLOAD");
        if(targets!=std::vector<ObjectRef>{territorialRef(trimWebText(entity))})fail("CORE_COMMAND_TARGETS","Metadata target must match its entity ID.");
        auto decoded=codecjson::parse(val::global("JSON").call<val>("stringify",payload).as<std::string>());
        if(!decoded.object.count("value"))decoded.object["value"]=codecjson::Value{};
        const auto field=text(payload["field"],"CORE_COMMAND_PAYLOAD");
        if(field=="name"||field=="notes"||field=="capital"||field=="color") {
            const auto value=payload["value"];
            decoded.object["value"]=codecjson::Value::str(value.isNull()||value.isUndefined()?"":text(val::global("String")(value),"CORE_COMMAND_PAYLOAD",true));
        }
        return readWebMetadataCommand(candidate,decoded,ports);
    }
    if(id=="territorial.lock"||id=="territorial.color"||id=="territorial.color.reset"||id=="territorial.batch-color") {
        const auto payload=codecjson::parse(val::global("JSON").call<val>("stringify",input["payload"]).as<std::string>());
        auto request=readWebTerritorialStyleCommand(candidate,id,payload);
        // Empty/no-op requests still validate the incoming identity contract.
        auto normalized=targets;for(auto& ref:normalized)ref.id=trimWebText(ref.id);
        std::set<ObjectRef> unique(normalized.begin(),normalized.end());
        if(std::vector<ObjectRef>(unique.begin(),unique.end())!=webTerritorialStyleTargets(payload))
            fail("CORE_COMMAND_TARGETS","Style targets must match their territorial IDs.");
        return request;
    }
    static const std::set<std::string> territorialIds={"territorial.create","territorial.geometry","territorial.parent","territorial.remove","territorial.patch","territorial.replace","territorial.copy-region"};
    if(territorialIds.count(id)) {
        const auto payload=codecjson::parse(val::global("JSON").call<val>("stringify",input["payload"]).as<std::string>());
        auto request=readWebTerritorialCommand(candidate,id,payload,ports);
        if(targets!=request.targets)fail("CORE_COMMAND_TARGETS","Territorial targets must match the typed operation identities.");
        return request;
    }
    if(id=="objects.lock"||id=="objects.color") {
        const auto payload=codecjson::parse(val::global("JSON").call<val>("stringify",input["payload"]).as<std::string>());
        auto request=readWebObjectEditCommand(candidate,id,payload);
        if(targets!=request.targets)fail("CORE_COMMAND_TARGETS","Object edit targets must match its refs.");return request;
    }
    static const std::set<std::string> contentIds={"generic.create","generic.import","generic.metadata","generic.remove","generic.color-reset","hydro.geometry","hydro.copy",
        "distribution.layer.create","distribution.layer.metadata","distribution.layer.remove","distribution.entry.create",
        "distribution.entry.value","distribution.entry.remove","distribution.import","label.edit","hydro.edit","hydro.metadata"};
    if(contentIds.count(id)) {
        const auto decoded=codecjson::parse(val::global("JSON").call<val>("stringify",input["payload"]).as<std::string>());
        auto request=readWebContentCommand(candidate,id,decoded);
        if(targets!=request.targets)fail("CORE_COMMAND_TARGETS","Content targets must match the typed operation identities.");
        return request;
    }
    if(id=="content.edit") {
        const auto payload=input["payload"];shape(payload,{"domain","id","value","create"},"CORE_COMMAND_PAYLOAD");
        const ObjectRef ref{text(payload["domain"],"CORE_COMMAND_PAYLOAD"),text(payload["id"],"CORE_COMMAND_PAYLOAD")};
        if(targets!=std::vector<ObjectRef>{ref})fail("CORE_COMMAND_TARGETS","Content target must match its identity.");
        if(!type(payload["create"],"boolean"))fail("CORE_COMMAND_PAYLOAD","A create boolean is required.");
        CommandArguments args;args.action=projectcodec::readWebContentEdit(candidate,ref,
            codecjson::parse(val::global("JSON").call<val>("stringify",payload["value"]).as<std::string>()),payload["create"].as<bool>());
        return {id,candidate.instanceId(),candidate.document().documentId,candidate.revision(),targets,std::move(args)};
    }
    return {id,candidate.instanceId(),candidate.document().documentId,candidate.revision(),targets,typedArguments(id,input["payload"])};
}
class WasmDocumentSession {
public:
    explicit WasmDocumentSession(val options):ports_(documentPorts(options)),session_(ports_){}
    val documentLoad(const std::string& input,const std::string& currentMonth){return boundary([&]{return documentState(session_.documentLoad(input,currentMonth));});}
    val storageBaselineLoad(val input,std::uint32_t epoch) {
        return boundary([&]{const auto kind=text(input["kind"],"CORE_STORAGE_BASELINE");
            if(kind=="static-features") {
                shape(input,{"kind","baseDataset","fingerprint","features"},"CORE_STORAGE_BASELINE");
                auto facts=codecjson::parse(val::global("JSON").call<val>("stringify",input).as<std::string>());facts.object.erase("kind");
                return documentState(session_.storageBaselineLoad(facts,epoch));
            }
            if(kind!="stored-asset")fail("CORE_STORAGE_BASELINE","An explicit stored-asset or static-features source kind is required.");
            shape(input,{"kind","sourceBytes","encoding","compressedBytes","decodedBytes","baseDataset","sourceMonth","fingerprint"},"CORE_STORAGE_BASELINE");
            const auto bytes=input["sourceBytes"];if(!bytes.instanceof(val::global("Uint8Array")))fail("CORE_STORAGE_BASELINE","Stored asset bytes must be a Uint8Array.");
            const auto size=bytes["length"].as<double>();if(size>256*1024*1024)fail("CORE_STORAGE_BASELINE","Stored asset exceeds its compressed size bound.");
            projectcodec::WebStorageAssetSource source;source.sourceBytes.resize(static_cast<std::size_t>(size));
            val view(emscripten::typed_memory_view(source.sourceBytes.size(),source.sourceBytes.data()));view.call<void>("set",bytes);
            source.encoding=text(input["encoding"],"CORE_STORAGE_BASELINE");source.baseDataset=text(input["baseDataset"],"CORE_STORAGE_BASELINE");
            source.sourceMonth=text(input["sourceMonth"],"CORE_STORAGE_BASELINE");source.fingerprint=text(input["fingerprint"],"CORE_STORAGE_BASELINE");
            source.compressedBytes=static_cast<std::uint64_t>(integer(input["compressedBytes"],"CORE_STORAGE_BASELINE"));
            source.decodedBytes=static_cast<std::uint64_t>(integer(input["decodedBytes"],"CORE_STORAGE_BASELINE"));
            return documentState(session_.storageBaselineLoad(source,epoch));
        });
    }
    val validateImport(const std::string& input,val baseline) const {
        return boundary([&]{std::optional<std::uint32_t> id;if(!baseline.isNull())id=static_cast<std::uint32_t>(integer(baseline,"CORE_STORAGE_BASELINE"));
            return val::global("JSON").call<val>("parse",session_.validateImport(input,id));});
    }
    val inspectImport(const std::string& input,val baseline,const std::string& currentMonth) const {
        return boundary([&]{std::optional<std::uint32_t> id;if(!baseline.isNull())id=static_cast<std::uint32_t>(integer(baseline,"CORE_STORAGE_BASELINE"));
            const auto inspected=session_.inspectImport(input,id,currentMonth);auto result=val::object();
            result.set("project",val::global("JSON").call<val>("parse",inspected.project));result.set("world",world(inspected.world));return result;});
    }
    val admitExternalBaseline(std::uint32_t epoch){return boundary([&]{return documentState(session_.admitExternalBaseline(epoch));});}
    val baselineCoverage(std::uint32_t id,const std::string& month) const {return boundary([&]{const auto resolved=session_.baselineWorld(id,month);auto result=val::object();result.set("month",month);result.set("available",resolved.entities.size());return result;});}
    val documentLoadBaseline(std::uint32_t id,const val& setup){return boundary([&]{return documentState(session_.documentLoadBaseline(id,codecjson::parse(val::global("JSON").call<val>("stringify",setup).as<std::string>()),val::global("crypto").call<val>("randomUUID").as<std::string>()));});}
    val documentInitialize(val input) {
        return boundary([&]{std::optional<codecjson::Value> features;std::optional<std::string> source;
            if(!input["features"].isUndefined())features=codecjson::parse(val::global("JSON").call<val>("stringify",input["features"]).as<std::string>());
            if(!input["territorialSource"].isUndefined())source=val::global("JSON").call<val>("stringify",input["territorialSource"]).as<std::string>();
            if(!type(input["preserveCursor"],"boolean"))fail("CORE_SOURCE_ADMISSION","A preserveCursor boolean is required.");
            const auto project=input["project"].isUndefined()?std::string{}:val::global("JSON").call<val>("stringify",input["project"]).as<std::string>();
            std::optional<std::uint32_t> baseline;if(!input["baselineId"].isUndefined())baseline=static_cast<std::uint32_t>(integer(input["baselineId"],"CORE_STORAGE_BASELINE"));
            return documentState(session_.documentInitialize(project,text(input["currentMonth"],"CORE_SOURCE_ADMISSION"),input["preserveCursor"].as<bool>(),features,source,commandEpoch(input),baseline));
        });
    }
    val documentSnapshot() const {
        return boundary([&]{auto value=val::global("JSON").call<val>("parse",session_.documentSnapshot());
            auto settings=value["labelSettings"];
            for(const auto& [ref,setting]:session_.project().document().presentation.webPresentation.labelSettings)
                if(setting.maxZoom&&*setting.maxZoom==INFINITY) {
                    const auto key=webString(ref.domain+":"+ref.id);auto row=settings[key];row.set("maxZoom",INFINITY);settings.set(key,row);
                }
            return value;
        });
    }
    std::uint32_t captureReplacement(std::uint32_t epoch){return boundary([&]{return session_.captureReplacement(epoch);});}
    val rollbackReplacement(std::uint32_t id,std::uint32_t epoch){return boundary([&]{return documentState(session_.rollbackReplacement(id,epoch));});}
    bool releaseReplacement(std::uint32_t id){return session_.releaseReplacement(id);}
    std::string storageSnapshot() const{return boundary([&]{return session_.storageSnapshot();});}
    val exportSnapshot(val input) const {
        return boundary([&]{shape(input,{"expectedEpoch","version","savedAt","format"},"CORE_STORAGE_CONTEXT");
            projectcodec::WebStorageContext context{text(input["version"],"CORE_STORAGE_CONTEXT",true),
                text(input["savedAt"],"CORE_STORAGE_CONTEXT",true),text(input["format"],"CORE_STORAGE_CONTEXT")};
            const auto storage=session_.exportSnapshot(context,commandEpoch(input));
            auto result=val::object();result.set("storageJson",storage);
            auto spatial=val::null();
            if(context.format=="pandolab-project-state"&&isStaticTimeline(session_.project().document())) {
                // This is a read-only file export projection of the same
                // synchronous snapshot. Reuse the parsed archive's JS geometry
                // objects rather than copying its coordinates through WASM.
                spatial=val::global("JSON").call<val>("parse",storage);
                auto identities=val::global("Map").new_(),archive=val::global("Map").new_();
                const auto stored=spatial["territorialEntities"],geometries=spatial["geometries"];
                for(unsigned i=0;i<stored["length"].as<unsigned>();++i)identities.call<val>("set",stored[i]["id"],stored[i]);
                for(unsigned i=0;i<geometries["length"].as<unsigned>();++i) {
                    const auto entry=geometries[i],id=entry["id"];auto versions=archive.call<val>("get",id);
                    if(versions.isUndefined()){versions=val::global("Map").new_();archive.call<val>("set",id,versions);}
                    versions.call<val>("set",entry["version"],entry["geojson"]);
                }
                auto features=val::array();unsigned index=0;
                for(const auto& row:session_.project().resolveWorld(session_.project().timelineCursor()).entities) {
                    if(row.objectRef.domain!="territorial")continue;
                    const auto identity=identities.call<val>("get",webString(row.objectRef.id));
                    const auto versions=archive.call<val>("get",webString(row.geometryRef.id));
                    if(identity.isUndefined()||versions.isUndefined())fail("CORE_EXPORT_PROJECTION","Missing static export identity or geometry.");
                    const auto shape=versions.call<val>("get",row.geometryRef.version);
                    if(shape.isUndefined())fail("CORE_EXPORT_PROJECTION","Missing static export geometry version.");
                    auto feature=val::object(),properties=val::global("Object").call<val>("assign",val::object(),identity["properties"]);
                    properties.set("parentId",webString(row.parentId));properties.set("coverageMode",webString(row.coverageMode));
                    properties.set("validFrom",optional(row.validity.from));properties.set("validTo",optional(row.validity.to));
                    feature.set("type",std::string("Feature"));feature.set("id",webString(row.objectRef.id));feature.set("properties",properties);feature.set("geometry",shape);
                    features.set(index++,feature);
                }
                spatial.set("territorialEntities",features);
            }
            result.set("spatialState",spatial);
            result.set("state",documentState(session_.projectState()));return result;});
    }
    val projectState() const{return boundary([&]{return documentState(session_.projectState());});}
    val prepareCommand(val envelope){return run(envelope,false);}
    val executeCommand(val envelope){return run(envelope,true);}
    val confirmCandidate(std::uint32_t id,std::uint32_t epoch){return boundary([&]{return commandOutcome(session_.confirmCandidate(id,epoch),session_);});}
    val candidateProjection(std::uint32_t id,std::uint32_t epoch) const {
        return boundary([&]{session_.requireEpoch(epoch);const auto preview=session_.candidatePreview(id);
            if(!preview)fail("PREVIEW_CONSUMED","The candidate is absent or replaced.");
            const auto& change=preview->change();const auto& candidate=change.after();
            auto value=val::object();value.set("delta",val::global("JSON").call<val>("parse",projectcodec::encodeWebDelta(change.before(),candidate,change.impact())));
            auto resolved=world(pandoeditor::resolveWorld(candidate.timelineRecords,{timelineEntityCatalog(candidate),[&](const ObjectRef& owner,const GeometryRef& ref){return bool(candidate.geometries.get(ref));}},session_.project().timelineCursor()));
            std::vector<ObjectRef> ids;for(const auto& ref:change.impact().changedObjects)if(ref.domain=="territorial"||ref.domain=="hydro")ids.push_back(ref);
            auto periods=val::array();for(const auto& period:timelineChangePeriods(change.before().timelineRecords,candidate.timelineRecords,ids)){
                auto row=val::object();row.set("entityId",period.objectRef.id);row.set("from",optional(period.from));row.set("until",optional(period.until));periods.call<void>("push",row);
            }
            value.set("temporalImpact",periods);
            resolved.set("sourceEpoch",epoch);value.set("world",resolved);return value;
        });
    }
    bool cancelCandidate(std::uint32_t id){return session_.cancelCandidate(id);}
    val undo(std::uint32_t epoch){return boundary([&]{return commandOutcome(session_.undo(epoch),session_);});}
    val redo(std::uint32_t epoch){return boundary([&]{return commandOutcome(session_.redo(epoch),session_);});}
    val labelGestureApply(val input) {
        return boundary([&]{
            const bool coordinatePresent=!input.isNull()&&type(input,"object")&&val::global("Object").call<bool>("hasOwn",input,std::string("coordinate"));
            if(coordinatePresent)shape(input,{"action","id","coordinate","expectedEpoch"},"CORE_LABEL_GESTURE");
            else shape(input,{"action","id","expectedEpoch"},"CORE_LABEL_GESTURE");
            std::optional<Point> point;if(!input["coordinate"].isUndefined())point=draftPoint(input["coordinate"]);
            return commandOutcome(session_.labelGestureApply(text(input["action"],"CORE_LABEL_GESTURE"),text(input["id"],"CORE_LABEL_GESTURE"),point,commandEpoch(input)),session_);
        });
    }
    val markSaved(std::uint32_t epoch){return boundary([&]{return documentState(session_.markSaved(epoch));});}
    val resolveWorld(const std::string& month,std::uint32_t epoch) const {
        return boundary([&]{session_.requireEpoch(epoch);auto value=world(session_.resolveWorld(month));value.set("sourceEpoch",epoch);return value;});
    }
    val setTimelineCursor(const std::string& month,std::uint32_t epoch) {
        return boundary([&]{
            ResolvedWorld resolved;
            session_.setTimelineCursor(month,epoch,&resolved);
            const auto state=session_.projectState();
            auto result=val::object(),projected=world(resolved);
            projected.set("sourceEpoch",state.epoch);
            result.set("state",documentState(state));
            result.set("selection",::selectionSnapshot(session_.selection()));
            result.set("world",projected);
            return result;
        });
    }
    val selectionCatalogLoad(const std::string& domain,val rows,std::uint32_t epoch) {
        return boundary([&]{array(rows,"CORE_SELECTION_CATALOG");std::vector<SelectionCatalogEntry> entries;
            for(unsigned i=0;i<rows["length"].as<unsigned>();++i) {
                const auto row=rows[i];std::optional<std::string> logicalId;std::vector<std::string> sourceIds;
                if(!row["logicalId"].isUndefined())logicalId=text(row["logicalId"],"CORE_SELECTION_CATALOG");
                if(domain=="hydroBuiltin"){const auto sources=row["sourceIds"];array(sources,"CORE_SELECTION_CATALOG");for(unsigned j=0;j<sources["length"].as<unsigned>();++j)sourceIds.push_back(text(sources[j],"CORE_SELECTION_CATALOG"));}
                entries.push_back({selectionRef(row),std::move(logicalId),std::move(sourceIds)});
            }
            return commandOutcome(session_.selectionCatalogLoad(domain,entries,epoch),session_);
        });
    }
    val presentationCatalogLoad(val input,std::uint32_t epoch) {
        return boundary([&]{shape(input,{"hydroLayers","countryLabelIds","builtinSubunitSources"},"CORE_PRESENTATION_CATALOG");
            PresentationCatalog catalog;const auto layers=input["hydroLayers"];const auto ids=val::global("Object").call<val>("keys",layers);
            for(unsigned i=0;i<ids["length"].as<unsigned>();++i) {const auto key=ids[i];catalog.hydroLayers.emplace(text(key,"CORE_PRESENTATION_CATALOG"),text(layers[key],"CORE_PRESENTATION_CATALOG"));}
            const auto labels=input["countryLabelIds"];array(labels,"CORE_PRESENTATION_CATALOG");
            for(unsigned i=0;i<labels["length"].as<unsigned>();++i)catalog.countryLabelIds.push_back(text(labels[i],"CORE_PRESENTATION_CATALOG"));
            const auto sources=input["builtinSubunitSources"];if(sources.isNull()||!type(sources,"object")||val::global("Array").call<bool>("isArray",sources))
                fail("CORE_PRESENTATION_CATALOG","A builtin subunit source map is required.");
            const auto sourceIds=val::global("Object").call<val>("keys",sources);
            for(unsigned i=0;i<sourceIds["length"].as<unsigned>();++i) {const auto key=sourceIds[i];
                catalog.builtinSubunitSources.emplace(text(key,"CORE_PRESENTATION_CATALOG"),text(sources[key],"CORE_PRESENTATION_CATALOG"));}
            return commandOutcome(session_.presentationCatalogLoad(std::move(catalog),epoch),session_);
        });
    }
    val selectionSnapshot() const{return boundary([&]{session_.projectState();return ::selectionSnapshot(session_.selection());});}
    val draftSnapshot() const{return boundary([&]{return draftValue(session_);});}
    val draftApply(val input) {
        return boundary([&]{session_.requireEpoch(commandEpoch(input));const auto action=text(input["action"],"CORE_DRAFT_ACTION");
            const auto origin=input["expectedDraftRevision"];
            if(!origin.isUndefined()) {
                if(!type(origin,"number"))fail("CORE_DRAFT_REVISION","An integer draft revision is required.");
                const auto revision=origin.as<double>();
                if(!std::isfinite(revision)||std::floor(revision)!=revision||revision<0||revision>9007199254740991.0)
                    fail("CORE_DRAFT_REVISION","Invalid draft revision.");
                session_.requireDraftRevision(static_cast<std::uint64_t>(revision));
            }
            auto& draft=session_.draft();bool result=false;
            if(action=="start")result=session_.startDraft(text(input["shape"],"CORE_DRAFT_SHAPE"),draftCoordinates(input["coords"]),
                input["inputPhase"].isUndefined()?"draw":text(input["inputPhase"],"CORE_DRAFT_PHASE",true));
            else if(action=="clear"||action=="stop"){session_.clearDraft(action=="stop");result=true;}
            else if(session_.draftActive()) {
                if(action=="replaceCoordinates")result=draft.replaceCoordinates(draftCoordinates(input["coords"]),
                    type(input["record"],"boolean")&&input["record"].as<bool>(),
                    input["selectedVertexIndex"].isNull()||input["selectedVertexIndex"].isUndefined()?-1:integer(input["selectedVertexIndex"],"CORE_DRAFT_INDEX"),
                    input["inputPhase"].isUndefined()?"":text(input["inputPhase"],"CORE_DRAFT_PHASE",true));
                else if(action=="append")result=draft.append(draftPoint(input["coordinate"]));
                else if(action=="selectVertex")result=draft.selectVertex(integer(input["index"],"CORE_DRAFT_INDEX"));
                else if(action=="setPhase")result=draft.setPhase(text(input["inputPhase"],"CORE_DRAFT_PHASE",true));
                else if(action=="setInsertMode"){if(!type(input["insertMode"],"boolean"))fail("CORE_DRAFT_MODE","A boolean is required.");result=draft.setInsertMode(input["insertMode"].as<bool>());}
                else if(action=="setInsertTarget") {
                    const auto target=input["insertTarget"];std::optional<GeometryDraft::InsertTarget> next;
                    if(!target.isNull())next=GeometryDraft::InsertTarget{integer(target["segmentIndex"],"CORE_DRAFT_INDEX"),draftPoint(target["coordinate"])};
                    result=draft.setInsertTarget(next);
                }else if(action=="insertAt")result=draft.insertAt(integer(input["segmentIndex"],"CORE_DRAFT_INDEX"),draftPoint(input["coordinate"]));
                else if(action=="deleteSelected")result=draft.deleteSelected();else if(action=="removeLast")result=draft.removeLast();
                else if(action=="undo")result=draft.undo();else if(action=="redo")result=draft.redo();
                else if(action=="beginDrag")result=draft.beginDrag(integer(input["index"],"CORE_DRAFT_INDEX"));
                else if(action=="queueDrag")result=draft.queueDrag(draftPoint(input["coordinate"]));
                else if(action=="flushDrag")result=draft.flushDrag();else if(action=="moveDrag")result=draft.moveDrag(draftPoint(input["coordinate"]));
                else if(action=="finishDrag")result=draft.finishDrag();else if(action=="cancelDrag")result=draft.cancelDrag();
                else fail("CORE_DRAFT_ACTION","Unknown draft action: "+action);
            }
            auto value=val::object();value.set("result",result);value.set("snapshot",draftValue(session_));return value;
        });
    }
    val selectionApply(val input) {
        return boundary([&] {
            session_.requireEpoch(commandEpoch(input));
            auto& selection=session_.selection();const auto action=text(input["action"],"CORE_SELECTION_ACTION");
            bool countNoOp=true;
            const auto scope=type(input["scope"],"string")?text(input["scope"],"CORE_SELECTION_SCOPE",true):std::string{};
            const auto admitted=[&](const SelectionRef& ref){return session_.selectionRefExists(ref);};
            const auto value=selectionRef(input["ref"]);
            if(action=="replace"||action=="toggle") {
                if(admitted(value)){if(action=="replace")selection.replace(value,scope);else selection.toggle(value,scope);}
            }else if(action=="selectRange"||action=="setMany") {
                auto refs=selectionRefs(input[action=="selectRange"?"orderedRefs":"refs"]);
                refs.erase(std::remove_if(refs.begin(),refs.end(),[&](const auto& ref){return !admitted(ref);}),refs.end());
                if(action=="selectRange") {
                    if(admitted(value))selection.selectRange(value,refs,scope.empty()?"default":scope,
                        type(input["additive"],"boolean")&&input["additive"].as<bool>());
                }else {
                    const auto primary=selectionRef(input["primary"]);
                    selection.setMany(refs,admitted(primary)?std::optional<SelectionRef>{primary}:std::nullopt,scope);
                }
            }else if(action=="remove") {
                if(type(input["key"],"string")) {
                    const auto key=text(input["key"],"CORE_SELECTION_KEY",true);const auto items=selection.items();
                    for(const auto& ref:items)if(selectionRefKey(ref)==key){selection.remove(ref);break;}
                }else selection.remove(value);
            }else if(action=="prune") {
                if(input["validKeys"].isNull()||input["validKeys"].isUndefined())selection.prune(admitted);
                else {const auto rows=input["validKeys"];array(rows,"CORE_SELECTION_KEYS");std::set<std::string> keys;
                    for(unsigned i=0;i<rows["length"].as<unsigned>();++i)keys.insert(text(rows[i],"CORE_SELECTION_KEYS",true));
                    selection.prune([&](const auto& ref){return keys.count(selectionRefKey(ref))!=0;});}
            }else if(action=="clear")selection.clear();
            else if(action=="resetProject")selection.resetProject();
            else if(action=="setHover") {
                const auto source=type(input["source"],"string")?text(input["source"],"CORE_SELECTION_SOURCE",true):std::string{};
                const auto key=type(input["expectedKey"],"string")?text(input["expectedKey"],"CORE_SELECTION_KEY",true):std::string{};
                if(input["ref"].isNull()||input["ref"].isUndefined())countNoOp=selection.setHover({},source,key);
                else if(admitted(value))selection.setHover(value,source,key);
            }else fail("CORE_SELECTION_ACTION","Unknown selection action: "+action);
            auto result=val::object();result.set("selection",::selectionSnapshot(selection));result.set("countNoOp",countNoOp);return result;
        });
    }
private:
    val run(const val& input,bool execute) {
        return boundary([&] {
          try {
            const auto commandId=text(input["commandId"],"CORE_COMMAND_ID");
            if(commandId=="document.batch"||isWebGeometryBatchCommand(commandId)) {
                const auto operations=input["payload"]["operations"];array(operations,"CORE_COMMAND_BATCH");
                if(!commandTargets(input).empty())fail("CORE_COMMAND_TARGETS","A semantic batch derives targets from its typed operations.");
                const auto epoch=commandEpoch(input);
                const auto sourceInfo=input["payload"]["sourceInfo"];const bool appendSource=!sourceInfo.isUndefined();
                const auto count=operations["length"].as<unsigned>();
                auto outcome=session_.prepareBatch(count+(appendSource?1:0),[&](const ProjectSnapshot& candidate,std::size_t index){
                    if(index<count)return typedRequest(candidate,operations[static_cast<unsigned>(index)],ports_);
                    const auto next=sourceInfo["next"];CommandArguments args;
                    args.action=DocumentSourceInfoAppend{next.isUndefined()?std::string("null"):val::global("JSON").call<val>("stringify",next).as<std::string>(),text(sourceInfo["mergedAt"],"CORE_SOURCE_INFO")};
                    return CommandRequest{"document.source-info",candidate.instanceId(),candidate.document().documentId,candidate.revision(),{},std::move(args)};
                },epoch,commandId);
                if(execute&&outcome.candidateId)outcome=session_.confirmCandidate(outcome.candidateId,epoch);
                return commandOutcome(outcome,session_);
            }
            const auto epoch=commandEpoch(input);
            if(epoch!=session_.projectState().epoch) {
                DocumentSessionOutcome rejected;rejected.result.error=CommandError::StaleRevision;rejected.result.detail="session epoch changed";
                return commandOutcome(rejected,session_);
            }
            if(commandId=="presentation.apply"||commandId=="distribution.render-mode"||commandId=="distribution.boundary-visible") {
                if(!execute)fail("CORE_PRESENTATION_PREPARE","Presentation commands execute atomically without a content preview.");
                const auto payload=codecjson::parse(val::global("JSON").call<val>("stringify",input["payload"]).as<std::string>());
                return commandOutcome(session_.applyPresentation(readWebPresentationCommand(session_.project().snapshot(),commandId,payload),epoch),session_);
            }
            auto request=typedRequest(session_.project().snapshot(),input,ports_);
            auto outcome=execute?session_.executeCommand(std::move(request.commandId),std::move(request.args),std::move(request.targets),epoch)
                :session_.prepareCommand(std::move(request.commandId),std::move(request.args),std::move(request.targets),epoch);
            if(!outcome.result.ok()&&commandId.rfind("distribution.",0)==0) {
                if(outcome.result.error==CommandError::Locked)outcome.domainErrorCode="locked";
                else if(outcome.result.error==CommandError::InvalidArguments||outcome.result.error==CommandError::ValidationFailed)outcome.domainErrorCode="invalid";
            }
            return commandOutcome(outcome,session_);
          } catch(const TimelineError& error) {
            static const std::set<std::string> declared={"not-found","locked","unsupported-field","unsupported-relation-field",
                "invalid-flag","invalid-temporal","invalid-color","TIMELINE_ACTIVATION","invalid","layer-not-found","territorial-unit-not-found","invalid-parent","invalid-source","unsupported-parent-type"};
            if(!declared.count(error.code))throw;
            DocumentSessionOutcome rejected;rejected.result.error=CommandError::InvalidArguments;
            rejected.result.detail=error.what();
            if(error.code=="unsupported-field") {
                const auto prefix=error.code+": ";if(rejected.result.detail.rfind(prefix,0)==0)rejected.result.detail.erase(0,prefix.size());
            }
            rejected.domainErrorCode=error.code;return commandOutcome(rejected,session_);
          }
        });
    }
    projectcodec::PlatformPorts ports_;
    DocumentSession session_;
};
}
EMSCRIPTEN_BINDINGS(pandoeditor_document_session) {
    const auto compilerVersion=std::to_string(__EMSCRIPTEN_major__)+"."
        +std::to_string(__EMSCRIPTEN_minor__)+"."+std::to_string(__EMSCRIPTEN_tiny__);
    emscripten::constant("coreAbiVersion",1);
    emscripten::constant("coreSourceSha256",std::string(PANDOEDITOR_CORE_SOURCE_SHA256));
    emscripten::constant("coreCompilerVersion",compilerVersion);
    emscripten::function("sphericalRingSignedArea",&sphericalRingAreaForWeb);
    emscripten::function("validateTerritorialRing",&territorialRingValidationForWeb);
    emscripten::function("referenceGraphDiagnostics",&referenceGraphForWeb);
    emscripten::function("resolveTerritorialRoot",&territorialRootForWeb);
    emscripten::function("distributionReferenceDiagnostics",&distributionReferencesForWeb);
    emscripten::function("sphericalRingSignedAreas",&sphericalRingAreasForWeb);
    emscripten::function("temporalParse",&temporalParseForWeb);
    emscripten::function("temporalMonthEnd",&temporalMonthEndForWeb);
    emscripten::function("temporalCompare",&temporalCompareForWeb);
    emscripten::function("temporalNormalizeInterval",&temporalNormalizeIntervalForWeb);
    emscripten::function("temporalContains",&temporalContainsForWeb);
    emscripten::function("temporalIntervalsOverlap",&temporalIntervalsOverlapForWeb);
    emscripten::function("temporalShiftMonth",&temporalShiftMonthForWeb);
    emscripten::function("temporalCompareKeys",&temporalCompareKeysForWeb);
    emscripten::function("temporalFollowingDay",&temporalFollowingDayForWeb);
    emscripten::function("normalizePolygonGeometry",&polygonGeometry);
    emscripten::function("normalizePolygonRing",&polygonRing);
    emscripten::function("hasCanonicalPolygonWinding",&canonicalPolygonGeometry);
    emscripten::class_<WasmDocumentSession>("DocumentSession").constructor<val>()
        .function("documentLoad",&WasmDocumentSession::documentLoad).function("storageSnapshot",&WasmDocumentSession::storageSnapshot)
        .function("storageBaselineLoad",&WasmDocumentSession::storageBaselineLoad).function("validateImport",&WasmDocumentSession::validateImport)
        .function("inspectImport",&WasmDocumentSession::inspectImport)
        .function("baselineCoverage",&WasmDocumentSession::baselineCoverage).function("documentLoadBaseline",&WasmDocumentSession::documentLoadBaseline).function("admitExternalBaseline",&WasmDocumentSession::admitExternalBaseline)
        .function("documentInitialize",&WasmDocumentSession::documentInitialize).function("documentSnapshot",&WasmDocumentSession::documentSnapshot)
        .function("captureReplacement",&WasmDocumentSession::captureReplacement).function("rollbackReplacement",&WasmDocumentSession::rollbackReplacement)
        .function("releaseReplacement",&WasmDocumentSession::releaseReplacement)
        .function("candidateProjection",&WasmDocumentSession::candidateProjection)
        .function("exportSnapshot",&WasmDocumentSession::exportSnapshot)
        .function("projectState",&WasmDocumentSession::projectState).function("prepareCommand",&WasmDocumentSession::prepareCommand)
        .function("executeCommand",&WasmDocumentSession::executeCommand).function("confirmCandidate",&WasmDocumentSession::confirmCandidate)
        .function("cancelCandidate",&WasmDocumentSession::cancelCandidate).function("undo",&WasmDocumentSession::undo)
        .function("redo",&WasmDocumentSession::redo).function("markSaved",&WasmDocumentSession::markSaved)
        .function("labelGestureApply",&WasmDocumentSession::labelGestureApply)
        .function("resolveWorld",&WasmDocumentSession::resolveWorld).function("setTimelineCursor",&WasmDocumentSession::setTimelineCursor)
        .function("selectionCatalogLoad",&WasmDocumentSession::selectionCatalogLoad)
        .function("selectionApply",&WasmDocumentSession::selectionApply)
        .function("presentationCatalogLoad",&WasmDocumentSession::presentationCatalogLoad)
        .function("selectionSnapshot",&WasmDocumentSession::selectionSnapshot)
        .function("draftApply",&WasmDocumentSession::draftApply).function("draftSnapshot",&WasmDocumentSession::draftSnapshot);
}
