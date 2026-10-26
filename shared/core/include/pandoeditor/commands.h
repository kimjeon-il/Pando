#pragma once
#include <pandoeditor/document.h>
#include <pandoeditor/territorialmutation.h>
#include <pandoeditor/webterritorialcommands.h>
#include <pandoeditor/webobjectcommands.h>
#include <pandoeditor/historicalinstantiation.h>
#include <pandoeditor/gisexchange.h>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace pandoeditor {
class Project;
class ProjectSnapshot;
namespace detail { struct DocumentState; }

enum class TerritorialField { Name, Notes, ValidFrom, ValidTo };
struct TerritorialFieldEdit { ObjectRef target; TerritorialField field; std::string value; };
struct TerritorialColorEdit { std::vector<ObjectRef> targets; std::optional<std::uint32_t> color; };
struct TerritorialLockEdit { std::vector<ObjectRef> targets; bool locked=false; };
struct ApplyTerritorialMutation { TerritorialMutationPlan plan; std::optional<GeometryPatch> geometry; };

struct CountryProperties {
    std::string name, memo;
    std::uint32_t color=0;
    double opacity=1;
    bool operator==(const CountryProperties& other) const;
};
struct CountryEdit { std::string id; CountryProperties properties; };
struct PropertyEdits { std::vector<CountryEdit> countries; std::vector<TerritorialFieldEdit> fields; };
struct SetCountryColor { std::string id; std::uint32_t color; };
// A null value deletes the target. Geometry is an immutable new version and is
// inserted only into the candidate; the live document changes at confirm.
using ContentValue=std::variant<std::monostate,PlaceLabel,HydroFeature,DistributionLayer,
    DistributionEntry,GenericFeature,CountryDetails,TerritorialSymbolStyle>;
struct ContentEdit {
    ObjectRef target;
    ContentValue value;
    std::optional<std::pair<GeometryRef,Geometry>> geometry;
    bool create=false;
    // Creation-time place presentation belongs to the same content command,
    // so Undo and Redo restore the copied label's pinned position together.
    std::optional<LabelSettings> initialLabelSettings;
    // The current Web codec produces this allocation evidence. Command prepare
    // independently verifies owner, reference and the actual geometry digest;
    // no claimed hash or caller flag authorizes archive omission.
    std::optional<InlineGeometryAllocation> inlineAllocation;
    std::optional<GeometryRef> geometryBinding;
    std::optional<std::string> geometryRendering;
};
enum class ContentImportKind { Generic,Distribution };
struct ContentBatchEdit { ContentImportKind kind=ContentImportKind::Generic;std::vector<ContentEdit> edits; };
struct DocumentSourceInfoAppend {std::string next="null",mergedAt;};
enum class WebObjectEditKind {Lock,Color};
struct WebObjectEdit {WebObjectEditKind kind=WebObjectEditKind::Lock;std::vector<ObjectRef> refs;bool locked=false;std::uint32_t color=0;};
struct SetPhysicalData { PhysicalDataSettings settings; };
// One existing territorial geometry or parent edit at the active month. The
// computed geometry is supplied by the existing engine, never recalculated here.
struct TimelineGeometryEdit { std::string id, month; Geometry geometry; };
struct TimelineParentEdit { std::string id, month, parentId, coverageMode; };
struct TimelineCreate { CreateTerritorialIntent intent; std::string month; };
struct TimelineDelete { std::vector<ObjectRef> targets; std::string month; };
struct TimelineTerritorialMutation { ApplyTerritorialMutation mutation; std::string month; };
using CommandAction = std::variant<std::monostate, SetCountryColor, TerritorialFieldEdit, TerritorialColorEdit, TerritorialLockEdit, ApplyTerritorialMutation, ContentEdit, SetPhysicalData,
    HistoricalInstantiationPlan, GisGenericImportPlan, GisTerritorialImportPlan,
    GisDistributionImportPlan, TimelineGeometryEdit, TimelineParentEdit, TimelineCreate, TimelineDelete,
    TimelineTerritorialMutation,ContentBatchEdit,WebTerritorialEdit,WebObjectRemoval,DocumentSourceInfoAppend,WebObjectEdit>;
struct CommandArguments { PropertyEdits properties; CommandAction action; };
struct CommandRequest {
    std::string commandId, projectInstanceId, documentId;
    std::uint64_t revision=0;
    std::vector<ObjectRef> targets;
    CommandArguments args;
};
bool advancesWebStateRevision(const CommandRequest&) noexcept;
bool isWebGeometryBatchCommand(const std::string&) noexcept;
using CommandBatchBuilder=std::function<CommandRequest(const ProjectSnapshot&,std::size_t)>;
enum class CommandStatus { Prepared, Applied, NoOp, Rejected };
enum class CommandError {
    None, ProjectMismatch, DocumentMismatch, StaleRevision, InvalidCommand,
    InvalidTargets, InvalidArguments, Locked, UnsupportedDependency,
    ValidationFailed, PrepareFailed, CommitFailed, PreviewConsumed, RevisionOverflow
};
const char* commandErrorCode(CommandError error) noexcept;
// Calculated against validated immutable states during prepare. Candidate consumers
// may narrow their work; exact hit testing and document validation stay authoritative.
struct SceneDirtySet {
    bool geometry=false,presentation=false,interaction=false,datasetResource=false;
    std::vector<ObjectRef> affectedObjects,geometryObjects;
    bool fullRebuild=true;
};
struct ChangeImpact {
    std::vector<ObjectRef> changedObjects;
    std::vector<GeometryRef> changedGeometries;
    std::vector<ObjectRef> presentationInvalidations;
    std::size_t retainedGeometryCount=0;
    std::size_t estimatedNewGeometryBytes=0;
    bool requiresFullSpatialRebuild=false;
    bool requiresFullSceneRebuild=true;
    SceneDirtySet sceneDirty;
};
// Compare actual immutable states, including reverse history transitions.
ChangeImpact calculateChangeImpact(const ProjectDocument& before,const ProjectDocument& after,
                                   const std::vector<ObjectRef>& targets={},const std::string& month={});
struct CommandResult {
    CommandStatus status=CommandStatus::Rejected;
    CommandError error=CommandError::None;
    std::string detail;
    ChangeImpact impact;
    std::string operationErrorCode;
    bool ok() const noexcept { return status!=CommandStatus::Rejected; }
    bool changed() const noexcept { return status==CommandStatus::Applied; }
};
class ChangeSet {
public:
    const ProjectDocument& before() const;
    const ProjectDocument& after() const;
    const CommandRequest& request() const noexcept { return request_; }
    const ChangeImpact& impact() const noexcept { return impact_; }
    bool advancesWebStateRevision() const noexcept { return batchWebStateRevision_||pandoeditor::advancesWebStateRevision(request_); }
    bool clearsSelection() const noexcept { return batchClearsSelection_||std::holds_alternative<WebObjectRemoval>(request_.args.action); }
private:
    friend class Project;
    friend class CommandProcessor;
    ChangeSet(std::shared_ptr<const detail::DocumentState> before,
              std::shared_ptr<const detail::DocumentState> after, CommandRequest request);
    std::shared_ptr<const detail::DocumentState> before_, after_;
    CommandRequest request_;
    ChangeImpact impact_;
    std::uint64_t checkpointBefore_=0, checkpointAfter_=0;
    bool historyCheckpoint_=false; // command-owned source compatibility, never a request flag
    bool batchBoundaryLabelSettings_=false;
    bool batchWebStateRevision_=false;
    bool batchClearsSelection_=false;
};
class CommandPreview {
public:
    CommandPreview(CommandPreview&&) noexcept=default;
    CommandPreview& operator=(CommandPreview&&) noexcept=default;
    CommandPreview(const CommandPreview&)=delete;
    CommandPreview& operator=(const CommandPreview&)=delete;
    bool pending() const noexcept { return static_cast<bool>(change_); }
    const ChangeSet& change() const;
private:
    friend class CommandProcessor;
    explicit CommandPreview(std::unique_ptr<const ChangeSet> change) : change_(std::move(change)) {}
    std::unique_ptr<const ChangeSet> change_;
};
struct PrepareResult : CommandResult { std::optional<CommandPreview> preview; };
struct TerritorialPlanResult : CommandResult { std::optional<TerritorialMutationPlan> plan; };
struct ExtensionRewriteResult { bool ok=true; std::string detail; std::vector<std::string> handledExtensionIds; };
using ExtensionRewriter=std::function<ExtensionRewriteResult(const ProjectDocument&,const TerritorialMutationPlan&,std::vector<PreservedExtension>&)>;
// Compare complete canonical data, retaining opaque extension bytes exactly.
// Shared immutable geometry allocations are a fast path, never an equality rule.
bool semanticallyEqual(const ProjectDocument& a, const ProjectDocument& b);
class CommandProcessor {
public:
    static ProjectSnapshot timelineViewSnapshot(const ProjectSnapshot&);
    static CommandRequest makeRequest(const Project&, std::string commandId, CommandArguments);
    static PrepareResult prepare(const Project&, const CommandRequest&);
    static PrepareResult prepare(const ProjectSnapshot&, const CommandRequest&);
    static PrepareResult prepareBatch(const ProjectSnapshot&,std::size_t count,const CommandBatchBuilder&,const std::string& operation="document.batch");
    static PrepareResult prepare(const Project&, const CommandRequest&, const ExtensionRewriter&);
    static PrepareResult prepare(const ProjectSnapshot&, const CommandRequest&, const ExtensionRewriter&);
    static TerritorialPlanResult planTerritorial(const ProjectSnapshot&,const TerritorialMutationIntent&);
    static TerritorialPlanResult planTerritorial(const Project&,const TerritorialMutationIntent&);
    static CommandResult confirm(Project&, CommandPreview&);
    static ProjectSnapshot commitProjection(const Project&,const CommandPreview&);
    static CommandResult confirm(Project&,CommandPreview&,const ProjectSnapshot&);
    static void cancel(CommandPreview& preview) noexcept { preview.change_.reset(); }
private:
    static PrepareResult prepareRequest(const ProjectSnapshot&,const CommandRequest&,const ExtensionRewriter&,const std::string& workflow);
};
} // namespace pandoeditor
