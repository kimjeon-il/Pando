#include <pandoeditor/project.h>
#include <pandoeditor/projectcodec.h>
#include "documentstate.h"
#include <pandoeditor/timeline-view.h>
#include <pandoeditor/losslessjson.h>
#include <algorithm>
#include <atomic>
#include <cctype>
#include <limits>
#include <stdexcept>
#include <type_traits>

namespace pandoeditor {
namespace {
std::string nextInstanceId()
{
    // Process-local session identity, deliberately not persisted in a document.
    static std::atomic<std::uint64_t> counter{0};
    auto value = counter.load(std::memory_order_relaxed);
    do {
        if (value == std::numeric_limits<std::uint64_t>::max())
            throw std::overflow_error("PROJECT_INSTANCE_OVERFLOW");
    } while (!counter.compare_exchange_weak(value, value + 1, std::memory_order_relaxed));
    return "project-session-" + std::to_string(value + 1);
}
bool boundaryHistoryAction(const CommandAction& action) {
    const auto* mutation=std::get_if<ApplyTerritorialMutation>(&action);
    return mutation&&mutation->plan.kind==TerritorialMutationKind::ReconcileSharedBoundary&&std::holds_alternative<SharedBoundaryIntent>(mutation->plan.intent);
}
std::shared_ptr<const detail::DocumentState> restoredBoundaryLabelSettings(
    const ProjectDocument& current,const std::shared_ptr<const detail::DocumentState>& target)
{
    // The boundary web history captures territorial visibility/styles but only
    // custom-label settings. Territorial label settings stay live view state:
    // a deleted owner's key must not reappear solely because Undo restores it.
    auto settings=target->document.presentation.webPresentation.labelSettings;
    for(auto it=settings.begin();it!=settings.end();)if(it->first.domain=="territorial")it=settings.erase(it);else ++it;
    for(const auto& [ref,value]:current.presentation.webPresentation.labelSettings)
        if(ref.domain=="territorial"&&target->index.objects.count(ref))settings[ref]=value;
    if(settings==target->document.presentation.webPresentation.labelSettings)return target;
    auto document=target->document;document.presentation.webPresentation.labelSettings=std::move(settings);
    return std::make_shared<const detail::DocumentState>(std::move(document));
}
void rebasePhysicalPresentation(const ProjectDocument& current,const ProjectDocument& from,ProjectDocument& target) {
    if(current.exchangeMetadata==from.exchangeMetadata)return;
    auto latest=codecjson::parse(current.exchangeMetadata),before=codecjson::parse(from.exchangeMetadata),after=codecjson::parse(target.exchangeMetadata);
    const auto copyKey=[](codecjson::Value& destination,const codecjson::Value& source,const std::string& key) {
        const auto item=source.object.find(key);if(item==source.object.end())destination.object.erase(key);else destination.object[key]=item->second;
    };
    const auto equalKey=[](const codecjson::Value& a,const codecjson::Value& b,const std::string& key) {
        const auto x=a.object.find(key),y=b.object.find(key);return x==a.object.end()?y==b.object.end():y!=b.object.end()&&x->second.encode()==y->second.encode();
    };
    if(!latest.object.count("physicalSettings")||!before.object.count("physicalSettings")||!after.object.count("physicalSettings"))return;
    auto& output=after.object.at("physicalSettings");const auto& prior=before.object.at("physicalSettings");const auto& live=latest.object.at("physicalSettings");
    if(output.kind!=codecjson::Value::Object||prior.kind!=codecjson::Value::Object||live.kind!=codecjson::Value::Object)return;
    for(const auto* key:{"terrainVisible","terrainStyle"})if(equalKey(prior,output,key))copyKey(output,live,key);
    for(const auto* key:{"hydroLayers","hiddenHydroIds"}) {
        if(equalKey(prior,output,key)){copyKey(output,live,key);continue;}
        auto merged=live.object.count(key)?live.object.at(key):codecjson::Value::obj();
        const auto old=prior.object.count(key)?prior.object.at(key):codecjson::Value::obj();
        const auto next=output.object.count(key)?output.object.at(key):codecjson::Value::obj();
        if(merged.kind!=codecjson::Value::Object||old.kind!=codecjson::Value::Object||next.kind!=codecjson::Value::Object)continue;
        std::set<std::string> ids;for(const auto& item:old.object)ids.insert(item.first);for(const auto& item:next.object)ids.insert(item.first);
        for(const auto& id:ids)if(!equalKey(old,next,id))copyKey(merged,next,id);
        output.object[key]=std::move(merged);
    }
    if(after.encode()!=target.exchangeMetadata) {
        auto admitted=target;admitted.exchangeMetadata=after.encode();GeometryProvenanceCodecAccess::admitPhysicalViewMetadata(target,admitted);
        target.exchangeMetadata=std::move(admitted.exchangeMetadata);target.geometryProvenance=std::move(admitted.geometryProvenance);
    }
}
bool territorialDataChanged(const ProjectDocument& before,const TerritorialUnit& old,const ProjectDocument& after,const TerritorialUnit& next) {
    if(std::tie(old.name,old.notes,old.kind,old.locked,old.baseName,old.nameExplicit,old.libraryOrigin,old.metadata,old.sourceFolderId,old.sourceEntityId,old.sourceGeometryVersion)!=
       std::tie(next.name,next.notes,next.kind,next.locked,next.baseName,next.nameExplicit,next.libraryOrigin,next.metadata,next.sourceFolderId,next.sourceEntityId,next.sourceGeometryVersion))return true;
    const auto oldOwner=territorialRef(old.id),newOwner=territorialRef(next.id);
    const auto& oldStyle=before.presentation.objectStyles.at(oldOwner);const auto& newStyle=after.presentation.objectStyles.at(newOwner);
    if(std::tie(oldStyle.color,oldStyle.opacity,oldStyle.explicitColor)!=std::tie(newStyle.color,newStyle.opacity,newStyle.explicitColor))return true;
    const auto oldCapital=before.countryDetails.find(oldOwner),newCapital=after.countryDetails.find(newOwner);
    if((oldCapital==before.countryDetails.end())!=(newCapital==after.countryDetails.end()))return true;
    if(oldCapital!=before.countryDetails.end()&&oldCapital->second.capital!=newCapital->second.capital)return true;
    const auto oldSymbol=before.symbols.find(oldOwner),newSymbol=after.symbols.find(newOwner);
    if((oldSymbol==before.symbols.end())!=(newSymbol==after.symbols.end()))return true;
    if(oldSymbol!=before.symbols.end()) {
        const auto& a=oldSymbol->second;const auto& b=newSymbol->second;
        if(std::tie(a.policy,a.embeddedDataUrl,a.defaultCountryId,a.defaultFlagDataUrl)!=std::tie(b.policy,b.embeddedDataUrl,b.defaultCountryId,b.defaultFlagDataUrl))return true;
    }
    const auto lifetimes=[](const ProjectDocument& d,const std::string& id) {
        std::vector<Validity> result;for(const auto& row:d.timelineRecords.lifetimes)if(row.objectRef==territorialRef(id))result.push_back(row.validity);return result;
    };
    const auto validity=[](const Validity& a,const Validity& b){return a.from==b.from&&a.to==b.to;};
    const auto a=lifetimes(before,old.id),b=lifetimes(after,next.id);
    if(a.size()!=b.size()||!std::equal(a.begin(),a.end(),b.begin(),validity))return true;
    std::vector<const TimelineGeometryBinding*> ga,gb;
    for(const auto& row:before.timelineRecords.geometryBindings)if(row.objectRef==territorialRef(old.id))ga.push_back(&row);
    for(const auto& row:after.timelineRecords.geometryBindings)if(row.objectRef==territorialRef(next.id))gb.push_back(&row);
    if(ga.size()!=gb.size())return true;
    for(std::size_t i=0;i<ga.size();++i) {
        if(!validity(ga[i]->validity,gb[i]->validity))return true;
        const auto first=before.geometries.get(ga[i]->geometryRef),second=after.geometries.get(gb[i]->geometryRef);
        if(first!=second&&(!first||!second||!sameGeometryValue(*first,*second)))return true;
    }
    std::vector<const TimelineParentRelation*> pa,pb;
    for(const auto& row:before.timelineRecords.parentRelations)if(row.objectRef==territorialRef(old.id))pa.push_back(&row);
    for(const auto& row:after.timelineRecords.parentRelations)if(row.objectRef==territorialRef(next.id))pb.push_back(&row);
    if(pa.size()!=pb.size())return true;
    for(std::size_t i=0;i<pa.size();++i)if(!validity(pa[i]->validity,pb[i]->validity)||pa[i]->parentId!=pb[i]->parentId||pa[i]->coverageMode!=pb[i]->coverageMode)return true;
    std::vector<std::tuple<std::string,std::optional<std::string>,std::optional<std::string>,std::string>> propertiesA,propertiesB;
    for(const auto& row:before.timelineRecords.propertyBindings)if(row.objectRef==territorialRef(old.id))propertiesA.emplace_back(row.property,row.validity.from,row.validity.to,row.value);
    for(const auto& row:after.timelineRecords.propertyBindings)if(row.objectRef==territorialRef(next.id))propertiesB.emplace_back(row.property,row.validity.from,row.validity.to,row.value);
    return propertiesA!=propertiesB;
}
std::vector<std::string> dirtyTerritorialOrder(const ProjectDocument& before,const ProjectDocument& after) {
    auto result=before.dirtyTerritorialIds;std::set<std::string> seen(result.begin(),result.end());
    std::map<std::string,const TerritorialUnit*> previous,current;
    for(const auto& row:before.units)previous.emplace(row.id,&row);
    for(const auto& row:after.units)current.emplace(row.id,&row);
    const auto append=[&](const std::string& id){if(seen.insert(id).second)result.push_back(id);};
    for(const auto& row:before.units) {
        const auto next=current.find(row.id);
        if(next==current.end()||territorialDataChanged(before,row,after,*next->second))append(row.id);
    }
    for(const auto& row:after.units)if(!previous.count(row.id))append(row.id);
    return result;
}
std::shared_ptr<const detail::DocumentState> projectedState(const ProjectDocument& document,
                                                             const std::string& month,const ResolvedWorld* resolved=nullptr) {
    if(isStaticTimeline(document))return {};
    if(month.empty())throw TimelineError("TIMELINE_CURSOR_REQUIRED","dated view needs a month");
    auto projection=timelineDocumentView(document,month,resolved);
    return std::make_shared<const detail::DocumentState>(std::move(projection.document),
        std::move(projection.inactiveIds));
}
}
struct ProjectReplacementState::Data {
    std::shared_ptr<const detail::DocumentState> state,saved,view;
    std::shared_ptr<const std::vector<ChangeSet>> commands;
    std::string instanceId,month;
    std::uint64_t revision,presentationRevision,checkpoint,savedCheckpoint,checkpointSequence,presentationCheckpoint,savedPresentationCheckpoint;
    std::size_t cursor;bool timelineEditsEnabled;
};
ProjectReplacementState Project::captureReplacement() const {
    ProjectReplacementState result;result.data_=std::make_shared<const ProjectReplacementState::Data>(ProjectReplacementState::Data{
        state_,saved_,viewState_,commands_,instanceId_,timelineCursor_,revision_,presentationRevision_,checkpoint_,savedCheckpoint_,
        checkpointSequence_,presentationCheckpoint_,savedPresentationCheckpoint_,cursor_,timelineEditsEnabled_});return result;
}
void Project::restoreReplacement(const ProjectReplacementState& checkpoint) {
    if(!checkpoint.data_)throw std::invalid_argument("CORE_REPLACEMENT_ABSENT");const auto& data=*checkpoint.data_;
    auto instance=data.instanceId,month=data.month;
    state_=data.state;saved_=data.saved;viewState_=data.view;commands_=data.commands;instanceId_.swap(instance);timelineCursor_.swap(month);
    revision_=data.revision;presentationRevision_=data.presentationRevision;checkpoint_=data.checkpoint;savedCheckpoint_=data.savedCheckpoint;
    checkpointSequence_=data.checkpointSequence;presentationCheckpoint_=data.presentationCheckpoint;savedPresentationCheckpoint_=data.savedPresentationCheckpoint;
    cursor_=data.cursor;timelineEditsEnabled_=data.timelineEditsEnabled;
}
void Project::admitTerritorialSource(ProjectDocument document,const std::function<ProjectDocument(const ProjectDocument&)>& rebase,
                                    const std::string& month,bool activateEdits) {
    if(revision_==std::numeric_limits<std::uint64_t>::max()||presentationRevision_==std::numeric_limits<std::uint64_t>::max())throw std::overflow_error("PROJECT_REVISION_OVERFLOW");
    auto current=std::make_shared<const detail::DocumentState>(std::move(document));
    std::map<const detail::DocumentState*,std::shared_ptr<const detail::DocumentState>> rebased;
    rebased.emplace(state_.get(),current);
    const auto rebuild=[&](const std::shared_ptr<const detail::DocumentState>& old) {
        if(const auto found=rebased.find(old.get());found!=rebased.end())return found->second;
        auto next=std::make_shared<const detail::DocumentState>(rebase(old->document));rebased.emplace(old.get(),next);return next;
    };
    auto saved=rebuild(saved_);std::vector<ChangeSet> commands=*commands_;
    for(auto& command:commands){command.before_=rebuild(command.before_);command.after_=rebuild(command.after_);}
    auto ledger=std::make_shared<const std::vector<ChangeSet>>(std::move(commands));
    auto view=projectedState(current->document,month);auto cursor=month;
    state_=std::move(current);saved_=std::move(saved);commands_=std::move(ledger);viewState_=std::move(view);timelineCursor_.swap(cursor);
    timelineEditsEnabled_=activateEdits;++revision_;++presentationRevision_;
}
void Project::admitPresentation(ProjectDocument document,bool advanceRevision) {
    if(advanceRevision&&presentationRevision_==std::numeric_limits<std::uint64_t>::max())throw std::overflow_error("PROJECT_REVISION_OVERFLOW");
    auto next=std::make_shared<const detail::DocumentState>(std::move(document));auto view=projectedState(next->document,timelineCursor_);
    state_=std::move(next);viewState_=std::move(view);if(advanceRevision)++presentationRevision_;
}
void Project::admitTerritorialDirtyIds(const std::function<std::vector<std::string>(const ProjectDocument&)>& read) {
    std::map<const detail::DocumentState*,std::shared_ptr<const detail::DocumentState>> rebuilt;
    const auto rebase=[&](const std::shared_ptr<const detail::DocumentState>& old) {
        if(const auto found=rebuilt.find(old.get());found!=rebuilt.end())return found->second;
        auto ids=read(old->document);auto result=old;
        if(ids!=old->document.dirtyTerritorialIds) {auto document=old->document;document.dirtyTerritorialIds=std::move(ids);result=std::make_shared<const detail::DocumentState>(std::move(document));}
        rebuilt.emplace(old.get(),result);return result;
    };
    auto state=rebase(state_),saved=rebase(saved_);auto commands=*commands_;
    for(auto& command:commands){command.before_=rebase(command.before_);command.after_=rebase(command.after_);}
    auto ledger=std::make_shared<const std::vector<ChangeSet>>(std::move(commands));auto view=projectedState(state->document,timelineCursor_);
    state_=std::move(state);saved_=std::move(saved);commands_=std::move(ledger);viewState_=std::move(view);
}
Project::Project() : state_(std::make_shared<const detail::DocumentState>()),
                     saved_(state_), instanceId_(nextInstanceId()) {}
std::string Project::normalizeName(const std::string& name)
{
    auto first=std::find_if_not(name.begin(),name.end(),[](unsigned char c){return std::isspace(c);});
    auto last=std::find_if_not(name.rbegin(),name.rend(),[](unsigned char c){return std::isspace(c);}).base();
    return first<last ? std::string(first,last) : std::string();
}
void Project::validate(const ProjectDocument& document) { (void)validateDocument(document); }
void Project::replace(ProjectDocument document)
{
    auto next=std::make_shared<const detail::DocumentState>(std::move(document));
    auto identity=nextInstanceId();auto ledger=std::make_shared<const std::vector<ChangeSet>>();
    // No allocation or validation after this point: replace is all-or-nothing.
    state_=std::move(next); saved_=state_; viewState_.reset(); instanceId_.swap(identity);
    commands_=std::move(ledger); cursor_=0; revision_=0; presentationRevision_=0; checkpoint_=savedCheckpoint_=checkpointSequence_=0;
    presentationCheckpoint_=savedPresentationCheckpoint_=0;
    timelineCursor_.clear();timelineEditsEnabled_=!isStaticTimeline(state_->document);
}
bool Project::setTimelineCursor(const std::string& month,bool activateEdits,const ResolvedWorld* resolved) {
    const auto header=codecjson::parse(document().exchangeMetadata);if(header.object.count("projectSetup"))projectcodec::requireNavigationMonth(header.object.at("projectSetup"),month);
    std::string next;
    if(!month.empty()) {
        const auto parsed=parseTemporal(month);
        if(parsed.precision!="month")throw std::invalid_argument("INVALID_TIMELINE_CURSOR: month precision required");
        next=parsed.canonical;
    }
    const bool activates=activateEdits&&!timelineEditsEnabled_;
    if(next==timelineCursor_){timelineEditsEnabled_=timelineEditsEnabled_||activateEdits;return activates;}
    auto view=next.empty()?std::shared_ptr<const detail::DocumentState>{}:projectedState(document(),next,resolved);
    viewState_=std::move(view);
    timelineCursor_.swap(next);timelineEditsEnabled_=timelineEditsEnabled_||activateEdits;return true;
}
std::shared_ptr<const detail::DocumentState> Project::presentationView(const ProjectDocument& document) const {
    return projectedState(document,timelineCursor_);
}
ProjectSnapshot Project::snapshotForView() const {
    if(!isStaticTimeline(document())) {
        if(!viewState_)throw TimelineError("TIMELINE_CURSOR_REQUIRED","month required for dated view");
        return {viewState_,instanceId_,revision_,timelineCursor_,timelineEditsEnabled_};
    }
    return snapshot();
}
ResolvedWorld Project::resolveWorld(const std::string& month) const {
    const auto& d=document();
    return pandoeditor::resolveWorld(d.timelineRecords,{timelineEntityCatalog(d),
        [&](const ObjectRef& owner,const GeometryRef& ref){return d.geometries.get(ref)!=nullptr;}},month);
}
const ProjectDocument& Project::document() const noexcept { return state_->document; }
const ProjectDocument& Project::viewDocument() const noexcept {
    return viewState_?viewState_->document:state_->document;
}
const std::set<ObjectRef>& Project::inactiveObjectRefs() const noexcept {
    return viewState_?viewState_->inactiveIds:state_->inactiveIds;
}
const std::vector<CountryView>& Project::countries() const noexcept {
    return viewState_?viewState_->countries:state_->countries;
}
const DocumentIndex& Project::index() const noexcept { return state_->index; }
const DocumentIndex& Project::viewIndex() const noexcept {
    return viewState_?viewState_->index:state_->index;
}
const CountryView* Project::country(const std::string& id) const
{
    const auto& state=viewState_?viewState_:state_;
    auto it=state->countryIndex.find(id);
    return it==state->countryIndex.end()?nullptr:&countries()[it->second];
}
const ObjectPropertyView* Project::propertyView(const ObjectRef& ref) const {
    const auto& state=viewState_?viewState_:state_;
    auto it=state->properties.find(ref);return it==state->properties.end()?nullptr:&it->second;
}
void Project::apply(const ChangeSet& change)
{
    apply(change,commitSnapshot(change));
}
ProjectSnapshot Project::commitSnapshot(const ChangeSet& change) const
{
    if(presentationRevision_==std::numeric_limits<std::uint64_t>::max())throw std::overflow_error("PRESENTATION_REVISION_OVERFLOW");
    if(change.request_.projectInstanceId!=instanceId_||change.request_.documentId!=document().documentId||change.request_.revision!=revision_)
        throw std::invalid_argument("STALE_REVISION: command source changed");
    auto rebased=change.after_;
    if(!(document().presentation.webPresentation==change.before_->document.presentation.webPresentation)) {
        auto candidate=change.after_->document;
        candidate.presentation.webPresentation=rebasePresentation(document(),change.before_->document,candidate);
        const auto owned=[&](auto& output,const auto& prior,const auto& target) {
            std::set<typename std::decay_t<decltype(output)>::key_type> keys;
            for(const auto& row:prior)keys.insert(row.first);for(const auto& row:target)keys.insert(row.first);
            for(const auto& key:keys) {
                const auto before=prior.find(key),after=target.find(key);
                const bool equal=before==prior.end()?after==target.end():after!=target.end()&&before->second==after->second;
                if(!equal){if(after==target.end())output.erase(key);else output[key]=after->second;}
            }
        };
        auto& output=candidate.presentation.webPresentation;
        const auto& prior=change.before().presentation.webPresentation;const auto& target=change.after().presentation.webPresentation;
        owned(output.labelSettings,prior.labelSettings,target.labelSettings);owned(output.objectStyles,prior.objectStyles,target.objectStyles);
        std::set<std::string> itemGroups;for(const auto& row:prior.itemVisibility)itemGroups.insert(row.first);for(const auto& row:target.itemVisibility)itemGroups.insert(row.first);
        for(const auto& key:itemGroups) {
            static const std::map<std::string,bool> empty;
            const auto old=prior.itemVisibility.find(key),next=target.itemVisibility.find(key);
            owned(output.itemVisibility[key],old==prior.itemVisibility.end()?empty:old->second,next==target.itemVisibility.end()?empty:next->second);
        }
        rebased=std::make_shared<const detail::DocumentState>(std::move(candidate));
    }
    // View-only controls may change while a geometry candidate is held. Their
    // source metadata is rebased by field, while command-owned sourceInfo and
    // all other header data stay in the validated candidate.
    if(document().exchangeMetadata!=change.before().exchangeMetadata||document().presentation.catalog!=rebased->document.presentation.catalog) {
        auto candidate=rebased->document;
        rebasePhysicalPresentation(document(),change.before(),candidate);
        candidate.presentation.catalog=document().presentation.catalog;
        rebased=std::make_shared<const detail::DocumentState>(std::move(candidate));
    }
    const auto dirtyIds=dirtyTerritorialOrder(document(),rebased->document);
    if(dirtyIds!=rebased->document.dirtyTerritorialIds) {
        auto candidate=rebased->document;candidate.dirtyTerritorialIds=dirtyIds;
        rebased=std::make_shared<const detail::DocumentState>(std::move(candidate));
    }
    ProjectSnapshot prepared{std::move(rebased),instanceId_,revision_,timelineCursor_,timelineEditsEnabled_};
    prepared.commitSource_=state_;return prepared;
}
void Project::apply(const ChangeSet& change,const ProjectSnapshot& prepared)
{
    if(!prepared.matches(*this)||prepared.commitSource_!=state_||prepared.timelineMonth_!=timelineCursor_||prepared.timelineEditsEnabled_!=timelineEditsEnabled_)
        throw std::invalid_argument("STALE_REVISION: commit projection changed");
    auto rebased=prepared.state_;
    auto nextView=projectedState(rebased->document,timelineCursor_);
    // Stage the entire prospective history, including metadata allocations.
    // Erasing the redo branch before this succeeds would break failure atomicity.
    std::vector<ChangeSet> next;
    next.reserve(cursor_+1);
    next.insert(next.end(),commands_->begin(),commands_->begin()+cursor_);
    next.push_back(change);
    next.back().before_=state_;
    next.back().after_=rebased;
    auto& staged=next.back();staged.checkpointBefore_=checkpoint_;staged.checkpointAfter_=checkpoint_;
    // Every accepted document history boundary gets its own saved-content
    // checkpoint, including the narrowly declared equal-value Web actions.
    if(checkpointSequence_==std::numeric_limits<std::uint64_t>::max())throw std::overflow_error("CHECKPOINT_OVERFLOW");
    staged.checkpointAfter_=checkpointSequence_+1;
    const auto checkpoint=staged.checkpointAfter_;
    // The current application keeps thirty whole-document Undo boundaries.
    // Detached GeometryDraft history has its separate one-hundred-step limit.
    constexpr std::size_t historyLimit=30;
    const auto nextCursor=std::min(cursor_+1,historyLimit);
    if(next.size()>historyLimit)next.erase(next.begin(),next.begin()+(next.size()-historyLimit));
    auto ledger=std::make_shared<const std::vector<ChangeSet>>(std::move(next));
    checkpoint_=checkpoint;++checkpointSequence_;
    commands_=std::move(ledger);
    state_=std::move(rebased);viewState_=std::move(nextView);
    ++presentationRevision_;
    cursor_=nextCursor;++revision_;
}
void Project::amendLabelGesture(const ChangeSet& change,std::uint64_t checkpoint)
{
    if(!canUndo()||canRedo()||checkpoint_!=checkpoint||(*commands_)[cursor_-1].request_.commandId!="label.gesture.begin"||
        revision_==std::numeric_limits<std::uint64_t>::max()||presentationRevision_==std::numeric_limits<std::uint64_t>::max())
        throw std::invalid_argument("STALE_LABEL_GESTURE: gesture history boundary changed");
    const auto prepared=commitSnapshot(change);auto view=projectedState(prepared.document(),timelineCursor_);
    auto ledger=*commands_;auto& gesture=ledger[cursor_-1];
    if(change.request_.targets!=gesture.request_.targets)throw std::invalid_argument("STALE_LABEL_GESTURE: gesture target changed");
    gesture.after_=prepared.state_;gesture.impact_=calculateChangeImpact(gesture.before(),gesture.after(),gesture.request_.targets,timelineCursor_);
    auto commands=std::make_shared<const std::vector<ChangeSet>>(std::move(ledger));
    state_=prepared.state_;viewState_=std::move(view);commands_=std::move(commands);++revision_;++presentationRevision_;
}
std::string Project::historyCommandId(bool forward) const {
    return (forward?canRedo():canUndo())?(*commands_)[forward?cursor_:cursor_-1].request_.commandId:std::string{};
}
std::optional<TerritorialMutationKind> Project::nextUndoTerritorialMutationKind() const noexcept {
    if(!canUndo())return {};
    const auto* action=std::get_if<ApplyTerritorialMutation>(&(*commands_)[cursor_-1].request_.args.action);
    return action?std::optional<TerritorialMutationKind>(action->plan.kind):std::nullopt;
}
std::optional<TerritorialMutationKind> Project::nextRedoTerritorialMutationKind() const noexcept {
    if(!canRedo())return {};
    const auto* action=std::get_if<ApplyTerritorialMutation>(&(*commands_)[cursor_].request_.args.action);
    return action?std::optional<TerritorialMutationKind>(action->plan.kind):std::nullopt;
}
ProjectSnapshot Project::historySnapshot(bool forward) const {
    if(!(forward?canRedo():canUndo()))return snapshot();
    const auto& command=(*commands_)[forward?cursor_:cursor_-1];
    const auto& target=forward?command.after_:command.before_;
    const auto& from=forward?command.before_:command.after_;
    auto next=target;
    if(!(document().presentation.webPresentation==from->document.presentation.webPresentation)) {
        auto candidate=next->document;
        candidate.presentation.webPresentation=rebasePresentation(document(),from->document,candidate);
        next=std::make_shared<const detail::DocumentState>(std::move(candidate));
    }
    // Physical viewing settings are not part of Web document history. Only
    // rebase them when they actually differ: re-encoding an unchanged header
    // would modify losslessly retained JSON bytes during an unrelated Undo.
    if(next->document.exchangeMetadata!=document().exchangeMetadata) {
        auto header=codecjson::parse(next->document.exchangeMetadata);
        const auto live=codecjson::parse(document().exchangeMetadata);
        const auto restored=header.object.find("physicalSettings");
        const auto current=live.object.find("physicalSettings");
        const bool unchanged=current==live.object.end()
            ? restored==header.object.end()
            : restored!=header.object.end()&&restored->second.encode()==current->second.encode();
        if(!unchanged) {
            auto candidate=next->document;
            if(current==live.object.end())header.object.erase("physicalSettings");
            else header.object["physicalSettings"]=current->second;
            candidate.exchangeMetadata=header.encode();
            GeometryProvenanceCodecAccess::admitPhysicalViewMetadata(next->document,candidate);
            next=std::make_shared<const detail::DocumentState>(std::move(candidate));
        }
    }
    if(command.batchBoundaryLabelSettings_||boundaryHistoryAction(command.request_.args.action))next=restoredBoundaryLabelSettings(document(),next);
    if(command.request_.commandId=="label.gesture.begin") {
        auto candidate=next->document;auto& settings=candidate.presentation.webPresentation.labelSettings;
        for(const auto& ref:command.request_.targets) {
            const auto& beforeLabel=command.before_->document.labels.at(command.before_->index.objects.at(ref));
            const auto& afterLabel=command.after_->document.labels.at(command.after_->index.objects.at(ref));
            const bool moved=!sameGeometryValue(*command.before_->document.geometries.get(beforeLabel.geometry),*command.after_->document.geometries.get(afterLabel.geometry));
            const auto& restore=moved?target->document.presentation.webPresentation.labelSettings:document().presentation.webPresentation.labelSettings;
            const auto owned=restore.find(ref);if(owned==restore.end())settings.erase(ref);else settings[ref]=owned->second;
        }
        next=std::make_shared<const detail::DocumentState>(std::move(candidate));
    }
    if(next->document.presentation.catalog!=document().presentation.catalog) {
        auto candidate=next->document;candidate.presentation.catalog=document().presentation.catalog;
        next=std::make_shared<const detail::DocumentState>(std::move(candidate));
    }
    ProjectSnapshot prepared{std::move(next),instanceId_,revision_,timelineCursor_,timelineEditsEnabled_};
    prepared.historySource_=state_;prepared.historyForward_=forward;prepared.historyCursor_=cursor_;
    return prepared;
}
bool Project::travelHistory(bool forward,const ProjectSnapshot& prepared) {
    if(!(forward?canRedo():canUndo())||revision_==std::numeric_limits<std::uint64_t>::max()||!prepared.matches(*this)
        ||prepared.historySource_!=state_||prepared.historyForward_!=std::optional<bool>{forward}
        ||prepared.historyCursor_!=cursor_||prepared.timelineMonth_!=timelineCursor_)return false;
    const auto& command=(*commands_)[forward?cursor_:cursor_-1];
    const auto& target=forward?command.after_:command.before_;
    auto nextView=projectedState(prepared.document(),timelineCursor_);
    const bool savedTarget=target==saved_||semanticallyEqual(target->document,saved_->document);
    auto nextSaved=savedTarget?target:saved_;
    state_=prepared.state_;viewState_=std::move(nextView);saved_=std::move(nextSaved);
    checkpoint_=forward?command.checkpointAfter_:command.checkpointBefore_;
    if(forward)++cursor_;else --cursor_;
    ++revision_;++presentationRevision_;return true;
}
bool Project::undo() { return travelHistory(false,historySnapshot(false)); }
bool Project::hasActiveObject(const ObjectRef& ref) const noexcept {
    return index().objects.count(ref)!=0&&!inactiveObjectRefs().count(ref);
}
bool Project::redo() { return travelHistory(true,historySnapshot(true)); }
void Project::markSaved() noexcept { saved_=state_; savedCheckpoint_=checkpoint_;savedPresentationCheckpoint_=presentationCheckpoint_; }
bool Project::dirty() const { return documentDirty()||presentationDirty(); }
} // namespace pandoeditor
