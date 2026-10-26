#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/webobjectcommands.h>
#include <pandoeditor/project.h>
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/webterritorialcommands.h>
#include <algorithm>
#include <map>
#include <set>

namespace pandoeditor {
namespace {
using V=codecjson::Value;
void require(bool condition,const char* code,const std::string& detail) {
    if(!condition)throw TimelineError(code,detail);
}
const V& field(const V& value,const char* key) {
    require(value.kind==V::Object&&value.object.count(key),"CORE_COMMAND_PAYLOAD",std::string("Missing object-removal field: ")+key);
    return value.object.at(key);
}
void keys(const V& value,std::initializer_list<const char*> allowed) {
    require(value.kind==V::Object,"CORE_COMMAND_PAYLOAD","Object-removal values must be objects.");
    std::set<std::string> known;for(const auto* name:allowed)known.insert(name);
    for(const auto& [name,item]:value.object)require(known.count(name),"CORE_COMMAND_PAYLOAD","Unknown object-removal field: "+name);
}
bool supported(const std::string& domain) {
    return domain=="territorial"||domain=="distributionLayer"||domain=="generic"||domain=="hydro"||domain=="label";
}
struct ActiveTerritories {
    std::map<std::string,std::string> parents;
    std::set<std::string> roots;
};
ActiveTerritories activeTerritories(const ProjectSnapshot& snapshot) {
    const auto& d=snapshot.document();ActiveTerritories result;
    const auto append=[&](const TerritorialUnit& unit,const std::string& parent) {
        result.parents.emplace(unit.id,parent);if(unit.kind==UnitKind::General&&parent.empty())result.roots.insert(unit.id);
    };
    if(snapshot.timelineEditsEnabled()||!isStaticTimeline(d)) {
        const auto world=resolveWorld(d.timelineRecords,{timelineEntityCatalog(d),[&](const ObjectRef& owner,const GeometryRef& ref){return bool(d.geometries.get(ref));}},snapshot.timelineMonth());
        for(const auto& row:world.entities)if(row.objectRef.domain=="territorial")append(d.units.at(snapshot.index().objects.at(row.objectRef)),row.parentId);
    } else for(const auto& unit:d.units)append(unit,staticParentRelation(d,unit.id).parentId);
    return result;
}
void admit(const ProjectSnapshot& snapshot,const WebObjectRemoval& intent,const ActiveTerritories& active) {
    require(!intent.refs.empty(),"CORE_COMMAND_PAYLOAD","Object removal needs at least one reference.");
    const auto& d=snapshot.document();
    for(const auto& ref:intent.refs) {
        require(supported(ref.domain),"unsupported","This object domain cannot be removed through the current Web UI.");
        require(!ref.id.empty(),"CORE_COMMAND_PAYLOAD","Object-removal identity is empty.");
        const auto found=snapshot.index().objects.find(ref);require(found!=snapshot.index().objects.end(),"not-found","Removal object was not found: "+ref.id);
        bool locked=false;
        if(ref.domain=="territorial") {
            require(active.parents.count(ref.id),"not-found","Removal territorial entity is inactive: "+ref.id);
            locked=d.units.at(found->second).locked;
        } else if(ref.domain=="distributionLayer")locked=d.distributionLayers.at(found->second).locked;
        else if(ref.domain=="generic")locked=d.genericFeatures.at(found->second).locked;
        else if(ref.domain=="hydro")locked=d.hydro.at(found->second).locked;
        require(!locked,"locked","Removal object is locked: "+ref.id);
        if(ref.domain=="territorial")for(const auto& [id,parent]:active.parents)
            require(parent!=ref.id,"has-children","A territorial entity with active children cannot be deleted, even when the children are selected.");
    }
}
std::string displayId(const ProjectDocument& d,const ActiveTerritories& active,const std::string& id) {
    if(active.roots.count(id))return id;
    const auto ordinary="territorial:entity:"+id;
    const auto unit=std::find_if(d.units.begin(),d.units.end(),[&](const auto& row){return row.id==id;});
    if(unit==d.units.end()||unit->kind!=UnitKind::General||active.parents.at(id).empty()||!d.presentation.catalog)return ordinary;
    const auto source=d.presentation.catalog->builtinSubunitSources.find(id);
    if(source==d.presentation.catalog->builtinSubunitSources.end()||active.roots.count(source->second))return ordinary;
    const auto metadata=codecjson::parse(unit->metadata);const auto builtin=metadata.object.find("builtinSubunit");
    if(builtin==metadata.object.end()||builtin->second.kind!=V::Object)return ordinary;
    const auto code=builtin->second.object.find("sourceCountryId");
    return code!=builtin->second.object.end()&&code->second.kind==V::String&&code->second.string==source->second?source->second:ordinary;
}
template<class Rows>void erase(Rows& rows,const std::set<std::string>& ids) {
    rows.erase(std::remove_if(rows.begin(),rows.end(),[&](const auto& row){return ids.count(row.id);}),rows.end());
}
void restoreHydroSources(ProjectDocument& candidate,const std::set<std::string>& sourceIds,const std::string& month) {
    const auto world=resolveWorld(candidate.timelineRecords,{timelineEntityCatalog(candidate),[&](const ObjectRef&,const GeometryRef& ref){return candidate.geometries.get(ref)!=nullptr;}},month);
    std::set<std::string> restore;
    for(const auto& id:sourceIds)if(std::none_of(candidate.hydro.begin(),candidate.hydro.end(),[&](const auto& row){return row.sourceFeatureId==id&&world.find({"hydro",row.id});}))restore.insert(id);
    if(restore.empty())return;
    auto header=codecjson::parse(candidate.exchangeMetadata);const auto settings=header.object.find("physicalSettings");
    require(settings!=header.object.end()&&settings->second.kind==V::Object,"invalid","Copied-hydro removal needs current physical settings.");
    auto hidden=settings->second.object.find("hiddenHydroIds");
    require(hidden!=settings->second.object.end()&&hidden->second.kind==V::Object,"invalid","Copied-hydro removal needs the current hidden-source map.");
    for(const auto& id:restore)hidden->second.object.erase(id);candidate.exchangeMetadata=header.encode();
}
}
CommandRequest readWebObjectRemoval(const ProjectSnapshot& snapshot,const V& payload) {
    keys(payload,{"refs"});const auto& rows=field(payload,"refs");require(rows.kind==V::Array,"CORE_COMMAND_PAYLOAD","Removal refs must be an array.");
    WebObjectRemoval intent;std::set<ObjectRef> seen;
    for(const auto& row:rows.array) {
        keys(row,{"domain","id"});const auto& domain=field(row,"domain"),&id=field(row,"id");
        require(domain.kind==V::String&&id.kind==V::String,"CORE_COMMAND_PAYLOAD","Removal references require string domain and ID.");
        ObjectRef ref{domain.string,id.string};if(seen.insert(ref).second)intent.refs.push_back(std::move(ref));
    }
    admit(snapshot,intent,activeTerritories(snapshot));const auto targets=intent.refs;
    CommandArguments args;args.action=std::move(intent);
    return {"objects.remove",snapshot.instanceId(),snapshot.document().documentId,snapshot.revision(),targets,std::move(args)};
}
ProjectDocument applyWebObjectRemoval(const ProjectSnapshot& snapshot,const WebObjectRemoval& intent) {
    const auto active=activeTerritories(snapshot);admit(snapshot,intent,active);const auto& before=snapshot.document();
    std::map<std::string,std::set<std::string>> removed;std::vector<std::string> territorialIds;
    for(const auto& ref:intent.refs)if(removed[ref.domain].insert(ref.id).second&&ref.domain=="territorial")territorialIds.push_back(ref.id);
    auto candidate=before;
    if(!territorialIds.empty()) {
        WebTerritorialEdit deletion;deletion.operation=WebTerritorialOperation::Remove;deletion.removedIds=territorialIds;
        candidate=applyWebTerritorialEdit(snapshot,deletion);
    }
    std::set<std::string> hydroSources;
    for(const auto& row:before.hydro)if(removed["hydro"].count(row.id)&&row.sourceFeatureId&&!row.sourceFeatureId->empty())hydroSources.insert(*row.sourceFeatureId);
    erase(candidate.distributionLayers,removed["distributionLayer"]);
    for(auto& row:candidate.distributionLayers)if(row.parentId&&removed["distributionLayer"].count(*row.parentId))row.parentId.reset();
    candidate.distributionEntries.erase(std::remove_if(candidate.distributionEntries.begin(),candidate.distributionEntries.end(),[&](const auto& row) {
        const bool deleting=removed["distributionLayer"].count(row.layerId)||(row.territory&&removed["territorial"].count(row.territory->id));
        if(deleting) {
            candidate.presentation.objectStyles.erase({"distributionEntry",row.id});
        }
        return deleting;
    }),candidate.distributionEntries.end());
    erase(candidate.genericFeatures,removed["generic"]);erase(candidate.labels,removed["label"]);
    std::set<std::string> retiredWater;
    for(const auto& id:removed["hydro"]) {
        const ObjectRef ref{"hydro",id};
        if(snapshot.timelineEditsEnabled()||!isStaticTimeline(before))candidate.timelineRecords=truncateTimelineEntityAtMonth(candidate.timelineRecords,ref,snapshot.timelineMonth());
        else removeObjectTimelineRecords(candidate,ref);
        if(std::none_of(candidate.timelineRecords.lifetimes.begin(),candidate.timelineRecords.lifetimes.end(),[&](const auto& row){return row.objectRef==ref;}))retiredWater.insert(id);
    }
    erase(candidate.hydro,retiredWater);
    restoreHydroSources(candidate,hydroSources,snapshot.timelineMonth());
    auto& view=candidate.presentation.webPresentation;
    for(const auto& id:removed["label"])view.labelSettings.erase({"label",id});
    for(const auto& id:territorialIds) {
        view.labelSettings.erase(territorialRef(id));view.objectStyles.erase(territorialPresentationKey(id));
        view.eraseItemVisibility("objectLabels",displayId(before,active,id));
        view.eraseItemVisibility("objects",id);view.eraseItemVisibility("objectLabels",id);
    }
    // Remove owner-specific styles when their content rows are deleted.
    for(const auto& ref:intent.refs)if(ref.domain!="territorial"&&(ref.domain!="hydro"||retiredWater.count(ref.id))) {
        candidate.presentation.objectStyles.erase(ref);
    }
    // Current Web labels keep the non-owning territorialUnitId annotation;
    // content itemVisibility and ordering hints also remain exactly as stored.
    return candidate;
}
std::string webTerritorialLabelDisplayId(const ProjectSnapshot& snapshot,const std::string& id) {
    return displayId(snapshot.document(),activeTerritories(snapshot),id);
}
}
