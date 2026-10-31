#pragma once
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/selection.h>
#include <pandoeditor/geometrydraft.h>
#include <pandoeditor/presentationcommands.h>
#include <pandoeditor/webstorage.h>
#include <array>
#include <map>
#include <memory>

namespace pandoeditor {
struct SelectionCatalogEntry {SelectionRef ref;std::optional<std::string> logicalId;std::vector<std::string> sourceIds;};
struct DocumentSessionState {
    std::uint32_t epoch=0,stateRevision=0;
    std::uint64_t revision=0,checkpoint=0;
    bool dirty=false,canUndo=false,canRedo=false;
    std::string timelineCursor,undoCommandId,redoCommandId;
    std::uint64_t presentationRevision=0,presentationCheckpoint=0;
    bool documentDirty=false,presentationDirty=false;
    bool timelineEditsEnabled=false;
    std::vector<std::string> dirtyTerritorialIds;
    std::uint32_t storageBaselineId=0;
};
struct DocumentSessionOutcome {
    CommandResult result;
    std::uint32_t candidateId=0;
    std::string delta;
    std::string domainErrorCode;
};
struct ImportInspection {std::string project;ResolvedWorld world;};
// An immutable Core-owned source is not an accepted storage baseline or a
// mutable CommandPreview. IDs are session-local and never reused after release.
struct TemporalSourceReceipt {
    std::uint32_t sourceId=0;
    std::string sourceMonth,fingerprint;
    bool reused=false;
};
struct TemporalSourceStats {
    std::size_t entries=0;
    std::uint64_t declaredDecodedBytes=0,hits=0,evictions=0;
};
// Read-only world candidate is separate from the editable CommandPreview and
// from the active storageBaselineId. It cannot be committed in P5-3.
struct TemporalCandidateReceipt {
    std::uint32_t candidateId=0,sourceId=0,expectedEpoch=0;
    std::string targetMonth,sourceFingerprint,worldSha256;
    std::size_t resolvedEntityCount=0;
    bool reused=false;
};
struct TemporalCandidateInspection {
    // Generated only for explicit verification; never held as a second
    // mutable document or returned by the public RPC in this phase.
    std::string projectedJson;
    ResolvedWorld world;
};
// The budget measures declared decoded bytes; it is not native heap usage.
constexpr std::size_t TEMPORAL_SOURCE_MAX_ENTRIES=2;
constexpr std::uint64_t TEMPORAL_SOURCE_MAX_DECODED_BYTES=64ull*1024*1024;
// The WASM document owner uses the canonical Project and CommandProcessor.
// Snapshots returned by Project remain immutable; this boundary never owns a
// second JSON document, a JS-computed candidate, or another undo ledger.
class DocumentSession {
public:
    explicit DocumentSession(projectcodec::PlatformPorts);
    DocumentSessionState adoptPreparedProject(Project&&);
    DocumentSessionOutcome adoptPreparedCommand(PrepareResult&&,std::uint32_t expectedEpoch);
    const CommandPreview* candidatePreview(std::uint32_t candidateId) const;
    DocumentSessionState documentLoad(const std::string& currentWebJson,const std::string& currentMonth);
    DocumentSessionState documentLoadBaseline(std::uint32_t baselineId,const codecjson::Value& setup,const std::string& documentId);
    DocumentSessionState documentInitialize(const std::string& currentWebJson,const std::string& currentMonth,bool preserveCursor,
        const std::optional<codecjson::Value>& features,const std::optional<std::string>& territorialSource,std::uint32_t expectedEpoch,
        std::optional<std::uint32_t> baselineId={});
    ResolvedWorld baselineWorld(std::uint32_t baselineId,const std::string& month) const;
    std::string documentSnapshot() const;
    DocumentSessionState storageBaselineLoad(const codecjson::Value&,std::uint32_t expectedEpoch);
    DocumentSessionState storageBaselineLoad(const projectcodec::WebStorageAssetSource&,std::uint32_t expectedEpoch);
    // P5-2: private immutable source registry. No Core RPC/WASM exposure yet.
    TemporalSourceReceipt temporalSourcePrepare(const projectcodec::WebStorageAssetSource&,
        const std::string& dataRevision,const std::string& manifestSha256,std::uint32_t expectedEpoch);
    std::optional<projectcodec::WebStorageBaseline> temporalSourceLookup(std::uint32_t sourceId,
        std::uint32_t expectedEpoch) const;
    bool temporalSourceRelease(std::uint32_t sourceId,std::uint32_t expectedEpoch);
    TemporalSourceStats temporalSourceStats() const noexcept;
    TemporalCandidateReceipt temporalCandidatePrepare(std::uint32_t sourceId,
        const std::string& targetMonth,const std::string& sourceFingerprint,
        std::uint32_t expectedEpoch);
    std::optional<TemporalCandidateInspection> temporalCandidateInspect(std::uint32_t candidateId,
        std::uint32_t expectedEpoch) const;
    DocumentSessionState admitExternalBaseline(std::uint32_t expectedEpoch);
    std::string validateImport(const std::string&,std::optional<std::uint32_t> baselineId={}) const;
    ImportInspection inspectImport(const std::string&,std::optional<std::uint32_t> baselineId,const std::string& currentMonth) const;
    std::uint32_t captureReplacement(std::uint32_t expectedEpoch);
    DocumentSessionState rollbackReplacement(std::uint32_t checkpointId,std::uint32_t expectedEpoch);
    bool releaseReplacement(std::uint32_t checkpointId);
    std::string storageSnapshot() const;
    std::string exportSnapshot(const projectcodec::WebStorageContext&,std::uint32_t expectedEpoch) const;
    DocumentSessionState projectState() const;
    const Project& project() const { return project_; }
    DocumentSessionOutcome prepareCommand(std::string commandId,CommandArguments,
        std::vector<ObjectRef> targets,std::uint32_t expectedEpoch);
    DocumentSessionOutcome prepareBatch(std::size_t count,const CommandBatchBuilder&,std::uint32_t expectedEpoch,const std::string& operation="document.batch");
    DocumentSessionOutcome confirmCandidate(std::uint32_t candidateId,std::uint32_t expectedEpoch);
    bool cancelCandidate(std::uint32_t candidateId);
    DocumentSessionOutcome executeCommand(std::string commandId,CommandArguments,
        std::vector<ObjectRef> targets,std::uint32_t expectedEpoch);
    DocumentSessionOutcome undo(std::uint32_t expectedEpoch);
    DocumentSessionOutcome redo(std::uint32_t expectedEpoch);
    DocumentSessionOutcome labelGestureApply(const std::string& action,const std::string& id,std::optional<Point>,std::uint32_t expectedEpoch);
    DocumentSessionState markSaved(std::uint32_t expectedEpoch);
    DocumentSessionOutcome applyPresentation(const PresentationAction&,std::uint32_t expectedEpoch);
    DocumentSessionOutcome presentationCatalogLoad(PresentationCatalog,std::uint32_t expectedEpoch);
    ResolvedWorld resolveWorld(const std::string& month) const;
    bool setTimelineCursor(const std::string& month,std::uint32_t expectedEpoch,ResolvedWorld* resolvedForResponse=nullptr);
    SelectionState& selection() { return selection_; }
    const SelectionState& selection() const { return selection_; }
    DocumentSessionOutcome selectionCatalogLoad(const std::string& domain,const std::vector<SelectionCatalogEntry>&,std::uint32_t expectedEpoch);
    void requireEpoch(std::uint32_t expectedEpoch) const;
    bool selectionRefExists(const SelectionRef&) const;
    GeometryDraft& draft() { requireLoaded();return draft_; }
    const GeometryDraft& draft() const { requireLoaded();return draft_; }
    bool draftActive() const { requireLoaded();return draftActive_; }
    bool startDraft(const std::string& shape,const Ring&,const std::string& phase);
    void clearDraft(bool deactivate=false);
    void requireDraftRevision(std::uint64_t expectedRevision) const;
private:
    struct Replacement {
        ProjectReplacementState project;
        SelectionState selection;
        GeometryDraft draft;
        bool draftActive;
        std::map<SelectionRef,std::optional<std::string>> externalSelectionRefs;
        std::optional<projectcodec::WebStorageBaseline> storageBaseline;
        std::optional<projectcodec::WebStorageBaseline> activeBaseline;
        std::uint32_t storageBaselineId;
        std::uint32_t stateRevision;
    };
    DocumentSessionOutcome rejected(CommandError,const std::string&) const;
    void requireLoaded() const;
    void clearPreview();
    void clearTemporalSources() noexcept;
    void clearTemporalCandidate() noexcept;
    DocumentSessionOutcome retainPreview(PrepareResult&&);
    DocumentSessionOutcome history(bool forward,std::uint32_t expectedEpoch);
    Project project_;
    SelectionState selection_;
    GeometryDraft draft_;
    bool draftActive_=false;
    std::map<SelectionRef,std::optional<std::string>> externalSelectionRefs_;
    std::optional<projectcodec::WebStorageBaseline> storageBaseline_;
    std::optional<projectcodec::WebStorageBaseline> activeBaseline_;
    std::uint32_t storageBaselineSequence_=0,storageBaselineId_=0;
    struct TemporalSourceEntry {
        std::array<std::string,8> identity;
        projectcodec::WebStorageBaseline baseline;
        std::uint64_t declaredDecodedBytes=0,access=0;
    };
    std::map<std::uint32_t,TemporalSourceEntry> temporalSources_;
    std::uint32_t temporalSourceSequence_=0;
    std::uint64_t temporalSourceBytes_=0,temporalSourceAccess_=0;
    std::uint64_t temporalSourceHits_=0,temporalSourceEvictions_=0;
    struct TemporalCandidateEntry {
        TemporalCandidateReceipt receipt;
        Project project;
        ResolvedWorld world;
    };
    std::unique_ptr<TemporalCandidateEntry> temporalCandidate_;
    std::uint32_t temporalCandidateSequence_=0;
    projectcodec::PlatformPorts ports_;
    std::optional<CommandPreview> preview_;
    std::uint32_t epoch_=0,stateRevision_=0,candidateSequence_=0,candidateId_=0,candidateEpoch_=0,sourceEpoch_=0;
    bool loaded_=false;
    std::optional<Replacement> replacement_;
    std::uint32_t replacementSequence_=0,replacementId_=0;
    struct LabelGesture {ObjectRef ref;std::string instanceId;std::uint64_t checkpoint;};
    std::optional<LabelGesture> labelGesture_;
};
}
