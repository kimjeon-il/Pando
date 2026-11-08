#include <pandoeditor/presentationcommands.h>
#include "documentstate.h"
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/timeline-resolver.h>
#include <cmath>
#include <algorithm>
#include <limits>
#include <stdexcept>
#include <type_traits>

namespace pandoeditor {
namespace {
bool group(const std::string& g){return g=="objects"||g=="labels"||g=="rivers"||g=="lakes"||g=="genericFeatures"||g=="distributions";}
void require(bool v){if(!v)throw std::invalid_argument("INVALID_PRESENTATION_COMMAND");}
void merge(PresentationStyle& s,const PresentationStyle& p){if(p.opacity)s.opacity=p.opacity;if(p.boundaryVisible)s.boundaryVisible=p.boundaryVisible;if(p.labelsVisible)s.labelsVisible=p.labelsVisible;if(p.boundaryWidth)s.boundaryWidth=p.boundaryWidth;if(p.blendMode)s.blendMode=p.blendMode;if(p.colorVisible)s.colorVisible=p.colorVisible;}
void webStyle(PresentationStyle& s,bool complete) {
    if(complete||s.opacity)s.opacity=std::clamp(s.opacity&&std::isfinite(*s.opacity)?*s.opacity:1,0.0,1.0);
    if(complete||s.colorVisible)s.colorVisible=s.colorVisible.value_or(true);
    if(complete||s.boundaryVisible)s.boundaryVisible=s.boundaryVisible.value_or(true);
    if(complete||s.boundaryWidth)s.boundaryWidth=1;
    if(complete||s.labelsVisible)s.labelsVisible=s.labelsVisible.value_or(true);
    if(complete||s.blendMode)s.blendMode=s.blendMode&&*s.blendMode=="multiply"?"multiply":"normal";
}
}
PresentationPreparation PresentationCommandProcessor::prepare(const ProjectSnapshot& project,const PresentationAction& action,
    const std::function<std::optional<std::string>(const SelectionRef&)>& builtinLogicalId) noexcept {
    try {
        auto d=project.document();auto& p=d.presentation.webPresentation;
        auto targetGroup=[&](const ObjectRef& ref){auto i=project.index().objects.find(ref);require(i!=project.index().objects.end());return ref.domain=="territorial"?territorialGroup(d,ref.id):contentGroup(d,ref);};
        auto itemGroup=[&](const ObjectRef& ref){return ref.domain=="territorial"?targetGroup(ref):contentItemGroup(d,ref);};
        auto set=[&](const ObjectRef& ref,bool visible){auto g=itemGroup(ref);if(visible)p.eraseItemVisibility(g,ref.id);else p.itemVisibility[g][ref.id]=false;};
        std::visit([&](const auto& a){using T=std::decay_t<decltype(a)>;
            if constexpr(std::is_same_v<T,SetPresentationVisibility>||std::is_same_v<T,WebControlVisibility>) {
                require(group(a.key)||a.key=="objectNames"||a.key=="objectFlags");
                if(groupVisible(p,a.key)!=a.visible)p.visibility[a.key]=a.visible;
            } else if constexpr(std::is_same_v<T,SetScopedVisibility>) {
                require(group(a.group)&&!a.targets.empty());for(const auto& r:a.targets)require(targetGroup(r)==a.group);
                if(!groupVisible(p,a.group)){for(const auto& [ref,index]:project.index().objects)if(targetGroup(ref)==a.group)p.itemVisibility[itemGroup(ref)][ref.id]=false;p.visibility[a.group]=true;}
                for(const auto& r:a.targets)set(r,a.visible);
            } else if constexpr(std::is_same_v<T,SetBatchVisibility>) {
                require(!a.targets.empty());bool all=true;for(const auto& r:a.targets)all= itemVisible(p,itemGroup(r),r.id)&&all;
                const bool visible=a.visible.value_or(!all);for(const auto& r:a.targets)set(r,visible);
            } else if constexpr(std::is_same_v<T,WebDistributionLayerVisibility>) {
                require(project.index().objects.count({"distributionLayer",a.id}));
                if(a.visible)p.eraseItemVisibility("distributions",a.id);else p.itemVisibility["distributions"][a.id]=false;
            } else if constexpr(std::is_same_v<T,WebObjectVisibility>) {
                require(!a.refs.empty());
                std::vector<ObjectRef> stored;std::vector<std::string> physical;bool all=true;
                const auto world=resolveWorld(d.timelineRecords,{timelineEntityCatalog(d),[&](const ObjectRef& owner,const GeometryRef& ref){return d.geometries.get(ref)!=nullptr;}},project.timelineMonth());
                const auto currentGroup=[&](const ObjectRef& ref) {
                    if(ref.domain!="territorial")return contentItemGroup(d,ref);
                    const auto row=world.find(ref);require(bool(row));
                    return std::string("objects");
                };
                for(const auto& ref:a.refs) {
                    if(ref.domain=="hydroBuiltin") {
                        require(bool(builtinLogicalId));const auto logical=builtinLogicalId(ref);require(logical&& !logical->empty());physical.push_back(*logical);
                        const bool visible=itemVisible(p,"hydro",*logical);
                        all=all&&visible;
                    }else {
                        ObjectRef target{ref.domain,ref.id};require(project.index().objects.count(target));stored.push_back(target);
                        all=all&&itemVisible(p,currentGroup(target),target.id);
                    }
                }
                const bool visible=a.visible.value_or(!all);
                for(const auto& ref:stored) {const auto g=currentGroup(ref);if(visible)p.eraseItemVisibility(g,ref.id);else p.itemVisibility[g][ref.id]=false;}
                if(!physical.empty()) {
                    for(const auto& id:physical)if(visible)p.eraseItemVisibility("hydro",id);else p.itemVisibility["hydro"][id]=false;
                }
            } else if constexpr(std::is_same_v<T,PatchGroupPresentation>) {
                require(group(a.group)||a.group=="objectLabels"||a.group=="terrain");merge(p.styles[a.group],a.patch);

            } else if constexpr(std::is_same_v<T,SetLabelSettings>) {
                require(project.index().objects.count(a.ref) && (a.ref.domain=="territorial" || a.ref.domain=="label"));
                p.labelSettings[a.ref]=a.settings;
            } else if constexpr(std::is_same_v<T,SetDistributionSettings>) {
                p.distributionSettings=a.settings;
            } else if constexpr(std::is_same_v<T,PatchObjectPresentation>) {
                require(a.ref.domain=="territorial"&&project.index().objects.count(a.ref));
                merge(p.objectStyles[territorialPresentationKey(a.ref.id)],a.patch);
            } else if constexpr(std::is_same_v<T,SetPresentationOrder>) {
                p.objectOrder=a.objectOrder;p.overlayOrder=a.overlayOrder;p.overlayOrderPresent=a.overlayOrderPresent;
            } else if constexpr(std::is_same_v<T,WebControlGroupPresentation>) {
                require(group(a.group)||a.group=="objectLabels"||a.group=="terrain");
                auto& style=p.styles[a.group];const auto labels=style.labelsVisible.value_or(true);merge(style,a.patch);style.labelsVisible=labels;style.boundaryWidth=1;
                for(const auto* key:{"objects","distributions","rivers","lakes","genericFeatures","labels","objectLabels","terrain"})webStyle(p.styles[key],true);
                for(auto& [key,override]:p.objectStyles)webStyle(override,false);
            } else if constexpr(std::is_same_v<T,SetTerrainPresentation>) {
                throw std::invalid_argument("DEVICE_PREFERENCE: terrain is not project content");
            } else if constexpr(std::is_same_v<T,WebControlDistributionPresentation>) {
                if(a.field==DistributionPresentationField::RenderMode)p.distributionSettings.renderMode=a.value=="single"?DistributionRenderMode::Single:DistributionRenderMode::Overlap;
                else if(a.field==DistributionPresentationField::ActiveLayer)p.distributionSettings.activeLayerId=a.value;
                else p.distributionSettings.boundaryVisible=a.visible;
            }
        },action);
        if(std::holds_alternative<WebControlVisibility>(action)||std::holds_alternative<WebControlGroupPresentation>(action)) {
            for(const auto* key:{"objects","distributions","rivers","lakes","genericFeatures","labels","objectLabels","terrain"})webStyle(p.styles[key],true);
            for(auto& [key,style]:p.objectStyles)webStyle(style,false);
            p.overlayOrder={"distributions","objects","genericFeatures"};p.overlayOrderPresent=true;
        }
        GeometryProvenanceCodecAccess::admitPresentationMetadata(project.document(),d);
        validatePresentation(d);
        // A true no-op must not prune retained web rank hints as a side effect.
        const bool touch=std::holds_alternative<WebControlVisibility>(action)||std::holds_alternative<WebControlGroupPresentation>(action)||std::holds_alternative<WebControlDistributionPresentation>(action)||std::holds_alternative<WebDistributionLayerVisibility>(action);
        if(!touch&&p==project.document().presentation.webPresentation&&d.exchangeMetadata==project.document().exchangeMetadata)return {PresentationResult::NoOp,{}};
        normalizePresentation(d,project.timelineMonth());
        if(!touch&&p==project.document().presentation.webPresentation&&d.exchangeMetadata==project.document().exchangeMetadata)return {PresentationResult::NoOp,{}};
        auto next=std::make_shared<const detail::DocumentState>(std::move(d));
        return {PresentationResult::Applied,PresentationPreview{project,
            ProjectSnapshot{std::move(next),project.instanceId(),project.revision(),project.timelineMonth(),project.timelineEditsEnabled()}}};
    } catch(const std::invalid_argument&){return {PresentationResult::InvalidArguments,{}};}
    catch(...){return {PresentationResult::Failed,{}};}
}
PresentationResult PresentationCommandProcessor::confirm(Project& project,PresentationPreview& preview) noexcept {
    if(!preview.pending())return PresentationResult::InvalidArguments;
    auto before=std::move(*preview.before_),after=std::move(*preview.after_);preview.before_.reset();preview.after_.reset();
    if(!before.matches(project))return PresentationResult::StaleRevision;
    try {
        require(project.presentationRevision_!=std::numeric_limits<std::uint64_t>::max()&&
            project.presentationCheckpoint_!=std::numeric_limits<std::uint64_t>::max());
        auto view=project.presentationView(after.document());
        project.state_=std::move(after.state_);project.viewState_=std::move(view);
        ++project.presentationRevision_;++project.presentationCheckpoint_;return PresentationResult::Applied;
    }catch(const std::invalid_argument&){return PresentationResult::InvalidArguments;}
    catch(...){return PresentationResult::Failed;}
}
PresentationResult PresentationCommandProcessor::apply(Project& project,const PresentationAction& action) noexcept {
    try {
        auto prepared=prepare(project.snapshot(),action);
        return prepared.preview?confirm(project,*prepared.preview):prepared.result;
    }catch(...){return PresentationResult::Failed;}
}
}
