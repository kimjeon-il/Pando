#include "editorcontroller.h"
#include "retainedreferencerewriter.h"
#include "territorialgeometry.h"
#include <pandoeditor/timeline-view.h>
#include <QUuid>
#include <set>
using namespace pandoeditor;
namespace { QString text(const std::string& v){return QString::fromStdString(v);} }
QVariantMap EditorController::structureState() const {
    QVariantMap out{{"open",structureDialogOpen()},{"geometryRequired",false},{"detail",QString()}};
    if(createDraft_) {
        out["createSetup"]=true;out["kind"]=static_cast<int>(createDraft_->intent.kind);out["generatedId"]=text(createDraft_->intent.id);out["name"]=text(createDraft_->intent.name);out["geometryRequired"]=true;
        out["detail"]=QStringLiteral("생성 설정을 보관했습니다. 지도 도구가 준비한 도형이 전달되기 전에는 프로젝트를 변경할 수 없습니다.");return out;
    }
    if(conversionDraft_) {
        out["kind"]=static_cast<int>(TerritorialMutationKind::ConvertCountryToSubunit);
        out["conversionSetup"]=true;
        out["generatedId"]=text(conversionDraft_->intent.generatedId);
        out["detail"]=QStringLiteral("상위 일반객체를 선택하세요. 객체 ID와 메타데이터는 유지됩니다.");
        return out;
    }
    if(!structureSession_)return out;const auto& plan=structureSession_->plan;
    if(plan.kind==TerritorialMutationKind::ConvertCountryToSubunit&&plan.selectedAfter)out["generatedId"]=text(plan.selectedAfter->id);
    out["kind"]=static_cast<int>(plan.kind);out["requiresConfirmation"]=plan.requiresConfirmation;
    out["geometryRequired"]=plan.geometry.kind==GeometryRequirementKind::WorkerPatch&&!structureSession_->preview;
    out["detail"]=plan.geometry.kind==GeometryRequirementKind::WorkerPatch?QStringLiteral("M4 도형 계산 결과를 기다리고 있습니다."):plan.geometry.kind==GeometryRequirementKind::Prepared?QStringLiteral("준비된 도형을 확인하고 생성을 확정하세요."):QStringLiteral("변경 내용을 확인하세요.");
    out["calculating"]=structureSession_->job.has_value();
    if(structureSession_->job)out["detail"]=QStringLiteral("영토 도형을 계산 중입니다. 취소해도 현재 지도는 바뀌지 않습니다.");
    if(!structureSession_->error.isEmpty())out["detail"]=structureSession_->error;
    if(structureSession_->preview) {
        out["detail"]=QStringLiteral("계산 결과입니다. 확인을 눌러야 지도에 적용됩니다.");
        out["previewPaths"]=structureSession_->projection.objects;
        out["previewWidth"]=structureSession_->projection.width;
        out["previewHeight"]=structureSession_->projection.height;
    }
    QVariantList impacts;for(const auto& item:plan.impacts)impacts.append(QVariantMap{{"kind",text(item.kind)},{"id",text(item.target.id)},{"messageKey",text(item.messageKey)}});out["impacts"]=impacts;return out;
}
QVariantList EditorController::relationCountryOptions() const {QVariantList result;for(const auto& u:project_.viewDocument().units)if(!project_.inactiveEntityIds().count(u.id)&&isRootGeneral(project_.viewDocument(),u))result.append(QVariantMap{{"id",text(u.id)},{"name",text(objectDisplayName(u))},{"locked",u.locked}});return result;}
QVariantList EditorController::relationParentOptions() const {QVariantList result;const auto current=selectedUnit();for(const auto& u:project_.viewDocument().units)if(!project_.inactiveEntityIds().count(u.id)&&u.kind==UnitKind::General)if(createDraft_||!current||u.id!=current->id)result.append(QVariantMap{{"id",text(u.id)},{"name",text(objectDisplayName(u))},{"type","general"},{"locked",u.locked}});return result;}
QVariantList EditorController::relationChildOptions() const {
    QVariantList result;const auto parent=selectedUnit();if(!parent||parent->kind!=UnitKind::General)return result;
    std::set<std::string> excluded{parent->id};
    auto ancestor=staticParentRelation(project_.viewDocument(),parent->id).parentId;
    while(!ancestor.empty()&&excluded.insert(ancestor).second)
        ancestor=staticParentRelation(project_.viewDocument(),ancestor).parentId;
    for(const auto& unit:project_.document().units)
        if(!project_.inactiveEntityIds().count(unit.id)&&unit.kind==UnitKind::General&&!unit.locked&&!excluded.count(unit.id)
            &&staticParentRelation(project_.viewDocument(),unit.id).parentId!=parent->id)
            result.append(QVariantMap{{"id",text(unit.id)},{"name",text(objectDisplayName(unit))}});
    return result;
}
bool EditorController::setStructurePlan(const TerritorialMutationIntent& intent) {
    if(project_.timelineEditsEnabled())
        if(const auto parent=std::get_if<ChangeParentIntent>(&intent))
            if(project_.inactiveEntityIds().count(parent->target.id)||
               project_.inactiveEntityIds().count(parent->parent.id))return false;
    TerritorialPlanResult result;
    if(std::holds_alternative<ChangeParentIntent>(intent)||std::holds_alternative<DeleteTerritorialIntent>(intent)||std::holds_alternative<CreateTerritorialIntent>(intent)) {
        try {
            const auto checked=prepareCoreRequest(coreTerritorialRequest(intent));
            if(!checked.ok()){commandError(checked.error,text(checked.detail));return false;}
        } catch(const std::exception& error){emit errorOccurred(QString::fromUtf8(error.what()));return false;}
        TerritorialMutationPlan plan;plan.intent=intent;plan.baseRevision=project_.revision();plan.documentId=project_.document().documentId;plan.projectInstanceId=project_.instanceId();
        if(const auto parent=std::get_if<ChangeParentIntent>(&intent)) {plan.kind=TerritorialMutationKind::ChangeParent;plan.targets={parent->target};plan.affectedObjects={parent->target,parent->parent};plan.selectedAfter=parent->target;plan.impacts.push_back({"change-parent",parent->target,"territorial.parent.changed"});}
        else if(const auto removal=std::get_if<DeleteTerritorialIntent>(&intent)) {
            plan.kind=TerritorialMutationKind::DeleteUnits;plan.targets=removal->targets;plan.affectedObjects=plan.targets;plan.requiresConfirmation=true;
            for(const auto& ref:plan.targets) {
                if(ref.domain=="territorial") {
                    const auto& unit=project_.viewDocument().units.at(project_.index().objects.at(ref));
                    if(isRootGeneral(project_.viewDocument(),unit))plan.kind=TerritorialMutationKind::DeleteCountry;
                }
                plan.impacts.push_back({"delete",ref,"territorial.delete"});
            }
        }
        else {const auto& create=std::get<CreateTerritorialIntent>(intent);plan.kind=create.kind==UnitKind::Regional?TerritorialMutationKind::CreateRegion:create.parent?TerritorialMutationKind::CreateSubunit:TerritorialMutationKind::CreateCountry;plan.targets={territorialRef(create.id)};plan.affectedObjects=plan.targets;plan.selectedAfter=territorialRef(create.id);plan.geometry.kind=GeometryRequirementKind::Prepared;plan.geometry.operation="create";plan.impacts.push_back({"create",plan.targets.front(),"territorial.create"});}
        result.status=CommandStatus::Prepared;result.plan=std::move(plan);
    } else result=CommandProcessor::planTerritorial(project_.snapshotForView(),intent);
    if(!result.ok()||!result.plan){commandError(result.error,text(result.detail));return false;}
    cancelStructureMutation();
    structureSession_=StructureSession{project_.snapshot(),std::move(*result.plan)};structureSession_->epoch=coreEpoch();
    if(structureSession_->plan.geometry.kind==GeometryRequirementKind::WorkerPatch) {
        const auto plan=structureSession_->plan;
        structureSession_->job=jobs_->submit(structureSession_->base,"territorial:geometry",
            [plan](const ProjectSnapshot& snapshot,const JobToken& token){return prepareTerritorialGeometry(
                CommandProcessor::timelineViewSnapshot(snapshot),plan,token);},
            [this](std::uint64_t id,JobDisposition disposition,PrepareResult result){
                if(!structureSession_||!structureSession_->job||structureSession_->job->id()!=id)return;
                structureSession_->job.reset();
                if(disposition!=JobDisposition::Accepted||!structureSession_->base.matches(project_)) {
                    structureSession_->error=QStringLiteral("현재 문서가 변경되어 계산 결과를 폐기했습니다. 취소 후 다시 시도하세요.");
                } else if(!result.ok()||!result.preview) {
                    structureSession_->error=text(result.detail.empty()?"GEOMETRY_PREPARATION_FAILED":result.detail);
                } else {
                    try {
                        result=prepareCoreTerritorialReceipt(std::move(result));
                        if(!result.ok()||!result.preview)throw std::invalid_argument(result.detail.empty()?"TERRITORIAL_MUTATION_FAILED":result.detail);
                        if(!isStaticTimeline(result.preview->change().after())) {
                            auto view=timelineDocumentView(result.preview->change().after(),project_.timelineCursor());
                            structureSession_->projection.rebuild(view.document,view.inactiveIds,ProjectionContent::SvgPreview);
                        } else structureSession_->projection.rebuild(result.preview->change().after(),{},ProjectionContent::SvgPreview);
                        structureSession_->preview=std::move(result.preview);
                    }catch(const std::exception& error){structureSession_->error=QString::fromUtf8(error.what());}
                }
                emit structureChanged();
            });
    }
    emit structureChanged();return true;
}
bool EditorController::transferSelectedSubunit(const QString& countryId) {
    const auto u=selectedUnit();
    return u&&u->kind==UnitKind::General&&setStructurePlan(TransferSubunitIntent{territorialRef(u->id),territorialRef(countryId.toStdString())});
}
bool EditorController::changeSelectedParent(const QString& parentId){const auto u=selectedUnit();return u&&u->kind==UnitKind::General&&setStructurePlan(ChangeParentIntent{territorialRef(u->id),territorialRef(parentId.toStdString())});}
bool EditorController::commitSelectedParent(const QString& parentId){
    const auto u=selectedUnit();
    if(!u||staticParentRelation(project_.viewDocument(),u->id).parentId==parentId.toStdString())return false;
    if(!changeSelectedParent(parentId))return false;
    if(confirmStructureMutation())return true;
    cancelStructureMutation();return false;
}
bool EditorController::commitSelectedChild(const QString& childId){
    const auto parent=selectedUnit();if(!parent||!selectedEditable()||childId.isEmpty())return false;
    bool eligible=false;for(const auto& raw:relationChildOptions())if(raw.toMap().value("id")==childId){eligible=true;break;}
    if(!eligible)return false;
    if(!setStructurePlan(ChangeParentIntent{territorialRef(childId.toStdString()),territorialRef(parent->id)}))return false;
    if(confirmStructureMutation())return true;
    cancelStructureMutation();return false;
}
bool EditorController::beginDeleteSelection(){return !selection_.items().empty()&&setStructurePlan(DeleteTerritorialIntent{selectedObjectRefs()});}
bool EditorController::beginMergeSelection(){
    const auto primary=primaryObjectRef();const auto unit=selectedUnit();
    if(!primary||!unit||!selectedEditable()||geometryEdit_||structureDialogOpen()||hasPendingEdits())return false;
    geometryEdit_=GeometryEditSession{coreSession_,project_.snapshot(),*primary,*project_.viewDocument().geometries.get(pandoeditor::staticGeometryBinding(project_.viewDocument(),unit->id).geometryRef),QStringLiteral("merge"),{}};geometryEdit_->epoch=coreEpoch();
    geometryEdit_->mergeIntent=MergeTerritorialIntent{*primary,{}};
    geometryEdit_->choosingProviders=true;emit geometryEditChanged();emit visualChanged();return true;
}
bool EditorController::beginAnnexGeometry(){
    const auto primary=primaryObjectRef();if(!primary||!selectedUnit()||!selectedEditable()||geometryEdit_||structureDialogOpen()||hasPendingEdits())return false;
    geometryEdit_=GeometryEditSession{coreSession_,project_.snapshotForView(),*primary,{"Polygon",{}, {}, {}},QStringLiteral("annex"),{}};geometryEdit_->annexIntent=AnnexTerritoryIntent{*primary,{}, {}};geometryEdit_->epoch=coreEpoch();
    if(isRootGeneral(project_.viewDocument(),*selectedUnit())) {
        geometryEdit_->territorySelection.emplace(TerritorySelectionKind::Annex);
        geometryEdit_->annexIntent.reset();
        geometryEdit_->generation=++nextGeometrySession_;
        geometryEdit_->stage="setup";
    }
    geometryEdit_->choosingProviders=true;emit geometryEditChanged();emit visualChanged();return true;
}
bool EditorController::beginSplitGeometry(){
    const auto primary=primaryObjectRef();const auto unit=selectedUnit();if(!primary||!unit||unit->kind!=UnitKind::General||!selectedEditable()||geometryEdit_||structureDialogOpen()||hasPendingEdits())return false;
    const auto& parent=staticParentRelation(project_.viewDocument(),unit->id).parentId;
    if(!parent.empty()&&objectLocked(project_.document(),project_.index(),territorialRef(parent)))return false;
    geometryEdit_=GeometryEditSession{coreSession_,project_.snapshotForView(),*primary,*project_.viewDocument().geometries.get(pandoeditor::staticGeometryBinding(project_.viewDocument(),unit->id).geometryRef),QStringLiteral("split"),{}};geometryEdit_->epoch=coreEpoch();
    geometryEdit_->splitIntent=SplitTerritorialIntent{*primary,{},QUuid::createUuid().toString(QUuid::WithoutBraces).toStdString(),"새 객체"};
    geometryEdit_->territorySelection.emplace(TerritorySelectionKind::BoundedCreation);
    const auto binding=staticGeometryBinding(project_.viewDocument(),unit->id).geometryRef;
    geometryEdit_->territorySelection->resetSources({{*primary,*project_.viewDocument().geometries.get(binding),binding,objectDisplayName(*unit)}});
    coreSession_.draft().resetGeometry({"Polygon",{},{},{}});geometryEdit_->generation=++nextGeometrySession_;geometryEdit_->stage="setup";
    scheduleTerritorySelection(false);emit geometryEditChanged();return true;
}
bool EditorController::beginCoastlineGeometry(const QString& authority){
    if(!beginGeometryEdit(QStringLiteral("coast")))return false;auto mode=CoastlineAuthority::Country;if(authority=="subunit")mode=CoastlineAuthority::Subunit;else if(authority=="independent")mode=CoastlineAuthority::Independent;geometryEdit_->coastIntent=CoastlineIntent{geometryEdit_->target,coreSession_.draft().geometry(),mode};emit geometryEditChanged();return true;
}
bool EditorController::confirmStructureMutation() {
    if(!structureSession_||!structureSession_->base.matches(project_)){
        cancelStructureMutation();emit errorOccurred("STALE_STRUCTURE_SESSION");return false;
    }
    const auto plan=structureSession_->plan;
    if(plan.geometry.kind!=GeometryRequirementKind::WorkerPatch) {
        try {
            GeometryPatch patch;patch.sourceRevision=project_.revision();
            auto prepared=prepareCoreRequest(coreTerritorialRequest(plan.intent,&patch));
            if(!prepared.ok()){commandError(prepared.error,text(prepared.detail));return false;}
            if(!prepared.preview){cancelStructureMutation();return true;}
            structureSession_->preview=std::move(prepared.preview);
        } catch(const std::exception& error) {emit errorOccurred(QString::fromUtf8(error.what()));return false;}
    }
    if(!structureSession_->preview||structureSession_->job)return false;
    // Allocate the rendering cache before committing the candidate.
    MapProjection next;
    try {
        if(!isStaticTimeline(structureSession_->preview->change().after())) {
            auto view=timelineDocumentView(structureSession_->preview->change().after(),project_.timelineCursor());
            next.rebuild(view.document,view.inactiveIds);
        } else next.rebuild(structureSession_->preview->change().after());
    }
    catch(const std::exception& error){emit errorOccurred(QString::fromUtf8(error.what()));return false;}
    const auto applied=confirmCorePreview(*structureSession_->preview,structureSession_->epoch);
    if(!applied.ok()){
        structureSession_->preview.reset();structureSession_->error=QStringLiteral("확정하지 못했습니다. 취소 후 다시 준비하세요.");
        commandError(applied.error,text(applied.detail));emit structureChanged();return false;
    }
    noteAppliedImpact(applied.impact);
    structureSession_.reset();projection_=std::move(next);
    coreSession_.selection().setHover({});
    closeObjectChooser();
    if(plan.selectedAfter)coreSession_.selection().setMany(selectionRefsFor({*plan.selectedAfter}));
    else coreSession_.selection().prune([&](const SelectionRef& ref){return coreSession_.selectionRefExists(ref);});
    publish(false);emit geometryChanged();emit structureChanged();return true;
}
void EditorController::cancelStructureMutation(){if(structureSession_||conversionDraft_||createDraft_){if(structureSession_&&structureSession_->job)jobs_->cancel(structureSession_->job->id());structureSession_.reset();conversionDraft_.reset();createDraft_.reset();emit structureChanged();}}
bool EditorController::beginTypeConversion(){const auto u=selectedUnit();if(!u||u->kind!=UnitKind::General)return false;cancelStructureMutation();ConvertTerritorialTypeIntent intent;intent.source=territorialRef(u->id);intent.targetKind=UnitKind::General;intent.generatedId=u->id;if(staticParentRelation(project_.viewDocument(),u->id).parentId.empty()){conversionDraft_=ConversionDraft{project_.snapshot(),std::move(intent)};emit structureChanged();return true;}return setStructurePlan(intent);}
bool EditorController::updateTypeConversionTarget(const QString& parentId){
    if(conversionDraft_) {
        if(!conversionDraft_->base.matches(project_)){cancelStructureMutation();emit errorOccurred("STALE_STRUCTURE_SESSION");return false;}
        if(parentId.isEmpty())return false;
        auto intent=conversionDraft_->intent;intent.parent=territorialRef(parentId.toStdString());
        return setStructurePlan(intent);
    }
    if(!structureSession_)return false;const auto conversion=std::get_if<ConvertTerritorialTypeIntent>(&structureSession_->plan.intent);if(!conversion)return false;auto intent=*conversion;intent.parent=parentId.isEmpty()?std::optional<ObjectRef>{}:territorialRef(parentId.toStdString());return setStructurePlan(intent);
}
bool EditorController::beginTerritorialCreate(const QString& type){if(type!="general"&&type!="regional"){emit errorOccurred("INVALID_ENTITY_KIND");return false;}cancelStructureMutation();CreateTerritorialIntent intent;intent.kind=type=="general"?UnitKind::General:UnitKind::Regional;intent.id=QUuid::createUuid().toString(QUuid::WithoutBraces).toStdString();createDraft_=CreateDraft{project_.snapshot(),std::move(intent)};emit structureChanged();return true;}
bool EditorController::updateTerritorialCreateSetup(const QString& name,const QString& parentId,const QString& sourceId){if(!createDraft_||!createDraft_->base.matches(project_)){cancelStructureMutation();emit errorOccurred("STALE_STRUCTURE_SESSION");return false;}auto& create=createDraft_->intent;create.name=name.toStdString();create.parent=parentId.isEmpty()?std::optional<ObjectRef>{}:territorialRef(parentId.toStdString());if(!sourceId.isEmpty())create.id=sourceId.toStdString();emit structureChanged();return true;}
bool EditorController::beginTerritorialCreatePrepared(const CreateTerritorialIntent& intent){if(structureDialogOpen())cancelStructureMutation();return setStructurePlan(intent);}
