#include <pandoeditor/webcontentcommands.h>
#include <pandoeditor/webcommands.h>
#include <pandoeditor/webpresentationcommands.h>
#include <pandoeditor/objectproperties.h>
#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <regex>
#include <set>

namespace pandoeditor {
namespace {
using V=codecjson::Value;
const V& optional(const V& value,const char* key) {
    static const V absent;
    if(value.kind!=V::Object)return absent;
    const auto found=value.object.find(key);return found==value.object.end()?absent:found->second;
}
const V& required(const V& value,const char* key) {
    if(value.kind!=V::Object||!value.object.count(key))
        throw TimelineError("CORE_COMMAND_PAYLOAD",std::string("Missing content field: ")+key);
    return value.object.at(key);
}
std::string text(const V& value) {return trimWebText(webCommandString(value));}
bool flag(const V& value) {return value.kind==V::Bool&&value.raw=="true";}
V object(std::initializer_list<std::pair<const std::string,V>> values) {
    auto result=V::obj();for(const auto& row:values)result.object.emplace(row);return result;
}
void keys(const V& value,std::initializer_list<const char*> allowed,const char* label) {
    if(value.kind!=V::Object)throw std::invalid_argument(std::string(label)+" must be an object.");
    std::set<std::string> known;for(auto key:allowed)known.insert(key);
    for(const auto& [key,item]:value.object)if(!known.count(key))
        throw std::invalid_argument(std::string(label)+" contains an unsupported field: "+key);
}
std::string identity(const V& value,const char* label) {
    const auto id=text(value);if(id.empty())throw std::invalid_argument(std::string(label)+" ID is empty.");return id;
}
double numeric(const V& value) {
    if((value.kind!=V::Number&&value.kind!=V::String)||(value.kind==V::String&&trimWebText(value.string).empty()))
        throw std::invalid_argument("A distribution value must be a finite number.");
    const auto number=webCommandNumber(value);if(!number)throw std::invalid_argument("A distribution value must be a finite number.");
    return *number;
}
std::optional<std::string> date(const V& value) {
    const auto result=text(value);return result.empty()?std::nullopt:std::optional<std::string>{result};
}
Validity validity(const V& from,const V& to) {
    const auto interval=normalizeTemporalInterval(date(from),date(to));return {interval.validFrom,interval.validTo};
}
V dateValue(const std::optional<std::string>& value) {return value?V::str(*value):V{};}
V metadata(const V& value) {
    return value.kind==V::Object||value.kind==V::Array?value:V::obj();
}
V hydro(const V& input) {
    if(input.kind!=V::Object)throw std::invalid_argument("편집 강/호수 형식이 올바르지 않습니다.");
    auto row=input;auto& properties=row.object["properties"];if(properties.kind!=V::Object)properties=V::obj();
    const auto& geometry=required(row,"geometry");const auto shape=projectcodec::readWebGeometry(geometry);
    const std::string category=shape.type=="Polygon"||shape.type=="MultiPolygon"?"lake":
        shape.type=="LineString"||shape.type=="MultiLineString"?"river":"";
    if(category.empty())throw std::invalid_argument("편집 강/호수 형식이 올바르지 않습니다.");
    const auto id=identity(optional(row,"id"),"편집 강/호수");row.object["id"]=V::str(id);
    properties.object["category"]=V::str(category);properties.object["pandolab_domain"]=V::str("hydro");
    properties.object["pandolab_schema_version"]=V::num(1);properties.object["pandolab_id"]=V::str(id);
    const auto truthy=[](const V& value) {return value.kind!=V::Null&&!(value.kind==V::Bool&&value.raw=="false")&&
        !(value.kind==V::String&&value.string.empty())&&!(value.kind==V::Number&&webCommandNumber(value)==std::optional<double>{0});};
    for(const auto* field:{"name","notes"}) {const auto value=optional(properties,field);properties.object[field]=V::str(truthy(value)?webCommandString(value):"");}
    auto color=text(optional(properties,"editorColor"));
    if(!std::regex_match(color,std::regex("#[0-9a-fA-F]{6}")))color=category=="river"?"#3b82c4":"#5aa9d6";
    std::transform(color.begin(),color.end(),color.begin(),[](unsigned char c){return static_cast<char>(std::tolower(c));});
    properties.object["editorColor"]=V::str(color);properties.object.erase("visible");return row;
}
V groups(const V& value) {
    auto result=V::arr();std::set<std::string> seen;
    if(value.kind==V::Array)for(const auto& item:value.array) {
        const auto group=text(item);if(!group.empty()&&seen.insert(group).second)result.array.push_back(V::str(group));
    }
    return result;
}
DistributionValueScale scale(const V& value) {
    const auto& mode=optional(value,"mode");
    if(value.kind==V::Null||(mode.kind==V::String&&mode.string=="auto"))return {};
    if(mode.kind!=V::String||mode.string!="manual")throw std::invalid_argument("Invalid distribution value scale.");
    const auto min=numeric(optional(value,"min")),max=numeric(optional(value,"max"));
    if(min>=max)throw std::invalid_argument("Distribution minimum must be less than maximum.");return {true,min,max};
}
V scaleValue(const DistributionValueScale& value) {
    if(!value.manual)return object({{"mode",V::str("auto")}});
    return object({{"mode",V::str("manual")},{"min",V::num(value.min)},{"max",V::num(value.max)}});
}
V generic(const V& row) {
    keys(row,{"type","id","geometry","properties"},"Generic feature");
    if(text(required(row,"type"))!="Feature")throw std::invalid_argument("Generic input must be a Feature.");
    const auto& p=optional(row,"properties");
    if(p.kind!=V::Null)keys(p,{"schemaVersion","name","notes","color","locked","source"},"Generic properties");
    const auto& version=optional(p,"schemaVersion");
    if(version.kind!=V::Null&&numeric(version)!=2)throw std::invalid_argument("Unsupported generic schemaVersion.");
    auto color=text(optional(p,"color"));if(color.empty())color="#8c68d8";
    const auto& rawId=required(row,"id");identity(rawId,"Generic");
    // Generic constructors validate trimmed identity but preserve the Feature ID.
    return object({{"type",V::str("Feature")},{"id",V::str(webCommandString(rawId))},
        {"geometry",required(row,"geometry")},{"properties",object({{"schemaVersion",V::num(2)},
        {"name",V::str(text(optional(p,"name")))},{"notes",V::str(text(optional(p,"notes")))},
        {"color",V::str(color)},{"locked",V::boolean(flag(optional(p,"locked")))},
        {"source",projectcodec::normalizeWebSourceProvenance(optional(p,"source"))}})}});
}
V distributionLayer(const V& raw,bool create) {
    keys(raw,{"id","schemaVersion","name","unit","valueScale","color","locked","parentId","groups","validFrom","validTo","metadata"},"Distribution layer");
    if(!create&&numeric(required(raw,"schemaVersion"))!=3)throw std::invalid_argument("Unsupported distribution schemaVersion.");
    const auto id=identity(required(raw,"id"),"Distribution layer");auto name=text(optional(raw,"name"));if(name.empty())name=id;
    auto color=text(optional(raw,"color"));if(color.empty())color="#8c68d8";
    const auto interval=validity(optional(raw,"validFrom"),optional(raw,"validTo"));
    return object({{"id",V::str(id)},{"schemaVersion",V::num(3)},{"name",V::str(name)},
        {"unit",V::str(text(optional(raw,"unit")))},{"color",V::str(color)},
        {"locked",V::boolean(flag(optional(raw,"locked")))},{"parentId",V::str(text(optional(raw,"parentId")))},
        {"groups",groups(optional(raw,"groups"))},{"valueScale",scaleValue(scale(optional(raw,"valueScale")))},
        {"validFrom",dateValue(interval.from)},{"validTo",dateValue(interval.to)},{"metadata",metadata(optional(raw,"metadata"))}});
}
V distributionEntry(const V& raw,bool create) {
    keys(raw,{"id","schemaVersion","layerId","mode","territorialUnitId","geometry","value","certainty","validFrom","validTo","metadata"},"Distribution entry");
    if(!create&&numeric(required(raw,"schemaVersion"))!=3)throw std::invalid_argument("Unsupported distribution schemaVersion.");
    const auto id=identity(required(raw,"id"),"Distribution entry"),layer=identity(required(raw,"layerId"),"Distribution layer"),mode=text(optional(raw,"mode"));
    if(mode!="territorial"&&mode!="geometry")throw std::invalid_argument("Invalid distribution mode.");
    const auto interval=validity(optional(raw,"validFrom"),optional(raw,"validTo"));
    auto certainty=text(optional(raw,"certainty"));if(certainty.empty())certainty="unknown";
    if(mode=="geometry") {
        const auto& geometry=required(raw,"geometry");const auto type=text(optional(geometry,"type"));
        const auto& coordinates=optional(geometry,"coordinates");
        if((type!="Polygon"&&type!="MultiPolygon")||coordinates.kind!=V::Array||coordinates.array.empty())
            throw std::invalid_argument("Invalid distribution geometry.");
    }
    return object({{"id",V::str(id)},{"schemaVersion",V::num(3)},{"layerId",V::str(layer)},{"mode",V::str(mode)},
        {"territorialUnitId",V::str(mode=="territorial"?identity(optional(raw,"territorialUnitId"),"Territorial unit"):"")},
        {"geometry",mode=="geometry"?required(raw,"geometry"):V{}},{"value",V::num(numeric(required(raw,"value")))},
        {"certainty",V::str(certainty)},{"validFrom",dateValue(interval.from)},{"validTo",dateValue(interval.to)},
        {"metadata",metadata(optional(raw,"metadata"))}});
}
std::size_t existing(const ProjectSnapshot& snapshot,const ObjectRef& ref) {
    const auto found=snapshot.index().objects.find(ref);
    if(found==snapshot.index().objects.end())throw TimelineError("not-found","Content object was not found.");return found->second;
}
std::optional<std::size_t> genericIndex(const ProjectSnapshot& snapshot,const std::string& id) {
    const auto& rows=snapshot.document().genericFeatures;
    for(std::size_t i=0;i<rows.size();++i)if(trimWebText(rows[i].id)==trimWebText(id))return i;
    return {};
}
const DistributionLayer& layer(const ProjectSnapshot& snapshot,const std::string& id,const char* code) {
    const auto found=snapshot.index().objects.find({"distributionLayer",id});
    if(found==snapshot.index().objects.end())throw TimelineError(code,"Distribution layer was not found.");
    return snapshot.document().distributionLayers.at(found->second);
}
void unlocked(const DistributionLayer& value) {if(value.locked)throw TimelineError("locked","Distribution layer is locked.");}
ContentEdit rowEdit(const ProjectSnapshot& snapshot,const std::string& domain,const V& row,bool create) {
    return projectcodec::readWebContentEdit(snapshot,{domain,required(row,"id").string},row,create);
}
template<class F> auto invalidBoundary(F&& action) -> decltype(action()) {
    try{return action();}catch(const TimelineError& error){if(error.code=="locked"||error.code=="not-found"||error.code=="layer-not-found"||error.code=="territorial-unit-not-found")throw;throw TimelineError("invalid",error.what());}
    catch(const std::invalid_argument& error){throw TimelineError("invalid",error.what());}
}
}
CommandRequest readWebContentCommand(const ProjectSnapshot& snapshot,const std::string& operationId,const V& payload) {
    if(payload.kind!=V::Object)throw TimelineError("CORE_COMMAND_PAYLOAD","Content payload must be an object.");
    static const std::set<std::string> operations={"generic.create","generic.import","generic.metadata","generic.remove",
        "distribution.layer.create","distribution.layer.metadata","distribution.layer.remove",
        "distribution.entry.create","distribution.entry.value","distribution.entry.remove","distribution.import",
        "label.edit","hydro.edit","hydro.metadata","generic.color-reset","hydro.geometry","hydro.copy"};
    if(!operations.count(operationId))throw TimelineError("CORE_COMMAND_ID","Unsupported content operation: "+operationId);
    CommandRequest request;request.commandId=operationId;request.projectInstanceId=snapshot.instanceId();
    const auto objectId=[&](const V& value) {
        return text(value);
    };
    request.documentId=snapshot.document().documentId;request.revision=snapshot.revision();
    const auto set=[&](ContentEdit edit){request.targets={edit.target};request.args.action=std::move(edit);};
    if(operationId=="generic.create") {
        const auto row=generic(required(payload,"feature"));const auto id=required(row,"id").string;
        if(genericIndex(snapshot,id))throw std::invalid_argument("Duplicate generic ID: "+id);
        set(rowEdit(snapshot,"generic",row,true));
    }
    else if(operationId=="generic.import"||operationId=="distribution.import") {
        ContentBatchEdit batch;batch.kind=operationId=="generic.import"?ContentImportKind::Generic:ContentImportKind::Distribution;
        const auto append=[&](const V& rows,const std::string& domain,auto normalize) {
            // The original generic collection normalizer treats a non-array as empty.
            if(rows.kind!=V::Array)return;
            for(const auto& row:rows.array)batch.edits.push_back(rowEdit(snapshot,domain,normalize(row),true));
        };
        if(batch.kind==ContentImportKind::Generic)append(optional(payload,"features"),"generic",generic);
        else {
            for(const auto* key:{"layers","entries"})if(payload.object.count(key)&&required(payload,key).kind!=V::Array)
                throw std::invalid_argument("Distribution import collections must be arrays.");
            append(optional(payload,"layers"),"distributionLayer",[](const V& row){return distributionLayer(row,false);});
            append(optional(payload,"entries"),"distributionEntry",[](const V& row){return distributionEntry(row,false);});
        }
        std::set<ObjectRef> seen;for(const auto& edit:batch.edits) {
            const auto dedup=edit.target.domain=="generic"?ObjectRef{"generic",trimWebText(edit.target.id)}:edit.target;
            if(!seen.insert(dedup).second||(edit.target.domain=="generic"?bool(genericIndex(snapshot,edit.target.id)):bool(snapshot.index().objects.count(edit.target))))
                throw std::invalid_argument("Duplicate content import ID: "+edit.target.id);
            request.targets.push_back(edit.target);
        }
        request.args.action=std::move(batch);
    } else if(operationId=="distribution.layer.create") {
        const auto row=distributionLayer(required(payload,"options"),true);const auto id=required(row,"id").string;
        if(snapshot.index().objects.count({"distributionLayer",id}))throw std::invalid_argument("Duplicate distribution layer ID: "+id);
        set(rowEdit(snapshot,"distributionLayer",row,true));
    }
    else if(operationId=="distribution.entry.create") {
        const auto& options=required(payload,"options");const auto& owner=layer(snapshot,text(optional(options,"layerId")),"layer-not-found");unlocked(owner);
        if(text(optional(options,"mode"))=="territorial"&&!snapshot.index().objects.count(territorialRef(text(optional(options,"territorialUnitId")))))
            throw TimelineError("territorial-unit-not-found","Territorial unit was not found.");
        set(invalidBoundary([&]{
            const auto row=distributionEntry(options,true);const auto id=required(row,"id").string;
            if(snapshot.index().objects.count({"distributionEntry",id}))throw std::invalid_argument("Duplicate distribution entry ID: "+id);
            return rowEdit(snapshot,"distributionEntry",row,true);
        }));
    } else if(operationId=="hydro.copy") {
        auto row=hydro(required(payload,"feature"));set(rowEdit(snapshot,"hydro",row,true));
    } else if(operationId=="hydro.geometry") {
        const ObjectRef ref{"hydro",objectId(required(payload,"id"))};existing(snapshot,ref);
        auto row=projectcodec::webContentValue(snapshot,ref);row.object["geometry"]=required(payload,"geometry");
        set(projectcodec::readWebContentEdit(snapshot,ref,row,false));
    } else if(operationId=="label.edit"||operationId=="hydro.edit") {
        const auto domain=operationId=="label.edit"?"label":"hydro";
        if(payload.object.count("domain")&&text(required(payload,"domain"))!=domain)throw TimelineError("CORE_COMMAND_PAYLOAD","Content domain does not match operation.");
        const ObjectRef ref{domain,objectId(required(payload,"id"))};
        const auto create=flag(optional(payload,"create"));
        const auto value=domain==std::string("hydro")&&create?
            hydro(required(payload,"value")):required(payload,"value");
        auto edit=projectcodec::readWebContentEdit(snapshot,ref,value,create);
        if(edit.create&&domain==std::string("label"))
            edit.initialLabelSettings=automaticLabelSettings(std::get<PlaceLabel>(edit.value).kind,readWebLabelSettings(optional(payload,"labelSettings")));
        set(std::move(edit));
    } else {
        const auto domain=operationId.rfind("generic.",0)==0?"generic":operationId.rfind("distribution.layer.",0)==0?"distributionLayer":
            operationId.rfind("distribution.entry.",0)==0?"distributionEntry":operationId=="hydro.metadata"?"hydro":"";
        if(!*domain)throw TimelineError("CORE_COMMAND_ID","Unsupported content operation: "+operationId);
        ObjectRef ref{domain,objectId(required(payload,"id"))};std::size_t index=0;
        if(ref.domain=="generic") {
            {const auto found=genericIndex(snapshot,ref.id);if(!found)throw TimelineError("not-found","Content object was not found.");
                index=*found;ref.id=snapshot.document().genericFeatures.at(index).id;}
        } else index=existing(snapshot,ref);
        ContentEdit edit;edit.target=ref;
        if(operationId=="generic.remove"||operationId=="distribution.layer.remove"||operationId=="distribution.entry.remove") {
            if(ref.domain=="distributionLayer")unlocked(snapshot.document().distributionLayers.at(index));
            else if(ref.domain=="distributionEntry")unlocked(layer(snapshot,snapshot.document().distributionEntries.at(index).layerId,"not-found"));
        } else if(operationId=="generic.color-reset") {
            auto value=snapshot.document().genericFeatures.at(index);value.color=0x8c68d8;value.explicitColor=false;edit.value=std::move(value);
        } else if(operationId=="generic.metadata") {
            auto value=snapshot.document().genericFeatures.at(index);const auto name=webCommandString(required(payload,"field"));const auto& input=required(payload,"value");
            if(name=="name")value.name=text(input);else if(name=="notes")value.notes=text(input);else if(name=="locked")value.locked=flag(input);
            else if(name=="color"){value.color=projectcodec::readWebColor(input);value.explicitColor=true;}else if(name=="source")value.source=projectcodec::readWebSourceProvenance(input);
            else throw TimelineError("unsupported-field","기타 객체에 지원하지 않는 필드 "+name+"가 있습니다.");edit.value=std::move(value);
        } else if(operationId=="hydro.metadata") {
            auto value=snapshot.document().hydro.at(index);if(value.locked)throw TimelineError("locked","Hydro object is locked.");
            const auto name=webCommandString(required(payload,"field"));const auto& input=required(payload,"value");
            if(name=="name")value.name=webCommandString(input);else if(name=="notes")value.notes=webCommandString(input);
            else if(name=="locked")value.locked=flag(input);else if(name=="editorColor")value.color=projectcodec::readWebColor(input);
            else throw TimelineError("invalid","Unsupported hydro field: "+name);
            if(value.webPropertyFields)value.webPropertyFields->insert(name);edit.value=std::move(value);
        } else if(operationId=="distribution.layer.metadata") {
            auto value=snapshot.document().distributionLayers.at(index);const auto name=webCommandString(required(payload,"field"));const auto& input=required(payload,"value");
            if(name!="locked")unlocked(value);
            edit.value=invalidBoundary([&]() -> ContentValue {
                if(name=="name"){value.name=text(input);if(value.name.empty())value.name=value.id;}
                else if(name=="unit")value.unit=text(input);else if(name=="locked")value.locked=flag(input);
                else if(name=="color"){value.color=projectcodec::readWebColor(input);value.explicitColor=true;}else if(name=="parentId")value.parentId=date(input);
                else if(name=="groups"){value.groups.clear();for(const auto& group:groups(input).array)value.groups.push_back(group.string);}
                else if(name=="metadata")value.metadata=metadata(input).encode();else if(name=="valueScale")value.valueScale=scale(input);
                else if(name=="validFrom")value.validity=validity(input,dateValue(value.validity.to));else if(name=="validTo")value.validity=validity(dateValue(value.validity.from),input);
                else if(name=="schemaVersion"){if(numeric(input)!=3)throw std::invalid_argument("Unsupported distribution schemaVersion.");}
                else throw std::invalid_argument("Unsupported distribution layer field: "+name);
                return value;
            });
        } else if(operationId=="distribution.entry.value") {
            auto value=snapshot.document().distributionEntries.at(index);unlocked(layer(snapshot,value.layerId,"not-found"));
            value.value=invalidBoundary([&]{return numeric(required(payload,"value"));});edit.value=std::move(value);
        } else throw TimelineError("CORE_COMMAND_ID","Unsupported content operation: "+operationId);
        set(std::move(edit));
    }
    return request;
}
}
