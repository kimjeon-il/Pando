#include <pandoeditor/document-session.h>
#include <limits>
#include <pandoeditor/webterritorialcommands.h>
#include <pandoeditor/objectproperties.h>
#include <cmath>

namespace pandoeditor {
DocumentSession::DocumentSession(projectcodec::PlatformPorts ports):ports_(std::move(ports)) {
    if(!ports_.validateFlagDataUrl)throw std::invalid_argument("CODEC_PLATFORM_REQUIRED: flag validator");
}
DocumentSessionState DocumentSession::adoptPreparedProject(Project&& project) {
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    project_=std::move(project);clearPreview();selection_.resetProject();draft_=GeometryDraft{};draftActive_=false;
    externalSelectionRefs_.clear();loaded_=true;stateRevision_=0;sourceEpoch_=++epoch_;return projectState();
}
DocumentSessionOutcome DocumentSession::adoptPreparedCommand(PrepareResult&& prepared,std::uint32_t expectedEpoch) {
    requireLoaded();if(expectedEpoch<sourceEpoch_||expectedEpoch>epoch_)return rejected(CommandError::StaleRevision,"document/cursor source epoch changed");
    if(prepared.preview) {
        const auto& request=prepared.preview->change().request();
        if(request.projectInstanceId!=project_.instanceId()||request.documentId!=project_.document().documentId||request.revision!=project_.revision())
            return rejected(CommandError::StaleRevision,"prepared command source changed");
    }
    clearPreview();auto result=retainPreview(std::move(prepared));if(result.candidateId)candidateEpoch_=expectedEpoch;return result;
}
const CommandPreview* DocumentSession::candidatePreview(std::uint32_t candidateId) const {
    requireLoaded();return preview_&&candidateId==candidateId_?&*preview_:nullptr;
}
void DocumentSession::requireLoaded() const {
    if(!loaded_)throw std::invalid_argument("CORE_SESSION_UNLOADED: Load a document first.");
}
void DocumentSession::clearPreview() { preview_.reset();candidateId_=0;candidateEpoch_=0;labelGesture_.reset(); }
DocumentSessionState DocumentSession::documentLoad(const std::string& input,const std::string& currentMonth) {
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    auto document=projectcodec::decodeWebStorage(input,ports_,storageBaseline_?&*storageBaseline_:nullptr);
    const auto month=projectcodec::restoredTimelineMonth(document);
    // Both decoding and Project::replace build a validated candidate before the
    // canonical state changes. No partially parsed document can publish.
    const bool resumeEditing=!isStaticTimeline(document);
    Project candidate;candidate.replace(std::move(document));candidate.setTimelineCursor(month,resumeEditing);
    const auto header=codecjson::parse(candidate.document().exchangeMetadata);
    auto active=storageBaseline_&&header.object.at("baseDataset").string==storageBaseline_->baseDataset()?storageBaseline_:
        std::optional<projectcodec::WebStorageBaseline>{projectcodec::admitWebStorageDocumentBaseline(candidate.snapshot(),ports_)};
    candidate.admitTerritorialDirtyIds([&](const ProjectDocument& d){return projectcodec::initialDirtyTerritorialIds(d,*active);});
    project_=std::move(candidate);activeBaseline_=std::move(active);
    clearPreview();selection_.resetProject();externalSelectionRefs_.clear();draft_=GeometryDraft{};draftActive_=false;
    loaded_=true;sourceEpoch_=++epoch_;stateRevision_=0;
    return projectState();
}
std::string DocumentSession::storageSnapshot() const { requireLoaded();return projectcodec::encodeWeb(project_.snapshot(),ports_); }
std::string DocumentSession::documentSnapshot() const {requireLoaded();return projectcodec::webSnapshot(project_.snapshot());}
std::string DocumentSession::validateImport(const std::string& input,std::optional<std::uint32_t> baselineId) const {
    if(baselineId&&(!storageBaseline_||*baselineId!=storageBaselineId_))throw TimelineError("PL-SCHEMA-BASE","The requested baseline is absent or replaced.");
    auto decoded=projectcodec::decodeWebStorage(input,ports_,storageBaseline_?&*storageBaseline_:nullptr);
    Project staged;staged.replace(std::move(decoded));
    auto prepared=codecjson::parse(projectcodec::webSnapshot(staged.snapshot()));
    return prepared.encode();
}
ImportInspection DocumentSession::inspectImport(const std::string& input,std::optional<std::uint32_t> baselineId,const std::string& currentMonth) const {
    if(baselineId&&(!storageBaseline_||*baselineId!=storageBaselineId_))throw TimelineError("PL-SCHEMA-BASE","The requested baseline is absent or replaced.");
    auto decoded=projectcodec::decodeWebStorage(input,ports_,storageBaseline_?&*storageBaseline_:nullptr);
    const auto month=projectcodec::restoredTimelineMonth(decoded);
    Project staged;staged.replace(std::move(decoded));staged.setTimelineCursor(month,false);
    return {projectcodec::webSnapshot(staged.snapshot()),staged.resolveWorld(month)};
}
DocumentSessionState DocumentSession::storageBaselineLoad(const codecjson::Value& input,std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);if(epoch_==std::numeric_limits<std::uint32_t>::max()||storageBaselineSequence_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    auto baseline=projectcodec::admitWebStorageBaseline(project_.snapshot(),input,ports_);
    const auto header=codecjson::parse(project_.document().exchangeMetadata);
    if(header.object.at("baseDataset").string==baseline.baseDataset()) {
        project_.admitTerritorialDirtyIds([&](const ProjectDocument& document){return projectcodec::initialDirtyTerritorialIds(document,baseline);});
        activeBaseline_=baseline;
    }
    storageBaseline_=std::move(baseline);storageBaselineId_=++storageBaselineSequence_;++epoch_;return projectState();
}
DocumentSessionState DocumentSession::storageBaselineLoad(const projectcodec::WebStorageAssetSource& input,std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);if(epoch_==std::numeric_limits<std::uint32_t>::max()||storageBaselineSequence_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    auto baseline=projectcodec::admitWebStorageAssetBaseline(project_.snapshot(),input,ports_);
    storageBaseline_=std::move(baseline);storageBaselineId_=++storageBaselineSequence_;++epoch_;return projectState();
}
DocumentSessionState DocumentSession::admitExternalBaseline(std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);if(project_.canUndo()||project_.canRedo())throw TimelineError("CORE_BASELINE_ADMISSION","An external baseline must be admitted at document load.");
    const auto header=codecjson::parse(project_.document().exchangeMetadata);
    if(storageBaseline_&&header.object.at("baseDataset").string==storageBaseline_->baseDataset())return projectState();
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    auto baseline=projectcodec::admitWebStorageDocumentBaseline(project_.snapshot(),ports_);
    project_.admitTerritorialDirtyIds([&](const ProjectDocument& document){return projectcodec::initialDirtyTerritorialIds(document,baseline);});
    activeBaseline_=std::move(baseline);++epoch_;return projectState();
}
ResolvedWorld DocumentSession::baselineWorld(std::uint32_t id,const std::string& month) const {
    if(!storageBaseline_||id!=storageBaselineId_||!storageBaseline_->sourceDocument())throw TimelineError("PL-SCHEMA-BASE","Baseline source is absent or replaced.");
    Project staged;staged.replace(*storageBaseline_->sourceDocument());return staged.resolveWorld(month);
}
Project DocumentSession::prepareBaselineProject(std::uint32_t id,const codecjson::Value& options,const std::string& documentId) const {
    if(!storageBaseline_||id!=storageBaselineId_||!storageBaseline_->sourceDocument())throw TimelineError("PL-SCHEMA-BASE","The full accepted baseline source is absent or replaced.");
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    auto document=*storageBaseline_->sourceDocument();document.dirtyTerritorialIds.clear();
    const auto before=document;const auto setup=projectcodec::validateProjectSetup(options);auto header=codecjson::parse(document.exchangeMetadata);header.object["projectSetup"]=setup;
    if(setup.object.at("sourceMode").string=="empty") {
        document.units.clear();document.countryDetails.clear();document.symbols.clear();document.labels.clear();document.hydro.clear();document.genericFeatures.clear();document.distributionLayers.clear();document.distributionEntries.clear();
        document.timelineRecords=TimelineRecords{};document.geometries=GeometryStore{};document.geometryProvenance=GeometryProvenance{};document.presentation=PresentationState{};
        header.object["baseDataset"]=codecjson::Value::str("external-territorial-entities");header.object["sourceInfo"]=codecjson::Value{};
    }
    document.exchangeMetadata=header.encode();
    if(setup.object.at("sourceMode").string=="builtin")GeometryProvenanceCodecAccess::admitProjectSetupMetadata(before,document);
    if(documentId.empty())throw TimelineError("INVALID_DOCUMENT_ID","New document ID is required.");document.documentId=documentId;
    const auto month=setup.object.at("initialMonth").string;Project candidate;candidate.replace(std::move(document));candidate.setTimelineCursor(month,true);
    return candidate;
}
DocumentSessionState DocumentSession::documentLoadBaseline(std::uint32_t id,const codecjson::Value& options,const std::string& documentId) {
    auto candidate=prepareBaselineProject(id,options,documentId);
    const auto result=adoptPreparedProject(std::move(candidate));activeBaseline_=storageBaseline_;return result;
}
DocumentSessionOutcome DocumentSession::documentTransitionBaseline(std::uint32_t id,const codecjson::Value& options,std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);
    const auto setup=projectcodec::validateProjectSetup(options);
    const auto header=codecjson::parse(project_.document().exchangeMetadata);
    if(!activeBaseline_||activeBaseline_->kind()!=projectcodec::WebStorageBaselineKind::Builtin
       ||setup.object.at("sourceMode").string!="builtin"||header.object.at("projectSetup").object.at("sourceMode").string!="builtin"
       ||project_.dirty()||project_.canUndo()||project_.canRedo())
        throw TimelineError("CORE_BUILTIN_TRANSITION","A clean active builtin viewer source is required.");
    // The accepted source is still selected and validated for the requested date.
    // Keep its viewer identity and emit a delta, not a full storage projection.
    auto candidate=prepareBaselineProject(id,setup,project_.document().documentId);
    for(const auto& [ref,shape]:candidate.document().geometries.versions()) {
        const auto previous=project_.document().geometries.get(ref);
        if(previous&&previous!=shape&&!sameGeometryValue(*previous,*shape))
            throw TimelineError("CORE_BUILTIN_GEOMETRY_VERSION","A temporal source cannot replace an immutable geometry version.");
    }
    const auto impact=calculateChangeImpact(project_.document(),candidate.document(),{},setup.object.at("initialMonth").string);
    DocumentSessionOutcome outcome;outcome.result.status=CommandStatus::Applied;outcome.result.impact=impact;
    outcome.delta=projectcodec::encodeWebDelta(project_.document(),candidate.document(),impact);
    // All validation and delta allocation finish before the active owner changes.
    adoptPreparedProject(std::move(candidate));activeBaseline_=storageBaseline_;return outcome;
}
DocumentSessionState DocumentSession::documentInitialize(const std::string& input,const std::string& currentMonth,bool preserveCursor,
        const std::optional<codecjson::Value>& features,const std::optional<std::string>& territorialSource,std::uint32_t expectedEpoch,std::optional<std::uint32_t> baselineId) {
    if(loaded_)requireEpoch(expectedEpoch);else if(expectedEpoch!=0)throw std::invalid_argument("STALE_REVISION: unloaded session epoch must be zero");
    if(unsigned(bool(features))+unsigned(bool(territorialSource))+unsigned(bool(baselineId))>1)throw std::invalid_argument("CORE_SOURCE_ADMISSION: source protocols are mutually exclusive");
    if(baselineId&&(!storageBaseline_||*baselineId!=storageBaselineId_||!storageBaseline_->sourceDocument()))throw TimelineError("PL-SCHEMA-BASE","Accepted baseline source is absent or replaced.");
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    auto content=loaded_?project_.document():projectcodec::readWebSnapshot(input,ports_);
    ProjectDocument source;
    if(baselineId)source=*storageBaseline_->sourceDocument();
    else if(territorialSource)source=projectcodec::decodeWeb(*territorialSource,ports_);
    else if(features) {
        ProjectDocument empty;empty.documentId=content.documentId;empty.exchangeMetadata=content.exchangeMetadata;
        Project staged;staged.replace(std::move(empty));auto payload=codecjson::Value::obj();payload.object["features"]=*features;
        const auto request=readWebTerritorialCommand(staged.snapshot(),"territorial.replace",payload,ports_);
        source=applyWebTerritorialEdit(staged.snapshot(),std::get<WebTerritorialEdit>(request.args.action),TerritorialEditContext::SourceAdmission);
    }else source=projectcodec::readWebSnapshot(input,ports_);
    const auto month=loaded_&&preserveCursor?project_.timelineCursor():initialTimelineMonth(source.timelineRecords,currentMonth);
    auto document=projectcodec::replaceWebTerritorialSource(content,source,month);
    std::optional<projectcodec::WebStorageBaseline> active;
    if(baselineId)active=storageBaseline_;
    else {Project sourceProject;sourceProject.replace(source);sourceProject.setTimelineCursor(month,false);
        active=projectcodec::admitWebStorageDocumentBaseline(sourceProject.snapshot(),ports_);}
    const auto rebase=[&](const ProjectDocument& old) {
        auto next=projectcodec::replaceWebTerritorialSource(old,source,month);
        next.dirtyTerritorialIds=active?projectcodec::initialDirtyTerritorialIds(next,*active):std::vector<std::string>{};return next;
    };
    document.dirtyTerritorialIds=active?projectcodec::initialDirtyTerritorialIds(document,*active):std::vector<std::string>{};
    const bool activated=!isStaticTimeline(document)||(loaded_&&preserveCursor&&project_.timelineEditsEnabled());
    // Source promotion rebases the existing immutable ledger and saved state.
    // User content/view checkpoints survive; it is not a user history action.
    if(loaded_)project_.admitTerritorialSource(std::move(document),rebase,month,activated);
    else {Project candidate;candidate.replace(std::move(document));candidate.setTimelineCursor(month,activated);project_=std::move(candidate);loaded_=true;}
    activeBaseline_=active;clearPreview();selection_.prune([&](const SelectionRef& ref){return selectionRefExists(ref);});sourceEpoch_=++epoch_;return projectState();
}
std::uint32_t DocumentSession::captureReplacement(std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);if(replacementSequence_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_REPLACEMENT_OVERFLOW");
    Replacement next{project_.captureReplacement(),selection_,draft_,draftActive_,externalSelectionRefs_,storageBaseline_,activeBaseline_,storageBaselineId_,stateRevision_};
    replacement_=std::move(next);replacementId_=++replacementSequence_;return replacementId_;
}
DocumentSessionState DocumentSession::rollbackReplacement(std::uint32_t id,std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);if(!replacement_||id!=replacementId_)throw std::invalid_argument("CORE_REPLACEMENT_ABSENT");
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    project_.restoreReplacement(replacement_->project);selection_=std::move(replacement_->selection);draft_=std::move(replacement_->draft);
    draftActive_=replacement_->draftActive;externalSelectionRefs_=std::move(replacement_->externalSelectionRefs);
    storageBaseline_=std::move(replacement_->storageBaseline);
    activeBaseline_=std::move(replacement_->activeBaseline);storageBaselineId_=replacement_->storageBaselineId;
    stateRevision_=replacement_->stateRevision;
    replacement_.reset();replacementId_=0;clearPreview();sourceEpoch_=++epoch_;return projectState();
}
bool DocumentSession::releaseReplacement(std::uint32_t id) {if(!replacement_||id!=replacementId_)return false;replacement_.reset();replacementId_=0;return true;}
std::string DocumentSession::exportSnapshot(const projectcodec::WebStorageContext& context,std::uint32_t expectedEpoch) const {
    requireLoaded();if(expectedEpoch!=epoch_)throw std::invalid_argument("STALE_REVISION: session epoch changed");
    return projectcodec::encodeWebStorage(project_.snapshot(),ports_,context,activeBaseline_?&*activeBaseline_:nullptr,project_.document().dirtyTerritorialIds);
}
DocumentSessionState DocumentSession::projectState() const {
    requireLoaded();DocumentSessionState state;
    state.epoch=epoch_;state.stateRevision=stateRevision_;state.revision=project_.revision();state.checkpoint=project_.historyCheckpoint();
    state.undoCommandId=project_.historyCommandId(false);state.redoCommandId=project_.historyCommandId(true);
    state.dirty=project_.dirty();state.canUndo=project_.canUndo();state.canRedo=project_.canRedo();state.timelineCursor=project_.timelineCursor();
    state.presentationRevision=project_.presentationRevision();state.presentationCheckpoint=project_.presentationCheckpoint();
    state.documentDirty=project_.documentDirty();state.presentationDirty=project_.presentationDirty();state.timelineEditsEnabled=project_.timelineEditsEnabled();state.dirtyTerritorialIds=project_.document().dirtyTerritorialIds;state.storageBaselineId=storageBaselineId_;return state;
}
DocumentSessionOutcome DocumentSession::rejected(CommandError code,const std::string& detail) const {
    DocumentSessionOutcome outcome;outcome.result.error=code;outcome.result.detail=detail;return outcome;
}
DocumentSessionOutcome DocumentSession::prepareCommand(std::string commandId,CommandArguments args,
        std::vector<ObjectRef> targets,std::uint32_t expectedEpoch) {
    requireLoaded();if(expectedEpoch!=epoch_)return rejected(CommandError::StaleRevision,"session epoch changed");
    if(commandId=="project.default-view"&&(draftActive_||preview_))return rejected(CommandError::InvalidArguments,"Confirm or cancel the active edit before setting the default view.");
    // At most one preview is retained. A replacement prepare also releases an
    // abandoned RPC preview whose acknowledgement was cancelled by the client.
    clearPreview();
    auto request=CommandProcessor::makeRequest(project_,std::move(commandId),std::move(args));
    request.targets=std::move(targets);
    auto prepared=CommandProcessor::prepare(project_,request);
    return retainPreview(std::move(prepared));
}
DocumentSessionOutcome DocumentSession::prepareBatch(std::size_t count,const CommandBatchBuilder& build,std::uint32_t expectedEpoch,const std::string& operation) {
    requireLoaded();if(expectedEpoch!=epoch_)return rejected(CommandError::StaleRevision,"session epoch changed");
    clearPreview();return retainPreview(CommandProcessor::prepareBatch(project_.snapshot(),count,build,operation));
}
DocumentSessionOutcome DocumentSession::retainPreview(PrepareResult&& prepared) {
    DocumentSessionOutcome outcome;outcome.result=static_cast<CommandResult&>(prepared);
    outcome.domainErrorCode=prepared.operationErrorCode;
    if(prepared.preview) {
        const auto& provenance=prepared.preview->change().after().geometryProvenance;
        if(provenance.opaqueUncertain&&std::any_of(provenance.inlineAllocations.begin(),provenance.inlineAllocations.end(),
            [](const auto& row){return !row.second.promoted;}))
            return rejected(CommandError::UnsupportedDependency,"opaque geometry dependencies cannot be exported by current Web storage");
        if(candidateSequence_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_CANDIDATE_OVERFLOW");
        preview_=std::move(prepared.preview);candidateId_=++candidateSequence_;candidateEpoch_=epoch_;outcome.candidateId=candidateId_;
    }
    return outcome;
}
DocumentSessionOutcome DocumentSession::confirmCandidate(std::uint32_t candidateId,std::uint32_t expectedEpoch) {
    requireLoaded();if(expectedEpoch!=epoch_&&expectedEpoch!=candidateEpoch_)return rejected(CommandError::StaleRevision,"session epoch changed");
    if(!preview_||candidateId!=candidateId_)return rejected(CommandError::PreviewConsumed,"candidate is absent or replaced");
    const bool advancesStateRevision=preview_->change().advancesWebStateRevision();
    const bool clearsSelection=preview_->change().clearsSelection();
    if(epoch_==std::numeric_limits<std::uint32_t>::max()||(advancesStateRevision&&stateRevision_==std::numeric_limits<std::uint32_t>::max()))
        return rejected(CommandError::RevisionOverflow,"session counter overflow");
    DocumentSessionOutcome outcome;
    // Serialization is part of preparation. A codec failure must not commit a
    // model change that the Worker client cannot reconcile.
    const auto prospective=CommandProcessor::commitProjection(project_,*preview_);
    const auto impact=calculateChangeImpact(project_.document(),prospective.document(),preview_->change().request().targets,project_.timelineCursor());
    auto delta=projectcodec::encodeWebDelta(project_.document(),prospective.document(),impact);
    outcome.result=CommandProcessor::confirm(project_,*preview_,prospective);clearPreview();
    if(outcome.result.changed()) {
        sourceEpoch_=++epoch_;if(advancesStateRevision)++stateRevision_;
        if(clearsSelection||(selection_.primary()&&!selectionRefExists(*selection_.primary())))selection_.clear();
        selection_.prune([&](const SelectionRef& ref){return selectionRefExists(ref);});
        outcome.delta=std::move(delta);
    }
    return outcome;
}
bool DocumentSession::cancelCandidate(std::uint32_t candidateId) {
    if(!preview_||candidateId!=candidateId_)return false;clearPreview();return true;
}
DocumentSessionOutcome DocumentSession::executeCommand(std::string commandId,CommandArguments args,
        std::vector<ObjectRef> targets,std::uint32_t epoch) {
    if(commandId=="project.default-view"&&(draftActive_||preview_))return rejected(CommandError::InvalidArguments,"Confirm or cancel the active edit before setting the default view.");
    auto prepared=prepareCommand(std::move(commandId),std::move(args),std::move(targets),epoch);
    return prepared.candidateId?confirmCandidate(prepared.candidateId,epoch):prepared;
}
DocumentSessionOutcome DocumentSession::history(bool forward,std::uint32_t expectedEpoch) {
    requireLoaded();if(expectedEpoch!=epoch_)return rejected(CommandError::StaleRevision,"session epoch changed");
    if(epoch_==std::numeric_limits<std::uint32_t>::max())return rejected(CommandError::RevisionOverflow,"session counter overflow");
    const auto before=project_.snapshot(),prospective=project_.historySnapshot(forward);
    const bool available=forward?project_.canRedo():project_.canUndo();
    ChangeImpact impact;std::string delta;
    if(available) {
        impact=calculateChangeImpact(before.document(),prospective.document(),{},project_.timelineCursor());
        delta=projectcodec::encodeWebDelta(before.document(),prospective.document(),impact);
    }
    clearPreview();const bool changed=available&&project_.travelHistory(forward,prospective);
    DocumentSessionOutcome outcome;outcome.result.status=changed?CommandStatus::Applied:CommandStatus::NoOp;
    if(changed) {
        sourceEpoch_=++epoch_;selection_.documentHistoryApplied([&](const SelectionRef& ref){return selectionRefExists(ref);});
        outcome.result.impact=std::move(impact);outcome.delta=std::move(delta);
    }
    return outcome;
}
DocumentSessionOutcome DocumentSession::undo(std::uint32_t epoch){return history(false,epoch);}
DocumentSessionOutcome DocumentSession::redo(std::uint32_t epoch){return history(true,epoch);}
DocumentSessionOutcome DocumentSession::labelGestureApply(const std::string& action,const std::string& id,std::optional<Point> coordinate,std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);
    if(action!="begin"&&action!="move"&&action!="finish")throw TimelineError("CORE_LABEL_GESTURE","Unknown label gesture action.");
    const ObjectRef ref{"label",id};
    const auto invalid=[&](const std::string& detail){auto outcome=rejected(CommandError::StaleRevision,detail);outcome.domainErrorCode="STALE_LABEL_GESTURE";return outcome;};
    if(action!="begin"&&(!labelGesture_||labelGesture_->ref!=ref||labelGesture_->instanceId!=project_.instanceId()||labelGesture_->checkpoint!=project_.historyCheckpoint()))
        return invalid("The label gesture is absent or its document history changed.");
    if(!project_.index().objects.count(ref))throw TimelineError("not-found","The label was not found.");
    if(action=="move"&&!coordinate)throw TimelineError("CORE_LABEL_GESTURE","A move coordinate is required.");
    if(coordinate&&(!std::isfinite(coordinate->x)||!std::isfinite(coordinate->y)))throw TimelineError("CORE_LABEL_GESTURE","A finite coordinate is required.");
    auto row=projectcodec::webContentValue(project_.snapshot(),ref);
    if(coordinate){auto point=codecjson::Value::arr();point.array={codecjson::Value::num(coordinate->x),codecjson::Value::num(coordinate->y)};row.object["coordinates"]=std::move(point);}
    auto edit=projectcodec::readWebContentEdit(project_.snapshot(),ref,row,false);
    if(action=="finish") {
        const auto& label=std::get<PlaceLabel>(edit.value);
        const auto found=project_.document().presentation.webPresentation.labelSettings.find(ref);
        auto settings=found==project_.document().presentation.webPresentation.labelSettings.end()?automaticLabelSettings(label.kind,LabelSettings{}):found->second;
        settings.annotations="{}";settings.webFields.reset();settings.webMinZoomNull=false;settings.minZoom=settings.minZoom.value_or(0);
        const auto shape=edit.geometry?&edit.geometry->second:project_.document().geometries.get(label.geometry).get();
        settings.manualPosition=shape->points.at(0);settings.pinned=true;edit.initialLabelSettings=settings;
    }
    CommandArguments arguments;arguments.action=std::move(edit);const auto commandId="label.gesture."+action;
    if(action=="begin") {
        auto outcome=executeCommand(commandId,std::move(arguments),{ref},expectedEpoch);
        if(outcome.result.changed())labelGesture_=LabelGesture{ref,project_.instanceId(),project_.historyCheckpoint()};
        return outcome;
    }
    auto request=CommandProcessor::makeRequest(project_,commandId,std::move(arguments));request.targets={ref};
    auto prepared=CommandProcessor::prepare(project_.snapshot(),request);
    DocumentSessionOutcome outcome;outcome.result=static_cast<CommandResult&>(prepared);outcome.domainErrorCode=prepared.operationErrorCode;
    if(!prepared.preview){if(action=="finish"&&outcome.result.ok())labelGesture_.reset();return outcome;}
    if(epoch_==std::numeric_limits<std::uint32_t>::max())return rejected(CommandError::RevisionOverflow,"session counter overflow");
    const auto prospective=CommandProcessor::commitProjection(project_,*prepared.preview);
    auto impact=calculateChangeImpact(project_.document(),prospective.document(),{ref},project_.timelineCursor());
    auto delta=projectcodec::encodeWebDelta(project_.document(),prospective.document(),impact);
    const auto receipt=*labelGesture_;project_.amendLabelGesture(prepared.preview->change(),receipt.checkpoint);
    clearPreview();if(action=="move")labelGesture_=receipt;
    sourceEpoch_=++epoch_;outcome.result.status=CommandStatus::Applied;outcome.result.impact=std::move(impact);outcome.delta=std::move(delta);return outcome;
}
DocumentSessionState DocumentSession::markSaved(std::uint32_t expectedEpoch) {
    requireLoaded();if(expectedEpoch!=epoch_)throw std::invalid_argument("STALE_REVISION: session epoch changed");
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    project_.markSaved();labelGesture_.reset();++epoch_;return projectState();
}
DocumentSessionOutcome DocumentSession::applyPresentation(const PresentationAction& action,std::uint32_t expectedEpoch) {
    requireLoaded();if(expectedEpoch!=epoch_)return rejected(CommandError::StaleRevision,"session epoch changed");
    if(const auto visible=std::get_if<WebObjectVisibility>(&action))for(const auto& ref:visible->refs)
        if(!selectionRefExists(ref))throw TimelineError("not-found","Visibility object was not found.");
    auto prepared=PresentationCommandProcessor::prepare(project_.snapshot(),action,[&](const SelectionRef& ref)->std::optional<std::string>{
        const auto entry=externalSelectionRefs_.find(ref);return entry==externalSelectionRefs_.end()?std::nullopt:entry->second;
    });
    if(!prepared.preview) {
        if(prepared.result!=PresentationResult::NoOp)return rejected(CommandError::InvalidArguments,"invalid presentation action");
        DocumentSessionOutcome outcome;outcome.result.status=CommandStatus::NoOp;return outcome;
    }
    if(epoch_==std::numeric_limits<std::uint32_t>::max())return rejected(CommandError::RevisionOverflow,"session counter overflow");
    auto impact=calculateChangeImpact(prepared.preview->before(),prepared.preview->after(),{},project_.timelineCursor());
    auto delta=projectcodec::encodeWebDelta(prepared.preview->before(),prepared.preview->after(),impact);
    const auto committed=PresentationCommandProcessor::confirm(project_,*prepared.preview);
    if(committed!=PresentationResult::Applied)return rejected(committed==PresentationResult::StaleRevision?
        CommandError::StaleRevision:CommandError::CommitFailed,"presentation commit failed");
    ++epoch_;DocumentSessionOutcome outcome;outcome.result.status=CommandStatus::Applied;
    outcome.result.impact=std::move(impact);outcome.delta=std::move(delta);return outcome;
}
DocumentSessionOutcome DocumentSession::presentationCatalogLoad(PresentationCatalog catalog,std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);
    for(const auto& [id,category]:catalog.hydroLayers)
        if(trimWebText(id).empty()||(category!="river"&&category!="lake"))throw TimelineError("CORE_PRESENTATION_CATALOG","Invalid physical layer identity/category.");
    std::set<std::string> labels;
    for(const auto& id:catalog.countryLabelIds)if(trimWebText(id).empty()||!labels.insert(id).second)
        throw TimelineError("CORE_PRESENTATION_CATALOG","Invalid country-label identity.");
    for(const auto& [id,source]:catalog.builtinSubunitSources)
        if(trimWebText(id).empty()||trimWebText(source).empty())
            throw TimelineError("CORE_PRESENTATION_CATALOG","Invalid builtin subunit source identity.");
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    auto candidate=project_.document();candidate.presentation.catalog=std::make_shared<const PresentationCatalog>(std::move(catalog));
    std::map<std::string,std::set<std::string>> valid;
    for(const auto& row:candidate.units)valid["objects"].insert(row.id);
    for(const auto& row:candidate.labels)valid["labels"].insert(row.id);
    for(const auto& row:candidate.hydro)valid["hydro"].insert(row.id);
    for(const auto& row:candidate.genericFeatures)valid["genericFeatures"].insert(row.id);
    for(const auto& row:candidate.distributionLayers)valid["distributions"].insert(row.id);
    for(const auto& [id,kind]:candidate.presentation.catalog->hydroLayers)valid["hydro"].insert(id);
    for(const auto& id:candidate.presentation.catalog->countryLabelIds)valid["objectLabels"].insert(id);
    auto& hidden=candidate.presentation.webPresentation.itemVisibility;
    for(const auto* group:{"objects","objectLabels","labels","hydro","genericFeatures","distributions"}) {
        auto& ids=hidden[group];for(auto it=ids.begin();it!=ids.end();)if(!valid[group].count(it->first))it=ids.erase(it);else ++it;
    }
    auto impact=calculateChangeImpact(project_.document(),candidate,{},project_.timelineCursor());
    auto delta=projectcodec::encodeWebDelta(project_.document(),candidate,impact);
    project_.admitPresentation(std::move(candidate));++epoch_;
    DocumentSessionOutcome outcome;outcome.result.status=CommandStatus::Applied;outcome.result.impact=std::move(impact);outcome.delta=std::move(delta);return outcome;
}
ResolvedWorld DocumentSession::resolveWorld(const std::string& month) const { requireLoaded();return project_.resolveWorld(month); }
bool DocumentSession::setTimelineCursor(const std::string& month,std::uint32_t expectedEpoch,ResolvedWorld* resolvedForResponse) {
    requireLoaded();if(expectedEpoch!=epoch_)throw std::invalid_argument("STALE_REVISION: session epoch changed");
    if(epoch_==std::numeric_limits<std::uint32_t>::max())throw std::overflow_error("CORE_SESSION_EPOCH_OVERFLOW");
    // Resolve exactly once. The same temporal result prunes selection, builds
    // the static view and forms the Worker response at the new session epoch.
    const auto world=project_.resolveWorld(month);auto nextSelection=selection_;
    nextSelection.prune([&](const SelectionRef& ref){return (ref.domain=="territorial"||ref.domain=="hydro")?world.find(ObjectRef{ref.domain,ref.id})!=nullptr:selectionRefExists(ref);});
    // Construct the outbound copy before modifying Project, preserving the
    // existing strong exception boundary if a large allocation fails.
    if(resolvedForResponse)*resolvedForResponse=world;
    const bool cursorChanged=project_.timelineCursor()!=month;
    if(!project_.setTimelineCursor(month,true,&world))return false;
    clearPreview();sourceEpoch_=++epoch_;selection_=std::move(nextSelection);return cursorChanged;
}
void DocumentSession::requireEpoch(std::uint32_t expectedEpoch) const {
    requireLoaded();if(expectedEpoch!=epoch_)throw std::invalid_argument("STALE_REVISION: session epoch changed");
}
DocumentSessionOutcome DocumentSession::selectionCatalogLoad(const std::string& domain,const std::vector<SelectionCatalogEntry>& refs,std::uint32_t expectedEpoch) {
    requireEpoch(expectedEpoch);if(domain!="placeBuiltin"&&domain!="hydroBuiltin")throw std::invalid_argument("CORE_SELECTION_CATALOG: expected an external domain");
    auto catalog=externalSelectionRefs_;
    for(auto i=catalog.begin();i!=catalog.end();)if(i->first.domain==domain)i=catalog.erase(i);else ++i;
    for(const auto& entry:refs) {
        const auto& ref=entry.ref;
        if(ref.domain!=domain||ref.id.empty()||ref.type.empty()||(entry.logicalId&&entry.logicalId->empty())||!catalog.emplace(ref,entry.logicalId).second)
            throw std::invalid_argument("CORE_SELECTION_CATALOG: invalid or duplicate external identity");
        if(domain!="hydroBuiltin"&&!entry.sourceIds.empty())throw std::invalid_argument("CORE_SELECTION_CATALOG: source IDs belong to hydro");
        for(const auto& source:entry.sourceIds)if(source.empty())throw std::invalid_argument("CORE_SELECTION_CATALOG: empty hydro source ID");
        if(!entry.sourceIds.empty()&&!entry.logicalId)throw std::invalid_argument("CORE_SELECTION_CATALOG: hydro aliases need explicit logical ID");
    }
    auto selected=selection_;selected.prune([&](const SelectionRef& ref){return ref.domain!=domain||catalog.count(ref)!=0;});
    auto candidate=project_.document();
    if(domain=="hydroBuiltin"&&std::any_of(refs.begin(),refs.end(),[](const auto& row){return !row.sourceIds.empty();})) {
        auto& hidden=candidate.presentation.webPresentation.itemVisibility["hydro"];
        for(const auto& entry:refs)if(entry.logicalId) {
            bool alias=false;for(const auto& row:hidden) {
                const auto& key=row.first;const auto suffix=key.substr(key.find_last_of(':')==std::string::npos?0:key.find_last_of(':')+1);
                if(key!=*entry.logicalId&&!row.second&&std::find(entry.sourceIds.begin(),entry.sourceIds.end(),suffix)!=entry.sourceIds.end()){alias=true;break;}
            }
            if(alias)hidden[*entry.logicalId]=false;
        }
    }
    DocumentSessionOutcome outcome;outcome.result.status=CommandStatus::NoOp;
    if(candidate.exchangeMetadata!=project_.document().exchangeMetadata) {
        GeometryProvenanceCodecAccess::admitPresentationMetadata(project_.document(),candidate);
        outcome.result.impact=calculateChangeImpact(project_.document(),candidate,{},project_.timelineCursor());
        outcome.delta=projectcodec::encodeWebDelta(project_.document(),candidate,outcome.result.impact);
        project_.admitPresentation(std::move(candidate),false);outcome.result.status=CommandStatus::Applied;
    }
    externalSelectionRefs_=std::move(catalog);selection_=std::move(selected);
    return outcome;
}
bool DocumentSession::selectionRefExists(const SelectionRef& ref) const {
    const ObjectRef object{ref.domain,ref.id};
    return project_.hasActiveObject(object)||externalSelectionRefs_.count(ref)!=0;
}
bool DocumentSession::startDraft(const std::string& shape,const Ring& coordinates,const std::string& phase) {
    requireLoaded();if(!draft_.start(shape,coordinates,phase))return false;draftActive_=true;return true;
}
void DocumentSession::clearDraft(bool deactivate) {
    requireLoaded();draft_.clear();if(deactivate)draftActive_=false;
}
void DocumentSession::requireDraftRevision(std::uint64_t expectedRevision) const {
    requireLoaded();if(expectedRevision!=draft_.revision())throw std::invalid_argument("STALE_DRAFT_REVISION: draft changed");
}
}
