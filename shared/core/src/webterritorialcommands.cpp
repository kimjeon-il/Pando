#include <pandoeditor/webterritorialcommands.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/webcommands.h>
#include <algorithm>
#include <cctype>
#include <set>

namespace pandoeditor {
namespace {
using V=codecjson::Value;
const V& optional(const V& input,const char* name) {
    static const V missing;
    if(input.kind!=V::Object)return missing;
    const auto found=input.object.find(name);return found==input.object.end()?missing:found->second;
}
const V& required(const V& input,const char* name) {
    if(input.kind!=V::Object||!input.object.count(name))throw TimelineError("CORE_COMMAND_PAYLOAD",std::string("Missing territorial field: ")+name);
    return input.object.at(name);
}
std::string text(const V& input) {return trimWebText(webCommandString(input));}
std::string identity(const V& input) {
    auto id=text(input);if(id.empty())throw TimelineError("CORE_COMMAND_PAYLOAD","Territorial ID is empty.");return id;
}
V object(std::initializer_list<std::pair<const std::string,V>> fields) {
    auto result=V::obj();for(const auto& row:fields)result.object.emplace(row);return result;
}
std::optional<std::string> endpoint(const V& input) {
    const auto value=text(input);return value.empty()?std::nullopt:std::optional<std::string>{value};
}
V dateValue(const std::optional<std::string>& value) {return value?V::str(*value):V{};}
V annotations(const V& input,const char* field) {
    // The resolved normalizer supplies {} for scalars. Identity publication
    // rejects arrays, so never discard an array's annotation values here.
    if(input.kind==V::Array)throw TimelineError("CORE_COMMAND_PAYLOAD",std::string(field)+" must be an object.");
    return input.kind==V::Object?input:V::obj();
}
void polygon(const V& geometry) {
    const auto& type=required(geometry,"type"),&coordinates=required(geometry,"coordinates");
    if(type.kind!=V::String||(type.string!="Polygon"&&type.string!="MultiPolygon")||
       coordinates.kind!=V::Array||coordinates.array.empty())throw TimelineError("CORE_COMMAND_PAYLOAD","A territorial Polygon or MultiPolygon is required.");
}
V normalizedResolvedFeature(const V& input) {
    const auto& p=required(input,"properties");
    if(p.kind!=V::Object)throw TimelineError("CORE_COMMAND_PAYLOAD","Territorial properties must be an object.");
    const auto schema=webCommandNumber(optional(p,"schemaVersion"));
    if(!schema||*schema!=6)throw TimelineError("CORE_COMMAND_PAYLOAD","Territorial schemaVersion must be 6.");
    for(const auto* name:{"unitType","associatedCountryId","sovereignId"})if(p.object.count(name))
        throw TimelineError("CORE_COMMAND_PAYLOAD",std::string(name)+" is not a current territorial field.");
    auto kind=text(optional(p,"entityKind"));
    std::transform(kind.begin(),kind.end(),kind.begin(),[](unsigned char c){return char(std::tolower(c));});
    if(kind!="general"&&kind!="regional")throw TimelineError("CORE_COMMAND_PAYLOAD","Unsupported territorial entityKind.");
    const auto id=identity(required(input,"id")),parent=text(optional(p,"parentId")),coverage=text(optional(p,"coverageMode"));
    if(coverage!="explicit"&&coverage!="partition")throw TimelineError("CORE_COMMAND_PAYLOAD","Unsupported territorial coverageMode.");
    const auto interval=normalizeTemporalInterval(endpoint(optional(p,"validFrom")),endpoint(optional(p,"validTo")));
    auto style=annotations(optional(p,"style"),"style");const auto color=text(optional(style,"color"));
    if(color.empty())style.object.erase("color");else style.object["color"]=V::str(color);
    const auto& rawGeometry=required(input,"geometry");polygon(rawGeometry);
    auto normalized=object({{"type",V::str("Feature")},{"id",V::str(id)},{"geometry",rawGeometry},
        {"properties",object({{"schemaVersion",V::num(6)},{"entityKind",V::str(kind)},
        {"name",V::str(text(optional(p,"name")))},{"notes",V::str(text(optional(p,"notes")))},
        {"locked",V::boolean(optional(p,"locked").kind==V::Bool&&optional(p,"locked").raw=="true")},
        {"parentId",V::str(parent)},{"coverageMode",V::str(coverage)},
        {"validFrom",dateValue(interval.validFrom)},{"validTo",dateValue(interval.validTo)},
        {"style",std::move(style)},{"metadata",annotations(optional(p,"metadata"),"metadata")},
        {"sourceFolderId",V::str(text(optional(p,"sourceFolderId")))},
        {"sourceEntityId",V::str(text(optional(p,"sourceEntityId")))},
        {"sourceGeometryVersion",V::str(text(optional(p,"sourceGeometryVersion")))}})}});
    return normalized;
}
WebTerritorialFeature feature(const V& input,const projectcodec::PlatformPorts& ports) {
    return projectcodec::readWebTerritorialIdentityFeature(normalizedResolvedFeature(input),ports);
}
std::vector<std::string> ids(const V& input) {
    if(input.kind!=V::Array)throw TimelineError("CORE_COMMAND_PAYLOAD","Territorial IDs must be an array.");
    std::vector<std::string> result;std::set<std::string> seen;
    for(const auto& item:input.array) {
        const auto id=text(item);if(!id.empty()&&seen.insert(id).second)result.push_back(id);
    }
    return result;
}
const TerritorialUnit& active(const ProjectSnapshot& snapshot,const std::string& id,const char* code) {
    const auto ref=territorialRef(id);const auto found=snapshot.index().objects.find(ref);
    if(found==snapshot.index().objects.end())throw TimelineError(code,"Territorial entity was not found.");
    if(!snapshot.timelineMonth().empty()) {
        const auto& d=snapshot.document();const auto world=resolveWorld(d.timelineRecords,
            {timelineEntityCatalog(d),[&](const ObjectRef& owner,const GeometryRef& geometry){return bool(d.geometries.get(geometry));}},snapshot.timelineMonth());
        if(!world.find(territorialRef(id)))throw TimelineError(code,"Territorial entity is inactive.");
    }
    return snapshot.document().units.at(found->second);
}
}
codecjson::Value normalizeWebTerritorialResolvedFeature(const codecjson::Value& value){return normalizedResolvedFeature(value);}
CommandRequest readWebTerritorialCommand(const ProjectSnapshot& snapshot,const std::string& operationId,
                                        const V& payload,const projectcodec::PlatformPorts& ports) {
    if(payload.kind!=V::Object)throw TimelineError("CORE_COMMAND_PAYLOAD","Territorial payload must be an object.");
    WebTerritorialEdit edit;std::vector<ObjectRef> targets;
    const auto append=[&](const V& rows) {
        if(rows.kind!=V::Array)throw TimelineError("CORE_COMMAND_PAYLOAD","Territorial features must be an array.");
        std::set<std::string> seen;
        for(const auto& row:rows.array) {
            auto value=feature(row,ports);const auto& id=value.identity.id;
            if(!seen.insert(id).second)throw TimelineError("CORE_COMMAND_PAYLOAD","Duplicate territorial feature ID: "+id);
            targets.push_back(territorialRef(id));edit.features.push_back(std::move(value));
        }
    };
    if(operationId=="territorial.create") {
        edit.operation=WebTerritorialOperation::Create;auto row=feature(required(payload,"feature"),ports);
        targets.push_back(territorialRef(row.identity.id));edit.features.push_back(std::move(row));
    } else if(operationId=="territorial.geometry") {
        edit.operation=WebTerritorialOperation::Geometry;edit.id=identity(required(payload,"id"));
        const auto& geometry=required(payload,"geometry");polygon(geometry);
        WebTerritorialFeature row;row.identity.id=edit.id;row.geometry=projectcodec::readWebGeometry(geometry);
        edit.features.push_back(std::move(row));targets.push_back(territorialRef(edit.id));
    } else if(operationId=="territorial.parent") {
        edit.operation=WebTerritorialOperation::Parent;edit.id=identity(required(payload,"id"));edit.parentId=text(required(payload,"parentId"));
        const auto& unit=active(snapshot,edit.id,"not-found");
        if(unit.locked)throw TimelineError("locked","Territorial entity is locked.");
        if(unit.kind!=UnitKind::General)throw TimelineError("unsupported-parent-type","Only general entities have administrative parents.");
        targets.push_back(territorialRef(edit.id));
    } else if(operationId=="territorial.remove") {
        edit.operation=WebTerritorialOperation::Remove;edit.removedIds=ids(required(payload,"ids"));
        for(const auto& id:edit.removedIds)targets.push_back(territorialRef(id));
    } else if(operationId=="territorial.patch"||operationId=="territorial.replace") {
        edit.operation=operationId=="territorial.patch"?WebTerritorialOperation::Patch:WebTerritorialOperation::Replace;
        append(required(payload,"features"));
        if(edit.operation==WebTerritorialOperation::Patch) {
            if(payload.object.count("removedIds"))edit.removedIds=ids(required(payload,"removedIds"));
            for(const auto& id:edit.removedIds) {
                if(std::any_of(edit.features.begin(),edit.features.end(),[&](const auto& row){return row.identity.id==id;}))
                    throw TimelineError("CORE_COMMAND_PAYLOAD","A territorial ID cannot be both changed and removed: "+id);
                targets.push_back(territorialRef(id));
            }
        }
    } else if(operationId=="territorial.copy-region") {
        edit.operation=WebTerritorialOperation::CopyRegion;edit.sourceId=text(required(payload,"sourceId"));
        const auto& source=active(snapshot,edit.sourceId,"invalid-source");
        if(source.kind!=UnitKind::General)throw TimelineError("invalid-source","Independent region copy requires a general source.");
        edit.id=identity(required(payload,"id"));edit.newName=text(optional(payload,"name"));
        const auto color=text(optional(payload,"color"));if(!color.empty())edit.color=projectcodec::readWebColor(V::str(color));
        targets={territorialRef(edit.sourceId),territorialRef(edit.id)};
    } else throw TimelineError("CORE_COMMAND_ID","Unsupported territorial operation: "+operationId);
    CommandArguments args;args.action=std::move(edit);
    return {operationId,snapshot.instanceId(),snapshot.document().documentId,snapshot.revision(),std::move(targets),std::move(args)};
}
}
