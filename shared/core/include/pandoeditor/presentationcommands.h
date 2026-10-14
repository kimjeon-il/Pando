#pragma once
#include <pandoeditor/project.h>
#include <pandoeditor/selection.h>
#include <variant>

namespace pandoeditor {
struct SetPresentationVisibility { std::string key; bool visible; };
struct SetScopedVisibility { std::string group; std::vector<ObjectRef> targets; bool visible; };
struct SetBatchVisibility { std::vector<ObjectRef> targets; std::optional<bool> visible; };
struct PatchGroupPresentation { std::string group; PresentationStyle patch; };
struct SetLabelSettings { ObjectRef ref; LabelSettings settings; };
struct SetDistributionSettings { DistributionSettings settings; };
struct PatchObjectPresentation { ObjectRef ref; PresentationStyle patch; };
struct SetPresentationOrder { std::vector<std::string> objectOrder,overlayOrder;bool overlayOrderPresent=true; };
struct WebControlVisibility { std::string key;bool visible; };
struct WebControlGroupPresentation { std::string group;PresentationStyle patch; };
struct SetTerrainPresentation { std::string mode; };
enum class DistributionPresentationField {RenderMode,ActiveLayer,BoundaryVisible};
struct WebControlDistributionPresentation {DistributionPresentationField field;std::string value;bool visible=true;};
struct WebObjectVisibility {std::vector<SelectionRef> refs;std::optional<bool> visible;};
struct WebDistributionLayerVisibility {std::string id;bool visible=true;};
using PresentationAction=std::variant<SetPresentationVisibility,SetScopedVisibility,SetBatchVisibility,PatchGroupPresentation,
    SetLabelSettings,SetDistributionSettings,PatchObjectPresentation,SetPresentationOrder,WebControlVisibility,
    WebControlGroupPresentation,SetTerrainPresentation,WebControlDistributionPresentation,WebObjectVisibility,WebDistributionLayerVisibility>;
enum class PresentationResult { Applied, NoOp, InvalidArguments, Failed,StaleRevision };
class PresentationPreview {
public:
    const ProjectDocument& before() const { return before_->document(); }
    const ProjectDocument& after() const { return after_->document(); }
    bool pending() const noexcept { return before_.has_value()&&after_.has_value(); }
private:
    friend class PresentationCommandProcessor;
    PresentationPreview(ProjectSnapshot before,ProjectSnapshot after):before_(std::move(before)),after_(std::move(after)){}
    std::optional<ProjectSnapshot> before_,after_;
};
struct PresentationPreparation {
    PresentationResult result=PresentationResult::Failed;
    std::optional<PresentationPreview> preview;
};
class PresentationCommandProcessor {
public:
    static PresentationPreparation prepare(const ProjectSnapshot&,const PresentationAction&,
        const std::function<std::optional<std::string>(const SelectionRef&)>& builtinLogicalId={}) noexcept;
    static PresentationResult confirm(Project&,PresentationPreview&) noexcept;
    static PresentationResult apply(Project&,const PresentationAction&) noexcept;
};
}
