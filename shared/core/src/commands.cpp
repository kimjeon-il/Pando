#include <pandoeditor/commands.h>
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/project.h>
#include <pandoeditor/objectproperties.h>
#include <pandoeditor/geometrypredicates.h>
#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/timeline-resolver.h>
#include <pandoeditor/timeline-view.h>
#include <pandoeditor/temporal.h>
#include <pandoeditor/webcommands.h>
#include "documentstate.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <stdexcept>
#include <type_traits>
#include <utility>

namespace pandoeditor {
bool isWebGeometryBatchCommand(const std::string& id) noexcept {
    for(const auto* name:{"territorial.annex","territorial.new-country","territorial.merge","territorial.from-generic",
        "territorial.import","territorial.library-import","territorial.edit","territorial.redraw-region","territorial.create-region","territorial.copy-region-for-display"})
        if(id==name)return true;return false;
}
bool advancesWebStateRevision(const CommandRequest& request) noexcept {
    if(const auto edit=std::get_if<WebObjectEdit>(&request.args.action))return edit->kind==WebObjectEditKind::Lock;
    if(request.commandId=="generic.color-reset")return false;
    if(request.commandId=="hydro.geometry")return true;
    if(std::holds_alternative<WebObjectRemoval>(request.args.action))return true;
    if(std::holds_alternative<WebTerritorialEdit>(request.args.action))return request.commandId=="territorial.parent"||request.commandId=="territorial.copy-region";
    if(request.commandId.rfind("generic.",0)==0||request.commandId.rfind("distribution.",0)==0||request.commandId=="hydro.metadata")return true;
    if(!request.args.properties.countries.empty()||!request.args.properties.fields.empty())return true;
    return std::visit([](const auto& action) {
        using T=std::decay_t<decltype(action)>;
        if constexpr(std::is_same_v<T,ContentEdit>)return action.target.domain=="territorial";
        else return std::is_same_v<T,SetCountryColor>||std::is_same_v<T,TerritorialFieldEdit>||
            std::is_same_v<T,TerritorialColorEdit>||std::is_same_v<T,TerritorialLockEdit>||std::is_same_v<T,ApplyTerritorialMutation>||
            std::is_same_v<T,HistoricalInstantiationPlan>||std::is_same_v<T,GisTerritorialImportPlan>||
            std::is_same_v<T,TimelineGeometryEdit>||std::is_same_v<T,TimelineParentEdit>||std::is_same_v<T,TimelineCreate>||
            std::is_same_v<T,TimelineDelete>||std::is_same_v<T,TimelineTerritorialMutation>;
    },request.args.action);
}
namespace {
struct Rejection { CommandError error; const char* detail; };
void require(bool condition,CommandError error,const char* detail)
{
    if(!condition) throw Rejection{error,detail};
}
bool opacity(double value) { return std::isfinite(value) && value>=0 && value<=1; }
const std::string& historicalInstanceId(const HistoricalAddition& addition) {
    return addition.instanceId.empty()?addition.selection.libraryId:addition.instanceId;
}

std::vector<ObjectRef> targetsFor(const CommandArguments& args)
{
    std::set<ObjectRef> refs;
    for(const auto& edit:args.properties.countries) {
        refs.insert(territorialRef(edit.id));
    }
    for(const auto& field:args.properties.fields)refs.insert(field.target);
    std::visit([&](const auto& action) {
        using T=std::decay_t<decltype(action)>;
        if constexpr(std::is_same_v<T,SetCountryColor>) {
            refs.insert(territorialRef(action.id));
        } else if constexpr(std::is_same_v<T,TerritorialFieldEdit>) refs.insert(action.target);
        else if constexpr(std::is_same_v<T,TerritorialColorEdit> || std::is_same_v<T,TerritorialLockEdit>) refs.insert(action.targets.begin(),action.targets.end());
        else if constexpr(std::is_same_v<T,ApplyTerritorialMutation>) refs.insert(action.plan.affectedObjects.begin(),action.plan.affectedObjects.end());
        else if constexpr(std::is_same_v<T,HistoricalInstantiationPlan>) {
            for(const auto& addition:action.additions) {
                refs.insert(ObjectRef{addition.selection.type?"territorial":"hydro",historicalInstanceId(addition)});
                if(addition.parent)refs.insert(*addition.parent);
                if(addition.sovereign)refs.insert(*addition.sovereign);
            }
            for(const auto& patch:action.territoryReplacements)refs.insert(patch.owner);
            for(const auto& [donor,target]:action.territoryTransfers)refs.insert(donor);
            for(const auto& [id,name]:action.countryNameUpdates)refs.insert(territorialRef(id));
        }
        else if constexpr(std::is_same_v<T,GisGenericImportPlan>)
            for(const auto& feature:action.features)refs.insert({"generic",feature.id});
        else if constexpr(std::is_same_v<T,GisTerritorialImportPlan>) {
            for(const auto& unit:action.units) {
                refs.insert(territorialRef(unit.id));
                if(unit.parent)refs.insert(*unit.parent);
                if(unit.sovereign)refs.insert(*unit.sovereign);
            }
            for(const auto& patch:action.countryReplacements)refs.insert(patch.owner);
        }
        else if constexpr(std::is_same_v<T,GisDistributionImportPlan>) {
            for(const auto& layer:action.layers)refs.insert({"distributionLayer",layer.id});
            for(const auto& row:action.entries) {
                refs.insert({"distributionEntry",row.entry.id});
                refs.insert({"distributionLayer",row.entry.layerId});
                if(row.entry.territory)refs.insert(*row.entry.territory);
            }
        }
        else if constexpr(std::is_same_v<T,ContentEdit>) refs.insert(action.target);
        else if constexpr(std::is_same_v<T,ContentBatchEdit>)for(const auto& edit:action.edits)refs.insert(edit.target);
        else if constexpr(std::is_same_v<T,WebObjectRemoval>)refs.insert(action.refs.begin(),action.refs.end());
        else if constexpr(std::is_same_v<T,WebObjectEdit>)refs.insert(action.refs.begin(),action.refs.end());
        else if constexpr(std::is_same_v<T,WebTerritorialEdit>) {
            for(const auto& row:action.features)refs.insert(territorialRef(row.identity.id));
            for(const auto& id:action.removedIds)refs.insert(territorialRef(id));
            if(!action.id.empty())refs.insert(territorialRef(action.id));
            if(!action.sourceId.empty())refs.insert(territorialRef(action.sourceId));
        }
        else if constexpr(std::is_same_v<T,TimelineGeometryEdit> || std::is_same_v<T,TimelineParentEdit>)
            refs.insert(territorialRef(action.id));
        else if constexpr(std::is_same_v<T,TimelineCreate>)
            refs.insert(territorialRef(action.intent.id));
        else if constexpr(std::is_same_v<T,TimelineDelete>)
            refs.insert(action.targets.begin(),action.targets.end());
        else if constexpr(std::is_same_v<T,TimelineTerritorialMutation>)
            refs.insert(action.mutation.plan.affectedObjects.begin(),action.mutation.plan.affectedObjects.end());
        else if constexpr(std::is_same_v<T,SetPhysicalData>||std::is_same_v<T,DocumentSourceInfoAppend>) {}
    },args.action);
    return {refs.begin(),refs.end()};
}
void validateRequest(const ProjectSnapshot& project,const CommandRequest& request)
{
    require(request.projectInstanceId==project.instanceId(),CommandError::ProjectMismatch,"project instance changed");
    require(request.documentId==project.document().documentId,CommandError::DocumentMismatch,"document changed");
    require(request.revision==project.revision(),CommandError::StaleRevision,"revision changed");
    const std::pair<const char*,std::size_t> commands[]={
        {"edit.properties",0},{"country.color",1},
        {"territorial.field",2},{"territorial.color",3},{"territorial.color.reset",3},
        {"territorial.batch-color",3},{"territorial.service-color",3},{"territorial.lock",4},{"territorial.create",5},
        {"territorial.relation.parent",5},{"territorial.relation.sovereign",5},
        {"territorial.delete",5},{"territorial.geometry.commit",5},{"territorial.geometry.replace",5},
        {"content.edit",6},{"generic.create",6},{"generic.metadata",6},{"generic.remove",6},
        {"distribution.layer.create",6},{"distribution.layer.metadata",6},{"distribution.layer.remove",6},
        {"distribution.entry.create",6},{"distribution.entry.value",6},{"distribution.entry.remove",6},
        {"label.edit",6},{"label.gesture.begin",6},{"label.gesture.move",6},{"label.gesture.finish",6},{"hydro.edit",6},{"hydro.metadata",6},
        {"physical-data.configure",7},{"historical.instantiate",8},
        {"gis.import.generic",9},{"gis.import.territorial",10},
        {"gis.import.distribution",11},{"timeline.geometry",12},{"timeline.parent",13},
        {"timeline.create",14},{"timeline.delete",15},{"timeline.territorial",16},
        {"generic.import",17},{"distribution.import",17},{"territorial.create",18},{"territorial.geometry",18},
        {"territorial.parent",18},{"territorial.remove",18},{"territorial.patch",18},{"territorial.replace",18},{"territorial.copy-region",18},{"objects.remove",19},{"document.source-info",20},{"objects.lock",21},{"objects.color",21},
        {"generic.color-reset",6},{"hydro.geometry",6},{"hydro.copy",6}};
    const auto known=std::find_if(std::begin(commands),std::end(commands),[&](const auto& c){return request.commandId==c.first;});
    require(known!=std::end(commands),CommandError::InvalidCommand,"unknown commandId");
    const auto found=std::find_if(std::begin(commands),std::end(commands),[&](const auto& c){return request.commandId==c.first&&request.args.action.index()==c.second;});
    require(found!=std::end(commands),CommandError::InvalidArguments,"commandId/action mismatch");
    if(std::holds_alternative<DocumentSourceInfoAppend>(request.args.action)) {
        require(request.targets.empty()&&request.args.properties.countries.empty()&&request.args.properties.fields.empty(),CommandError::InvalidArguments,"source metadata cannot collect object/property targets");return;
    }
    if(const auto edit=std::get_if<WebObjectEdit>(&request.args.action)) {
        require(request.args.properties.countries.empty()&&request.args.properties.fields.empty(),CommandError::InvalidArguments,"object edit cannot contain other property drafts");
        require((request.commandId=="objects.lock")== (edit->kind==WebObjectEditKind::Lock),CommandError::InvalidArguments,"object edit intent mismatch");
        auto targets=request.targets;std::sort(targets.begin(),targets.end());
        require(std::adjacent_find(targets.begin(),targets.end())==targets.end()&&targets==targetsFor(request.args),CommandError::InvalidTargets,"object edit targets mismatch");return;
    }
    if(const auto* removal=std::get_if<WebObjectRemoval>(&request.args.action)) {
        require(request.args.properties.countries.empty()&&request.args.properties.fields.empty(),CommandError::InvalidArguments,"object removal cannot include property drafts");
        auto refs=request.targets;std::sort(refs.begin(),refs.end());
        require(std::adjacent_find(refs.begin(),refs.end())==refs.end()&&refs==targetsFor(request.args),CommandError::InvalidTargets,"object removal targets mismatch");
        std::set<ObjectRef> unique(removal->refs.begin(),removal->refs.end());
        require(unique.size()==removal->refs.size(),CommandError::InvalidTargets,"duplicate object removal intent");return;
    }
    if(const auto* edit=std::get_if<WebTerritorialEdit>(&request.args.action)) {
        require(request.args.properties.countries.empty()&&request.args.properties.fields.empty(),CommandError::InvalidArguments,"territorial intent cannot include unrelated property drafts");
        const char* names[]={"territorial.create","territorial.geometry","territorial.parent","territorial.remove","territorial.patch","territorial.replace","territorial.copy-region"};
        const auto operation=static_cast<unsigned>(edit->operation);
        require(operation<7&&request.commandId==names[operation],CommandError::InvalidArguments,"territorial operation mismatch");
        auto refs=request.targets;std::sort(refs.begin(),refs.end());
        require(std::adjacent_find(refs.begin(),refs.end())==refs.end()&&refs==targetsFor(request.args),CommandError::InvalidTargets,"territorial intent targets mismatch");return;
    }
    if(const auto* edit=std::get_if<ContentEdit>(&request.args.action)) {
        if(request.commandId!="content.edit") {
            const auto expected=request.commandId.rfind("generic.",0)==0?"generic":
                request.commandId.rfind("distribution.layer.",0)==0?"distributionLayer":
                request.commandId.rfind("distribution.entry.",0)==0?"distributionEntry":
                request.commandId.rfind("label.",0)==0?"label":"hydro";
            require(edit->target.domain==expected,CommandError::InvalidTargets,"operation content domain mismatch");
            const bool create=request.commandId.find(".create")!=std::string::npos;
            const bool remove=request.commandId.find(".remove")!=std::string::npos;
            if(create)require(edit->create&&!std::holds_alternative<std::monostate>(edit->value),CommandError::InvalidArguments,"create operation requires new content");
            if(remove)require(!edit->create&&std::holds_alternative<std::monostate>(edit->value),CommandError::InvalidArguments,"remove operation requires null content");
            if(request.commandId.find(".metadata")!=std::string::npos||request.commandId=="distribution.entry.value")
                require(!edit->create&&!edit->geometry&&!std::holds_alternative<std::monostate>(edit->value),CommandError::InvalidArguments,"metadata operation cannot create/delete/replace geometry");
        }
    }
    if(const auto* batch=std::get_if<ContentBatchEdit>(&request.args.action)) {
        require((request.commandId=="generic.import")== (batch->kind==ContentImportKind::Generic),CommandError::InvalidArguments,"import domain mismatch");
        std::set<ObjectRef> unique;
        for(const auto& edit:batch->edits)require(edit.create&&!std::holds_alternative<std::monostate>(edit.value)&&
            unique.insert(edit.target).second&&(batch->kind==ContentImportKind::Generic?edit.target.domain=="generic":
                edit.target.domain=="distributionLayer"||edit.target.domain=="distributionEntry"),
            CommandError::InvalidArguments,"invalid/duplicate import row");
    }
    if(request.args.action.index()>=2) {
        require(request.args.properties.countries.empty() && request.args.properties.fields.empty(),CommandError::InvalidArguments,"property commands cannot collect unrelated drafts");
        if(const auto field=std::get_if<TerritorialFieldEdit>(&request.args.action)) {
            require(field->field>=TerritorialField::Name && field->field<=TerritorialField::ValidTo,CommandError::InvalidArguments,"unknown field");
        }
        std::visit([&](const auto& action){using T=std::decay_t<decltype(action)>;
            if constexpr(std::is_same_v<T,TerritorialColorEdit> || std::is_same_v<T,TerritorialLockEdit>) {
                std::set<ObjectRef> unique(action.targets.begin(),action.targets.end());
                require(!action.targets.empty() && unique.size()==action.targets.size(),CommandError::InvalidTargets,"empty/duplicate targets");
                if constexpr(std::is_same_v<T,TerritorialColorEdit>) {
                    require(request.commandId=="territorial.service-color"||
                        (request.commandId=="territorial.batch-color"?action.targets.size()>=2:action.targets.size()==1),CommandError::InvalidTargets,"color selection arity");
                    require(request.commandId=="territorial.service-color"||
                        (request.commandId=="territorial.color.reset"?!action.color:bool(action.color)),CommandError::InvalidArguments,"explicit/reset color contract");
                    require(!action.color || *action.color<=0xffffff,CommandError::InvalidArguments,"invalid RGB");
                }
            }
            else if constexpr(std::is_same_v<T,ApplyTerritorialMutation>||std::is_same_v<T,TimelineTerritorialMutation>) {
                const auto& mutation=[&]() -> const ApplyTerritorialMutation& {
                    if constexpr(std::is_same_v<T,TimelineTerritorialMutation>)return action.mutation;
                    else return action;
                }();
                require(mutation.plan.projectInstanceId==project.instanceId()&&mutation.plan.documentId==project.document().documentId&&mutation.plan.baseRevision==project.revision(),CommandError::StaleRevision,"territorial plan stale");
                require(!mutation.plan.affectedObjects.empty(),CommandError::InvalidTargets,"empty territorial plan");
            } else if constexpr(std::is_same_v<T,HistoricalInstantiationPlan>) {
                require(action.projectInstanceId==project.instanceId(),CommandError::ProjectMismatch,"historical plan project changed");
                require(action.documentId==project.document().documentId,CommandError::DocumentMismatch,"historical plan document changed");
                require(action.baseRevision==project.revision(),CommandError::StaleRevision,"historical plan stale");
                require(!action.applicationMonth||*action.applicationMonth==project.timelineMonth(),CommandError::StaleRevision,"historical plan month changed");
                require(!action.additions.empty(),CommandError::InvalidTargets,"empty historical plan");
                std::set<std::string> unique;
                bool replacementMode=false;
                const bool catalogBatch=std::all_of(action.additions.begin(),action.additions.end(),[](const auto& addition){return !addition.instanceId.empty();});
                std::map<std::string,std::string> expectedNames;
                for(const auto& addition:action.additions) {
                    const auto& selection=addition.selection;
                    require(!selection.libraryId.empty()&&unique.insert(historicalInstanceId(addition)).second,
                            CommandError::InvalidTargets,"duplicate historical selection");
                    require(selection.instantiation.mode=="independent"||selection.instantiation.mode=="territory-replacement",CommandError::InvalidArguments,"invalid historical mode");
                    replacementMode|=selection.instantiation.mode=="territory-replacement";
                    for(const auto& [id,name]:selection.instantiation.countryNameUpdates) {
                        const auto found=expectedNames.find(id);
                        require(found==expectedNames.end()||found->second==name,CommandError::InvalidArguments,"conflicting country updates");
                        expectedNames[id]=name;
                    }
                    require(!selection.partial||addition.partialApproved,CommandError::InvalidArguments,
                            "partial historical source not approved");
                    require(!addition.sovereign,CommandError::InvalidArguments,"UNSUPPORTED_POLITICAL_RELATION");
                    require(!addition.asIndependentCountry||(selection.type==UnitKind::General&&!addition.parent&&!addition.sovereign&&!addition.countryName.empty()),
                            CommandError::InvalidArguments,"invalid independent country choice");
                }
                require(action.countryNameUpdates==expectedNames,CommandError::InvalidArguments,"country updates differ from library");
                require(replacementMode||catalogBatch||(action.territoryReplacements.empty()&&action.territoryTransfers.empty()),CommandError::InvalidArguments,"unexpected historical geometry patch");
                for(const auto& patch:action.territoryReplacements)
                    require(patch.owner.domain=="territorial" && project.index().objects.count(patch.owner) &&
                            (patch.geometry.type=="Polygon"||patch.geometry.type=="MultiPolygon"),
                            CommandError::InvalidArguments,"invalid historical geometry patch");
                const auto historicalView=action.applicationMonth?std::optional<TimelineDocumentView>{timelineDocumentView(project.document(),*action.applicationMonth)}:std::nullopt;
                const auto& historicalDocument=historicalView?historicalView->document:project.document();
                for(const auto& transfer:action.territoryTransfers) {
                    const auto& donor=transfer.first;const auto& target=transfer.second;
                    const auto found=project.index().objects.find(donor);
                    const auto targetFound=project.index().objects.find(target);
                    const bool expandedRoot=catalogBatch&&target.domain=="territorial"&&targetFound!=project.index().objects.end()&&
                        isRootGeneral(historicalDocument,historicalDocument.units.at(targetFound->second))&&
                        std::any_of(action.territoryReplacements.begin(),action.territoryReplacements.end(),[&](const auto& patch){return patch.owner==target;});
                    require(found!=project.index().objects.end()&&donor.domain=="territorial"&&
                            project.document().units.at(found->second).kind==UnitKind::General&&
                            (expandedRoot||std::any_of(action.additions.begin(),action.additions.end(),[&](const auto& item){
                                return ObjectRef{item.selection.type?"territorial":"hydro",historicalInstanceId(item)}==target&&
                                    (item.selection.instantiation.mode=="territory-replacement"||
                                     (catalogBatch&&item.selection.type==UnitKind::General&&!item.parent));
                            })),CommandError::InvalidArguments,"invalid historical country transfer");
                }
                for(const auto& [id,name]:action.countryNameUpdates)
                    require(!name.empty()&&project.index().objects.count(territorialRef(id))&&
                            project.document().units.at(project.index().objects.at(territorialRef(id))).kind==UnitKind::General,
                            CommandError::InvalidArguments,"invalid country name update");
            } else if constexpr(std::is_same_v<T,GisGenericImportPlan>) {
                require(action.info.projectInstanceId==project.instanceId(),CommandError::ProjectMismatch,"GIS plan project changed");
                require(action.info.documentId==project.document().documentId,CommandError::DocumentMismatch,"GIS plan document changed");
                require(action.info.revision==project.revision(),CommandError::StaleRevision,"GIS plan stale");
                require(action.info.version==1 && !action.info.id.empty() &&
                        action.info.kind==GisImportKind::Generic && action.info.target==GisExchangeTarget::Generic &&
                        !action.features.empty() && action.features.size()==action.info.affectedIds.size(),
                        CommandError::InvalidArguments,"invalid generic GIS plan");
                std::set<std::string> unique;
                for(std::size_t i=0;i<action.features.size();++i)
                    require(!action.features[i].id.empty() &&
                            action.features[i].id==action.info.affectedIds[i] &&
                            unique.insert(action.features[i].id).second,
                            CommandError::InvalidTargets,"duplicate generic GIS target");
            } else if constexpr(std::is_same_v<T,GisTerritorialImportPlan>) {
                require(action.info.projectInstanceId==project.instanceId(),CommandError::ProjectMismatch,"GIS plan project changed");
                require(action.info.documentId==project.document().documentId,CommandError::DocumentMismatch,"GIS plan document changed");
                require(action.info.revision==project.revision(),CommandError::StaleRevision,"GIS plan stale");
                require(action.info.version==1&&!action.info.id.empty()&&!action.units.empty()&&
                    action.info.affectedIds.size()==action.units.size(),CommandError::InvalidArguments,
                    "invalid territorial GIS plan");
                std::set<std::string> unique;
                for(std::size_t i=0;i<action.units.size();++i)
                    require(action.info.affectedIds[i]==action.units[i].id&&
                        unique.insert(action.units[i].id).second,CommandError::InvalidTargets,
                        "territorial GIS IDs changed");
            } else if constexpr(std::is_same_v<T,GisDistributionImportPlan>) {
                require(action.info.projectInstanceId==project.instanceId(),CommandError::ProjectMismatch,"GIS plan project changed");
                require(action.info.documentId==project.document().documentId,CommandError::DocumentMismatch,"GIS plan document changed");
                require(action.info.revision==project.revision(),CommandError::StaleRevision,"GIS plan stale");
                require(action.info.version==1&&!action.info.id.empty()&&
                    action.info.kind==GisImportKind::Distribution&&
                    action.info.target==GisExchangeTarget::Distribution&&
                    !action.entries.empty()&&action.entries.size()==action.info.affectedIds.size(),
                    CommandError::InvalidArguments,"invalid distribution GIS plan");
            }
        },request.args.action);
    }
    std::set<std::pair<ObjectRef,TerritorialField>> fields;
    for(const auto& f:request.args.properties.fields) {
        require(f.target.domain=="territorial" && f.field>=TerritorialField::Name && f.field<=TerritorialField::ValidTo && fields.emplace(f.target,f.field).second,CommandError::InvalidArguments,"invalid/duplicate field edit");
    }
    std::set<std::string> countries;
    for(const auto& edit:request.args.properties.countries) {
        require(countries.insert(edit.id).second,CommandError::InvalidArguments,"duplicate country edit");
        const auto& p=edit.properties;
        require(!Project::normalizeName(p.name).empty() && p.color<=0xffffff && opacity(p.opacity),
                CommandError::InvalidArguments,"invalid country name/color/opacity");
    }
    std::visit([&](const auto& action) {
        using T=std::decay_t<decltype(action)>;
        if constexpr(std::is_same_v<T,SetCountryColor>)
            require(action.color<=0xffffff,CommandError::InvalidArguments,"invalid RGB color");
    },request.args.action);
    auto refs=request.targets;
    std::sort(refs.begin(),refs.end());
    require(std::adjacent_find(refs.begin(),refs.end())==refs.end() && refs==targetsFor(request.args),
            CommandError::InvalidTargets,"targets do not match arguments");
    if(request.args.action.index()>=2 && request.args.action.index()<6)for(const auto& ref:refs)require(ref.domain=="territorial",CommandError::InvalidTargets,"non-territorial target");
    for(const auto& ref:refs) {
        if(std::holds_alternative<ContentEdit>(request.args.action)||std::holds_alternative<ContentBatchEdit>(request.args.action)) {
            require(!ref.id.empty(),CommandError::InvalidTargets,"empty content target");
            continue; // The typed payload and target are checked together below.
        }
        if(const auto historical=std::get_if<HistoricalInstantiationPlan>(&request.args.action)) {
            const auto created=std::any_of(historical->additions.begin(),historical->additions.end(),
                [&](const auto& item){return ObjectRef{item.selection.type?"territorial":"hydro",historicalInstanceId(item)}==ref;});
            require((ref.domain=="territorial"||ref.domain=="hydro") && (created? !project.index().objects.count(ref)
                :project.index().objects.count(ref)!=0),CommandError::InvalidTargets,"historical target invalid");
            continue;
        }
        if(std::holds_alternative<GisGenericImportPlan>(request.args.action)) {
            require(ref.domain=="generic" && !project.index().objects.count(ref),
                    CommandError::InvalidTargets,"generic GIS target exists");
            continue;
        }
        if(const auto gis=std::get_if<GisTerritorialImportPlan>(&request.args.action)) {
            const auto imported=std::find_if(gis->units.begin(),gis->units.end(),
                [&](const auto& row){return territorialRef(row.id)==ref;});
            require(ref.domain=="territorial"&&
                (imported==gis->units.end()||imported->replaceExisting||!project.index().objects.count(ref))&&
                (imported!=gis->units.end()||project.index().objects.count(ref)),
                CommandError::InvalidTargets,"territorial GIS target invalid");
            continue;
        }
        if(const auto gis=std::get_if<GisDistributionImportPlan>(&request.args.action)) {
            const bool newLayer=std::any_of(gis->layers.begin(),gis->layers.end(),
                [&](const auto& row){return ref.domain=="distributionLayer"&&row.id==ref.id;});
            const bool newEntry=std::any_of(gis->entries.begin(),gis->entries.end(),
                [&](const auto& row){return ref.domain=="distributionEntry"&&row.entry.id==ref.id;});
            require((newLayer||newEntry)?!project.index().objects.count(ref):
                project.index().objects.count(ref)!=0,CommandError::InvalidTargets,
                "distribution GIS target invalid");
            continue;
        }
        if(ref.domain=="territorial") {
            const auto create=std::get_if<ApplyTerritorialMutation>(&request.args.action);
            const auto datedCreate=std::get_if<TimelineTerritorialMutation>(&request.args.action);
            const auto* createPlan=create?&create->plan:datedCreate?&datedCreate->mutation.plan:nullptr;
            const bool newCreate=(createPlan && (createPlan->kind==TerritorialMutationKind::CreateCountry||createPlan->kind==TerritorialMutationKind::CreateSubunit||createPlan->kind==TerritorialMutationKind::CreateRegion) && ref==createPlan->targets.front())||
                (std::holds_alternative<TimelineCreate>(request.args.action)&&ref==territorialRef(std::get<TimelineCreate>(request.args.action).intent.id));
            require(newCreate || ((request.args.action.index()>=2 || std::any_of(request.args.properties.fields.begin(),request.args.properties.fields.end(),[&](const auto& f){return f.target==ref;}))?project.index().objects.count(ref)!=0:project.country(ref.id)!=nullptr),CommandError::InvalidTargets,"territorial target not found");
        }
        else require(false,CommandError::InvalidTargets,"unsupported target domain");
    }
}
void applyField(ProjectDocument& candidate,const DocumentIndex& index,const TerritorialFieldEdit& action) {
            auto& u=candidate.units.at(index.objects.at(action.target));
            const auto value=trimWebText(action.value);
            switch(action.field) {
            case TerritorialField::Name:
                if(u.kind!=UnitKind::General || trimWebText(u.nameExplicit&&!u.name.empty()?u.name:!u.baseName.empty()?u.baseName:u.id)!=value){u.name=value;u.nameExplicit=true;}
                break;
            case TerritorialField::Notes:u.notes=value;break;
            case TerritorialField::ValidFrom:case TerritorialField::ValidTo:
                require(value.empty(),CommandError::InvalidArguments,"TIMELINE_ACTIVATION: dated edits require T4");
                (void)staticLifetime(candidate,territorialRef(u.id));break;
            }
}
bool sameGeometry(const Geometry& a,const Geometry& b);
bool sameValidity(const Validity& a,const Validity& b);
void applyGeometryPatch(ProjectDocument& d,const TerritorialMutationPlan& plan,const GeometryPatch& patch) {
    if(patch.sourceRevision!=plan.baseRevision) throw Rejection{CommandError::StaleRevision,"geometry patch stale"};
    const auto& mappings=plan.geometry.replacements;
    std::set<ObjectRef> expected, seen;
    for(const auto& mapping:mappings)require(expected.insert(mapping.result).second,CommandError::InvalidArguments,"duplicate planned owner");
    if(expected.empty()) throw Rejection{CommandError::InvalidArguments,"geometry patch has no owners"};
    require(patch.creations.size()==plan.geometry.createOwners.size(),CommandError::InvalidArguments,"geometry creation owner set mismatch");
    std::set<ObjectRef> created;
    for(const auto& creation:patch.creations) {
        require(std::find(plan.geometry.createOwners.begin(),plan.geometry.createOwners.end(),creation.owner)!=plan.geometry.createOwners.end()&&created.insert(creation.owner).second,CommandError::InvalidArguments,"unexpected geometry creation owner");
        require(std::none_of(d.units.begin(),d.units.end(),[&](const auto& u){return territorialRef(u.id)==creation.owner;}),CommandError::InvalidArguments,"geometry creation owner already exists");
        require(creation.geometry.type=="Polygon"||creation.geometry.type=="MultiPolygon",CommandError::InvalidArguments,"polygon required");
    }
    for(const auto& replacement:patch.replacements) {
        if(!expected.count(replacement.owner)||!seen.insert(replacement.owner).second)
            throw Rejection{CommandError::InvalidArguments,"geometry patch owner mismatch"};
    }
    for(const auto& owner:patch.removedGeometryOwners) {
        if(!expected.count(owner)||!seen.insert(owner).second||
           std::find(plan.geometry.removableOwners.begin(),plan.geometry.removableOwners.end(),owner)==plan.geometry.removableOwners.end())
            throw Rejection{CommandError::InvalidArguments,"geometry patch removed owner mismatch"};
        const auto removed=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return territorialRef(u.id)==owner;});
        const auto targetPatch=std::find_if(patch.replacements.begin(),patch.replacements.end(),[&](const auto& r){return !plan.geometry.replacements.empty()&&r.owner==plan.geometry.replacements.front().result;});
        const auto target=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return !plan.geometry.readOwners.empty()&&territorialRef(u.id)==plan.geometry.readOwners.front();});
        const bool splitCovered=plan.geometry.operation=="split"&&removed!=d.units.end()&&patch.creations.size()==1&&geometryContains(patch.creations.front().geometry,*d.geometries.get(staticGeometryBinding(d,territorialRef(removed->id)).geometryRef));
        bool boundaryRemoved=false;
        if(plan.geometry.operation=="boundary"&&removed!=d.units.end()) {
            const auto parent=territorialRef(staticParentRelation(d,removed->id).parentId);
            const bool parentRemoved=std::find(patch.removedGeometryOwners.begin(),patch.removedGeometryOwners.end(),parent)!=patch.removedGeometryOwners.end();
            const auto parentPatch=std::find_if(patch.replacements.begin(),patch.replacements.end(),[&](const auto& row){return row.owner==parent;});
            boundaryRemoved=parentRemoved||(parentPatch!=patch.replacements.end()&&!geometrySignificantOverlap(parentPatch->geometry,*d.geometries.get(staticGeometryBinding(d,territorialRef(removed->id)).geometryRef)));
        }
        const bool coveredByResult=target!=d.units.end()&&removed!=d.units.end()&&targetPatch!=patch.replacements.end()&&geometryContains(targetPatch->geometry,*d.geometries.get(staticGeometryBinding(d,territorialRef(removed->id)).geometryRef));
        require(plan.geometry.operation=="boundary"?boundaryRemoved:(plan.geometry.operation=="coast"||splitCovered||coveredByResult),CommandError::InvalidArguments,"removed owner is not covered by result");
    }
    if(seen!=expected) throw Rejection{CommandError::InvalidArguments,"geometry patch owner set incomplete"};
    for(const auto& replacement:patch.replacements) {
        const auto mapping=std::find_if(mappings.begin(),mappings.end(),[&](const auto& m){return m.result==replacement.owner;});
        require(mapping!=mappings.end(),CommandError::InvalidArguments,"geometry owner mapping missing");
        const auto& input=mapping->source;
        auto unit=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return territorialRef(u.id)==input;});
        if(unit==d.units.end()) throw Rejection{CommandError::InvalidArguments,"geometry patch owner missing"};
        require(replacement.geometry.type=="Polygon"||replacement.geometry.type=="MultiPolygon",CommandError::InvalidArguments,"polygon required");
        if(sameGeometry(*d.geometries.get(staticGeometryBinding(d,territorialRef(unit->id)).geometryRef),replacement.geometry))continue;
        auto& binding=staticGeometryBinding(d,territorialRef(unit->id)); GeometryRef next=binding.geometryRef;
        do {require(next.version<std::numeric_limits<std::uint32_t>::max(),CommandError::RevisionOverflow,"geometry version overflow");++next.version;}while(d.geometries.get(next));
        d.geometries.insert(next,replacement.geometry); binding.geometryRef=next;
    }
    for(const auto& ref:patch.removedGeometryOwners) {
        d.presentation.objectStyles.erase(ref);
        d.units.erase(std::remove_if(d.units.begin(),d.units.end(),[&](const auto& u){return territorialRef(u.id)==ref;}),d.units.end());
    }
}
void applyTerritorial(ProjectDocument& d,const ApplyTerritorialMutation& action) {
    const auto& plan=action.plan;
    const auto contentBefore=d;
    auto shape=[&](const std::string& id){return d.geometries.get(staticGeometryBinding(d,territorialRef(id)).geometryRef);};
    auto patch=[&](){require(action.geometry.has_value(),CommandError::InvalidArguments,"geometry patch required");applyGeometryPatch(d,plan,*action.geometry);};
    std::visit([&](const auto& in) {
        using T=std::decay_t<decltype(in)>;
        if constexpr(std::is_same_v<T,ChangeParentIntent>) {
            staticParentRelation(d,in.target.id).parentId=in.parent.id;
        } else if constexpr(std::is_same_v<T,ChangeRegionSovereignIntent>) {
            throw Rejection{CommandError::InvalidArguments,"UNSUPPORTED_POLITICAL_RELATION: sovereignty is not an administrative parent"};
        } else if constexpr(std::is_same_v<T,CreateTerritorialIntent>) {
            require(!in.sovereign,CommandError::InvalidArguments,"UNSUPPORTED_POLITICAL_RELATION");
            require(!in.validity.from&&!in.validity.to,CommandError::InvalidArguments,"TIMELINE_ACTIVATION: dated creation requires T4");
            GeometryRef geometry{"geometry-"+in.id,1};unsigned n=1;while(d.geometries.get(geometry))geometry={"geometry-"+in.id+"-"+std::to_string(n++),1};d.geometries.insert(geometry,in.geometry);
            TerritorialUnit unit;unit.id=in.id;unit.name=in.name;unit.baseName=in.kind==UnitKind::General?in.name:"";unit.nameExplicit=true;unit.notes=in.notes;unit.kind=in.kind;d.units.push_back(unit);
            addStaticTerritorialRecords(d,in.id,geometry,in.parent?in.parent->id:"",in.coverageMode.empty()?"explicit":in.coverageMode);
            const auto ref=territorialRef(in.id);d.presentation.objectStyles.emplace(ref,ObjectStyle{in.explicitColor.value_or(0),1,in.explicitColor.has_value()});
        } else if constexpr(std::is_same_v<T,DeleteTerritorialIntent>) {
            std::set<ObjectRef> removed(in.targets.begin(),in.targets.end());std::vector<std::string> ids;
            for(const auto& ref:removed){ids.push_back(ref.id);d.presentation.objectStyles.erase(ref);}
            removeTerritorialRecords(d,ids);d.units.erase(std::remove_if(d.units.begin(),d.units.end(),[&](const auto& u){return removed.count(territorialRef(u.id));}),d.units.end());
        } else if constexpr(std::is_same_v<T,TransferSubunitIntent>) {
            patch();staticParentRelation(d,in.target.id).parentId=in.destinationCountry.id;
        } else if constexpr(std::is_same_v<T,ConvertTerritorialTypeIntent>) {
            require(!in.sovereign,CommandError::InvalidArguments,"UNSUPPORTED_POLITICAL_RELATION");
            auto unit=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return territorialRef(u.id)==in.source;});
            require(unit!=d.units.end()&&unit->kind==in.targetKind,CommandError::InvalidArguments,"kind changes require a new entity identity");
            if(action.geometry)patch();
            auto& parent=staticParentRelation(d,in.source.id);parent.parentId=in.parent?in.parent->id:"";parent.coverageMode="explicit";
        } else if constexpr(std::is_same_v<T,ReplaceGeometryIntent>||std::is_same_v<T,CoastlineIntent>) {
            patch();
        } else if constexpr(std::is_same_v<T,MergeTerritorialIntent>) {
            patch();const std::set<ObjectRef> donors(in.donors.begin(),in.donors.end());
            for(auto& relation:d.timelineRecords.parentRelations)if(donors.count(territorialRef(relation.parentId)))relation.parentId=in.target.id;
            auto& web=d.presentation.webPresentation;
            for(const auto& donor:in.donors) {
                for(auto& [group,hidden]:web.itemVisibility)hidden.erase(donor.id);
                web.objectStyles.erase(territorialPresentationKey(donor.id));
                web.objectOrder.erase(std::remove(web.objectOrder.begin(),web.objectOrder.end(),territorialPresentationKey(donor.id)),web.objectOrder.end());
            }
        } else if constexpr(std::is_same_v<T,AnnexTerritoryIntent>) {
            const auto targetUnit=std::find_if(d.units.begin(),d.units.end(),[&](const auto& unit){return territorialRef(unit.id)==in.target;});
            const bool rootAnnex=targetUnit!=d.units.end()&&isRootGeneral(d,*targetUnit);
            if(rootAnnex&&action.geometry)for(const auto& removed:action.geometry->removedGeometryOwners) {
                // The root web workflow asserts reference integrity before its
                // commit. Unlike sibling annex it does not auto-clean these
                // references. Reject transactionally instead of silently
                // deleting a distribution row or detaching a label.
                for(const auto& entry:d.distributionEntries)
                    require(!entry.territory||!(*entry.territory==removed),CommandError::ValidationFailed,"DANGLING_REF: distribution territory");
                for(const auto& label:d.labels)
                    require(!label.territory||!(*label.territory==removed),CommandError::ValidationFailed,"DANGLING_REF: label territory");
                require(!d.presentation.webPresentation.labelSettings.count(removed),CommandError::ValidationFailed,"DANGLING_REF: territorial label settings");
            }
            patch();const std::set<ObjectRef> donors(in.donors.begin(),in.donors.end());
            for(auto& relation:d.timelineRecords.parentRelations)if(!rootAnnex&&donors.count(territorialRef(relation.parentId))) {
                const auto child=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return u.id==relation.objectRef.id;});
                if(child!=d.units.end()&&geometryContains(*shape(in.target.id),*shape(child->id)))relation.parentId=in.target.id;
            }
        } else if constexpr(std::is_same_v<T,SplitTerritorialIntent>) {
            require(action.geometry&&action.geometry->creations.size()==1,CommandError::InvalidArguments,"split geometry patch required");
            const auto source=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return territorialRef(u.id)==in.source;});
            require(source!=d.units.end(),CommandError::ValidationFailed,"split source missing");
            const auto sourceKind=source->kind;const auto parent=staticParentRelation(d,in.source.id);const bool root=sourceKind==UnitKind::General&&parent.parentId.empty();
            const auto& createdGeometry=action.geometry->creations.front().geometry;
            std::vector<std::string> reparented;
            if(!root) {
                // The child-create oracle stops descending after moving a whole
                // child. Grandchildren preserve their immediate parent identity.
                const auto visit=[&](const auto& self,const std::string& owner)->void {
                    for(const auto& relation:contentBefore.timelineRecords.parentRelations)if(relation.parentId==owner) {
                        const auto original=contentBefore.geometries.get(staticGeometryBinding(contentBefore,territorialRef(relation.objectRef.id)).geometryRef);
                        if(geometryContains(createdGeometry,*original))reparented.push_back(relation.objectRef.id);
                        else {
                            const auto replacement=std::find_if(action.geometry->replacements.begin(),action.geometry->replacements.end(),[&](const auto& row){return row.owner==territorialRef(relation.objectRef.id);});
                            if(replacement!=action.geometry->replacements.end()&&!sameGeometry(replacement->geometry,*original))self(self,relation.objectRef.id);
                        }
                    }
                };visit(visit,in.source.id);
            } else for(const auto& removed:action.geometry->removedGeometryOwners) {
                // Root new-country commits retain references and assert their
                // integrity, matching root annex, rather than cleaning them up.
                for(const auto& entry:d.distributionEntries)require(!entry.territory||!(*entry.territory==removed),CommandError::ValidationFailed,"DANGLING_REF: distribution territory");
                for(const auto& label:d.labels)require(!label.territory||!(*label.territory==removed),CommandError::ValidationFailed,"DANGLING_REF: label territory");
                require(!d.presentation.webPresentation.labelSettings.count(removed),CommandError::ValidationFailed,"DANGLING_REF: territorial label settings");
            }
            patch();GeometryRef geometry{"geometry-"+in.createdId,1};unsigned suffix=1;while(d.geometries.get(geometry))geometry={"geometry-"+in.createdId+"-"+std::to_string(suffix++),1};d.geometries.insert(geometry,createdGeometry);
            TerritorialUnit createdUnit;createdUnit.id=in.createdId;createdUnit.name=trimWebText(in.createdName);createdUnit.nameExplicit=true;createdUnit.kind=sourceKind;d.units.push_back(std::move(createdUnit));
            addStaticTerritorialRecords(d,in.createdId,geometry,parent.parentId,parent.parentId.empty()?"explicit":"partition");const auto createdRef=territorialRef(in.createdId);
            d.presentation.objectStyles.emplace(createdRef,ObjectStyle{0,1,false});
            for(const auto& id:reparented)if(std::any_of(d.units.begin(),d.units.end(),[&](const auto& child){return child.id==id;}))staticParentRelation(d,id).parentId=in.createdId;
            if(!root) {
                auto& web=d.presentation.webPresentation;
                for(const auto& removed:action.geometry->removedGeometryOwners) {
                    web.eraseItemVisibility("objects",removed.id);
                    web.eraseItemVisibility("objectLabels","territorial:"+removed.id);
                    web.labelSettings.erase(removed);web.objectStyles.erase(territorialPresentationKey(removed.id));
                }
            }
        } else if constexpr(std::is_same_v<T,SharedBoundaryIntent>) {
            require(action.geometry.has_value(),CommandError::InvalidArguments,"boundary geometry patch required");
            const bool root=staticParentRelation(contentBefore,in.drafts.front().owner.id).parentId.empty();
            std::map<std::string,std::string> reparented;
            const auto children=[&](const std::string& parent){std::vector<std::string> ids;for(const auto& unit:contentBefore.units)if(unit.kind==UnitKind::General&&staticParentRelation(contentBefore,unit.id).parentId==parent)ids.push_back(unit.id);return ids;};
            // Derive ownership independently from the approved draft owners and
            // original hierarchy. The worker cannot submit arbitrary parents.
            const auto reconcile=[&](const auto& self,const std::string& parent,const ObjectRef& sourceRoot)->void {
                for(const auto& child:children(parent)) {
                    const auto receiver=std::find_if(in.drafts.begin(),in.drafts.end(),[&](const auto& draft){return !(draft.owner==sourceRoot)&&geometryContains(draft.geometry,*shape(child));});
                    if(receiver!=in.drafts.end()){reparented[child]=receiver->owner.id;continue;}
                    if(root)self(self,child,sourceRoot);
                }
            };
            for(const auto& draft:in.drafts) {
                const auto replacement=std::find_if(action.geometry->replacements.begin(),action.geometry->replacements.end(),[&](const auto& row){return row.owner==draft.owner;});
                require(replacement!=action.geometry->replacements.end()&&sameGeometry(replacement->geometry,draft.geometry),CommandError::InvalidArguments,"boundary owner draft mismatch");
                reconcile(reconcile,draft.owner.id,draft.owner);
            }
            for(const auto& [child,parent]:reparented)require(std::find(action.geometry->removedGeometryOwners.begin(),action.geometry->removedGeometryOwners.end(),territorialRef(child))==action.geometry->removedGeometryOwners.end(),CommandError::InvalidArguments,"boundary transferred child removed");
            // A boundary plan grants no authority to edit a contained or
            // wholly transferred descendant. True clips may only lose source
            // territory; their exact intersection remains the app receipt's
            // checked calculation, not an untrusted patch assertion here.
            for(const auto& replacement:action.geometry->replacements) {
                if(std::any_of(in.drafts.begin(),in.drafts.end(),[&](const auto& draft){return draft.owner==replacement.owner;}))continue;
                const auto& id=replacement.owner.id;const auto original=shape(id);
                const auto moved=reparented.find(id);const auto parent=moved==reparented.end()?staticParentRelation(contentBefore,id).parentId:moved->second;
                const auto parentPatch=std::find_if(action.geometry->replacements.begin(),action.geometry->replacements.end(),[&](const auto& row){return row.owner==territorialRef(parent);});
                const auto& parentGeometry=parentPatch==action.geometry->replacements.end()?*shape(parent):parentPatch->geometry;
                require(geometryContains(*original,replacement.geometry),CommandError::ValidationFailed,"boundary descendant gained territory");
                if(geometryContains(parentGeometry,*original))require(sameGeometry(*original,replacement.geometry),CommandError::ValidationFailed,"boundary unchanged descendant geometry changed");
            }
            patch();for(const auto& [child,parent]:reparented)staticParentRelation(d,child).parentId=parent;
            const auto rootId=[](const ProjectDocument& document,std::string id){std::set<std::string> seen;while(seen.insert(id).second){const auto parent=staticParentRelation(document,id).parentId;if(parent.empty())return id;id=parent;}throw Rejection{CommandError::ValidationFailed,"parent cycle"};};
            std::set<std::string> changed;
            for(const auto& unit:d.units) {
                const auto original=contentBefore.geometries.get(staticGeometryBinding(contentBefore,territorialRef(unit.id)).geometryRef);
                if(!sameGeometry(*original,*shape(unit.id))||staticParentRelation(contentBefore,unit.id).parentId!=staticParentRelation(d,unit.id).parentId||rootId(contentBefore,unit.id)!=rootId(d,unit.id))changed.insert(unit.id);
            }
            // Core has no clipping backend. Certify only a conservative area
            // lower bound for single, hole-free, nonwrapping rectangles. The
            // sealed app calculator owns complete significant-area validation;
            // a topological overlap predicate must not replace that tolerance.
            struct Rectangle {double west,south,east,north;};
            const auto rectangle=[](const Geometry& geometry)->std::optional<Rectangle> {
                if(geometry.polygons.size()!=1||geometry.polygons.front().size()!=1)return {};
                const auto& ring=geometry.polygons.front().front();if(ring.size()!=5||ring.front().x!=ring.back().x||ring.front().y!=ring.back().y)return {};
                Rectangle bounds{ring[0].x,ring[0].y,ring[0].x,ring[0].y};
                for(const auto point:ring){if(!std::isfinite(point.x)||!std::isfinite(point.y)||point.x< -180||point.x>180||point.y< -90||point.y>90)return {};bounds.west=std::min(bounds.west,point.x);bounds.east=std::max(bounds.east,point.x);bounds.south=std::min(bounds.south,point.y);bounds.north=std::max(bounds.north,point.y);}
                if(bounds.east<=bounds.west||bounds.north<=bounds.south||bounds.east-bounds.west>=180)return {};
                unsigned corners=0;
                for(std::size_t i=0;i<4;++i){const auto point=ring[i],next=ring[i+1];if((point.x!=bounds.west&&point.x!=bounds.east)||(point.y!=bounds.south&&point.y!=bounds.north)||(point.x!=next.x&&point.y!=next.y))return {};const auto bit=1u<<((point.x==bounds.east?1:0)+(point.y==bounds.north?2:0));if(corners&bit)return {};corners|=bit;}
                return corners==15?std::optional<Rectangle>(bounds):std::nullopt;
            };
            const auto certifiedOverlap=[&](const Geometry& a,const Geometry& b) {
                const auto left=rectangle(a),right=rectangle(b);if(!left||!right)return false;
                const long double width=static_cast<long double>(std::min(left->east,right->east))-std::max(left->west,right->west),height=static_cast<long double>(std::min(left->north,right->north))-std::max(left->south,right->south);if(width<=0||height<=0)return false;
                const auto area=[](const Rectangle& value){return (static_cast<long double>(value.east)-value.west)*(static_cast<long double>(value.north)-value.south);};
                const long double reference=std::max(area(*left),area(*right));
                const long double magnitude=std::max({1.,std::abs(left->west),std::abs(left->east),std::abs(left->south),std::abs(left->north),std::abs(right->west),std::abs(right->east),std::abs(right->south),std::abs(right->north)});
                // Conservatively cover floating shoelace/product/subtraction
                // rounding. Near-threshold cases defer to the sealed calculator.
                const long double roundoff=128*std::numeric_limits<double>::epsilon()*magnitude*magnitude;
                return width*height>std::max(1e-10L,reference*1e-9L)+roundoff;
            };
            for(const auto& unit:d.units) {
                if(unit.kind!=UnitKind::General)continue;const auto& parent=staticParentRelation(d,unit.id);
                if(parent.parentId.empty()||parent.coverageMode!="partition"||(!changed.count(unit.id)&&!changed.count(parent.parentId)))continue;
                for(const auto& sibling:d.units) {
                    if(sibling.kind!=UnitKind::General||sibling.id==unit.id)continue;const auto& other=staticParentRelation(d,sibling.id);
                    if(other.parentId==parent.parentId&&other.coverageMode=="partition")require(!certifiedOverlap(*shape(unit.id),*shape(sibling.id)),CommandError::ValidationFailed,"boundary partition sibling overlap");
                }
            }
            auto& web=d.presentation.webPresentation;
            for(const auto& removed:action.geometry->removedGeometryOwners) {
                web.eraseItemVisibility("objects",removed.id);
                web.eraseItemVisibility("objectLabels","territorial:"+removed.id);web.labelSettings.erase(removed);
                const auto key=territorialPresentationKey(removed.id);web.objectStyles.erase(key);
                web.objectOrder.erase(std::remove(web.objectOrder.begin(),web.objectOrder.end(),key),web.objectOrder.end());
            }
        }
    },plan.intent);
    std::map<ObjectRef,ObjectRef> redirected;
    if(const auto merge=std::get_if<MergeTerritorialIntent>(&plan.intent))for(const auto& ref:merge->donors)redirected[ref]=merge->target;

    auto survives=[&](const ObjectRef& ref){return std::any_of(d.units.begin(),d.units.end(),[&](const auto& u){return territorialRef(u.id)==ref;});};
    for(auto& label:d.labels)if(label.territory&&!survives(*label.territory)) {
        require(effectAllowed(contentBefore,{"label",label.id},"relation"),CommandError::UnsupportedDependency,"label territorial dependency");
        const auto replacement=redirected.find(*label.territory);
        label.territory=replacement==redirected.end()?std::nullopt:std::optional<ObjectRef>(replacement->second);
    }
    for(auto it=d.distributionEntries.begin();it!=d.distributionEntries.end();) {
        if(!it->territory||survives(*it->territory)){++it;continue;}
        const auto ref=ObjectRef{"distributionEntry",it->id};const auto replacement=redirected.find(*it->territory);
        const auto layer=std::find_if(d.distributionLayers.begin(),d.distributionLayers.end(),[&](const auto& l){return l.id==it->layerId;});
        require(layer!=d.distributionLayers.end()&&!layer->locked,CommandError::Locked,"distribution reference locked");
        require(effectAllowed(contentBefore,ref,replacement==redirected.end()?"delete":"relation"),CommandError::UnsupportedDependency,"distribution territorial dependency");
        if(replacement!=redirected.end()){it->territory=replacement->second;++it;}
        else {d.presentation.objectStyles.erase(ref);it=d.distributionEntries.erase(it);}
    }
    for(auto it=d.symbols.begin();it!=d.symbols.end();) {
        if(survives(it->first)){++it;continue;}const auto replacement=redirected.find(it->first);
        if(replacement!=redirected.end()) {
            require(!d.symbols.count(replacement->second),CommandError::UnsupportedDependency,"conflicting territorial symbols");
            d.symbols.emplace(replacement->second,it->second);
        }
        it=d.symbols.erase(it);
    }
    for(auto it=d.countryDetails.begin();it!=d.countryDetails.end();) {
        const auto unit=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return territorialRef(u.id)==it->first;});
        if(unit!=d.units.end()){++it;continue;}
        require(it->second.capital.empty()||!redirected.count(it->first),CommandError::UnsupportedDependency,"capital requires explicit resolution before merge/conversion");
        it=d.countryDetails.erase(it);
    }
    if(action.geometry){std::vector<std::string> removed;for(const auto& ref:action.geometry->removedGeometryOwners)removed.push_back(ref.id);removeTerritorialRecords(d,removed);}
    if(action.geometry)for(const auto& r:d.timelineRecords.parentRelations)if(!r.parentId.empty()) {
        const auto child=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return u.id==r.objectRef.id;});
        const auto parent=std::find_if(d.units.begin(),d.units.end(),[&](const auto& u){return u.id==r.parentId;});
        if(child!=d.units.end()&&parent!=d.units.end()&&child->kind==UnitKind::General)
            require(geometryContains(*shape(parent->id),*shape(child->id)),CommandError::ValidationFailed,"final geometry outside parent");
    }
}
template<class Rows,class Value> void replaceContentRow(Rows& rows,const Value& value) {
    auto found=std::find_if(rows.begin(),rows.end(),[&](const auto& row){return row.id==value.id;});
    if(found==rows.end()) rows.push_back(value); else *found=value;
}
void applyContent(ProjectDocument& d,const DocumentIndex& before,const ContentEdit& edit,bool webHydro=false) {
    require(!edit.target.id.empty(),CommandError::InvalidTargets,"empty content ID");
    const bool exists=before.objects.count(edit.target)!=0;
    require(edit.create?!exists:exists,CommandError::InvalidTargets,"content creation/update existence mismatch");
    require(!edit.create || (!std::holds_alternative<std::monostate>(edit.value) && edit.target.domain!="territorial"),
        CommandError::InvalidArguments,"invalid content creation");
    require(!edit.initialLabelSettings||(edit.target.domain=="label"&&std::holds_alternative<PlaceLabel>(edit.value)),CommandError::InvalidArguments,"label settings require a place value");
    if(edit.geometry) {
        require(!d.geometries.get(edit.geometry->first),CommandError::InvalidArguments,"geometry version already exists");
        d.geometries.insert(edit.geometry->first,edit.geometry->second);
    }
    require(!edit.inlineAllocation||bool(edit.geometry),CommandError::InvalidArguments,"inline evidence requires new geometry");
    if(edit.inlineAllocation) {
        const auto& allocation=*edit.inlineAllocation;const auto& ref=edit.geometry->first;
        const auto wire=edit.target.domain=="hydro"?"hydroEdits":edit.target.domain=="generic"?"genericFeatures":
            edit.target.domain=="label"?"label":edit.target.domain=="distributionEntry"?"distributionEntry":"";
        require(*wire&&allocation.createdFor==edit.target&&!allocation.promoted&&ref.version>=1&&
            ref.id==std::string("web-")+wire+":"+edit.target.id&&!d.geometryProvenance.originalArchive.count(ref),
            CommandError::InvalidArguments,"invalid private inline geometry owner/reference");
        require(!trimWebText(edit.target.id).empty(),
            CommandError::InvalidArguments,"private allocation requires nonempty creator identity");
        require(allocation.geometrySha256==projectcodec::geometrySha256(edit.geometry->second),
            CommandError::InvalidArguments,"inline geometry digest differs from actual shape");
    }
    std::visit([&](const auto& value) {
        using T=std::decay_t<decltype(value)>;
        if constexpr(std::is_same_v<T,std::monostate>) {
            require(exists && edit.target.domain!="territorial",CommandError::InvalidTargets,"content deletion target missing");
            auto erase=[&](auto& rows){rows.erase(std::remove_if(rows.begin(),rows.end(),[&](const auto& row){return row.id==edit.target.id;}),rows.end());};
            if(edit.target.domain=="label") erase(d.labels);
            else if(edit.target.domain=="hydro") {
                erase(d.hydro);removeObjectTimelineRecords(d,edit.target);
            }
            else if(edit.target.domain=="generic") erase(d.genericFeatures);
            else if(edit.target.domain=="distributionEntry") erase(d.distributionEntries);
            else if(edit.target.domain=="distributionLayer") {
                erase(d.distributionLayers);
                for(const auto& entry:d.distributionEntries) if(entry.layerId==edit.target.id) {
                    d.presentation.objectStyles.erase({"distributionEntry",entry.id});
                }
                d.distributionEntries.erase(std::remove_if(d.distributionEntries.begin(),d.distributionEntries.end(),
                    [&](const auto& row){return row.layerId==edit.target.id;}),d.distributionEntries.end());
                for(auto& child:d.distributionLayers) if(child.parentId==edit.target.id) child.parentId.reset();
            } else require(false,CommandError::InvalidTargets,"invalid content domain");
            d.presentation.objectStyles.erase(edit.target);
        } else if constexpr(std::is_same_v<T,CountryDetails>) {
            require(edit.target.domain=="territorial" && exists,CommandError::InvalidTargets,"country missing");
            auto& metadata=d.units.at(before.objects.at(edit.target)).metadata;
            auto annotations=codecjson::parse(metadata);annotations.object.erase("capital");metadata=annotations.encode();
            d.countryDetails[edit.target]=value;
        } else if constexpr(std::is_same_v<T,TerritorialSymbolStyle>) {
            require(edit.target.domain=="territorial" && exists,CommandError::InvalidTargets,"symbol owner missing");
            auto& metadata=d.units.at(before.objects.at(edit.target)).metadata;
            auto annotations=codecjson::parse(metadata);annotations.object.erase("flagDataUrl");metadata=annotations.encode();
            if(value.policy==FlagPolicy::Default)d.symbols.erase(edit.target);
            else d.symbols[edit.target]=value;
        } else {
            const char* domain=std::is_same_v<T,PlaceLabel>?"label":std::is_same_v<T,HydroFeature>?"hydro":
                std::is_same_v<T,DistributionLayer>?"distributionLayer":std::is_same_v<T,DistributionEntry>?"distributionEntry":"generic";
            require(edit.target.domain==domain && edit.target.id==value.id,CommandError::InvalidTargets,"content ID/domain mismatch");
            if constexpr(std::is_same_v<T,PlaceLabel>) replaceContentRow(d.labels,value);
            else if constexpr(std::is_same_v<T,HydroFeature>) {
                if(edit.create&&value.sourceFeatureId&&!webHydro) {
                    const auto original=std::find_if(d.hydro.begin(),d.hydro.end(),[&](const auto& h){return h.id==*value.sourceFeatureId&&h.source.kind=="builtin";});
                    require(original!=d.hydro.end()||(!d.physicalData.source.empty()&&value.source.dataset==d.physicalData.dataset&&
                        value.source.version==d.physicalData.version&&value.source.kind=="user"),
                        CommandError::InvalidArguments,"source hydro dataset feature unavailable");
                    auto& hidden=d.physicalData.hiddenHydroIds;
                    require(std::find(hidden.begin(),hidden.end(),*value.sourceFeatureId)==hidden.end(),
                        CommandError::InvalidArguments,"source hydro already hidden");
                    hidden.push_back(*value.sourceFeatureId);
                }
                require(!edit.create||edit.geometryBinding.has_value(),CommandError::InvalidArguments,"water geometry binding required");
                if(edit.geometryBinding) {
                    if(edit.create)addStaticObjectRecords(d,edit.target,*edit.geometryBinding);
                    else staticGeometryBinding(d,edit.target).geometryRef=*edit.geometryBinding;
                    staticGeometryBinding(d,edit.target).rendering=edit.geometryRendering.value_or("{}");
                }
                replaceContentRow(d.hydro,value);
            }
            else if constexpr(std::is_same_v<T,DistributionLayer>) replaceContentRow(d.distributionLayers,value);
            else if constexpr(std::is_same_v<T,DistributionEntry>) replaceContentRow(d.distributionEntries,value);
            else {
                replaceContentRow(d.genericFeatures,value);
            }
            if(edit.geometry) {
                if constexpr(std::is_same_v<T,PlaceLabel> || std::is_same_v<T,GenericFeature>)
                    require(value.geometry==edit.geometry->first,CommandError::InvalidArguments,"unused content geometry");
                else if constexpr(std::is_same_v<T,HydroFeature>)
                    require(edit.geometryBinding==edit.geometry->first,CommandError::InvalidArguments,"unused water geometry");
                else if constexpr(std::is_same_v<T,DistributionEntry>)
                    require(value.geometry && *value.geometry==edit.geometry->first,CommandError::InvalidArguments,"unused distribution geometry");
                else require(false,CommandError::InvalidArguments,"layer cannot own geometry");
            }
        }
    },edit.value);
    require(!edit.geometry || (edit.value.index()>=1 && edit.value.index()<=5),CommandError::InvalidArguments,"unexpected geometry payload");
    if(edit.initialLabelSettings)d.presentation.webPresentation.labelSettings[edit.target]=*edit.initialLabelSettings;
}
void admitContentInlineGeometry(const ProjectDocument& before,ProjectDocument& candidate,const CommandRequest& request) {
    std::set<ObjectRef> created;
    const auto admit=[&](const ContentEdit& edit){
        if(edit.inlineAllocation) {
            auto allocation=*edit.inlineAllocation;
            // A temporal binding is an archive reference, never an inline fallback.
            if(edit.target.domain=="hydro")allocation.promoted=true;
            require(candidate.geometryProvenance.inlineAllocations.emplace(edit.geometry->first,std::move(allocation)).second,
                CommandError::InvalidArguments,"inline allocation already exists");
        }
        if(edit.create)created.insert(edit.target);
    };
    if(const auto* edit=std::get_if<ContentEdit>(&request.args.action))admit(*edit);
    else if(const auto* batch=std::get_if<ContentBatchEdit>(&request.args.action))for(const auto& edit:batch->edits)admit(edit);
    else return;
    GeometryProvenanceCodecAccess::admitCreatedOpaqueBaseline(before,candidate,created);
    // Creation establishes only the new owner's baseline. Existing opaque
    // dependencies remain protected by the forward reconciliation.
    if(!candidate.geometryProvenance.opaqueUncertain)GeometryProvenanceCodecAccess::sealVerifiedOpaqueBaseline(candidate);
}
void applyArguments(ProjectDocument& candidate,const DocumentIndex& index,const CommandRequest& request)
{
    const auto& args=request.args;
    for(const auto& edit:args.properties.countries) {
        const auto ref=territorialRef(edit.id);
        auto& u=candidate.units.at(index.objects.at(ref));
        auto& style=candidate.presentation.objectStyles.at(ref);
        if(objectDisplayName(u)!=Project::normalizeName(edit.properties.name)){u.name=Project::normalizeName(edit.properties.name);u.nameExplicit=true;}
        u.notes=edit.properties.memo;
        if(effectiveObjectColor(candidate,ref)!=edit.properties.color){style.color=edit.properties.color;style.explicitColor=true;}
        style.opacity=edit.properties.opacity;
    }
    std::visit([&](const auto& action) {
        using T=std::decay_t<decltype(action)>;
        if constexpr(std::is_same_v<T,SetCountryColor>)
            {auto& s=candidate.presentation.objectStyles.at(territorialRef(action.id));s.color=action.color;s.explicitColor=true;}
        else if constexpr(std::is_same_v<T,SetPhysicalData>)
            candidate.physicalData=action.settings;
        else if constexpr(std::is_same_v<T,TerritorialFieldEdit>) {
            applyField(candidate,index,action);
        } else if constexpr(std::is_same_v<T,TerritorialColorEdit>) {
            for(const auto& ref:action.targets){auto& s=candidate.presentation.objectStyles.at(ref);s.explicitColor=action.color.has_value();s.color=action.color.value_or(0);}
        } else if constexpr(std::is_same_v<T,TerritorialLockEdit>) {
            for(const auto& ref:action.targets)candidate.units.at(index.objects.at(ref)).locked=action.locked;
        } else if constexpr(std::is_same_v<T,ApplyTerritorialMutation>) {
            applyTerritorial(candidate,action);
        } else if constexpr(std::is_same_v<T,ContentEdit>) {
            applyContent(candidate,index,action,request.commandId=="hydro.edit"||request.commandId=="hydro.copy");
        } else if constexpr(std::is_same_v<T,ContentBatchEdit>) {
            for(const auto& edit:action.edits)applyContent(candidate,index,edit);
        } else if constexpr(std::is_same_v<T,HistoricalInstantiationPlan>) {
            applyHistoricalInstantiation(candidate,action);
        } else if constexpr(std::is_same_v<T,GisGenericImportPlan>) {
            applyGenericGisImport(candidate,action);
        } else if constexpr(std::is_same_v<T,GisTerritorialImportPlan>) {
            applyTerritorialGisImport(candidate,action);
        } else if constexpr(std::is_same_v<T,GisDistributionImportPlan>) {
            applyDistributionGisImport(candidate,action);
        }
    },args.action);
    for(const auto& field:args.properties.fields)applyField(candidate,index,field);
}
void checkEffects(const ProjectSnapshot& project,const ProjectDocument& after,const CommandRequest& request)
{
    const auto& before=project.document();
    if(const auto* batch=std::get_if<ContentBatchEdit>(&request.args.action)) {
        // Import owns new rows as one candidate. Existing destination locks and
        // retained dependency rules remain authoritative before any commit.
        for(const auto& edit:batch->edits) {
            require(!project.index().objects.count(edit.target),CommandError::InvalidTargets,"import target already exists");
            require(effectAllowed(before,edit.target,"add"),CommandError::UnsupportedDependency,"import creation dependency");
            if(const auto* entry=std::get_if<DistributionEntry>(&edit.value)) {
                const auto layer=project.index().objects.find({"distributionLayer",entry->layerId});
                if(layer!=project.index().objects.end())require(!before.distributionLayers.at(layer->second).locked,
                    CommandError::Locked,"existing import layer locked");
            }
        }
        return;
    }
    if(const auto edit=std::get_if<ContentEdit>(&request.args.action)) {
        const auto& ref=edit->target;
        const auto found=project.index().objects.find(ref);
        const bool exists=found!=project.index().objects.end();
        bool locked=false;
        if(exists) {
            const auto i=found->second;
            if(ref.domain=="territorial") locked=before.units.at(i).locked;
            else if(ref.domain=="hydro") {
                require(before.hydro.at(i).source.kind!="builtin",CommandError::Locked,"builtin hydro requires copy-on-edit");
                locked=before.hydro.at(i).locked;
            }
            else if(ref.domain=="generic") locked=before.genericFeatures.at(i).locked;
            else if(ref.domain=="distributionLayer") locked=before.distributionLayers.at(i).locked;
            else if(ref.domain=="distributionEntry") {
                const auto& entry=before.distributionEntries.at(i);
                locked=before.distributionLayers.at(project.index().objects.at({"distributionLayer",entry.layerId})).locked;
            }
        }
        bool unlockOnly=false;
        if(locked && exists && !edit->geometry) {
            auto unlocked=before;
            const auto i=found->second;
            if(ref.domain=="hydro") unlocked.hydro.at(i).locked=false;
            else if(ref.domain=="generic") unlocked.genericFeatures.at(i).locked=false;
            else if(ref.domain=="distributionLayer") unlocked.distributionLayers.at(i).locked=false;
            unlockOnly=sameContent(unlocked,after);
        }
        const bool rawWebDelete=request.commandId=="hydro.edit"&&std::holds_alternative<std::monostate>(edit->value);
        require(!locked || unlockOnly||rawWebDelete||request.commandId=="generic.color-reset",CommandError::Locked,"content object locked");
        // Derive effects from the candidate, not from UI claims. An opaque
        // geometry dependency must not prevent a safe name-only correction.
        const bool deleting=std::holds_alternative<std::monostate>(edit->value);
        if(!exists) require(effectAllowed(before,ref,"add"),CommandError::UnsupportedDependency,"content creation dependency");
        else if(deleting) require(effectAllowed(before,ref,"delete"),CommandError::UnsupportedDependency,"content deletion dependency");
        else if(unlockOnly) require(effectAllowed(before,ref,"locked"),CommandError::UnsupportedDependency,"content lock dependency");
        else {
            auto allow=[&](bool changed,const char* effect){require(!changed||effectAllowed(before,ref,effect),CommandError::UnsupportedDependency,effect);};
            auto fields=[&](const auto& old,const auto& next){
                using T=std::decay_t<decltype(old)>;
                if constexpr(!std::is_same_v<T,DistributionEntry>)allow(old.name!=next.name,"name");
                if constexpr(std::is_same_v<T,PlaceLabel>||std::is_same_v<T,HydroFeature>||std::is_same_v<T,GenericFeature>) {
                    allow(old.notes!=next.notes,"notes");
                    if constexpr(!std::is_same_v<T,HydroFeature>)allow(!(old.geometry==next.geometry),"geometry");
                    else allow(edit->geometryBinding && !(staticGeometryBinding(before,edit->target).geometryRef==*edit->geometryBinding),"geometry");
                    const auto sourceKey=[](const SourceProvenance& s){return std::tie(s.kind,s.dataset,s.version,s.sourceId,s.sourceFormat,s.sourceType,s.importedAt,s.details);};
                    allow(sourceKey(old.source)!=sourceKey(next.source),"source");
                }
                if constexpr(std::is_same_v<T,PlaceLabel>||std::is_same_v<T,HydroFeature>)allow(old.kind!=next.kind,"kind");
                if constexpr(std::is_same_v<T,PlaceLabel>)allow(!(old.territory==next.territory),"relation");
                if constexpr(std::is_same_v<T,PlaceLabel>)allow(old.sourcePlaceId!=next.sourcePlaceId,"source");
                if constexpr(std::is_same_v<T,PlaceLabel>)allow(old.metadata!=next.metadata||labelWebFields(old)!=labelWebFields(next),"metadata");
                if constexpr(std::is_same_v<T,GenericFeature>)allow(old.fallbackOnly!=next.fallbackOnly,"source");
                if constexpr(std::is_same_v<T,HydroFeature>)allow(old.sourceFeatureId!=next.sourceFeatureId,"source");
                if constexpr(std::is_same_v<T,HydroFeature>)allow(old.annotations!=next.annotations||hydroWebPropertyFields(old)!=hydroWebPropertyFields(next),"metadata");
                if constexpr(std::is_same_v<T,HydroFeature>||std::is_same_v<T,GenericFeature>||std::is_same_v<T,DistributionLayer>){allow(old.color!=next.color,"color");allow(old.locked!=next.locked,"locked");}
                if constexpr(std::is_same_v<T,GenericFeature>||std::is_same_v<T,DistributionLayer>)allow(old.explicitColor!=next.explicitColor,"color");
                if constexpr(std::is_same_v<T,DistributionLayer>){allow(old.parentId!=next.parentId,"relation");allow(old.unit!=next.unit||!(old.valueScale==next.valueScale)||old.groups!=next.groups||old.metadata!=next.metadata,"metadata");}
                if constexpr(std::is_same_v<T,DistributionEntry>){allow(!(old.territory==next.territory)||old.layerId!=next.layerId,"relation");allow(!(old.geometry==next.geometry),"geometry");allow(old.value!=next.value||old.certainty!=next.certainty||old.metadata!=next.metadata,"metadata");}
                if constexpr(std::is_same_v<T,DistributionLayer>||std::is_same_v<T,DistributionEntry>)allow(old.validity.from!=next.validity.from||old.validity.to!=next.validity.to,"validity");
            };
            const auto i=found->second;
            if(ref.domain=="label")fields(before.labels.at(i),after.labels.at(i));
            else if(ref.domain=="hydro")fields(before.hydro.at(i),after.hydro.at(i));
            else if(ref.domain=="generic")fields(before.genericFeatures.at(i),after.genericFeatures.at(i));
            else if(ref.domain=="distributionLayer")fields(before.distributionLayers.at(i),after.distributionLayers.at(i));
            else if(ref.domain=="distributionEntry")fields(before.distributionEntries.at(i),after.distributionEntries.at(i));
            else allow(!sameContent(before,after),std::holds_alternative<CountryDetails>(edit->value)?"capital":"flag");
        }
        if(const auto entry=std::get_if<DistributionEntry>(&edit->value)) {
            const auto destination=project.index().objects.find({"distributionLayer",entry->layerId});
            require(destination!=project.index().objects.end() && !before.distributionLayers.at(destination->second).locked,
                CommandError::Locked,"destination distribution layer locked");
        }
        if(deleting && ref.domain=="distributionLayer") {
            for(const auto& child:before.distributionLayers) if(child.parentId==ref.id)
                require(!child.locked && effectAllowed(before,{"distributionLayer",child.id},"relation"),CommandError::Locked,"child layer is protected");
            for(const auto& entry:before.distributionEntries) if(entry.layerId==ref.id)
                require(effectAllowed(before,{"distributionEntry",entry.id},"delete"),CommandError::UnsupportedDependency,"entry is protected");
        }
        return;
    }
    if(const auto structural=std::get_if<ApplyTerritorialMutation>(&request.args.action)) {
        for(const auto& ref:structural->plan.affectedObjects) {
            if(project.index().objects.count(ref)) {
                const auto& u=before.units.at(project.index().objects.at(ref));
                bool changed=true;
                if(structural->plan.kind==TerritorialMutationKind::ReconcileSharedBoundary&&
                   std::find(structural->plan.targets.begin(),structural->plan.targets.end(),ref)==structural->plan.targets.end()) {
                    const auto next=std::find_if(after.units.begin(),after.units.end(),[&](const auto& unit){return unit.id==u.id;});
                    if(next!=after.units.end()) {
                        const auto root=[](const ProjectDocument& document,std::string id){std::set<std::string> seen;while(seen.insert(id).second){const auto& parent=staticParentRelation(document,id);if(parent.parentId.empty())return id;id=parent.parentId;}throw Rejection{CommandError::ValidationFailed,"parent cycle"};};
                        changed=!sameGeometry(*before.geometries.get(staticGeometryBinding(before,territorialRef(u.id)).geometryRef),*after.geometries.get(staticGeometryBinding(after,territorialRef(u.id)).geometryRef))||
                            staticParentRelation(before,u.id).parentId!=staticParentRelation(after,u.id).parentId||root(before,u.id)!=root(after,u.id);
                    }
                }
                require(!changed||!u.locked,CommandError::Locked,"object locked");
            }
        }
        return;
    }
    if(const auto historical=std::get_if<HistoricalInstantiationPlan>(&request.args.action)) {
        for(const auto& addition:historical->additions) {
            require(effectAllowed(before,ObjectRef{addition.selection.type?"territorial":"hydro",historicalInstanceId(addition)},"add"),
                    CommandError::UnsupportedDependency,"historical creation dependency");
            for(const auto& ref:{addition.parent,addition.sovereign})if(ref&&project.index().objects.count(*ref)) {
                const auto& owner=before.units.at(project.index().objects.at(*ref));
                require(!owner.locked,CommandError::Locked,"historical owner locked");
            }
        }
        for(const auto& patch:historical->territoryReplacements) {
            const auto& owner=before.units.at(project.index().objects.at(patch.owner));
            require(!owner.locked&&effectAllowed(before,patch.owner,"geometry"),CommandError::Locked,"historical geometry owner locked");
        }
        for(const auto& [donor,target]:historical->territoryTransfers) {
            const auto& owner=before.units.at(project.index().objects.at(donor));
            require(!owner.locked&&effectAllowed(before,donor,"delete"),CommandError::Locked,"historical donor locked");
            for(const auto& label:before.labels)if(label.territory==donor)
                require(effectAllowed(before,{"label",label.id},"relation"),CommandError::UnsupportedDependency,"historical label dependency");
            for(const auto& entry:before.distributionEntries)if(entry.territory==donor) {
                const auto layer=std::find_if(before.distributionLayers.begin(),before.distributionLayers.end(),
                    [&](const auto& row){return row.id==entry.layerId;});
                require(layer!=before.distributionLayers.end()&&!layer->locked&&
                        effectAllowed(before,{"distributionEntry",entry.id},"relation"),
                        CommandError::UnsupportedDependency,"historical distribution dependency");
            }
        }
        for(const auto& [id,name]:historical->countryNameUpdates) {
            const auto ref=territorialRef(id);
            const auto& owner=before.units.at(project.index().objects.at(ref));
            require(!owner.locked&&effectAllowed(before,ref,"name"),CommandError::Locked,"historical country name locked");
        }
        return;
    }
    if(const auto generic=std::get_if<GisGenericImportPlan>(&request.args.action)) {
        for(const auto& feature:generic->features)
            require(effectAllowed(before,{"generic",feature.id},"add"),
                    CommandError::UnsupportedDependency,"generic GIS creation dependency");
        return;
    }
    if(const auto gis=std::get_if<GisTerritorialImportPlan>(&request.args.action)) {
        for(const auto& row:gis->units) {
            const auto ref=territorialRef(row.id);
            require(effectAllowed(before,ref,row.replaceExisting?"geometry":"add"),
                CommandError::UnsupportedDependency,"territorial GIS dependency");
            for(const auto& owner:{row.parent,row.sovereign})if(owner) {
                const auto found=project.index().objects.find(*owner);
                if(found!=project.index().objects.end()) {
                    const auto& unit=before.units.at(found->second);
                    require(!unit.locked,CommandError::Locked,
                        "territorial GIS owner locked");
                }
            }
            if(row.replaceExisting) {
                const auto& unit=before.units.at(project.index().objects.at(ref));
                require(!unit.locked,CommandError::Locked,
                    "territorial GIS replacement locked");
            }
        }
        for(const auto& patch:gis->countryReplacements) {
            require(effectAllowed(before,patch.owner,"geometry"),
                CommandError::UnsupportedDependency,"territorial GIS patch dependency");
            const auto& unit=before.units.at(project.index().objects.at(patch.owner));
            require(!unit.locked,CommandError::Locked,
                "territorial GIS donor locked");
        }
        return;
    }
    if(const auto gis=std::get_if<GisDistributionImportPlan>(&request.args.action)) {
        for(const auto& layer:gis->layers)
            require(effectAllowed(before,{"distributionLayer",layer.id},"add"),
                CommandError::UnsupportedDependency,"GIS distribution layer dependency");
        for(const auto& row:gis->entries) {
            require(effectAllowed(before,{"distributionEntry",row.entry.id},"add"),
                CommandError::UnsupportedDependency,"GIS distribution entry dependency");
            if(row.entry.territory)
                require(effectAllowed(before,*row.entry.territory,"relation"),
                    CommandError::UnsupportedDependency,"GIS distribution territory dependency");
            auto found=project.index().objects.find({"distributionLayer",row.entry.layerId});
            if(found!=project.index().objects.end())
                require(!before.distributionLayers.at(found->second).locked,CommandError::Locked,
                    "GIS distribution layer locked");
        }
        return;
    }
    auto allow=[&](bool changed,const ObjectRef& ref,const char* effect) {
        require(!changed || effectAllowed(before,ref,effect),CommandError::UnsupportedDependency,effect);
    };
    // New commands validate their intended effects even for equal-value requests.
    if(request.args.action.index()>=2)for(const auto& ref:request.targets) {
        const auto& u=before.units.at(project.index().objects.at(ref));
        const bool unlock=std::holds_alternative<TerritorialLockEdit>(request.args.action);
        require(unlock || request.commandId=="territorial.batch-color" || request.commandId=="territorial.service-color" || !u.locked,CommandError::Locked,"object locked");
        const char* effect=unlock?"locked":"color";
        if(const auto f=std::get_if<TerritorialFieldEdit>(&request.args.action))
            effect=f->field==TerritorialField::Name?"name":f->field==TerritorialField::Notes?"notes":"validity";
        allow(true,ref,effect);
    }
    for(std::size_t i=0;i<before.units.size();++i) {
        const auto& old=before.units[i]; const auto& next=after.units[i]; const auto ref=territorialRef(old.id);
        const auto& oldStyle=before.presentation.objectStyles.at(ref);
        const auto& nextStyle=after.presentation.objectStyles.at(ref);
        const bool colorChanged=oldStyle.explicitColor!=nextStyle.explicitColor || (oldStyle.explicitColor&&oldStyle.color!=nextStyle.color);
        const bool dateChanged=isStaticTimeline(before) &&
            !sameValidity(staticLifetime(before,territorialRef(old.id)).validity,staticLifetime(after,territorialRef(next.id)).validity);
        bool changed=old.name!=next.name || old.nameExplicit!=next.nameExplicit || old.notes!=next.notes || colorChanged || dateChanged ||
                     oldStyle.opacity!=nextStyle.opacity;
        // Check pre-transaction locks; a compound unlock cannot bypass protection.
        require(!changed || !old.locked || request.commandId=="territorial.batch-color" || request.commandId=="territorial.service-color",CommandError::Locked,"country locked");
        allow(old.name!=next.name,ref,"name"); allow(old.notes!=next.notes,ref,"notes");
        allow(colorChanged,ref,"color");allow(dateChanged,ref,"validity");allow(old.locked!=next.locked,ref,"locked"); allow(oldStyle.opacity!=nextStyle.opacity,ref,"opacity");
    }
}
template<class Range,class Equal> bool same(const Range& a,const Range& b,Equal equal)
{
    return a.size()==b.size() && std::equal(a.begin(),a.end(),b.begin(),equal);
}
bool sameValidity(const Validity& a,const Validity& b) { return a.from==b.from && a.to==b.to; }
bool sameGeometry(const Geometry& a,const Geometry& b)
{
    auto point=[](Point a,Point b){return a.x==b.x && a.y==b.y;};
    auto ring=[&](const Ring& a,const Ring& b){return same(a,b,point);};
    auto polygon=[&](const Polygon& a,const Polygon& b){return same(a,b,ring);};
    return a.type==b.type && same(a.points,b.points,point) && same(a.lines,b.lines,ring) && same(a.polygons,b.polygons,polygon);
}
} // namespace

ChangeImpact calculateChangeImpact(const ProjectDocument& before,const ProjectDocument& after,
                                   const std::vector<ObjectRef>& targets,const std::string& month) {
    ChangeImpact impact;
    if(!isStaticTimeline(before)||!isStaticTimeline(after)) {
        if(month.empty())throw TimelineError("TIMELINE_CURSOR_REQUIRED","change impact needs a month");
        const auto beforeIndex=validateDocument(before),afterIndex=validateDocument(after);
        std::set<ObjectRef> affected(targets.begin(),targets.end());
        for(const auto& [ref,unused]:beforeIndex.objects)affected.insert(ref);
        for(const auto& [ref,unused]:afterIndex.objects)affected.insert(ref);
        impact.changedObjects.assign(affected.begin(),affected.end());
        impact.sceneDirty.affectedObjects=impact.changedObjects;
        impact.sceneDirty.geometry=true;
        impact.sceneDirty.presentation=true;
        impact.sceneDirty.fullRebuild=true;
        impact.requiresFullSceneRebuild=true;
        for(const auto& target:targets)if(target.domain=="territorial") {
            impact.sceneDirty.geometryObjects.push_back(target);
            for(const auto& row:before.timelineRecords.geometryBindings)
                if(row.objectRef.id==target.id)impact.changedGeometries.push_back(row.geometryRef);
            for(const auto& row:after.timelineRecords.geometryBindings)
                if(row.objectRef.id==target.id)impact.changedGeometries.push_back(row.geometryRef);
        }
        std::sort(impact.changedGeometries.begin(),impact.changedGeometries.end());
        impact.changedGeometries.erase(std::unique(impact.changedGeometries.begin(),impact.changedGeometries.end()),
            impact.changedGeometries.end());
        return impact;
    }
    const auto beforeIndex=validateDocument(before),afterIndex=validateDocument(after);
    std::set<ObjectRef> objects,affected(targets.begin(),targets.end()),geometryObjects;
    std::set<GeometryRef> geometries;
    for(const auto& entry:beforeIndex.objects)objects.insert(entry.first);
    for(const auto& entry:afterIndex.objects)objects.insert(entry.first);
    for(const auto& object:objects) {
        const auto oldRef=objectGeometry(before,beforeIndex,object);
        const auto newRef=objectGeometry(after,afterIndex,object);
        const bool lifetime=beforeIndex.objects.count(object)!=afterIndex.objects.count(object);
        const auto oldShape=oldRef?before.geometries.get(*oldRef):nullptr;
        const auto newShape=newRef?after.geometries.get(*newRef):nullptr;
        // Fallback eligibility changes the effective LOD/projection preparation
        // even when the immutable geographic shape and binding remain identical.
        const bool fallbackPolicy=object.domain=="generic"&&!lifetime&&
            before.genericFeatures.at(beforeIndex.objects.at(object)).fallbackOnly!=
            after.genericFeatures.at(afterIndex.objects.at(object)).fallbackOnly;
        const bool geometry=!(oldRef==newRef)||oldShape!=newShape||fallbackPolicy;
        if(lifetime||geometry)affected.insert(object);
        if(geometry) {
            geometryObjects.insert(object);
            // Both endpoints are necessary when deleting or undoing a replacement.
            if(oldRef)geometries.insert(*oldRef);
            if(newRef)geometries.insert(*newRef);
        }
    }
    const auto sourceKey=[](const SourceProvenance& s) {
        return std::tie(s.kind,s.dataset,s.version,s.sourceId,s.sourceFormat,s.sourceType,s.importedAt,s.details);
    };
    const auto& a=before.presentation;const auto& b=after.presentation;
    const bool globalPresentation=!(a.webPresentation==b.webPresentation)||!same(a.objectStyles,b.objectStyles,[](const auto& x,const auto& y) {
            return x.first==y.first&&std::tie(x.second.color,x.second.opacity,x.second.explicitColor)==
                std::tie(y.second.color,y.second.opacity,y.second.explicitColor);
        });
    const bool relationsChanged=
        !same(before.timelineRecords.lifetimes,after.timelineRecords.lifetimes,[](const auto& x,const auto& y) {
            return x.id==y.id&&x.objectRef==y.objectRef&&sameValidity(x.validity,y.validity);
        })||!same(before.timelineRecords.geometryBindings,after.timelineRecords.geometryBindings,[](const auto& x,const auto& y) {
            return x.id==y.id&&x.objectRef==y.objectRef&&sameValidity(x.validity,y.validity)&&x.geometryRef==y.geometryRef&&x.rendering==y.rendering;
        })||!same(before.timelineRecords.parentRelations,after.timelineRecords.parentRelations,[](const auto& x,const auto& y) {
            return x.id==y.id&&x.objectRef==y.objectRef&&sameValidity(x.validity,y.validity)&&x.parentId==y.parentId&&x.coverageMode==y.coverageMode;
        })||!same(before.timelineRecords.propertyBindings,after.timelineRecords.propertyBindings,[](const auto& x,const auto& y) {
            return x.id==y.id&&x.objectRef==y.objectRef&&sameValidity(x.validity,y.validity)&&x.property==y.property&&x.value==y.value;
        });
    const bool unitPresentation=!same(before.units,after.units,[](const auto& x,const auto& y) {
        return std::tie(x.id,x.name,x.notes,x.kind,x.locked,x.baseName,x.nameExplicit,x.libraryOrigin,
                        x.metadata,x.sourceFolderId,x.sourceEntityId,x.sourceGeometryVersion)==
            std::tie(y.id,y.name,y.notes,y.kind,y.locked,y.baseName,y.nameExplicit,y.libraryOrigin,
                     y.metadata,y.sourceFolderId,y.sourceEntityId,y.sourceGeometryVersion);
    });
    const bool contentPresentation=
        !same(before.countryDetails,after.countryDetails,[](const auto& x,const auto& y) {
            return x.first==y.first&&x.second.capital==y.second.capital;
        })||!same(before.symbols,after.symbols,[](const auto& x,const auto& y) {
            return x.first==y.first&&std::tie(x.second.policy,x.second.embeddedDataUrl,x.second.defaultCountryId,x.second.defaultFlagDataUrl)==
                std::tie(y.second.policy,y.second.embeddedDataUrl,y.second.defaultCountryId,y.second.defaultFlagDataUrl);
        })||!same(before.labels,after.labels,[&](const auto& x,const auto& y) {
            return std::tie(x.id,x.name,x.kind,x.notes,x.territory,x.sourcePlaceId,x.metadata)==std::tie(y.id,y.name,y.kind,y.notes,y.territory,y.sourcePlaceId,y.metadata)&&sourceKey(x.source)==sourceKey(y.source)&&labelWebFields(x)==labelWebFields(y);
        })||!same(before.hydro,after.hydro,[&](const auto& x,const auto& y) {
            return std::tie(x.id,x.name,x.kind,x.notes,x.color,x.locked,x.sourceFeatureId,x.annotations)==
                std::tie(y.id,y.name,y.kind,y.notes,y.color,y.locked,y.sourceFeatureId,y.annotations)&&sourceKey(x.source)==sourceKey(y.source)&&hydroWebPropertyFields(x)==hydroWebPropertyFields(y);
        })||!same(before.genericFeatures,after.genericFeatures,[&](const auto& x,const auto& y) {
            return std::tie(x.id,x.name,x.notes,x.color,x.locked,x.fallbackOnly)==
                std::tie(y.id,y.name,y.notes,y.color,y.locked,y.fallbackOnly)&&sourceKey(x.source)==sourceKey(y.source);
        })||!same(before.distributionLayers,after.distributionLayers,[](const auto& x,const auto& y) {
            return std::tie(x.id,x.name,x.unit,x.color,x.locked,x.parentId,x.groups,x.validity.from,x.validity.to,x.metadata,x.valueScale.manual,x.valueScale.min,x.valueScale.max)==
                std::tie(y.id,y.name,y.unit,y.color,y.locked,y.parentId,y.groups,y.validity.from,y.validity.to,y.metadata,y.valueScale.manual,y.valueScale.min,y.valueScale.max);
        })||!same(before.distributionEntries,after.distributionEntries,[](const auto& x,const auto& y) {
            return std::tie(x.id,x.layerId,x.territory,x.value,x.certainty,x.metadata,x.validity.from,x.validity.to)==
                std::tie(y.id,y.layerId,y.territory,y.value,y.certainty,y.metadata,y.validity.from,y.validity.to);
        });
    const bool extensionsChanged=!same(before.extensions,after.extensions,[](const auto& x,const auto& y) {
        return std::tie(x.id,x.sourceFormat,x.sourceSchema,x.jsonPointer,x.payload,x.status,x.dependencyKnowledge,x.dependencies,x.forbiddenEffects,x.envelopeExtras)==
            std::tie(y.id,y.sourceFormat,y.sourceSchema,y.jsonPointer,y.payload,y.status,y.dependencyKnowledge,y.dependencies,y.forbiddenEffects,y.envelopeExtras);
    });
    auto& dirty=impact.sceneDirty;
    dirty.geometry=!geometryObjects.empty();
    dirty.datasetResource=before.documentId!=after.documentId||
        std::tie(before.physicalData.dataset,before.physicalData.version,before.physicalData.source)!=
        std::tie(after.physicalData.dataset,after.physicalData.version,after.physicalData.source);
    dirty.presentation=globalPresentation||relationsChanged||unitPresentation||contentPresentation||extensionsChanged||
        before.physicalData.hiddenHydroIds!=after.physicalData.hiddenHydroIds;
    // Broad display and reference changes can affect objects outside command targets.
    if(dirty.presentation||dirty.datasetResource)affected.insert(objects.begin(),objects.end());
    dirty.affectedObjects.assign(affected.begin(),affected.end());
    dirty.geometryObjects.assign(geometryObjects.begin(),geometryObjects.end());
    // Lifetime and known reference changes are covered by the complete affected
    // set and effective geometry diff; opaque extension effects remain global.
    dirty.fullRebuild=dirty.datasetResource||extensionsChanged;
    impact.changedObjects=dirty.affectedObjects;
    impact.changedGeometries.assign(geometries.begin(),geometries.end());
    if(dirty.presentation)impact.presentationInvalidations=dirty.affectedObjects;
    impact.requiresFullSpatialRebuild=dirty.datasetResource;
    impact.requiresFullSceneRebuild=dirty.fullRebuild;
    for(const auto& [ref,shape]:after.geometries.versions()) {
        const auto old=before.geometries.versions().find(ref);
        if(old!=before.geometries.versions().end()&&old->second==shape) {
            ++impact.retainedGeometryCount;continue;
        }
        impact.estimatedNewGeometryBytes+=sizeof(Geometry)+shape->points.size()*sizeof(Point);
        for(const auto& line:shape->lines)impact.estimatedNewGeometryBytes+=line.size()*sizeof(Point);
        for(const auto& polygon:shape->polygons)for(const auto& ring:polygon)
            impact.estimatedNewGeometryBytes+=ring.size()*sizeof(Point);
    }
    return impact;
}

bool CountryProperties::operator==(const CountryProperties& b) const
{
    return name==b.name && memo==b.memo && color==b.color && opacity==b.opacity;
}
const char* commandErrorCode(CommandError error) noexcept
{
    switch(error) {
    case CommandError::None: return "NONE";
    case CommandError::ProjectMismatch: return "PROJECT_MISMATCH";
    case CommandError::DocumentMismatch: return "DOCUMENT_MISMATCH";
    case CommandError::StaleRevision: return "STALE_REVISION";
    case CommandError::InvalidCommand: return "INVALID_COMMAND";
    case CommandError::InvalidTargets: return "INVALID_TARGETS";
    case CommandError::InvalidArguments: return "INVALID_ARGUMENTS";
    case CommandError::Locked: return "LOCKED";
    case CommandError::UnsupportedDependency: return "UNSUPPORTED_DEPENDENCY";
    case CommandError::ValidationFailed: return "VALIDATION_FAILED";
    case CommandError::PrepareFailed: return "PREPARE_FAILED";
    case CommandError::CommitFailed: return "COMMIT_FAILED";
    case CommandError::PreviewConsumed: return "PREVIEW_CONSUMED";
    case CommandError::RevisionOverflow: return "REVISION_OVERFLOW";
    }
    return "UNKNOWN_ERROR";
}
ChangeSet::ChangeSet(std::shared_ptr<const detail::DocumentState> before,
                     std::shared_ptr<const detail::DocumentState> after,CommandRequest request)
    : before_(std::move(before)),after_(std::move(after)),request_(std::move(request)) {}
const ProjectDocument& ChangeSet::before() const { return before_->document; }
const ProjectDocument& ChangeSet::after() const { return after_->document; }
const ChangeSet& CommandPreview::change() const
{
    if(!change_) throw std::logic_error("PREVIEW_CONSUMED");
    return *change_;
}
CommandRequest CommandProcessor::makeRequest(const Project& project,std::string commandId,CommandArguments args)
{
    auto refs=targetsFor(args);
    return {std::move(commandId),project.instanceId(),project.document().documentId,project.revision(),std::move(refs),std::move(args)};
}
ProjectSnapshot CommandProcessor::timelineViewSnapshot(const ProjectSnapshot& source) {
    if(isStaticTimeline(source.document()))return source;
    auto view=timelineDocumentView(source.document(),source.timelineMonth());
    return {std::make_shared<const detail::DocumentState>(std::move(view.document),std::move(view.inactiveIds)),
        source.instanceId(),source.revision(),source.timelineMonth(),source.timelineEditsEnabled()};
}
bool sameGeometryValue(const Geometry& a,const Geometry& b) {return sameGeometry(a,b);}
PrepareResult CommandProcessor::prepare(const ProjectSnapshot& project,const CommandRequest& request)
{ return prepare(project,request,{}); }
PrepareResult CommandProcessor::prepare(const ProjectSnapshot& project,const CommandRequest& request,const ExtensionRewriter& rewriter)
{return prepareRequest(project,request,rewriter,{});}
PrepareResult CommandProcessor::prepareRequest(const ProjectSnapshot& project,const CommandRequest& request,const ExtensionRewriter& rewriter,const std::string& workflow)
{
    PrepareResult result;
    const auto candidateState=[&](ProjectDocument candidate)->std::shared_ptr<const detail::DocumentState> {
        validateTimelineParentChanges(project.document(),candidate);
        if(workflow.empty())return std::make_shared<const detail::DocumentState>(std::move(candidate));
        return std::make_shared<const detail::DocumentState>(std::move(candidate),detail::CommandBatchStage{});
    };
    try {
        // Existing property intents execute against the effective month view.
        const auto* contentProperty=std::get_if<ContentEdit>(&request.args.action);
        const bool symbolProperty=contentProperty&&contentProperty->target.domain=="territorial"&&
            std::holds_alternative<TerritorialSymbolStyle>(contentProperty->value);
        const auto* webProperty=std::get_if<WebObjectEdit>(&request.args.action);
        const bool datedProperties=request.commandId=="edit.properties"||request.commandId=="country.color"||
            request.commandId=="territorial.field"||request.commandId=="territorial.color"||
            request.commandId=="territorial.color.reset"||request.commandId=="territorial.batch-color"||
            request.commandId=="territorial.service-color"||request.commandId=="territorial.lock"||symbolProperty||
            (webProperty&&webProperty->kind==WebObjectEditKind::Color)||(contentProperty&&contentProperty->target.domain=="hydro");
        if((project.timelineEditsEnabled()||!isStaticTimeline(project.document()))&&datedProperties) {
            validateRequest(project,request);
            auto resolved=timelineDocumentView(project.document(),project.timelineMonth());
            for(const auto& target:request.targets)if((target.domain=="territorial"||target.domain=="hydro") && !(contentProperty&&contentProperty->create))
                require(!resolved.inactiveIds.count(target),CommandError::InvalidTargets,"timeline target inactive");
            auto state=std::make_shared<const detail::DocumentState>(resolved.document,resolved.inactiveIds);
            const ProjectSnapshot view{state,project.instanceId(),project.revision(),project.timelineMonth(),false};
            auto prepared=prepareRequest(view,request,rewriter,workflow);
            if(!prepared.ok()||!prepared.preview)return prepared;
            auto candidate=prepared.preview->change().after();
            candidate.timelineRecords=project.document().timelineRecords;
            if(contentProperty&&contentProperty->target.domain=="hydro") {
                const auto target=contentProperty->target;const auto& original=project.document();
                const auto old=std::find_if(original.hydro.begin(),original.hydro.end(),[&](const auto& row){return row.id==target.id;});
                const auto next=std::find_if(candidate.hydro.begin(),candidate.hydro.end(),[&](const auto& row){return row.id==target.id;});
                if(next==candidate.hydro.end()) {
                    candidate.timelineRecords=truncateTimelineEntityAtMonth(candidate.timelineRecords,target,project.timelineMonth());
                    if(std::any_of(candidate.timelineRecords.lifetimes.begin(),candidate.timelineRecords.lifetimes.end(),[&](const auto& row){return row.objectRef==target;}))candidate.hydro.push_back(*old);
                } else if(old==original.hydro.end()) {
                    const Validity period{project.timelineMonth(),{}};const auto key=target.domain+":"+target.id;
                    candidate.timelineRecords.lifetimes.push_back({"lifetime:"+key,target,period});
                    candidate.timelineRecords.geometryBindings.push_back({"geometry:"+key,target,period,staticGeometryBinding(prepared.preview->change().after(),target).geometryRef,staticGeometryBinding(prepared.preview->change().after(),target).rendering});
                } else {
                    const auto geometry=staticGeometryBinding(prepared.preview->change().after(),target).geometryRef;
                    candidate.timelineRecords=replaceGeometryBindingAtMonth(candidate.timelineRecords,target,project.timelineMonth(),geometry,staticGeometryBinding(prepared.preview->change().after(),target).rendering);
                }
            } else {
                candidate.geometries=project.document().geometries;
                candidate.geometryProvenance=project.document().geometryProvenance;
            }
            candidate.presentation.webPresentation=project.document().presentation.webPresentation;
            captureTimelinePropertyChanges(project.document(),resolved.document,candidate,project.timelineMonth());
            reconcileGeometryProvenance(project.document(),candidate);
            auto after=candidateState(std::move(candidate));
            auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
            if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,project.timelineMonth());
            result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
        }
        if(const auto* source=std::get_if<DocumentSourceInfoAppend>(&request.args.action)) {
            validateRequest(project,request);auto candidate=project.document();
            auto header=codecjson::parse(candidate.exchangeMetadata),incoming=codecjson::parse(source->next),imports=codecjson::Value::arr();
            if(source->mergedAt.empty())throw TimelineError("CORE_SOURCE_INFO","A platform import timestamp is required.");
            const auto append=[&](const codecjson::Value& value) {
                using V=codecjson::Value;
                if(value.kind==V::Null||(value.kind==V::Bool&&value.raw=="false")||(value.kind==V::String&&value.string.empty())||
                    (value.kind==V::Number&&webCommandNumber(value)==std::optional<double>{0}))return;
                const auto rows=value.object.find("imports");
                if(value.kind==V::Object&&rows!=value.object.end()&&rows->second.kind==V::Array)
                    imports.array.insert(imports.array.end(),rows->second.array.begin(),rows->second.array.end());
                else imports.array.push_back(value);
            };
            if(header.object.count("sourceInfo"))append(header.object.at("sourceInfo"));append(incoming);
            auto combined=codecjson::Value::obj();combined.object["mergedAt"]=codecjson::Value::str(source->mergedAt);combined.object["imports"]=std::move(imports);
            header.object["sourceInfo"]=std::move(combined);candidate.exchangeMetadata=header.encode();
            if(semanticallyEqual(project.document(),candidate)){result.status=CommandStatus::NoOp;return result;}
            reconcileGeometryProvenance(project.document(),candidate);GeometryProvenanceCodecAccess::admitSourceInfoMetadata(project.document(),candidate);
            auto after=candidateState(std::move(candidate));auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
            if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),{},project.timelineMonth());result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
        }
        if(const auto* edit=std::get_if<WebObjectEdit>(&request.args.action)) {
            validateRequest(project,request);auto candidate=project.document();
            for(const auto& ref:edit->refs) {
                const auto found=project.index().objects.find(ref);if(found==project.index().objects.end()||
                    (ref.domain=="territorial"&&project.inactiveObjectRefs().count(ref)))throw TimelineError("not-found","The object was not found.");
                const auto index=found->second;const bool lock=edit->kind==WebObjectEditKind::Lock;
                require(effectAllowed(project.document(),ref,lock?"locked":"color"),CommandError::UnsupportedDependency,"object edit dependency");
                if(ref.domain=="territorial") {
                    if(lock)candidate.units.at(index).locked=edit->locked;
                    else {if(candidate.units.at(index).locked)throw TimelineError("locked","Territorial object is locked.");
                        auto& style=candidate.presentation.objectStyles.at(ref);style.color=edit->color;style.explicitColor=true;}
                }else if(ref.domain=="generic") {
                    auto& row=candidate.genericFeatures.at(index);if(lock)row.locked=edit->locked;
                    else {if(row.locked)throw TimelineError("locked","Generic object is locked.");row.color=edit->color;row.explicitColor=true;}
                }else if(ref.domain=="distributionLayer") {
                    auto& row=candidate.distributionLayers.at(index);if(lock)row.locked=edit->locked;
                    else {if(row.locked)throw TimelineError("locked","Distribution layer is locked.");row.color=edit->color;row.explicitColor=true;}
                }else if(ref.domain=="hydro") {
                    auto& row=candidate.hydro.at(index);if(lock){row.locked=edit->locked;if(row.webPropertyFields)row.webPropertyFields->insert("locked");}
                    else {if(row.locked)throw TimelineError("locked","Hydro object is locked.");
                        auto properties=codecjson::parse(row.annotations);properties.object["color"]=projectcodec::webColorValue(edit->color);row.annotations=properties.encode();}
                }else throw TimelineError("invalid","The object has no lock/color capability.");
            }
            if(semanticallyEqual(project.document(),candidate)){result.status=CommandStatus::NoOp;return result;}
            reconcileGeometryProvenance(project.document(),candidate);auto after=candidateState(std::move(candidate));
            auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
            if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,project.timelineMonth());
            result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
        }
        if(const auto* removal=std::get_if<WebObjectRemoval>(&request.args.action)) {
            validateRequest(project,request);
            auto candidate=applyWebObjectRemoval(project,*removal);
            if(semanticallyEqual(project.document(),candidate)){result.status=CommandStatus::NoOp;return result;}
            reconcileGeometryProvenance(project.document(),candidate);
            auto after=candidateState(std::move(candidate));
            auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
            if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,project.timelineMonth());
            result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
        }
        if(const auto* edit=std::get_if<WebTerritorialEdit>(&request.args.action)) {
            validateRequest(project,request);
            auto candidate=applyWebTerritorialEdit(project,*edit,workflow=="territorial.library-import"?TerritorialEditContext::LibraryImport:TerritorialEditContext::UserCommand);
            if(!workflow.empty()) {
                const auto beforeWorld=resolveWorld(project.document().timelineRecords,{timelineEntityCatalog(project.document()),[&](const ObjectRef& owner,const GeometryRef& ref){return bool(project.document().geometries.get(ref));}},project.timelineMonth());
                const auto afterWorld=resolveWorld(candidate.timelineRecords,{timelineEntityCatalog(candidate),[&](const ObjectRef& owner,const GeometryRef& ref){return bool(candidate.geometries.get(ref));}},project.timelineMonth());
                auto& view=candidate.presentation.webPresentation;
                for(const auto& row:beforeWorld.entities)if(row.objectRef.domain=="territorial" && !afterWorld.find(row.objectRef)) {
                    const std::string group="objects";
                    view.eraseItemVisibility(group,row.objectRef.id);view.eraseItemVisibility("objectLabels",webTerritorialLabelDisplayId(project,row.objectRef.id));
                    view.objectStyles.erase(territorialPresentationKey(row.objectRef.id));view.labelSettings.erase(territorialRef(row.objectRef.id));
                }

            }
            if(semanticallyEqual(project.document(),candidate)){result.status=CommandStatus::NoOp;return result;}
            reconcileGeometryProvenance(project.document(),candidate);
            std::set<ObjectRef> created;for(const auto& unit:candidate.units)
                if(!project.index().objects.count(territorialRef(unit.id)))created.insert(territorialRef(unit.id));
            GeometryProvenanceCodecAccess::admitCreatedOpaqueBaseline(project.document(),candidate,created);
            auto after=candidateState(std::move(candidate));
            auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
            if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,project.timelineMonth());
            result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
        }
        if(const auto dated=std::get_if<TimelineTerritorialMutation>(&request.args.action)) {
            validateRequest(project,request);
            require(!isStaticTimeline(project.document())&&dated->month==project.timelineMonth(),
                CommandError::StaleRevision,"timeline mutation month changed");
            auto view=timelineViewSnapshot(project);
            for(const auto& ref:request.targets)
                if(ref.domain=="territorial"&&view.inactiveObjectRefs().count(ref))
                    require(false,CommandError::InvalidTargets,"timeline mutation target inactive");
            CommandArguments staticArgs;staticArgs.action=dated->mutation;
            const auto kind=dated->mutation.plan.kind;
            const auto command=dated->mutation.geometry?"territorial.geometry.commit":
                kind==TerritorialMutationKind::CreateCountry||kind==TerritorialMutationKind::CreateSubunit||
                kind==TerritorialMutationKind::CreateRegion?"territorial.create":
                kind==TerritorialMutationKind::DeleteCountry||kind==TerritorialMutationKind::DeleteUnits?
                "territorial.delete":"territorial.relation.parent";
            CommandRequest staticRequest{command,project.instanceId(),project.document().documentId,
                project.revision(),targetsFor(staticArgs),std::move(staticArgs)};
            auto staticResult=prepare(view,staticRequest,rewriter);
            if(!staticResult.ok()||!staticResult.preview) {
                result.status=staticResult.status;result.error=staticResult.error;
                result.detail=std::move(staticResult.detail);return result;
            }
            const auto& beforeView=view.document();
            const auto& afterView=staticResult.preview->change().after();
            auto candidate=afterView;
            candidate.units=project.document().units;
            candidate.timelineRecords=project.document().timelineRecords;
            candidate.geometries=project.document().geometries;
            candidate.geometryProvenance=project.document().geometryProvenance;
            candidate.presentation=project.document().presentation;
            for(const auto& [ref,shape]:afterView.geometries.versions())
                if(!candidate.geometries.get(ref))candidate.geometries.insert(ref,*shape);
            const auto findUnit=[](const ProjectDocument& d,const std::string& id) {
                return std::find_if(d.units.begin(),d.units.end(),[&](const auto& unit){return unit.id==id;});
            };
            const auto nextRecordId=[&](const std::string& base) {
                const auto used=[&](const std::string& id) {
                    for(const auto& row:candidate.timelineRecords.lifetimes)if(row.id==id)return true;
                    for(const auto& row:candidate.timelineRecords.geometryBindings)if(row.id==id)return true;
                    for(const auto& row:candidate.timelineRecords.parentRelations)if(row.id==id)return true;
                            for(const auto& row:candidate.timelineRecords.propertyBindings)if(row.id==id)return true;
                    return false;
                };
                auto id=base;
                for(unsigned suffix=1;used(id);++suffix)id=base+":"+std::to_string(suffix);
                return id;
            };
            for(const auto& old:beforeView.units) {
                if(view.inactiveObjectRefs().count(territorialRef(old.id)))continue;
                if(findUnit(afterView,old.id)!=afterView.units.end())continue;
                candidate.timelineRecords=truncateTimelineEntityAtMonth(candidate.timelineRecords,territorialRef(old.id),dated->month);
                const bool retained=std::any_of(candidate.timelineRecords.lifetimes.begin(),
                    candidate.timelineRecords.lifetimes.end(),[&](const auto& row){return row.objectRef==territorialRef(old.id);});
                if(!retained) {
                    candidate.units.erase(std::remove_if(candidate.units.begin(),candidate.units.end(),
                        [&](const auto& unit){return unit.id==old.id;}),candidate.units.end());
                    const auto ref=territorialRef(old.id);
                    
                    candidate.presentation.objectStyles.erase(ref);
                }
            }
            for(const auto& unit:afterView.units) {
                if(view.inactiveObjectRefs().count(territorialRef(unit.id)))continue;
                const auto previous=findUnit(beforeView,unit.id);
                const auto ref=territorialRef(unit.id);
                const auto geometry=staticGeometryBinding(afterView,territorialRef(unit.id)).geometryRef;
                const auto& relation=staticParentRelation(afterView,unit.id);
                if(previous==beforeView.units.end()) {
                    require(!project.index().objects.count(ref),CommandError::InvalidTargets,
                        "timeline mutation reuses historical identity");
                    candidate.units.push_back(unit);
                    const Validity validity{dated->month,{}};
                    candidate.timelineRecords.lifetimes.push_back({nextRecordId("lifetime:"+unit.id),territorialRef(unit.id),validity});
                    candidate.timelineRecords.geometryBindings.push_back({nextRecordId("geometry:"+unit.id),territorialRef(unit.id),validity,geometry});
                    candidate.timelineRecords.parentRelations.push_back({nextRecordId("parent:"+unit.id),territorialRef(unit.id),validity,
                        relation.parentId,relation.coverageMode});
                } else {
                    const auto current=std::find_if(candidate.units.begin(),candidate.units.end(),
                        [&](const auto& row){return row.id==unit.id;});
                    require(current!=candidate.units.end(),CommandError::InvalidTargets,"timeline unit missing");
                    *current=unit;
                    if(!(staticGeometryBinding(beforeView,territorialRef(unit.id)).geometryRef==geometry))
                        candidate.timelineRecords=replaceGeometryBindingAtMonth(candidate.timelineRecords,
                            territorialRef(unit.id),dated->month,geometry);
                    const auto& prior=staticParentRelation(beforeView,unit.id);
                    if(prior.parentId!=relation.parentId||prior.coverageMode!=relation.coverageMode)
                        candidate.timelineRecords=replaceParentRelationAtMonth(candidate.timelineRecords,
                            territorialRef(unit.id),dated->month,relation.parentId,relation.coverageMode);
                }
                const auto style=afterView.presentation.objectStyles.find(ref);
                if(style!=afterView.presentation.objectStyles.end())candidate.presentation.objectStyles[ref]=style->second;
                else candidate.presentation.objectStyles.erase(ref);
            }
            captureTimelinePropertyChanges(project.document(),beforeView,candidate,dated->month);
            reconcileGeometryProvenance(project.document(),candidate);
            try {
                auto after=candidateState(std::move(candidate));
                auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
                if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,dated->month);
                result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
            } catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
        }
        const auto creation=std::get_if<TimelineCreate>(&request.args.action);
        const auto deletion=std::get_if<TimelineDelete>(&request.args.action);
        if(creation||deletion) {
            validateRequest(project,request);
            require(!isStaticTimeline(project.document()),CommandError::InvalidArguments,"dated project required");
            const auto& month=creation?creation->month:deletion->month;
            TemporalValue point;
            try { point=parseTemporal(month); }
            catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
            require(point.precision=="month"&&point.canonical==project.timelineMonth(),
                CommandError::StaleRevision,"timeline month changed");
            auto candidate=project.document();
            try {
                const auto world=resolveWorld(candidate.timelineRecords,
                    {timelineEntityCatalog(candidate),[&](const ObjectRef& owner,const GeometryRef& ref){return candidate.geometries.get(ref)!=nullptr;}},month);
                if(creation) {
                    const auto& in=creation->intent;
                    require(!in.id.empty()&&!Project::normalizeName(in.name).empty()&&
                        !project.index().objects.count(territorialRef(in.id)),
                        CommandError::InvalidArguments,"invalid or duplicate timeline identity");
                    require(!in.sovereign&&!in.validity.from&&!in.validity.to,
                        CommandError::InvalidArguments,"unsupported dated creation fields");
                    require(effectAllowed(candidate,territorialRef(in.id),"add"),
                        CommandError::UnsupportedDependency,"timeline creation protected");
                    if(in.parent) {
                        const auto* parent=world.find(territorialRef(in.parent->id));
                        const auto found=project.index().objects.find(*in.parent);
                        require(in.parent->domain=="territorial"&&parent&&found!=project.index().objects.end()&&
                            in.kind==UnitKind::General&&candidate.units.at(found->second).kind==UnitKind::General,
                            CommandError::InvalidTargets,"invalid active timeline parent");
                        require(!objectLocked(candidate,project.index(),*in.parent),CommandError::Locked,"timeline parent locked");
                        require(geometryContains(*candidate.geometries.get(parent->geometryRef),in.geometry),
                            CommandError::ValidationFailed,"GEOMETRY_OUTSIDE_PARENT");
                    }
                    GeometryRef ref{"territorial-geometry:"+in.id,1};
                    for(unsigned suffix=1;candidate.geometries.get(ref);++suffix)
                        ref={"territorial-geometry:"+in.id+":"+std::to_string(suffix),1};
                    candidate.geometries.insert(ref,in.geometry);
                    TerritorialUnit unit;unit.id=in.id;unit.name=in.name;
                    unit.baseName=in.kind==UnitKind::General?in.name:"";
                    unit.nameExplicit=true;unit.notes=in.notes;unit.kind=in.kind;
                    candidate.units.push_back(std::move(unit));
                    const auto recordId=[&](const std::string& base) {
                        const auto used=[&](const std::string& id) {
                            for(const auto& row:candidate.timelineRecords.lifetimes)if(row.id==id)return true;
                            for(const auto& row:candidate.timelineRecords.geometryBindings)if(row.id==id)return true;
                            for(const auto& row:candidate.timelineRecords.parentRelations)if(row.id==id)return true;
                            for(const auto& row:candidate.timelineRecords.propertyBindings)if(row.id==id)return true;
                            return false;
                        };
                        auto id=base;
                        for(unsigned suffix=1;used(id);++suffix)id=base+":"+std::to_string(suffix);
                        return id;
                    };
                    const Validity validity{month,in.parent?world.find(territorialRef(in.parent->id))->validity.to:std::nullopt};
                    const auto coverage=in.parent?timelineMapCoverageAtMonth(candidate.timelineRecords,territorialRef(in.parent->id),month):Validity{};
                    const Validity mapValidity{coverage.from&&point.startKey<parseTemporal(*coverage.from).startKey?coverage.from:month,coverage.to};
                    candidate.timelineRecords.lifetimes.push_back({recordId("lifetime:"+in.id),territorialRef(in.id),validity});
                    candidate.timelineRecords.geometryBindings.push_back({recordId("geometry:"+in.id),territorialRef(in.id),mapValidity,ref});
                    candidate.timelineRecords.parentRelations.push_back({recordId("parent:"+in.id),territorialRef(in.id),mapValidity,
                        in.parent?in.parent->id:"",in.coverageMode.empty()?"explicit":in.coverageMode});
                    const auto object=territorialRef(in.id);
                    candidate.presentation.objectStyles.emplace(object,
                        ObjectStyle{in.explicitColor.value_or(0),1,in.explicitColor.has_value()});
                } else {
                    require(!deletion->targets.empty(),CommandError::InvalidTargets,"empty timeline deletion");
                    const std::set<ObjectRef> unique(deletion->targets.begin(),deletion->targets.end());
                    require(unique.size()==deletion->targets.size(),CommandError::InvalidTargets,
                        "duplicate timeline deletion target");
                    for(const auto& ref:deletion->targets) {
                        require(ref.domain=="territorial"&&world.find(territorialRef(ref.id)),
                            CommandError::InvalidTargets,"inactive timeline deletion target");
                        require(!objectLocked(project.document(),project.index(),ref),
                            CommandError::Locked,"timeline deletion target locked");
                        require(effectAllowed(project.document(),ref,"delete"),
                            CommandError::UnsupportedDependency,"timeline deletion protected");
                        candidate.timelineRecords=truncateTimelineEntityAtMonth(candidate.timelineRecords,territorialRef(ref.id),month);
                        const bool retained=std::any_of(candidate.timelineRecords.lifetimes.begin(),
                            candidate.timelineRecords.lifetimes.end(),[&](const auto& row){return row.objectRef==territorialRef(ref.id);});
                        if(!retained) {
                            candidate.units.erase(std::remove_if(candidate.units.begin(),candidate.units.end(),
                                [&](const auto& unit){return unit.id==ref.id;}),candidate.units.end());
                            
                            candidate.presentation.objectStyles.erase(ref);
                        }
                    }
                }
                reconcileGeometryProvenance(project.document(),candidate);
                auto after=candidateState(std::move(candidate));
                auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
                if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,month);
                result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
            } catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
        }
        const auto geometryEdit=std::get_if<TimelineGeometryEdit>(&request.args.action);
        const auto parentEdit=std::get_if<TimelineParentEdit>(&request.args.action);
        if(geometryEdit||parentEdit) {
            validateRequest(project,request);
            const auto& month=geometryEdit?geometryEdit->month:parentEdit->month;
            const auto& id=geometryEdit?geometryEdit->id:parentEdit->id;
            TemporalValue point;
            try { point=parseTemporal(month); }
            catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
            require(point.precision=="month"&&point.canonical==project.timelineMonth(),
                CommandError::StaleRevision,"timeline month changed");
            const auto target=territorialRef(id);
            require(project.index().objects.count(target)!=0,CommandError::InvalidTargets,"timeline target missing");
            require(!objectLocked(project.document(),project.index(),target),CommandError::Locked,"timeline target locked");
            require(effectAllowed(project.document(),target,geometryEdit?"geometry":"relation"),
                CommandError::UnsupportedDependency,"timeline target protected");
            auto candidate=project.document();
            try {
                const auto world=resolveWorld(candidate.timelineRecords,
                    {timelineEntityCatalog(candidate),[&](const ObjectRef& owner,const GeometryRef& ref){return candidate.geometries.get(ref)!=nullptr;}},month);
                const auto* active=world.find(territorialRef(id));
                if(!active)throw TimelineError("TIMELINE_INACTIVE","target is inactive at month end");
                if(geometryEdit) {
                    const auto previous=candidate.geometries.get(active->geometryRef);
                    if(!previous)throw TimelineError("TIMELINE_GEOMETRY","missing active geometry");
                    if(sameGeometry(*previous,geometryEdit->geometry)) {
                        result.status=CommandStatus::NoOp;return result;
                    }
                    auto version=active->geometryRef.version;
                    for(const auto& [ref,unused]:candidate.geometries.versions())
                        if(ref.id==active->geometryRef.id)version=std::max(version,ref.version);
                    if(version==std::numeric_limits<std::uint32_t>::max())
                        throw std::overflow_error("TIMELINE_GEOMETRY_VERSION_OVERFLOW");
                    GeometryRef next{active->geometryRef.id,version+1};
                    candidate.geometries.insert(next,geometryEdit->geometry);
                    candidate.timelineRecords=replaceGeometryBindingAtMonth(candidate.timelineRecords,territorialRef(id),month,next);
                } else {
                    const auto& targetUnit=candidate.units.at(project.index().objects.at(target));
                    if(targetUnit.kind!=UnitKind::General)
                        throw std::invalid_argument("INVALID_PARENT_KIND");
                    if(!parentEdit->parentId.empty()) {
                        const auto parentRef=territorialRef(parentEdit->parentId);
                        const auto found=project.index().objects.find(parentRef);
                        const auto* parentWorld=world.find(territorialRef(parentEdit->parentId));
                        if(found==project.index().objects.end()||!parentWorld||
                           candidate.units.at(found->second).kind!=UnitKind::General)
                            throw std::invalid_argument("INVALID_PARENT_KIND");
                        require(!objectLocked(project.document(),project.index(),parentRef),
                            CommandError::Locked,"timeline parent locked");
                        if(!geometryContains(*candidate.geometries.get(parentWorld->geometryRef),
                                             *candidate.geometries.get(active->geometryRef)))
                            throw std::invalid_argument("GEOMETRY_OUTSIDE_PARENT");
                    }
                    if(active->parentId==parentEdit->parentId&&active->coverageMode==parentEdit->coverageMode) {
                        result.status=CommandStatus::NoOp;return result;
                    }
                    candidate.timelineRecords=replaceParentRelationAtMonth(candidate.timelineRecords,territorialRef(id),month,
                        parentEdit->parentId,parentEdit->coverageMode);
                }
                reconcileGeometryProvenance(project.document(),candidate);
                auto after=candidateState(std::move(candidate));
                auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
                if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,month);
                result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;
                return result;
            } catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
        }
        if(!isStaticTimeline(project.document())&&
           (request.commandId=="edit.properties"||request.commandId=="country.color"||
            request.commandId=="territorial.field"||request.commandId=="territorial.color"||
            request.commandId=="territorial.color.reset"||request.commandId=="territorial.batch-color"||request.commandId=="territorial.service-color"||
            request.commandId=="territorial.lock")) {
            validateRequest(project,request);
            const auto invalidValidity=[](const TerritorialFieldEdit& edit){
                return edit.field==TerritorialField::ValidFrom||edit.field==TerritorialField::ValidTo;
            };
            require(std::none_of(request.args.properties.fields.begin(),request.args.properties.fields.end(),invalidValidity)&&
                !(std::get_if<TerritorialFieldEdit>(&request.args.action)&&
                  invalidValidity(*std::get_if<TerritorialFieldEdit>(&request.args.action))),
                CommandError::InvalidArguments,"TIMELINE_ACTIVATION: dated validity editing is unavailable");
            const auto world=resolveWorld(project.document().timelineRecords,
                {timelineEntityCatalog(project.document()),[&](const ObjectRef& owner,const GeometryRef& ref){return project.document().geometries.get(ref)!=nullptr;}},
                project.timelineMonth());
            for(const auto& target:request.targets)
                if(target.domain=="territorial")
                    require(world.find(territorialRef(target.id))!=nullptr,CommandError::InvalidTargets,"timeline target inactive");
            auto candidate=project.document();
            try { applyArguments(candidate,project.index(),request); }
            catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
            checkEffects(project,candidate,request);
            if(semanticallyEqual(project.document(),candidate)) {
                result.status=CommandStatus::NoOp;return result;
            }
            reconcileGeometryProvenance(project.document(),candidate);
            try {
                auto after=candidateState(std::move(candidate));
                auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
                if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,project.timelineMonth());
                result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
            } catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
        }
        const bool content=std::holds_alternative<ContentEdit>(request.args.action)||std::holds_alternative<ContentBatchEdit>(request.args.action);
        const auto* fieldEdit=std::get_if<TerritorialFieldEdit>(&request.args.action);
        const bool identityField=fieldEdit&&(fieldEdit->field==TerritorialField::Name||fieldEdit->field==TerritorialField::Notes);
        const bool identityProperties=request.args.properties.countries.empty()&&
            std::all_of(request.args.properties.fields.begin(),request.args.properties.fields.end(),[](const auto& field){return field.field==TerritorialField::Name||field.field==TerritorialField::Notes;})&&request.args.action.index()==0;
        const bool identityAction=identityField||identityProperties||std::holds_alternative<TerritorialColorEdit>(request.args.action)||std::holds_alternative<TerritorialLockEdit>(request.args.action);
        const auto* historical=std::get_if<HistoricalInstantiationPlan>(&request.args.action);
        if(!content&&!identityAction&&!(historical&&historical->applicationMonth))requireStaticTimeline(project.document());
        validateRequest(project,request);
        const auto structural=std::get_if<ApplyTerritorialMutation>(&request.args.action);
        if(structural) {
            auto rederived=planTerritorial(project,structural->plan.intent);
            // Planning is intentionally repeated against the current snapshot.  An
            // allocation failure while doing so is not evidence that a valid plan
            // has gone stale; preserve the candidate and report the preparation
            // failure to callers instead.
            if(!rederived.ok()) {
                require(false,rederived.error==CommandError::PrepareFailed
                              ?CommandError::PrepareFailed:rederived.error,
                        "territorial plan preparation failed");
            }
            require(rederived.plan&&rederived.plan->kind==structural->plan.kind&&rederived.plan->affectedObjects==structural->plan.affectedObjects,CommandError::ValidationFailed,"territorial plan changed");
            require(rederived.plan->geometry.kind==structural->plan.geometry.kind &&
                    rederived.plan->geometry.operation==structural->plan.geometry.operation &&
                    rederived.plan->geometry.readOwners==structural->plan.geometry.readOwners &&
                    rederived.plan->geometry.replacements==structural->plan.geometry.replacements &&
                    rederived.plan->geometry.createOwners==structural->plan.geometry.createOwners &&
                    rederived.plan->geometry.removableOwners==structural->plan.geometry.removableOwners,
                    CommandError::ValidationFailed,"geometry owner contract changed");
            require(rederived.plan->retainedGuards==structural->plan.retainedGuards&&rederived.plan->rewrites==structural->plan.rewrites,CommandError::UnsupportedDependency,"retained guards changed");
            for(const auto& guard:structural->plan.retainedGuards) {
                const auto found=std::find_if(project.document().extensions.begin(),project.document().extensions.end(),[&](const auto& e){return e.id==guard.id&&e.payload==guard.payload;});
                require(found!=project.document().extensions.end(),CommandError::UnsupportedDependency,"retained extension changed");
            }
            require(structural->plan.retainedGuards.empty()||bool(rewriter),CommandError::UnsupportedDependency,"retained references require a rewriter");
        }
        if(const auto gis=std::get_if<GisTerritorialImportPlan>(&request.args.action)) {
            try {
                (void)planTerritorialGisImport(project,gis->info.id,gis->info.source,
                    gis->info.target,gis->units,gis->countryReplacements);
            } catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
        }
        if(const auto gis=std::get_if<GisDistributionImportPlan>(&request.args.action)) {
            try {
                (void)planDistributionGisImport(project,gis->info.id,gis->info.source,
                    gis->layers,gis->entries);
            } catch(const std::invalid_argument& error) {
                result.error=CommandError::ValidationFailed;result.detail=error.what();return result;
            }
        }
        auto candidate=project.document();
        try { applyArguments(candidate,project.index(),request); }
        catch(const std::invalid_argument& e){ result.error=CommandError::ValidationFailed;result.detail=e.what();return result; }
        if(structural && (!structural->plan.retainedGuards.empty() || !structural->plan.rewrites.empty() ||
           (structural->geometry&&!structural->geometry->removedGeometryOwners.empty()))) {
            auto rewritePlan=structural->plan;
            if(structural->geometry)for(const auto& ref:structural->geometry->removedGeometryOwners)
                for(const auto& extension:project.document().extensions) {
                    if(extension.jsonPointer=="/distributionEntries"||extension.jsonPointer=="/genericFeatures")
                        rewritePlan.rewrites.push_back({extension.jsonPointer,ReferenceRewriteOperation::RemoveEntry,ref.id,{}});
                    else if(extension.jsonPointer=="/itemVisibility"||extension.jsonPointer=="/labelSettings")
                        rewritePlan.rewrites.push_back({extension.jsonPointer,ReferenceRewriteOperation::DeleteKey,ref.id,{}});
                }
            require(bool(rewriter)||(rewritePlan.retainedGuards.empty()&&rewritePlan.rewrites.empty()),CommandError::UnsupportedDependency,"retained rewriter required");
            const auto rewritten=rewriter?rewriter(project.document(),rewritePlan,candidate.extensions):ExtensionRewriteResult{};
            require(rewritten.ok,CommandError::UnsupportedDependency,"retained reference rewrite failed");
            for(const auto& guard:structural->plan.retainedGuards)
                require(std::find(rewritten.handledExtensionIds.begin(),rewritten.handledExtensionIds.end(),guard.id)!=rewritten.handledExtensionIds.end(),CommandError::UnsupportedDependency,"retained reference not handled");
        }
        checkEffects(project,candidate,request);
        bool checkpoint=request.commandId=="territorial.batch-color"||request.commandId=="generic.import"||request.commandId=="distribution.import"||request.commandId=="label.gesture.begin";
        if(const auto field=std::get_if<TerritorialFieldEdit>(&request.args.action)) {
            const auto& unit=project.document().units.at(project.index().objects.at(field->target));
            // Current Web compares notes before its store trims them. Repeating
            // whitespace around the stored text therefore keeps one declared
            // history boundary; equal raw text is still a genuine no-op.
            checkpoint=field->field==TerritorialField::Notes && unit.notes!=field->value &&
                unit.notes==trimWebText(field->value);
        }
        // The unchanged candidate is already validated by the current snapshot.
        // Do not turn a no-op into an edit solely by pruning saved rank hints.
        if(!checkpoint && semanticallyEqual(project.document(),candidate)) {
            result.status=CommandStatus::NoOp; return result;
        }
        normalizePresentation(candidate,project.timelineMonth());
        if((request.commandId=="hydro.edit"||request.commandId=="hydro.copy")&&project.document().exchangeMetadata!=candidate.exchangeMetadata) {
            // Admit only the copied-source visibility fields before establishing
            // a newly created content owner's opaque baseline.
            auto source=project.document();source.exchangeMetadata=candidate.exchangeMetadata;
            GeometryProvenanceCodecAccess::admitPresentationMetadata(project.document(),source);
            reconcileGeometryProvenance(source,candidate);admitContentInlineGeometry(source,candidate,request);
        }else {reconcileGeometryProvenance(project.document(),candidate);admitContentInlineGeometry(project.document(),candidate,request);}
        // Full candidate validation and all derived allocations precede preview.
        std::shared_ptr<const detail::DocumentState> after;
        try { after=candidateState(std::move(candidate)); }
        catch(const std::invalid_argument& e) {
            result.error=CommandError::ValidationFailed; result.detail=e.what(); return result;
        }
        if(!checkpoint && semanticallyEqual(project.document(),after->document)) {
            result.status=CommandStatus::NoOp; return result;
        }
        auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));
        if(workflow.empty())change->impact_=calculateChangeImpact(change->before(),change->after(),request.targets,project.timelineMonth());
        change->historyCheckpoint_=checkpoint;
        result.preview=CommandPreview(std::move(change)); result.status=CommandStatus::Prepared;
    } catch(const Rejection& e) {
        result.error=e.error;
        // Diagnostic allocation must not turn a handled failure into mutation.
        try { result.detail=e.detail; } catch(const std::bad_alloc&) {}
    } catch(const TimelineError& e) {
        result.error=CommandError::ValidationFailed;result.detail=e.what();result.operationErrorCode=e.code;
    } catch(const std::exception& error) {
        result.error=CommandError::PrepareFailed;
        // Preserve the actual boundary failure without letting a diagnostic
        // allocation failure escape the rejected command path.
        try {result.detail=error.what();}catch(const std::bad_alloc&){}
    }
    return result;
}
PrepareResult CommandProcessor::prepare(const Project& project,const CommandRequest& request)
{
    try { return prepare(project.snapshot(),request); }
    catch(const std::exception&) { PrepareResult r; r.error=CommandError::PrepareFailed; return r; }
}
PrepareResult CommandProcessor::prepare(const Project& project,const CommandRequest& request,const ExtensionRewriter& rewriter)
{ return prepare(project.snapshot(),request,rewriter); }
TerritorialPlanResult CommandProcessor::planTerritorial(const ProjectSnapshot& project,const TerritorialMutationIntent& intent)
{
    TerritorialPlanResult result;
    try {
        std::visit([&](const auto& value){using T=std::decay_t<decltype(value)>;
            if constexpr(std::is_same_v<T,ChangeParentIntent>)result.plan=planChangeParent(project,value);
            else if constexpr(std::is_same_v<T,ChangeRegionSovereignIntent>)result.plan=planRegionSovereign(project,value);
            else if constexpr(std::is_same_v<T,CreateTerritorialIntent>)result.plan=planCreate(project,value);
            else if constexpr(std::is_same_v<T,DeleteTerritorialIntent>)result.plan=planDelete(project,value);
            else if constexpr(std::is_same_v<T,TransferSubunitIntent>)result.plan=planTransfer(project,value);
            else if constexpr(std::is_same_v<T,ConvertTerritorialTypeIntent>)result.plan=planConversion(project,value);
            else if constexpr(std::is_same_v<T,ReplaceGeometryIntent>)result.plan=planReplaceGeometry(project,value);
            else if constexpr(std::is_same_v<T,MergeTerritorialIntent>)result.plan=planMerge(project,value);
            else if constexpr(std::is_same_v<T,AnnexTerritoryIntent>)result.plan=planAnnex(project,value);
            else if constexpr(std::is_same_v<T,SplitTerritorialIntent>)result.plan=planSplit(project,value);
            else if constexpr(std::is_same_v<T,SharedBoundaryIntent>)result.plan=planSharedBoundary(project,value);
            else if constexpr(std::is_same_v<T,CoastlineIntent>)result.plan=planCoastline(project,value);
        },intent);result.status=CommandStatus::Prepared;
    } catch(const std::invalid_argument& e) { result.detail=e.what();result.error=result.detail=="LOCKED"?CommandError::Locked:result.detail=="INVALID_TARGETS"?CommandError::InvalidTargets:result.detail=="UNSUPPORTED_DEPENDENCY"?CommandError::UnsupportedDependency:CommandError::ValidationFailed; }
    catch(...) { result.error=CommandError::PrepareFailed; }
    return result;
}
TerritorialPlanResult CommandProcessor::planTerritorial(const Project& project,const TerritorialMutationIntent& intent)
{ return planTerritorial(project.snapshot(),intent); }
CommandResult CommandProcessor::confirm(Project& project,CommandPreview& preview)
{
    if(!preview.pending())return {CommandStatus::Rejected,CommandError::PreviewConsumed,{}};
    const auto& request=preview.change().request();
    const auto reject=[&](CommandError error){cancel(preview);return CommandResult{CommandStatus::Rejected,error,{}};};
    if(request.projectInstanceId!=project.instanceId())return reject(CommandError::ProjectMismatch);
    if(request.documentId!=project.document().documentId)return reject(CommandError::DocumentMismatch);
    if(request.revision!=project.revision())return reject(CommandError::StaleRevision);
    try {return confirm(project,preview,commitProjection(project,preview));}
    catch(const std::exception& error) {cancel(preview);return {CommandStatus::Rejected,CommandError::CommitFailed,error.what()};}
}
ProjectSnapshot CommandProcessor::commitProjection(const Project& project,const CommandPreview& preview)
{
    return project.commitSnapshot(preview.change());
}
CommandResult CommandProcessor::confirm(Project& project,CommandPreview& preview,const ProjectSnapshot& prepared)
{
    // Every attempt consumes the token, including stale, foreign or failed commits.
    auto change=std::move(preview.change_);
    if(!change) return {CommandStatus::Rejected,CommandError::PreviewConsumed,{}};
    const auto& request=change->request_;
    if(request.projectInstanceId!=project.instanceId()) return {CommandStatus::Rejected,CommandError::ProjectMismatch,{}};
    if(request.documentId!=project.document().documentId) return {CommandStatus::Rejected,CommandError::DocumentMismatch,{}};
    if(request.revision!=project.revision())
        return {CommandStatus::Rejected,CommandError::StaleRevision,{}};
    if(const auto edit=std::get_if<TimelineGeometryEdit>(&request.args.action))
        if(edit->month!=project.timelineCursor())
            return {CommandStatus::Rejected,CommandError::StaleRevision,{}};
    if(const auto edit=std::get_if<TimelineParentEdit>(&request.args.action))
        if(edit->month!=project.timelineCursor())
            return {CommandStatus::Rejected,CommandError::StaleRevision,{}};
    if(project.revision()==std::numeric_limits<std::uint64_t>::max())
        return {CommandStatus::Rejected,CommandError::RevisionOverflow,{}};
    const bool presentationRebased=!(project.document().presentation.webPresentation==
                                     change->before().presentation.webPresentation);
    // CommandPreview owns a const ChangeSet, so taking its impact is a copy,
    // not a move. Stage that allocation before mutating the project; otherwise
    // an allocation failure could escape after apply() has already committed.
    ChangeImpact impact;
    try {
        impact=change->impact_;
        if(presentationRebased) {
            // Stage conservative display invalidation before committing, preserving
            // the existing no-allocation-after-apply failure contract.
            impact.sceneDirty.presentation=true;
            impact.sceneDirty.fullRebuild=true;
            std::set<ObjectRef> affected(impact.sceneDirty.affectedObjects.begin(),impact.sceneDirty.affectedObjects.end());
            for(const auto& entry:project.index().objects)affected.insert(entry.first);
            for(const auto& entry:change->after_->index.objects)affected.insert(entry.first);
            impact.sceneDirty.affectedObjects.assign(affected.begin(),affected.end());
            impact.changedObjects=impact.sceneDirty.affectedObjects;
            impact.presentationInvalidations=impact.sceneDirty.affectedObjects;
            impact.requiresFullSceneRebuild=true;
        }
        project.apply(*change,prepared);
    }
    catch(const std::exception& error) { return {CommandStatus::Rejected,CommandError::CommitFailed,error.what()}; }
    return {CommandStatus::Applied,CommandError::None,{},std::move(impact)};
}
bool semanticallyEqual(const ProjectDocument& a,const ProjectDocument& b)
{
    if(&a==&b) return true;
    return a.documentId==b.documentId && a.exchangeMetadata==b.exchangeMetadata && a.geometryProvenance==b.geometryProvenance && sameContent(a,b) &&
        same(a.units,b.units,[](const auto& x,const auto& y) {
            return x.id==y.id && x.name==y.name && x.baseName==y.baseName && x.nameExplicit==y.nameExplicit && x.notes==y.notes && x.kind==y.kind &&
                x.locked==y.locked && x.libraryOrigin==y.libraryOrigin && x.metadata==y.metadata &&
                x.sourceFolderId==y.sourceFolderId && x.sourceEntityId==y.sourceEntityId && x.sourceGeometryVersion==y.sourceGeometryVersion;
        }) && a.timelineRecords.schemaVersion==b.timelineRecords.schemaVersion &&
        same(a.timelineRecords.lifetimes,b.timelineRecords.lifetimes,[](const auto& x,const auto& y){return x.id==y.id&&x.objectRef==y.objectRef&&sameValidity(x.validity,y.validity);}) &&
        same(a.timelineRecords.geometryBindings,b.timelineRecords.geometryBindings,[](const auto& x,const auto& y){return x.id==y.id&&x.objectRef==y.objectRef&&sameValidity(x.validity,y.validity)&&x.geometryRef==y.geometryRef&&x.rendering==y.rendering;}) &&
        same(a.timelineRecords.parentRelations,b.timelineRecords.parentRelations,[](const auto& x,const auto& y){return x.id==y.id&&x.objectRef==y.objectRef&&sameValidity(x.validity,y.validity)&&x.parentId==y.parentId&&x.coverageMode==y.coverageMode;}) &&
        same(a.timelineRecords.propertyBindings,b.timelineRecords.propertyBindings,[](const auto& x,const auto& y){return x.id==y.id&&x.objectRef==y.objectRef&&sameValidity(x.validity,y.validity)&&x.property==y.property&&x.value==y.value;}) && same(a.geometries.versions(),b.geometries.versions(),[](const auto& x,const auto& y) {
            return x.first==y.first && (x.second==y.second || sameGeometry(*x.second,*y.second));
        }) && a.presentation.webPresentation==b.presentation.webPresentation &&
        same(a.presentation.objectStyles,b.presentation.objectStyles,[](const auto& x,const auto& y) {
            return x.first==y.first && x.second.explicitColor==y.second.explicitColor && (!x.second.explicitColor || x.second.color==y.second.color) && x.second.opacity==y.second.opacity;
        }) && same(a.extensions,b.extensions,[](const PreservedExtension& x,const PreservedExtension& y) {
            return x.id==y.id && x.sourceFormat==y.sourceFormat && x.sourceSchema==y.sourceSchema &&
                x.jsonPointer==y.jsonPointer && x.payload==y.payload && x.status==y.status &&
                x.dependencyKnowledge==y.dependencyKnowledge && x.dependencies==y.dependencies &&
                x.forbiddenEffects==y.forbiddenEffects && x.envelopeExtras==y.envelopeExtras;
        });
}
} // namespace pandoeditor
