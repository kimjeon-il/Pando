#include "editorcontroller.h"
#include <pandoeditor/maprenderorder.h>
#include <QCollator>
#include <QLocale>
#include <QScopedValueRollback>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

using namespace pandoeditor;
namespace {
QString q(const std::string& value) { return QString::fromStdString(value); }
QString rgb(std::uint32_t color) { return QString("#%1").arg(color,6,16,QChar('0')); }
QString typeName(UnitKind kind) { return kind==UnitKind::General?"general":"regional"; }
QString typeLabel(UnitKind kind) { return kind==UnitKind::General?QStringLiteral("일반객체"):QStringLiteral("독립 권역"); }
}
std::vector<ObjectRef> EditorController::selectedObjectRefs() const {
    std::vector<ObjectRef> result;result.reserve(selection_.items().size());
    for(const auto& ref:selection_.items())result.push_back(asObjectRef(ref));return result;
}
std::optional<ObjectRef> EditorController::primaryObjectRef() const {
    return selection_.primary()?std::optional<ObjectRef>{asObjectRef(*selection_.primary())}:std::nullopt;
}
std::optional<ObjectRef> EditorController::hoverObjectRef() const {
    return selection_.hover()?std::optional<ObjectRef>{asObjectRef(*selection_.hover())}:std::nullopt;
}
std::optional<SelectionRef> EditorController::selectionRefFor(const ObjectRef& ref) const {
    if(ref.id.empty())return {};
    if(ref.domain=="placeBuiltin"){
        const auto record=placeRuntime_.recordById(q(ref.id));
        if(!record||copiedPlaceSourceIds(project_.document()).count(ref.id))return {};
        return SelectionRef{ref.domain,record->kind.toStdString(),ref.id};
    }
    if(ref.domain=="hydroBuiltin"){
        const auto record=hydroRuntime_.recordById(q(ref.id));if(!record)return {};
        return SelectionRef{ref.domain,record->category.toStdString(),ref.id};
    }
    if(!project_.hasActiveObject(ref))return {};
    if(ref.domain=="userLayer")return SelectionRef{ref.domain,"layer",ref.id};
    const auto index=project_.index().objects.at(ref);
    const auto type=ref.domain=="territorial"?"entity":ref.domain=="distributionLayer"?"layer":
        ref.domain=="distributionEntry"?"entry":ref.domain=="generic"?"feature":
        ref.domain=="label"?project_.document().labels.at(index).kind:
        ref.domain=="hydro"?project_.document().hydro.at(index).kind:std::string{};
    return type.empty()?std::nullopt:std::optional<SelectionRef>{{ref.domain,type,ref.id}};
}
std::vector<SelectionRef> EditorController::selectionRefsFor(const std::vector<ObjectRef>& refs) const {
    std::vector<SelectionRef> result;result.reserve(refs.size());
    for(const auto& ref:refs){const auto typed=selectionRefFor(ref);
        if(!typed)throw std::invalid_argument("Selection target does not exist");result.push_back(*typed);}
    return result;
}
std::optional<SelectionRef> EditorController::existingSelectionRef(const QVariantMap& value) const {
    auto ref=selectionRefFor({value.value("domain").toString().trimmed().toStdString(),
        value.value("id").toString().trimmed().toStdString()});
    if(!ref)return {};
    const auto requested=value.value("type").toString().trimmed();
    if(requested.isEmpty())return ref; // Native document ObjectRefs derive type at this boundary.
    if(ref->domain=="territorial"&&requested!="entity")return {};
    if((ref->domain=="placeBuiltin"||ref->domain=="hydroBuiltin")&&requested!=q(ref->type))return {};
    // Stored selection identity captures its type; a later model kind change
    // does not rewrite it. Existence and command/render ObjectRefs use domain/id.
    ref->type=requested.toStdString();
    return ref;
}
std::optional<ObjectRef> EditorController::existingObjectRef(const QVariantMap& value) const {
    const auto ref=existingSelectionRef(value);return ref?std::optional<ObjectRef>{asObjectRef(*ref)}:std::nullopt;
}
QVariantMap EditorController::selectionRefValue(const SelectionRef& ref) const {
    QVariantMap result{{"domain",q(ref.domain)},{"type",q(ref.type)},{"id",q(ref.id)},{"key",q(selectionRefKey(ref))}};
    if(ref.domain=="territorial")if(const auto found=project_.index().objects.find(asObjectRef(ref));found!=project_.index().objects.end())
        result["kind"]=typeName(project_.document().units.at(found->second).kind);
    return result;
}
QVariantMap EditorController::objectRefValue(const ObjectRef& ref) const {
    const auto typed=selectionRefFor(ref);return typed?selectionRefValue(*typed):QVariantMap{{"domain",q(ref.domain)},{"id",q(ref.id)}};
}
QVariantList EditorController::selectionItems() const {
    QVariantList result;for(const auto& ref:selection_.items()) result.append(selectionRefValue(ref));return result;
}
QVariantMap EditorController::primaryObject() const { return selection_.primary()?selectionRefValue(*selection_.primary()):QVariantMap{}; }
QVariantMap EditorController::rangeAnchor(const QString& scope) const {
    const auto ref=selection_.rangeAnchor(scope.toStdString());return ref?selectionRefValue(*ref):QVariantMap{};
}
bool EditorController::objectVisible(const ObjectRef& ref) const {
    if(ref.domain=="placeBuiltin")return placeRuntime_.recordById(q(ref.id)).has_value()&&
        !copiedPlaceSourceIds(project_.document()).count(ref.id)&&groupVisible(project_.document().presentation.webPresentation,"labels");
    if(ref.domain=="hydroBuiltin"){
        const auto record=hydroRuntime_.recordById(q(ref.id));
        if(!record)return false;
        const auto& hidden=project_.document().physicalData.hiddenHydroIds;
        if(std::find(hidden.begin(),hidden.end(),ref.id)!=hidden.end())return false;
        return groupVisible(project_.document().presentation.webPresentation,
            record->category=="lake"?"lakes":"rivers");
    }
    // Presentation migration promotes the supported web fields into the common
    // model.  Keeping a second extension-based check here made rendering and
    // picking disagree whenever a retained payload was only partially known.
    return effectiveMapVisibility(project_.viewDocument(),ref);
}
QVariantList EditorController::objectRows() const {
    if(objectRowsCache_)return *objectRowsCache_;
    QVariantList rows;
    for(const auto& unit:project_.document().units) {
        if(project_.inactiveEntityIds().count(unit.id))continue;
        const auto ref=territorialRef(unit.id);
        auto row=objectRefValue(ref);
        row["flagSource"]=labelFlagSource(ref);row["color"]=rgb(effectiveObjectColor(project_.viewDocument(),ref));
        row["name"]=q(project_.propertyView(ref)->displayName);row["typeLabel"]=typeLabel(unit.kind);
        row["visible"]=objectVisible(ref);row["locked"]=unit.locked;row["lockEnabled"]=true;
        const auto member=project_.document().presentation.membership.find(ref);
        if(member!=project_.document().presentation.membership.end()) {
            row["layerId"]=q(member->second);
            if(const auto layer=project_.layer(member->second)) {row["locked"]=unit.locked||layer->locked;row["lockEnabled"]=!layer->locked;}
        }
        row["editable"]=!row["locked"].toBool();
        row["selectionOnly"]=false;
        rows.append(row);
    }
    for(const auto& [ref,index]:project_.index().objects) if(ref.domain!="territorial") {
        auto row=objectRefValue(ref); const auto properties=project_.propertyView(ref);
        row["name"]=properties?q(properties->displayName):q(ref.id);
        row["typeLabel"]=ref.domain=="label"?QStringLiteral("지명"):ref.domain=="hydro"?QStringLiteral("수계"):
            ref.domain=="generic"?QStringLiteral("기타 객체"):ref.domain=="distributionLayer"?QStringLiteral("분포 레이어"):QStringLiteral("분포 항목");
        row["visible"]=objectVisible(ref); row["locked"]=objectLocked(project_.document(),project_.index(),ref);
        row["editable"]=!row["locked"].toBool(); row["selectionOnly"]=false; rows.append(row);
    }
    if(const auto frame=hydroRuntime_.frame()){
        std::set<QString> seen;
        for(const auto& feature:frame->features)if(const auto record=hydroRuntime_.recordByFid(feature.fid)){
            if(!seen.insert(record->awId).second)continue;
            const ObjectRef ref{"hydroBuiltin",record->awId.toStdString()};
            auto row=objectRefValue(ref);row["name"]=record->name;
            row["typeLabel"]=record->category=="lake"?QStringLiteral("호수"):QStringLiteral("강");
            row["visible"]=objectVisible(ref);row["locked"]=true;
            row["editable"]=false;row["selectionOnly"]=false;rows.append(row);
        }
    }
    std::set<QString> placeIds;const auto copied=copiedPlaceSourceIds(project_.document());
    const auto appendPlace=[&](const PlaceRecord& record) {
        if(copied.count(record.id.toStdString())||!placeIds.insert(record.id).second)return;
        const ObjectRef ref{"placeBuiltin",record.id.toStdString()};auto item=objectRefValue(ref);
        item["name"]=record.name;item["sourceName"]=record.name;item["kind"]=record.kind;item["typeLabel"]=QStringLiteral("기본 지명");
        item["visible"]=objectVisible(ref);item["locked"]=true;item["editable"]=false;item["lockEnabled"]=false;
        item["selectionOnly"]=false;item["builtinSource"]=true;item["copyAvailable"]=true;rows.append(item);
    };
    if(const auto snapshot=placeRuntime_.snapshot())for(const auto& record:snapshot->records)appendPlace(record);
    for(const auto& ref:selection_.items())if(ref.domain=="placeBuiltin")if(const auto record=placeRuntime_.recordById(q(ref.id)))appendPlace(*record);
    objectRowsCache_=rows;return rows;
}
void EditorController::setSearchQuery(const QString& query) {
    if(query==searchQuery_) return;
    searchQuery_=query;
    if(query.isEmpty())placeRuntime_.cancelSearch();else placeRuntime_.search(query);
    emit searchChanged();
}
QVariantList EditorController::searchResults() const {
    const auto query=searchQuery_.trimmed().toLower();
    if(query.isEmpty()) return {};
    QVariantList rows;
    for(const auto& value:objectRows()) {
        auto row=value.toMap();
        if((row["name"].toString()+" "+row["typeLabel"].toString()+" "+row["id"].toString()).toLower().contains(query)) rows.append(row);
    }
    if(const auto metadata=hydroRuntime_.coreMetadata()){
        std::set<QString> seen;
        for(auto it=metadata->cbegin();it!=metadata->cend();++it){
            const auto& record=it.value();if(!seen.insert(record.awId).second)continue;
            if(!(record.name+" "+record.systemId+" "+record.awId).toLower().contains(query))continue;
            const ObjectRef ref{"hydroBuiltin",record.awId.toStdString()};
            auto row=objectRefValue(ref);row["name"]=record.name;
            row["typeLabel"]=record.category=="lake"?QStringLiteral("호수"):QStringLiteral("강");
            row["visible"]=objectVisible(ref);row["locked"]=true;
            row["editable"]=false;row["selectionOnly"]=false;rows.append(row);
        }
    }
    const auto copied=copiedPlaceSourceIds(project_.document());
    for(const auto& record:placeRuntime_.searchResults())if(!copied.count(record.id.toStdString())){
        const ObjectRef ref{"placeBuiltin",record.id.toStdString()};auto item=objectRefValue(ref);
        item["name"]=record.name;item["sourceName"]=record.name;item["kind"]=record.kind;item["typeLabel"]=QStringLiteral("기본 지명");
        item["visible"]=objectVisible(ref);item["locked"]=true;item["editable"]=false;item["lockEnabled"]=false;item["selectionOnly"]=false;
        item["builtinSource"]=true;item["copyAvailable"]=true;rows.append(item);
    }
    std::set<QString> resultIds;
    rows.erase(std::remove_if(rows.begin(),rows.end(),[&](const QVariant& value){
        const auto row=value.toMap();const auto key=row["key"].toString();return !resultIds.insert(key).second;
    }),rows.end());
    QCollator compare{QLocale{QLocale::Korean}};
    std::stable_sort(rows.begin(),rows.end(),[&](const QVariant& a,const QVariant& b){
        const auto left=a.toMap(),right=b.toMap();
        const int result=compare.compare(left["name"].toString(),right["name"].toString());
        return result!=0?result<0:left["key"].toString()<right["key"].toString();
    });
    return rows;
}
void EditorController::parkDrafts() {
    if(const auto u=selectedUnit()) {
        const auto ref=territorialRef(u->id);const auto& style=project_.document().presentation.objectStyles.at(ref);
        CountryDraft d{nameDraft_,memoDraft_,colorDraft_,opacityPreview_,validFromDraft_,validToDraft_};
        if(nameDraft_!=q(u->kind==UnitKind::General?objectDisplayName(*u):u->name))d.fields.insert("name");
        if(memoDraft_!=q(u->notes))d.fields.insert("notes");
        if(colorDraft_!=rgb(effectiveObjectColor(project_.viewDocument(),ref)))d.fields.insert("color");
        if(opacityPreview_&&*opacityPreview_!=style.opacity)d.fields.insert("opacity");
        if(validFromDraft_!=q(pandoeditor::staticLifetime(project_.viewDocument(),u->id).validity.from.value_or("")))d.fields.insert("validFrom");
        if(validToDraft_!=q(pandoeditor::staticLifetime(project_.viewDocument(),u->id).validity.to.value_or("")))d.fields.insert("validTo");
        if(d.fields.empty())parkedCountryDrafts_.erase(selectedId());else parkedCountryDrafts_[selectedId()]=std::move(d);
    }
    if(const auto layer=project_.layer(selectedLayer_.toStdString())) {
        if(layerNameDraft_!=q(layer->name)||(layerOpacityPreview_&&*layerOpacityPreview_!=layer->opacity))
            parkedLayerDrafts_[selectedLayer_]={layerNameDraft_,layerOpacityPreview_};
        else parkedLayerDrafts_.erase(selectedLayer_);
    }
}
void EditorController::restoreParkedDrafts() {
    if(const auto it=parkedCountryDrafts_.find(selectedId());it!=parkedCountryDrafts_.end()) {
        const auto draft=it->second;parkedCountryDrafts_.erase(it);
        if(draft.fields.count("name"))nameDraft_=draft.name;
        if(draft.fields.count("notes"))memoDraft_=draft.memo;
        if(draft.fields.count("color"))colorDraft_=draft.color;
        if(draft.fields.count("opacity"))opacityPreview_=draft.opacity;
        if(draft.fields.count("validFrom"))validFromDraft_=draft.from;
        if(draft.fields.count("validTo"))validToDraft_=draft.to;
    }
    if(const auto it=parkedLayerDrafts_.find(selectedLayer_);it!=parkedLayerDrafts_.end()) {
        const auto draft=it->second;parkedLayerDrafts_.erase(it);
        layerNameDraft_=draft.name;layerOpacityPreview_=draft.opacity;
    }
}
void EditorController::clearParkedDrafts() {
    parkedCountryDrafts_.clear();parkedLayerDrafts_.clear();
    const bool editing=!fieldSessions_.empty();fieldSessions_.clear();
    if(editing)refreshTypedScene();
}
void EditorController::applySelection(SelectionState next) {
    coreSession_.requireEpoch(coreEpoch());
    next.prune([this](const SelectionRef& ref){return coreSession_.selectionRefExists(ref);});
    const bool changed=selection_.revision()!=next.revision();
    const bool hoverChangedNow=selection_.hoverRevision()!=next.hoverRevision();
    if(!changed) {coreSession_.selection()=std::move(next);if(hoverChangedNow){requestPlaceResources();emit hoverChanged();}return;} // anchor-only changes are silent in the web reducer
    QScopedValueRollback<bool> guard(selectionTransition_,true);
    cancelColorEdit();fieldSessions_.clear();parkDrafts();coreSession_.selection()=std::move(next);
    requestPlaceResources();refreshBuiltinPlaceLabels();
    reloadDrafts();
    emit selectionChanged();
    emit stateChanged();emit draftsChanged();
    emit visualChanged();
    if(hoverChangedNow)emit hoverChanged();
    // Child split previews bind to the selection identity observed at request
    // time. Refresh their read-only readiness when that identity changes.
    if(geometryEdit_&&geometryEdit_->splitIntent&&!staticParentRelation(geometryEdit_->base.document(),geometryEdit_->target.id).parentId.empty())emit geometryEditChanged();
    // No dirtyChanged, project revision, history, import epoch or content preview mutation.
}
bool EditorController::selectObject(const QVariantMap& value,const QString& mode,const QString& scope,const QVariantList& ordered,bool additive) {
    const auto ref=existingSelectionRef(value);if(!ref) return false;
    closeObjectChooser();
    auto next=selection_;
    if(mode=="replace") next.replace(*ref,scope.toStdString());
    else if(mode=="toggle") next.toggle(*ref,scope.toStdString());
    else if(mode=="range") {
        std::vector<SelectionRef> refs;
        for(const auto& v:ordered) if(const auto candidate=existingSelectionRef(v.toMap())) refs.push_back(*candidate);
        next.selectRange(*ref,refs,scope.isEmpty()?"default":scope.toStdString(),additive);
    } else if(mode=="remove") next.remove(*ref);
    else return false;
    applySelection(std::move(next));return true;
}
bool EditorController::setSelection(const QVariantList& values,const QVariantMap& primary,const QString& scope) {
    closeObjectChooser();
    std::vector<SelectionRef> refs;
    for(const auto& v:values) if(const auto ref=existingSelectionRef(v.toMap())) refs.push_back(*ref);
    auto next=selection_;next.setMany(refs,existingSelectionRef(primary),scope.toStdString());applySelection(std::move(next));return true;
}
void EditorController::clearSelection() { closeObjectChooser();auto next=selection_;next.clear();applySelection(std::move(next)); }
void EditorController::selectCountry(const QString& id) {
    selectObject({{"domain","territorial"},{"type","entity"},{"id",id}},"replace","countries");
}
void EditorController::selectLayer(const QString& id) {
    if(!project_.layer(id.toStdString())||selectedLayer_==id) return;
    QScopedValueRollback<bool> guard(selectionTransition_,true);
    parkDrafts();selectedLayer_=id;reloadDrafts();
    emit stateChanged();emit draftsChanged();emit visualChanged();
}
QVariantMap EditorController::pickObject(double x,double y,double pixelsPerUnit,double zoom) const {
    if(!std::isfinite(x)||!std::isfinite(y)) return {};
    return pickObjectFromCandidates(mapCandidates(x,y,pixelsPerUnit,zoom));
}
QVariantMap EditorController::pickObjectScreen(double x,double y,double zoom) const {
    if(!std::isfinite(x)||!std::isfinite(y))return {};
    auto candidates=mapCandidatesScreen(x,y,zoom);
    if(geometryEdit_&&geometryEdit_->choosingProviders) {
        const auto& document=project_.document();const auto& index=project_.index();
        const auto target=index.objects.find(geometryEdit_->target);if(target==index.objects.end())return {};
        const auto kind=document.units.at(target->second).kind;
        candidates.erase(std::remove_if(candidates.begin(),candidates.end(),[&](const auto& ref){
            const auto found=index.objects.find(ref);
            return ref.domain!="territorial"||ref==geometryEdit_->target||found==index.objects.end()||
                document.units.at(found->second).kind!=kind||
                (geometryEdit_->territorySelection&&!isRootGeneral(document,document.units.at(found->second)))||objectLocked(document,index,ref);
        }),candidates.end());
    }
    return pickObjectFromCandidates(candidates);
}
QVariantMap EditorController::pickObjectFromCandidates(
    const std::vector<ObjectRef>& hits) const {
    const auto snapshot=project_.snapshotForView();
    const auto top=mapPicker_.topCandidate(snapshot,hits);
    for(const auto& ref:hits)if(ref.domain=="placeBuiltin"&&objectVisible(ref)&&(!top||mapPicker_.candidateRank(snapshot,*top)<=mapPickOrder(snapshot.document(),{"label",ref.id})))return objectRefValue(ref);
    return top?objectRefValue(*top):QVariantMap{};
}
void EditorController::selectAt(double x,double y) { selectMapAt(x,y,false); }
void EditorController::selectMapAt(double x,double y,bool additive) {
    beginMapSelection(x,y,additive);
}
QVariantMap EditorController::hoverObject() const { return selection_.hover()?selectionRefValue(*selection_.hover()):QVariantMap{}; }
bool EditorController::setHoverObject(const QVariantMap& value,const QString& source,const QString& expectedKey) {
    coreSession_.requireEpoch(coreEpoch());
    std::optional<SelectionRef> next;
    if(!value.isEmpty()){next=existingSelectionRef(value);if(!next)return false;}
    const auto before=selection_.hoverRevision();
    if(!coreSession_.selection().setHover(next,source.toStdString(),expectedKey.toStdString()))return false;
    if(before!=selection_.hoverRevision()){requestPlaceResources();emit hoverChanged();}
    return true;
}
bool EditorController::focusObject(const QVariantMap& value) {
    const auto ref=value.isEmpty()?primaryObjectRef():existingObjectRef(value);
    if(!ref) return false;
    if(ref->domain=="placeBuiltin"){
        const auto record=placeRuntime_.recordById(q(ref->id));if(!record||!objectVisible(*ref))return false;
        const auto point=projection_.project(record->coordinates);focusMapCameraRect(point.x,point.y,.001,.001,mobileMode_?12:10);
        emit focusRequested(point.x,point.y,.001,.001,mobileMode_?12:10);return true;
    }
    if(ref->domain=="hydroBuiltin"){
        const auto record=hydroRuntime_.recordById(q(ref->id));
        if(!record||record->bounds.size()!=4)return false;
        const auto topLeft=projection_.project({record->bounds[0],record->bounds[3]});
        const auto bottomRight=projection_.project({record->bounds[2],record->bounds[1]});
        const auto width=std::max(.001,bottomRight.x-topLeft.x);
        const auto height=std::max(.001,bottomRight.y-topLeft.y);
        focusMapCameraRect(topLeft.x,topLeft.y,width,height,mobileMode_?12:10);
        emit focusRequested(topLeft.x,topLeft.y,width,height,mobileMode_?12:10);
        return true;
    }
    for(const auto& path:projection_.objects) {
        const auto p=path.toMap();
        if(ref->domain=="territorial" ? p["countryId"].toString()!=q(ref->id) :
            (p["domain"].toString()!=q(ref->domain) || p["objectId"].toString()!=q(ref->id))) continue;
        focusMapCameraRect(p["left"].toDouble(),p["top"].toDouble(),p["width"].toDouble(),p["height"].toDouble(),mobileMode_?12:10);
        emit focusRequested(p["left"].toDouble(),p["top"].toDouble(),p["width"].toDouble(),p["height"].toDouble(),mobileMode_?12:10);
        return true;
    }
    return false;
}
void EditorController::reconcileSelection() {
    const bool replaced=selectionInstance_!=project_.instanceId();
    // Cancellation emits synchronous QML notifications. Drop references to the
    // old document before any of those notifications can read object properties.
    if(replaced) {
        selectionInstance_=project_.instanceId();
        searchQuery_.clear();clearParkedDrafts();
        labelEngine_.clear();++labelCounterGeneration_;labelFlagSources_.clear();labelSourcesDirty_=true;
        if(!placedLabels_.isEmpty()){placedLabels_.clear();emit labelLayoutChanged();}
    } else {
        coreSession_.selection().prune([this](const SelectionRef& ref){return coreSession_.selectionRefExists(ref);});
    }
    closeObjectChooser();cancelColorEdit();fieldSessions_.clear();
    if(replaced) {cancelContentEdit();cancelGeometryEdit();}
}
