#include <pandoeditor/timeline-records.h>
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/timeline-resolver.h>
#include <pandoeditor/objectproperties.h>
#include <cmath>
#include <array>
#include <cstdlib>
#include <exception>
#include <set>

namespace pandoeditor {
codecjson::Value normalizeTerritorialNames(const codecjson::Value& input) {
    using V=codecjson::Value;
    const auto bad=[](){throw TimelineError("TIMELINE_NAME","Invalid multilingual names");};
    if(input.kind!=V::Object||input.object.empty())bad();
    auto result=input;
    const auto item=[&](V& row,bool native) {
        if(row.kind!=V::Object||row.object.empty())bad();
        bool named=false;
        for(auto& [key,value]:row.object) {
            if(key=="language"&&native) {
                if(value.kind!=V::String||value.string.empty())bad();
                for(char ch:value.string)if(!((ch>='a'&&ch<='z')||(ch>='A'&&ch<='Z')||(ch>='0'&&ch<='9')||ch=='-'))bad();
            } else if(key=="common"||key=="formal") {
                if(value.kind!=V::String||trimWebText(value.string).empty())bad();
                named=true;
            } else if(key=="aliases") {
                if(value.kind!=V::Array)bad();
                std::set<std::string> seen;
                for(const auto& alias:value.array)if(alias.kind!=V::String||trimWebText(alias.string).empty()||!seen.insert(alias.string).second)bad();
            } else bad();
        }
        if(!named||(native&&!row.object.count("language")))bad();
    };
    bool named=false;
    for(auto& [key,value]:result.object) {
        if(key=="ko"||key=="en"){item(value,false);named=true;}
        else if(key=="native") {
            if(value.kind!=V::Array)bad();
            std::set<std::string> languages;
            for(auto& row:value.array){item(row,true);if(!languages.insert(row.object.at("language").string).second)bad();named=true;}
        } else bad();
    }
    if(!named)bad();
    return result;
}
std::string territorialCommonName(const codecjson::Value& names) {
    const auto text=[](const auto& row){const auto found=row.object.find("common");return found!=row.object.end()?found->second.string:row.object.at("formal").string;};
    for(const char* key:{"ko","en"})if(names.object.count(key))return text(names.object.at(key));
    const auto found=names.object.find("native");
    return found!=names.object.end()&&!found->second.array.empty()?text(found->second.array.front()):"";
}
codecjson::Value territorialLibraryNames(const codecjson::Value& entity,const std::optional<std::string>& referenceDate) {
    using V=codecjson::Value;
    const auto validity=[](const V& row) {
        if(row.kind!=V::Object||!row.object.count("validFrom")||!row.object.count("validTo"))throw TimelineError("TIMELINE_NAME","Missing name interval");
        const auto endpoint=[](const V& v)->std::optional<std::string>{if(v.kind==V::Null)return {};if(v.kind!=V::String)throw TimelineError("TIMELINE_NAME","Invalid name endpoint");parseTemporal(v.string);return v.string;};
        Validity result{endpoint(row.object.at("validFrom")),endpoint(row.object.at("validTo"))};normalizeTemporalInterval(result.from,result.to);return result;
    };
    const auto lifetime=validity(entity.object.at("lifetime"));
    V versions=V::arr();std::vector<Validity> intervals;
    if(const auto found=entity.object.find("nameVersions");found!=entity.object.end()) {
        if(found->second.kind!=V::Array||found->second.array.empty())throw TimelineError("TIMELINE_NAME","Empty name history");
        for(auto row:found->second.array) {
            if(row.object.size()!=3||!row.object.count("names"))throw TimelineError("TIMELINE_NAME","Invalid name version");
            intervals.push_back(validity(row));row.object["names"]=normalizeTerritorialNames(row.object.at("names"));versions.array.push_back(std::move(row));
        }
    } else {
        V names=V::obj(),native=V::arr();
        for(const auto& [language,value]:entity.object.at("names").object) {
            V row=V::obj();row.object["common"]=value;
            if(language=="ko"||language=="en")names.object[language]=row;
            else {row.object["language"]=V::str(language=="native"?"und":language);native.array.push_back(row);}
        }
        if(!native.array.empty())names.object["native"]=native;
        V row=V::obj();row.object["validFrom"]=V{};row.object["validTo"]=V{};row.object["names"]=normalizeTerritorialNames(names);
        versions.array.push_back(row);intervals.push_back({});
    }
    for(std::size_t i=0;i<intervals.size();++i)for(std::size_t j=i+1;j<intervals.size();++j) {
        const auto a=normalizeTemporalInterval(intervals[i].from,intervals[i].to),b=normalizeTemporalInterval(intervals[j].from,intervals[j].to);
        if((!a.start||!b.end||!(b.end->endKey<a.start->startKey))&&(!b.start||!a.end||!(a.end->endKey<b.start->startKey)))throw TimelineError("TIMELINE_NAME","Overlapping name versions");
    }
    std::optional<std::size_t> selected;
    if(referenceDate)selected=selectTimelineVersion(lifetime,intervals,referenceDate);
    else {
        selected=0;
        for(std::size_t i=1;i<intervals.size();++i)if(intervals[i].from&&(!intervals[*selected].from||parseTemporal(*intervals[*selected].from).startKey<parseTemporal(*intervals[i].from).startKey))selected=i;
    }
    V result=V::obj();result.object["versions"]=versions;
    result.object["names"]=selected?versions.array[*selected].object.at("names"):V{};
    result.object["name"]=V::str(selected?territorialCommonName(result.object.at("names")):"");
    V search=V::arr();std::set<std::string> seen;
    const auto add=[&](const V& v){if(v.kind==V::String&&seen.insert(v.string).second)search.array.push_back(v);};
    for(const auto& version:versions.array)for(const auto& [key,names]:version.object.at("names").object) {
        const auto collect=[&](const V& row){for(const auto& [field,value]:row.object)if(field=="common"||field=="formal")add(value);else if(field=="aliases")for(const auto& alias:value.array)add(alias);};
        if(key=="native")for(const auto& row:names.array)collect(row);else collect(names);
    }
    if(entity.object.count("alternateNames"))for(const auto& alias:entity.object.at("alternateNames").array)add(alias);
    result.object["searchNames"]=search;return result;
}
namespace {
[[noreturn]] void fail(const std::string& code,const std::string& detail) {
    throw TimelineError(code,detail);
}
void requireId(const std::string& value) {
    if(value.empty()) fail("TIMELINE_ID","A nonempty string ID is required.");
}
TemporalInterval interval(const Validity& value) {
    try {
        // A blank string is invalid, not an implicit unbounded endpoint.
        if(value.from) parseTemporal(*value.from);
        if(value.to) parseTemporal(*value.to);
        return normalizeTemporalInterval(value.from,value.to);
    } catch(const std::invalid_argument& error) {
        std::throw_with_nested(TimelineError("TIMELINE_INTERVAL",error.what()));
    }
}
struct Change {
    std::size_t slot;
    std::string id,parentId;
    ObjectRef objectRef;
    bool add;
};
using Slots=std::array<std::map<std::string,std::string>,6>;
void inspect(const std::map<ObjectRef,Slots>& active) {
    for(const auto& [ref,slots]:active) {
        for(const auto& slot:slots) if(slot.size()>1)
            fail("TIMELINE_OVERLAP","Concurrent records for "+ref.domain+":"+ref.id+".");
    }
    std::map<std::string,std::string> parents;
    for(const auto& [ref,slots]:active) {
        const auto& life=slots[0]; const auto& geometry=slots[1]; const auto& parent=slots[2];
        if(life.empty()&&(!geometry.empty()||!parent.empty()))
            fail("TIMELINE_OUTSIDE_LIFETIME","Records outside the lifetime of "+ref.domain+":"+ref.id+".");
        if(life.empty())for(std::size_t i=3;i<slots.size();++i)if(!slots[i].empty())
            fail("TIMELINE_OUTSIDE_LIFETIME","Properties outside the lifetime of "+ref.domain+":"+ref.id+".");
        if(!life.empty()) {
            if(ref.domain=="territorial" && geometry.empty()!=parent.empty()) fail("TIMELINE_GAP","Geometry and parent coverage differ for "+ref.domain+":"+ref.id+".");
            if(!parent.empty()) parents.emplace(ref.id,parent.begin()->second);
        }
    }
    for(const auto& [id,parent]:parents) {
        if(!parent.empty()&&!parents.count(parent))
            fail("TIMELINE_PARENT_INACTIVE","Inactive parent "+parent+" for "+id+".");
    }
    std::set<std::string> settled;
    for(const auto& entry:parents) {
        std::set<std::string> path;
        auto cursor=entry.first;
        while(!cursor.empty()&&!settled.count(cursor)) {
            if(!path.insert(cursor).second) fail("TIMELINE_CYCLE","Parent cycle at "+cursor+".");
            cursor=parents.at(cursor);
        }
        settled.insert(path.begin(),path.end());
    }
}
}

TimelineRecords normalizeTimelineRecords(const TimelineRecords& input,const TimelineValidationContext& context) {
    if(input.schemaVersion!=TimelineRecordSchemaVersion) fail("TIMELINE_SCHEMA","Unsupported timeline version.");
    if(!context.geometryExists) fail("TIMELINE_CONTEXT","A geometry repository is required.");
    std::map<ObjectRef,std::string> entities;
    std::map<ObjectRef,Slots> active;
    for(const auto& entity:context.entities) {
        requireId(entity.objectRef.id);
        if(entity.objectRef.domain!="territorial"&&entity.objectRef.domain!="hydro"&&entity.objectRef.domain!="hydroBuiltin")fail("TIMELINE_KIND","Unsupported object domain.");
        if(entities.count(entity.objectRef)) fail("TIMELINE_ENTITY","Duplicate object "+entity.objectRef.id+".");
        if((entity.objectRef.domain=="territorial" && entity.entityKind!="general" && entity.entityKind!="regional") ||
           (entity.objectRef.domain!="territorial" && entity.entityKind!="river" && entity.entityKind!="lake")) fail("TIMELINE_KIND","Invalid object kind.");
        entities.emplace(entity.objectRef,entity.entityKind);
        active.emplace(entity.objectRef,Slots{});
    }
    std::set<std::string> ids;
    std::set<ObjectRef> hasLife;
    std::map<std::optional<TemporalKey>,std::vector<Change>> events;
    events[std::nullopt];
    auto result=input;
    const auto common=[&](auto& row,std::size_t slot,const std::string& parentId) {
        requireId(row.id); requireId(row.objectRef.id);
        if(!ids.insert(row.id).second) fail("TIMELINE_ID","Duplicate record "+row.id+".");
        if(!entities.count(row.objectRef)) fail("TIMELINE_ENTITY","Unknown object "+row.objectRef.id+".");
        const auto dates=interval(row.validity);
        row.validity={dates.validFrom,dates.validTo};
        const auto start=dates.start?std::optional<TemporalKey>{dates.start->startKey}:std::nullopt;
        events[start].push_back({slot,row.id,parentId,row.objectRef,true});
        if(dates.end) events[temporalFollowingDay(dates.end->endKey)].push_back({slot,row.id,parentId,row.objectRef,false});
    };
    for(auto& row:result.lifetimes) {
        common(row,0,{});
        hasLife.insert(row.objectRef);
    }
    for(auto& row:result.geometryBindings) {
        common(row,1,{});
        if(row.geometryRef.id.empty()||row.geometryRef.version==0)
            fail("TIMELINE_GEOMETRY","Invalid geometry reference for "+row.id+".");
        const auto rendering=codecjson::parse(row.rendering);
        if(rendering.kind!=codecjson::Value::Object)fail("TIMELINE_GEOMETRY","Rendering inputs must be an object.");
        if(row.objectRef.domain=="territorial"&&!rendering.object.empty())fail("TIMELINE_KIND","Water rendering inputs on a territorial binding.");
        for(const auto& [key,value]:rendering.object) {
            if(key!="stroke_width"&&key!="stroke_widths"&&key!="border_aligned"&&key!="connectivity")fail("TIMELINE_GEOMETRY","Unknown rendering input.");
            if(key=="stroke_width"&&(value.kind!=codecjson::Value::Number||!std::isfinite(std::stod(value.raw))||std::stod(value.raw)<0))fail("TIMELINE_GEOMETRY","Invalid river width.");
            if(key=="stroke_widths") {
                if(value.kind!=codecjson::Value::Array)fail("TIMELINE_GEOMETRY","Invalid width profile.");
                for(const auto& part:value.array){
                    if(part.kind!=codecjson::Value::Array)fail("TIMELINE_GEOMETRY","Expected per-part river widths.");
                    for(const auto& width:part.array)if(width.kind!=codecjson::Value::Number||!std::isfinite(std::stod(width.raw))||std::stod(width.raw)<0)fail("TIMELINE_GEOMETRY","Invalid vertex width.");
                }
            }
            if(key=="border_aligned"&&value.kind!=codecjson::Value::Bool)fail("TIMELINE_GEOMETRY","Invalid river alignment.");
        }
        row.rendering=rendering.encode();
        // Repository exceptions propagate unchanged; they are not missing records.
        if(!context.geometryExists(row.objectRef,row.geometryRef)) fail("TIMELINE_GEOMETRY","Missing geometry for "+row.id+".");
    }
    for(auto& row:result.parentRelations) {
        if(row.objectRef.domain!="territorial")fail("TIMELINE_KIND","Only territorial objects have administrative parents.");
        common(row,2,row.parentId);
        if(row.coverageMode!="explicit"&&row.coverageMode!="partition") fail("TIMELINE_COVERAGE","Invalid coverage mode for "+row.id+".");
        if(row.parentId==row.objectRef.id) fail("TIMELINE_CYCLE","Self-parent "+row.objectRef.id+".");
        if(!row.parentId.empty()&&!entities.count(ObjectRef{"territorial",row.parentId})) fail("TIMELINE_PARENT","Unknown parent "+row.parentId+".");
        if(!row.parentId.empty()&&(entities.at(row.objectRef)!="general"||entities.at(ObjectRef{"territorial",row.parentId})!="general"))
            fail("TIMELINE_KIND","Both ends of an administrative relationship must be general entities.");
        if(row.parentId.empty()&&row.coverageMode!="explicit") fail("TIMELINE_COVERAGE","Roots and regional entities must be explicit.");
    }
    for(auto& row:result.propertyBindings) {
        const auto slot=row.property=="name"?3:row.property=="flag"?4:row.property=="color"?5:0;
        if(!slot)fail("TIMELINE_PROPERTY","Unsupported temporal property.");
        common(row,slot,{});
        if(row.property=="flag" && row.objectRef.domain!="territorial")fail("TIMELINE_PROPERTY","Flags belong to territorial objects.");
        using V=codecjson::Value;
        const auto value=codecjson::parse(row.value);
        if(value.kind!=V::Object)fail("TIMELINE_PROPERTY","Property value must be an object.");
        const auto field=[&](const char* key)->const V& {
            const auto found=value.object.find(key);if(found==value.object.end())fail("TIMELINE_PROPERTY",std::string("Missing ")+key);return found->second;
        };
        if(row.property=="name") {
            if(value.object.size()!=(value.object.count("names")?3:2)||field("name").kind!=V::String||field("nameExplicit").kind!=V::Bool)
                fail("TIMELINE_PROPERTY","Invalid name value.");
            if(value.object.count("names"))normalizeTerritorialNames(field("names"));
        }else if(row.property=="color") {
            if(value.object.size()!=2||field("color").kind!=V::Number||field("explicitColor").kind!=V::Bool)
                fail("TIMELINE_PROPERTY","Invalid color value.");
            const auto number=std::stod(field("color").raw);
            if(!std::isfinite(number)||number<0||number>0xffffff||number!=std::floor(number))fail("TIMELINE_PROPERTY","Invalid color.");
        }else {
            if(value.object.size()!=4||field("policy").kind!=V::String||field("embeddedDataUrl").kind!=V::String||
               field("defaultCountryId").kind!=V::String||
               (field("defaultFlagDataUrl").kind!=V::Null&&field("defaultFlagDataUrl").kind!=V::String))fail("TIMELINE_PROPERTY","Invalid flag value.");
            const auto& policy=field("policy").string;
            if(policy!="default"&&policy!="none"&&policy!="embedded")fail("TIMELINE_PROPERTY","Invalid flag policy.");
            if((policy=="embedded")==field("embeddedDataUrl").string.empty())fail("TIMELINE_PROPERTY","Invalid embedded flag.");
        }
        row.value=value.encode();
    }
    for(const auto& entry:entities) if(!hasLife.count(entry.first)) fail("TIMELINE_LIFETIME","No lifetime for "+entry.first.id+".");
    for(const auto& boundary:events) {
        // Inspect only after every simultaneous change has been applied.
        for(const auto& change:boundary.second) {
            auto& slot=active.at(change.objectRef)[change.slot];
            if(change.add) slot.emplace(change.id,change.parentId);
            else slot.erase(change.id);
        }
        inspect(active);
    }
    return result;
}
}
