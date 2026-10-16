#include <pandoeditor/timeline-records.h>
#include <pandoeditor/losslessjson.h>
#include <cmath>
#include <array>
#include <cstdlib>
#include <exception>
#include <set>

namespace pandoeditor {
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
    std::string id,entityId,parentId;
    bool add;
};
using Slots=std::array<std::map<std::string,std::string>,6>;
void inspect(const std::map<std::string,Slots>& active) {
    for(const auto& [id,slots]:active) {
        for(const auto& slot:slots) if(slot.size()>1)
            fail("TIMELINE_OVERLAP","Concurrent records for "+id+".");
    }
    std::map<std::string,std::string> parents;
    for(const auto& [id,slots]:active) {
        const auto& life=slots[0]; const auto& geometry=slots[1]; const auto& parent=slots[2];
        if(life.empty()&&(!geometry.empty()||!parent.empty()))
            fail("TIMELINE_OUTSIDE_LIFETIME","Records outside the lifetime of "+id+".");
        if(life.empty())for(std::size_t i=3;i<slots.size();++i)if(!slots[i].empty())
            fail("TIMELINE_OUTSIDE_LIFETIME","Properties outside the lifetime of "+id+".");
        if(!life.empty()) {
            if(geometry.empty()||parent.empty()) fail("TIMELINE_GAP","Incomplete lifetime coverage for "+id+".");
            parents.emplace(id,parent.begin()->second);
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
    std::map<std::string,std::string> entities;
    std::map<std::string,Slots> active;
    for(const auto& entity:context.entities) {
        requireId(entity.id);
        if(entities.count(entity.id)) fail("TIMELINE_ENTITY","Duplicate entity "+entity.id+".");
        if(entity.entityKind!="general"&&entity.entityKind!="regional") fail("TIMELINE_KIND","Invalid kind for "+entity.id+".");
        entities.emplace(entity.id,entity.entityKind);
        active.emplace(entity.id,Slots{});
    }
    std::set<std::string> ids,hasLife;
    std::map<std::optional<TemporalKey>,std::vector<Change>> events;
    events[std::nullopt];
    auto result=input;
    const auto common=[&](auto& row,std::size_t slot,const std::string& parentId) {
        requireId(row.id); requireId(row.entityId);
        if(!ids.insert(row.id).second) fail("TIMELINE_ID","Duplicate record "+row.id+".");
        if(!entities.count(row.entityId)) fail("TIMELINE_ENTITY","Unknown entity "+row.entityId+".");
        const auto dates=interval(row.validity);
        row.validity={dates.validFrom,dates.validTo};
        const auto start=dates.start?std::optional<TemporalKey>{dates.start->startKey}:std::nullopt;
        events[start].push_back({slot,row.id,row.entityId,parentId,true});
        if(dates.end) events[temporalFollowingDay(dates.end->endKey)].push_back({slot,row.id,row.entityId,parentId,false});
    };
    for(auto& row:result.lifetimes) {
        common(row,0,{});
        hasLife.insert(row.entityId);
    }
    for(auto& row:result.geometryBindings) {
        common(row,1,{});
        if(row.geometryRef.id.empty()||row.geometryRef.version==0)
            fail("TIMELINE_GEOMETRY","Invalid geometry reference for "+row.id+".");
        // Repository exceptions propagate unchanged; they are not missing records.
        if(!context.geometryExists(row.geometryRef)) fail("TIMELINE_GEOMETRY","Missing geometry for "+row.id+".");
    }
    for(auto& row:result.parentRelations) {
        common(row,2,row.parentId);
        if(row.coverageMode!="explicit"&&row.coverageMode!="partition") fail("TIMELINE_COVERAGE","Invalid coverage mode for "+row.id+".");
        if(row.parentId==row.entityId) fail("TIMELINE_CYCLE","Self-parent "+row.entityId+".");
        if(!row.parentId.empty()&&!entities.count(row.parentId)) fail("TIMELINE_PARENT","Unknown parent "+row.parentId+".");
        if(!row.parentId.empty()&&(entities.at(row.entityId)!="general"||entities.at(row.parentId)!="general"))
            fail("TIMELINE_KIND","Both ends of an administrative relationship must be general entities.");
        if(row.parentId.empty()&&row.coverageMode!="explicit") fail("TIMELINE_COVERAGE","Roots and regional entities must be explicit.");
    }
    for(auto& row:result.propertyBindings) {
        const auto slot=row.property=="name"?3:row.property=="flag"?4:row.property=="color"?5:0;
        if(!slot)fail("TIMELINE_PROPERTY","Unsupported temporal property.");
        common(row,slot,{});
        using V=codecjson::Value;
        const auto value=codecjson::parse(row.value);
        if(value.kind!=V::Object)fail("TIMELINE_PROPERTY","Property value must be an object.");
        const auto field=[&](const char* key)->const V& {
            const auto found=value.object.find(key);if(found==value.object.end())fail("TIMELINE_PROPERTY",std::string("Missing ")+key);return found->second;
        };
        if(row.property=="name") {
            if(value.object.size()!=2||field("name").kind!=V::String||field("nameExplicit").kind!=V::Bool)
                fail("TIMELINE_PROPERTY","Invalid name value.");
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
    for(const auto& entry:entities) if(!hasLife.count(entry.first)) fail("TIMELINE_LIFETIME","No lifetime for "+entry.first+".");
    for(const auto& boundary:events) {
        // Inspect only after every simultaneous change has been applied.
        for(const auto& change:boundary.second) {
            auto& slot=active.at(change.entityId)[change.slot];
            if(change.add) slot.emplace(change.id,change.parentId);
            else slot.erase(change.id);
        }
        inspect(active);
    }
    return result;
}
}
