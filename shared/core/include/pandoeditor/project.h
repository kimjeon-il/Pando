#pragma once
#include <pandoeditor/commands.h>
#include <pandoeditor/objectproperties.h>
#include <pandoeditor/timeline-resolver.h>
#include <string>
#include <memory>
#include <vector>
#include <utility>
#include <set>

namespace pandoeditor {

class Project;
class ProjectReplacementState {
    friend class Project;
    struct Data;
    std::shared_ptr<const Data> data_;
};
class ProjectSnapshot {
public:
    const std::string& instanceId() const { return instanceId_; }
    std::uint64_t revision() const { return revision_; }
    const std::string& timelineMonth() const noexcept { return timelineMonth_; }
    bool timelineEditsEnabled() const noexcept { return timelineEditsEnabled_; }
    const std::set<ObjectRef>& inactiveObjectRefs() const noexcept;
    const ProjectDocument& document() const noexcept;
    const DocumentIndex& index() const noexcept;
    const CountryView* country(const std::string&) const;
    bool matches(const Project&) const noexcept;
private:
    friend class Project;
    friend class CommandProcessor;
    friend class PresentationCommandProcessor;
    ProjectSnapshot(std::shared_ptr<const detail::DocumentState> state, std::string instanceId, std::uint64_t revision,
                    std::string timelineMonth={},bool timelineEditsEnabled=false)
        : state_(std::move(state)), instanceId_(std::move(instanceId)), revision_(revision), timelineMonth_(std::move(timelineMonth)),timelineEditsEnabled_(timelineEditsEnabled) {}
    std::shared_ptr<const detail::DocumentState> state_;
    std::string instanceId_;
    std::uint64_t revision_;
    std::string timelineMonth_;
    bool timelineEditsEnabled_=false;
    std::shared_ptr<const detail::DocumentState> historySource_;
    std::optional<bool> historyForward_;
    std::size_t historyCursor_=0;
    std::shared_ptr<const detail::DocumentState> commitSource_;
};

class Project {
public:
    const std::string& timelineCursor() const noexcept { return timelineCursor_; }
    // Session month only: no content revision, dirty bit or history entry.
    bool setTimelineCursor(const std::string& month,bool activateEdits=true,const ResolvedWorld* resolved=nullptr);
    bool timelineEditsEnabled() const noexcept { return timelineEditsEnabled_; }
    ResolvedWorld resolveWorld(const std::string& month) const;
    std::uint64_t presentationRevision() const noexcept { return presentationRevision_; }
    std::uint64_t presentationCheckpoint() const noexcept { return presentationCheckpoint_; }
    Project();
    ProjectSnapshot snapshot() const { return {state_,instanceId_,revision_,timelineCursor_,timelineEditsEnabled_}; }
    ProjectSnapshot snapshotForView() const;
    const std::string& instanceId() const { return instanceId_; }
    std::uint64_t revision() const { return revision_; }
    std::uint64_t historyCheckpoint() const noexcept { return checkpoint_; }
    Project(const Project&) = delete;
    Project& operator=(const Project&) = delete;
    Project(Project&&) noexcept = default;
    Project& operator=(Project&&) noexcept = default;
    static std::string normalizeName(const std::string& name);
    static void validate(const ProjectDocument& document);
    void replace(ProjectDocument document);
    const ProjectDocument& document() const noexcept;
    const ProjectDocument& viewDocument() const noexcept;
    const std::set<ObjectRef>& inactiveObjectRefs() const noexcept;
    const std::vector<CountryView>& countries() const noexcept;
    const DocumentIndex& index() const noexcept;
    const DocumentIndex& viewIndex() const noexcept;
    bool hasActiveObject(const ObjectRef&) const noexcept;
    const CountryView* country(const std::string& id) const;
    const ObjectPropertyView* propertyView(const ObjectRef&) const;
    bool undo();
    bool redo();
    ProjectSnapshot historySnapshot(bool forward) const;
    bool travelHistory(bool forward,const ProjectSnapshot& prepared);
    std::string historyCommandId(bool forward) const;
    bool canUndo() const noexcept { return cursor_ > 0; }
    bool canRedo() const noexcept { return cursor_ < commands_->size(); }
    ProjectReplacementState captureReplacement() const;
    void restoreReplacement(const ProjectReplacementState&);
    // Read the validated stored action by value; no request/ledger alias escapes.
    std::optional<TerritorialMutationKind> nextUndoTerritorialMutationKind() const noexcept;
    std::optional<TerritorialMutationKind> nextRedoTerritorialMutationKind() const noexcept;
    bool dirty() const;
    bool documentDirty() const noexcept { return checkpoint_!=savedCheckpoint_; }
    bool presentationDirty() const noexcept { return presentationCheckpoint_!=savedPresentationCheckpoint_; }
    void markSaved() noexcept;
private:
    friend class CommandProcessor;
    friend class PresentationCommandProcessor;
    friend class DocumentSession;
    void admitTerritorialSource(ProjectDocument,const std::function<ProjectDocument(const ProjectDocument&)>&,const std::string& month,bool activateEdits);
    void admitPresentation(ProjectDocument,bool advanceRevision=true);
    void admitTerritorialDirtyIds(const std::function<std::vector<std::string>(const ProjectDocument&)>&);
    void apply(const ChangeSet& change);
    ProjectSnapshot commitSnapshot(const ChangeSet&) const;
    void apply(const ChangeSet&,const ProjectSnapshot&);
    void amendLabelGesture(const ChangeSet&,std::uint64_t checkpoint);
    std::shared_ptr<const detail::DocumentState> presentationView(const ProjectDocument&) const;
    // Capture snapshots and mutate Project only on the owner/editor thread.
    // Workers may prepare against ProjectSnapshot, never against live Project.
    std::shared_ptr<const detail::DocumentState> state_, saved_, viewState_;
    std::shared_ptr<const std::vector<ChangeSet>> commands_=std::make_shared<const std::vector<ChangeSet>>();
    std::string instanceId_;
    std::uint64_t revision_ = 0;
    std::uint64_t presentationRevision_ = 0;
    std::uint64_t checkpoint_=0, savedCheckpoint_=0, checkpointSequence_=0;
    std::uint64_t presentationCheckpoint_=0,savedPresentationCheckpoint_=0;
    std::size_t cursor_ = 0;
    std::string timelineCursor_;
    bool timelineEditsEnabled_=false;
};
} // namespace pandoeditor
