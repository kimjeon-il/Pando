#include "editorcontroller.h"
#include <pandoeditor/webobjectcommands.h>
#include <QRegularExpression>
#include <exception>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonValue>

namespace {
bool validColor(const QString& value)
{
    static const QRegularExpression pattern("^#[0-9a-fA-F]{6}$");
    return pattern.match(value).hasMatch();
}
}
pandoeditor::projectcodec::PlatformPorts EditorController::coreCodecPorts() const
{
    return {::projectcodec::validateFlagDataUrl,true,pandoeditor::codecjson::ParsedTextPolicy::QtUtf8};
}
pandoeditor::codecjson::Value EditorController::coreInputValue(const QVariant& input)
{
    const auto value=QJsonValue::fromVariant(input);
    QJsonArray envelope;envelope.append(value);
    auto parsed=pandoeditor::codecjson::parse(QJsonDocument(envelope).toJson(QJsonDocument::Compact).toStdString(),
        pandoeditor::codecjson::ParsedTextPolicy::QtUtf8);
    return std::move(parsed.array.at(0));
}
pandoeditor::PrepareResult EditorController::prepareCoreRequest(const pandoeditor::CommandRequest& request) const
{
    if(const auto field=std::get_if<pandoeditor::TerritorialFieldEdit>(&request.args.action)) {
        using V=pandoeditor::codecjson::Value;
        const auto name=field->field==pandoeditor::TerritorialField::Name?"name":
            field->field==pandoeditor::TerritorialField::Notes?"notes":
            field->field==pandoeditor::TerritorialField::ValidFrom?"validFrom":"validTo";
        auto payload=V::obj();payload.object["id"]=V::str(field->target.id);payload.object["field"]=V::str(name);
        payload.object["valuePresent"]=V::boolean(true);payload.object["value"]=V::str(field->value);
        return coreSession_.prepareNativeCommand(
            pandoeditor::readWebMetadataCommand(project_.snapshot(),payload,coreCodecPorts()),coreEpoch());
    }
    return coreSession_.prepareNativeCommand(request,coreEpoch());
}
pandoeditor::CommandRequest EditorController::coreTerritorialRequest(const pandoeditor::TerritorialMutationIntent& intent,
    const pandoeditor::GeometryPatch* patch) const
{
    using namespace pandoeditor;using V=codecjson::Value;
    const auto snapshot=project_.snapshot();
    auto payload=V::obj();std::string operation;
    if(const auto parent=std::get_if<ChangeParentIntent>(&intent)) {
        operation="territorial.parent";payload.object["id"]=V::str(parent->target.id);payload.object["parentId"]=V::str(parent->parent.id);
        return readWebTerritorialCommand(snapshot,operation,payload,coreCodecPorts());
    }
    if(const auto removal=std::get_if<DeleteTerritorialIntent>(&intent)) {
        auto refs=V::arr();for(const auto& ref:removal->targets) {
            auto row=V::obj();row.object["domain"]=V::str(ref.domain);row.object["id"]=V::str(ref.id);
            refs.array.push_back(std::move(row));
        }
        payload.object["refs"]=std::move(refs);return readWebObjectRemoval(snapshot,payload);
    }
    const auto createRow=[&](const CreateTerritorialIntent& create,const Geometry& geometry) {
        auto row=V::obj(),properties=V::obj();row.object["type"]=V::str("Feature");row.object["id"]=V::str(create.id);
        row.object["geometry"]=pandoeditor::projectcodec::webGeometryValue(geometry);properties.object["schemaVersion"]=V::num(6);
        properties.object["entityKind"]=V::str(create.kind==UnitKind::General?"general":"regional");
        properties.object["name"]=V::str(create.name);properties.object["notes"]=V::str(create.notes);
        const auto parent=create.parent?create.parent->id:std::string{};properties.object["parentId"]=V::str(parent);
        properties.object["coverageMode"]=V::str(create.coverageMode.empty()?(parent.empty()?"explicit":"partition"):create.coverageMode);
        properties.object["locked"]=V::boolean(false);properties.object["metadata"]=V::obj();properties.object["style"]=V::obj();
        if(create.explicitColor)properties.object["style"].object["color"]=V::str(QString("#%1").arg(*create.explicitColor,6,16,QChar('0')).toStdString());
        properties.object["validFrom"]=create.validity.from?V::str(*create.validity.from):V{};
        properties.object["validTo"]=create.validity.to?V::str(*create.validity.to):V{};row.object["properties"]=std::move(properties);
        auto input=V::obj();input.object["feature"]=std::move(row);
        return std::get<WebTerritorialEdit>(readWebTerritorialCommand(snapshot,"territorial.create",input,coreCodecPorts()).args.action).features.at(0);
    };
    if(const auto create=std::get_if<CreateTerritorialIntent>(&intent)) {
        WebTerritorialEdit edit;edit.operation=WebTerritorialOperation::Create;edit.features.push_back(createRow(*create,create->geometry));
        CommandArguments args;args.action=std::move(edit);return CommandProcessor::makeRequest(project_,"territorial.create",std::move(args));
    }
    if(!patch)throw TimelineError("invalid","A platform geometry receipt is required.");
    if(patch->sourceRevision!=project_.revision())throw TimelineError("STALE_REVISION","Geometry receipt source changed.");
    const auto& view=project_.viewDocument();
    const auto existing=[&](const ObjectRef& ref) {
        const auto found=project_.index().objects.find(ref);if(ref.domain!="territorial"||found==project_.index().objects.end()||project_.inactiveEntityIds().count(ref.id))throw TimelineError("not-found","Geometry owner is inactive.");
        WebTerritorialFeature row;row.identity=project_.document().units.at(found->second);
        const auto& relation=staticParentRelation(view,ref.id);row.parentId=relation.parentId;row.coverageMode=relation.coverageMode;row.validity=staticLifetime(view,ref.id).validity;
        row.geometry=*view.geometries.get(staticGeometryBinding(view,ref.id).geometryRef);
        const auto& document=project_.document();row.style=document.presentation.objectStyles.at(ref);
        if(document.countryDetails.count(ref))row.countryDetails=document.countryDetails.at(ref);
        if(document.symbols.count(ref))row.symbol=document.symbols.at(ref);return row;
    };
    WebTerritorialEdit edit;edit.operation=WebTerritorialOperation::Patch;
    for(const auto& replacement:patch->replacements) {auto row=existing(replacement.owner);row.geometry=replacement.geometry;edit.features.push_back(std::move(row));}
    for(const auto& creation:patch->creations) {
        const auto split=std::get_if<SplitTerritorialIntent>(&intent);if(!split||creation.owner.id!=split->createdId)throw TimelineError("invalid","Unknown platform creation intent.");
        auto source=existing(split->source);CreateTerritorialIntent create;create.id=split->createdId;create.name=split->createdName;create.kind=source.identity.kind;
        if(!source.parentId.empty())create.parent=territorialRef(source.parentId);create.coverageMode=source.coverageMode;
        edit.features.push_back(createRow(create,creation.geometry));
    }
    for(const auto& ref:patch->removedGeometryOwners) {if(ref.domain!="territorial")throw TimelineError("invalid","Unknown geometry removal domain.");edit.removedIds.push_back(ref.id);}
    const auto relation=[&](const ObjectRef& target,const std::string& parent) {
        auto found=std::find_if(edit.features.begin(),edit.features.end(),[&](const auto& row){return row.identity.id==target.id;});
        if(found==edit.features.end()){edit.features.push_back(existing(target));found=std::prev(edit.features.end());}
        found->parentId=parent;if(parent.empty())found->coverageMode="explicit";
    };
    if(const auto transfer=std::get_if<TransferSubunitIntent>(&intent))relation(transfer->target,transfer->destinationCountry.id);
    if(const auto conversion=std::get_if<ConvertTerritorialTypeIntent>(&intent))relation(conversion->source,conversion->parent?conversion->parent->id:std::string{});
    CommandArguments args;args.action=std::move(edit);return CommandProcessor::makeRequest(project_,"territorial.patch",std::move(args));
}
pandoeditor::PrepareResult EditorController::prepareCoreTerritorialReceipt(pandoeditor::PrepareResult&& prepared) const
{
    if(!prepared.ok()||!prepared.preview)return std::move(prepared);
    const auto& action=prepared.preview->change().request().args.action;
    const auto* mutation=std::get_if<pandoeditor::ApplyTerritorialMutation>(&action);
    if(const auto timeline=std::get_if<pandoeditor::TimelineTerritorialMutation>(&action))mutation=&timeline->mutation;
    if(!mutation)return std::move(prepared);
    try {return prepareCoreRequest(coreTerritorialRequest(mutation->plan.intent,mutation->geometry?&*mutation->geometry:nullptr));}
    catch(const std::exception& error) {pandoeditor::PrepareResult rejected;rejected.error=pandoeditor::CommandError::PrepareFailed;rejected.detail=error.what();return rejected;}
}
pandoeditor::CommandRequest EditorController::coreContentRequest(const pandoeditor::ContentEdit& edit,const pandoeditor::Geometry* geometry) const
{
    using namespace pandoeditor;using V=codecjson::Value;
    const auto snapshot=project_.snapshot();auto payload=V::obj();payload.object["id"]=V::str(edit.target.id);
    if(edit.target.domain=="territorial") {
        payload.object["valuePresent"]=V::boolean(true);
        if(const auto details=std::get_if<CountryDetails>(&edit.value)) {payload.object["field"]=V::str("capital");payload.object["value"]=V::str(details->capital);}
        else if(const auto symbol=std::get_if<TerritorialSymbolStyle>(&edit.value)) {
            payload.object["field"]=V::str("flagDataUrl");payload.object["valuePresent"]=V::boolean(symbol->policy!=FlagPolicy::Default);
            payload.object["value"]=symbol->policy==FlagPolicy::Embedded?V::str(symbol->embeddedDataUrl):V{};
        } else throw TimelineError("invalid","Unsupported territorial metadata value.");
        auto request=readWebMetadataCommand(snapshot,payload,coreCodecPorts());
        if(const auto original=std::get_if<TerritorialSymbolStyle>(&edit.value))if(auto content=std::get_if<ContentEdit>(&request.args.action))if(auto normalized=std::get_if<TerritorialSymbolStyle>(&content->value)) {
            normalized->defaultCountryId=original->defaultCountryId;normalized->defaultFlagDataUrl=original->defaultFlagDataUrl;
        }
        return request;
    }
    const bool remove=std::holds_alternative<std::monostate>(edit.value);
    const auto row=remove?V{}:pandoeditor::projectcodec::webContentValue(snapshot,edit.target,&edit.value,geometry?geometry:edit.geometry?&edit.geometry->second:nullptr);
    if(edit.target.domain=="label"||edit.target.domain=="hydro") {
        auto normalized=pandoeditor::projectcodec::readNativeContentEdit(snapshot,edit.target,row,edit.create);
        if(edit.initialLabelSettings)normalized.initialLabelSettings=edit.initialLabelSettings;
        CommandArguments args;args.action=std::move(normalized);
        return CommandProcessor::makeRequest(project_,edit.target.domain+".edit",std::move(args));
    }
    std::string operation;
    if(edit.target.domain=="generic")operation=edit.create?"generic.create":remove?"generic.remove":"";
    else if(edit.target.domain=="distributionLayer")operation=edit.create?"distribution.layer.create":remove?"distribution.layer.remove":"";
    else if(edit.target.domain=="distributionEntry")operation=edit.create?"distribution.entry.create":remove?"distribution.entry.remove":"";
    else throw TimelineError("invalid","Unsupported content domain.");
    if(!operation.empty()) {
        if(edit.create)payload.object[edit.target.domain=="generic"?"feature":"options"]=row;
        return readWebContentCommand(snapshot,operation,payload,ContentIdentityPolicy::NativeExact);
    }
    auto normalized=pandoeditor::projectcodec::readNativeContentEdit(snapshot,edit.target,row,false);
    CommandArguments args;args.action=std::move(normalized);return CommandProcessor::makeRequest(project_,"content.edit",std::move(args));
}
pandoeditor::CommandResult EditorController::confirmCorePreview(pandoeditor::CommandPreview& preview,std::uint32_t expectedEpoch)
{
    pandoeditor::PrepareResult prepared;prepared.status=pandoeditor::CommandStatus::Prepared;
    prepared.preview.emplace(std::move(preview));
    auto retained=coreSession_.adoptPreparedCommand(std::move(prepared),expectedEpoch);
    if(!retained.result.ok()||!retained.candidateId)return retained.result;
    return coreSession_.confirmCandidate(retained.candidateId,expectedEpoch).result;
}
pandoeditor::PresentationResult EditorController::applyCorePresentation(const pandoeditor::PresentationAction& action)
{
    try {
        const auto outcome=coreSession_.applyPresentation(action,coreEpoch());
        if(!outcome.result.ok()){commandError(outcome.result.error,QString::fromStdString(outcome.result.detail));return pandoeditor::PresentationResult::Failed;}
        return outcome.result.changed()?pandoeditor::PresentationResult::Applied:pandoeditor::PresentationResult::NoOp;
    } catch(const std::exception& error) {
        emit errorOccurred("PRESENTATION_FAILED: "+QString::fromUtf8(error.what()));return pandoeditor::PresentationResult::Failed;
    }
}
void EditorController::commandError(pandoeditor::CommandError error,const QString& detail)
{
    using pandoeditor::CommandError;
    QString message;
    switch(error) {
    case CommandError::InvalidArguments:
        message=QStringLiteral("이름·색상·불투명도 등 입력값을 확인하세요."); break;
    case CommandError::InvalidTargets:
        message=QStringLiteral("편집 대상을 찾을 수 없습니다. 선택한 국가와 레이어를 확인하세요."); break;
    case CommandError::Locked:
        message=QStringLiteral("국가 또는 소속 레이어가 잠겨 있어 변경할 수 없습니다."); break;
    case CommandError::UnsupportedDependency:
        message=QStringLiteral("미해석 데이터 보호를 위해 이 편집을 제한합니다."); break;
    case CommandError::ValidationFailed:
        message=QStringLiteral("변경 후 문서가 유효하지 않습니다. 참조 중이거나 마지막인 레이어는 삭제할 수 없습니다."); break;
    case CommandError::ProjectMismatch: case CommandError::DocumentMismatch: case CommandError::StaleRevision:
        message=QStringLiteral("미리보기 이후 문서가 변경되었습니다. 다시 준비해 주세요."); break;
    case CommandError::PreviewConsumed:
        message=QStringLiteral("확정할 미리보기가 없거나 이미 폐기되었습니다."); break;
    default:
        message=QStringLiteral("명령을 처리하지 못했습니다."); break;
    }
    emit errorOccurred(QString::fromLatin1(pandoeditor::commandErrorCode(error))+": "+message+
                       QStringLiteral(" 초안은 유지됩니다.")+(detail.isEmpty()?QString():"\n"+detail));
}
bool EditorController::collectPendingEdits(pandoeditor::CommandArguments& args)
{
    // Selection parks drafts by identity. An explicit apply/save collects them;
    // selecting/searching/focusing never calls this function.
    auto country=[&](const QString& id,const CountryDraft& draft) {
        using namespace pandoeditor;
        const auto ref=territorialRef(id.toStdString());auto pos=project_.index().objects.find(ref);
        if(pos==project_.index().objects.end()){commandError(CommandError::InvalidTargets);return false;}
        const auto& u=project_.viewDocument().units[pos->second];
        auto active=[&](const char* field){return draft.fields.empty()||draft.fields.count(field);};
        if(active("name") && draft.name.toStdString()!=(u.kind==UnitKind::General?objectDisplayName(u):u.name))args.properties.fields.push_back({ref,TerritorialField::Name,draft.name.toStdString()});
        if(active("notes") && draft.memo.toStdString()!=u.notes)args.properties.fields.push_back({ref,TerritorialField::Notes,draft.memo.toStdString()});
        if(active("validFrom") && draft.from.toStdString()!=pandoeditor::staticLifetime(project_.viewDocument(),u.id).validity.from.value_or(""))args.properties.fields.push_back({ref,TerritorialField::ValidFrom,draft.from.toStdString()});
        if(active("validTo") && draft.to.toStdString()!=pandoeditor::staticLifetime(project_.viewDocument(),u.id).validity.to.value_or(""))args.properties.fields.push_back({ref,TerritorialField::ValidTo,draft.to.toStdString()});
        if(!validColor(draft.color)){commandError(CommandError::InvalidArguments);return false;}
        const auto& style=project_.document().presentation.objectStyles.at(ref);
        if((active("color") && draft.color.mid(1).toUInt(nullptr,16)!=effectiveObjectColor(project_.viewDocument(),ref)) || (active("opacity") && draft.opacity&&*draft.opacity!=style.opacity)) {
            const auto c=project_.country(ref.id);if(!c){commandError(CommandError::InvalidArguments);return false;}
            args.properties.countries.push_back({c->id,{c->name,c->memo,draft.color.mid(1).toUInt(nullptr,16),draft.opacity.value_or(c->opacity),c->layerId}});
        }
        return true;
    };
    auto layer=[&](const QString& id,const LayerDraft& draft) {
        const auto l=project_.layer(id.toStdString());
        if(!l) {commandError(pandoeditor::CommandError::InvalidTargets);return false;}
        auto next=*l;next.name=draft.name.trimmed().toStdString();next.opacity=draft.opacity.value_or(l->opacity);
        if(next.name!=l->name||next.opacity!=l->opacity) args.properties.layers.push_back(std::move(next));
        return true;
    };
    for(const auto& [id,draft]:parkedCountryDrafts_) if(!country(id,draft))return false;
    for(const auto& [id,draft]:parkedLayerDrafts_) if(!layer(id,draft))return false;
    if(selectedUnit()&&!country(selectedId(),{nameDraft_,memoDraft_,colorDraft_,opacityPreview_,validFromDraft_,validToDraft_}))return false;
    if(project_.layer(selectedLayer_.toStdString())&&!layer(selectedLayer_,{layerNameDraft_,layerOpacityPreview_}))return false;
    return true;
}
pandoeditor::CommandStatus EditorController::prepareCommand(const std::string& commandId,pandoeditor::CommandArguments args)
{
    using namespace pandoeditor;
    cancelPreview();
    try {
        if(!collectPendingEdits(args)) return CommandStatus::Rejected;
        if(commandId=="edit.properties"&&project_.timelineEditsEnabled()&&
            args.properties.countries.empty()&&args.properties.layers.empty()&&args.properties.fields.empty())
            return CommandStatus::NoOp;
        auto request=CommandProcessor::makeRequest(project_,commandId,std::move(args));
        auto result=prepareCoreRequest(request);
        if(!result.ok()) {commandError(result.error,QString::fromStdString(result.detail));return result.status;}
        if(result.preview) {pendingPreviewEpoch_=coreEpoch();pendingPreview_=std::move(result.preview);emit previewChanged();}
        return result.status;
    }catch(const std::exception&) {commandError(CommandError::PrepareFailed);return CommandStatus::Rejected;}
}
bool EditorController::preparePendingEdits(){return prepareCommand("edit.properties",{})!=pandoeditor::CommandStatus::Rejected;}
bool EditorController::confirmCommand()
{
    if(!pendingPreview_) {commandError(pandoeditor::CommandError::PreviewConsumed);return false;}
    auto result=confirmCorePreview(*pendingPreview_,pendingPreviewEpoch_);
    pendingPreview_.reset();
    if(result.ok())clearParkedDrafts();
    emit previewChanged();
    if(!result.ok()) {commandError(result.error,QString::fromStdString(result.detail));return false;}
    noteAppliedImpact(result.impact);
    return true;
}
bool EditorController::confirmPreview(){if(!confirmCommand())return false;publish(false);return true;}
void EditorController::cancelPreview()
{
    cancelBackgroundWork();
    if(pendingPreview_){pandoeditor::CommandProcessor::cancel(*pendingPreview_);pendingPreview_.reset();emit previewChanged();}
}
void EditorController::discardPendingEdits()
{
    cancelContentEdit();cancelGeometryEdit();
    cancelPreview();clearParkedDrafts();reloadDrafts();emit draftsChanged();emit visualChanged();emit dirtyChanged();
}
bool EditorController::executeCommand(const std::string& commandId,pandoeditor::CommandAction action)
{
    if(startupBusy_||worldStatus_=="recovery-failed")return false;
    pandoeditor::CommandArguments args;args.action=std::move(action);
    const auto status=prepareCommand(commandId,std::move(args));
    if(status==pandoeditor::CommandStatus::NoOp){clearParkedDrafts();return true;}
    return status==pandoeditor::CommandStatus::Prepared&&confirmCommand();
}
bool EditorController::commitPendingEdits(){
    if(geometryEdit_)return false;
    if(contentSession_){
        // The integrated panel keeps a read/edit session open. Only creation,
        // deletion previews and geometry need explicit confirmation.
        if(contentSession_->edit.create||contentSession_->preview)return false;
        const auto pending=contentSession_->pendingFields;
        for(const auto& field:pending){
            if(contentSession_->pendingFields.count(field)&&
               !commitContentField(QString::fromStdString(field)))return false;
        }
    }
    if(!executeCommand("edit.properties",std::monostate{}))return false;
    publish(false);return true;
}
void EditorController::setColor(const QString& color)
{
    if(!validColor(color)){commandError(pandoeditor::CommandError::InvalidArguments);return;}
    if(executeCommand("country.color",pandoeditor::SetCountryColor{selectedId().toStdString(),color.mid(1).toUInt(nullptr,16)}))publish(false);
}
