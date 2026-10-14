#include "editorcontroller.h"
#include "geometrysnapprovider.h"
#include "retainedreferencerewriter.h"
#include "territorialgeometry.h"
#include "geometrycalculator.h"
#include "../renderer/gpumapitem.h"
#include "../renderer/maprenderitem.h"
#include <pandoeditor/map/projectionengine.h>
#include <pandoeditor/map/interactionstylepolicy.h>
#include <pandoeditor/commands.h>
#include <pandoeditor/timeline-view.h>
#include <pandoeditor/map/editcoordinates.h>
#include <pandoeditor/map/editgeometry.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <QQuickWindow>

using namespace pandoeditor;
namespace {
bool isArea(const Geometry& g) { return g.type=="Polygon"||g.type=="MultiPolygon"; }
const Ring* openPath(const Geometry& g,int path) {
    if(g.type=="Point"||g.type=="MultiPoint") return path==0?&g.points:nullptr;
    if(path<0||std::size_t(path)>=g.lines.size())return nullptr;
    return &g.lines[path];
}
bool samePoint(Point a,Point b) { return a.x==b.x&&a.y==b.y; }
const ApplyTerritorialMutation* territorialMutation(const CommandAction& action) {
    if(const auto* mutation=std::get_if<ApplyTerritorialMutation>(&action))return mutation;
    if(const auto* dated=std::get_if<TimelineTerritorialMutation>(&action))return &dated->mutation;
    return nullptr;
}
}

QVariantMap EditorController::geometryEditState() const
{
    if(!geometryEdit_) return {{"active",false}};
    if(geometryEdit_->territorySelection)return territorySelectionState();
    const auto& edit=*geometryEdit_;
    auto describe=[&](const ObjectRef& ref) {
        auto row=objectRefValue(ref);QString name;
        for(const auto& unit:project_.document().units)if(territorialRef(unit.id)==ref){name=QString::fromStdString(objectDisplayName(unit));break;}
        if(name.isEmpty()&&ref==edit.target) { if(edit.createIntent)name=QString::fromStdString(edit.createIntent->name);else if(edit.content && contentSession_){name=contentEditState().value("name").toString();if(name.isEmpty()&&!contentSession_->edit.create)name=objectProperties().value("displayName").toString();}else name=objectProperties().value("displayName").toString(); }
        row["name"]=name.isEmpty()?QStringLiteral("새 객체"):name;return row;
    };
    QVariantList providers,targets,boundaryImpacts;
    if(edit.tool=="boundary"&&edit.preview&&edit.platformPlan)for(const auto& impact:edit.platformPlan->impacts) {
        if(impact.kind!="clip-child"&&impact.kind!="remove-child"&&impact.kind!="ownership-change")continue;
        QString description=impact.kind=="clip-child"?QStringLiteral("일부 영역 절단"):impact.kind=="remove-child"?QStringLiteral("객체와 참조 삭제"):QStringLiteral("상위 단위 변경");
        if(impact.kind=="ownership-change"){const auto separator=impact.messageKey.rfind(':');if(separator!=std::string::npos)description=QStringLiteral("상위 단위: ")+describe(territorialRef(impact.messageKey.substr(separator+1))).value("name").toString();}
        boundaryImpacts.append(QVariantMap{{"kind",QString::fromStdString(impact.kind)},{"id",QString::fromStdString(impact.target.id)},{"name",describe(impact.target).value("name")},{"description",description},{"messageKey",QString::fromStdString(impact.messageKey)}});
    }
    targets.append(describe(edit.target));
    for(const auto& ref:edit.boundaryOwners)if(!(ref==edit.target))targets.append(describe(ref));
    if(edit.mergeIntent)for(const auto& ref:edit.mergeIntent->donors)providers.append(describe(ref));
    if(edit.annexIntent)for(const auto& ref:edit.annexIntent->donors)providers.append(describe(ref));
    return {{"active",true},{"creating",bool(edit.createIntent)||(edit.content&&contentSession_&&contentSession_->edit.create)},{"tool",edit.tool},{"stage",edit.preview?QStringLiteral("review"):edit.stage},{"choosingProviders",edit.choosingProviders},{"providers",providers},
        {"phase",edit.preview?"preview":edit.job?"calculating":"editing"},{"previewReady",bool(edit.preview)},
        {"calculating",bool(edit.job)||edit.boundaryStatus=="preparing"},
        {"snapIndicator",edit.snapIndicator},{"boundaryStatus",edit.tool=="boundary"&&edit.boundaryStatus=="ready"&&!boundaryGeometryReady()?QStringLiteral("error"):edit.boundaryStatus},{"boundaryImpacts",boundaryImpacts},{"boundaryImpactConfirmation",edit.boundaryImpactConfirmation},{"boundaryCanPreview",boundaryGeometryReady()&&!edit.boundarySession->dragging()&&!edit.boundarySession->changedDrafts().empty()},
        {"selectedVertex",edit.tool=="boundary"?edit.boundaryNode:coreSession_.draft().selectedVertexIndex()},{"error",edit.error},{"canUndo",edit.tool=="boundary"?boundaryGeometryReady()&&edit.boundarySession->canUndo():coreSession_.draft().historyCount()>0},{"canRedo",edit.tool=="boundary"?boundaryGeometryReady()&&edit.boundarySession->canRedo():coreSession_.draft().futureCount()>0},
        {"target",objectRefValue(edit.target)},{"targets",targets},
        {"snapX",edit.snapPoint?projection_.project(*edit.snapPoint).x:std::numeric_limits<double>::quiet_NaN()},
        {"snapY",edit.snapPoint?projection_.project(*edit.snapPoint).y:std::numeric_limits<double>::quiet_NaN()}};
}

void EditorController::recordMapPresentationSource(QObject* source) {
    if(!source||geometryPresentationSources_.count(source))return;
    if(auto* gpu=qobject_cast<GpuMapItem*>(source))
        connect(gpu,&GpuMapItem::framePresented,this,&EditorController::acceptMapPresentation);
    else if(auto* cpu=qobject_cast<MapRenderItem*>(source))
        connect(cpu,&MapRenderItem::framePresented,this,&EditorController::acceptMapPresentation);
    else return;
    geometryPresentationSources_.insert(source);
    connect(source,&QObject::destroyed,this,[this,source]{geometryPresentationSources_.erase(source);});
}
void EditorController::acceptMapPresentation(const std::shared_ptr<const MapFrame>& frame,const QVariantList& inventory) {
    if(geometryPresentationStrokes_.empty()||geometryPresentationInstance_!=project_.instanceId()||
       geometryPresentationRevision_!=project_.revision()||!frame||frame!=sceneBridge_.frameSnapshot())return;
    for(const auto& held:geometryPresentationStrokes_) {
        bool found=false;
        for(const auto& entry:inventory) {
            const auto row=entry.toMap();
            if(row.value("domain").toString().toStdString()!=held.object.domain||row.value("id").toString().toStdString()!=held.object.id)continue;
            if(!held.successor)return;
            if(row.value("geometryId").toString().toStdString()==held.successor->id&&
               row.value("geometryVersion").toULongLong()==held.successor->version)found=true;
            else return; // A predecessor is still in this actual render inventory.
        }
        if(held.successor&&!found)return;
    }
    geometryPresentationStrokes_.clear();emit geometryEditChanged();
}
QVariantList EditorController::geometryPresentationPaths() const {
    QVariantList paths;
    if(geometryPresentationInstance_!=project_.instanceId()||geometryPresentationRevision_!=project_.revision())return paths;
    const auto view=sceneBridge_.viewState();
    for(const auto& held:geometryPresentationStrokes_) {
        const auto packet=makeStrokeGeometryPacket(*held.geometry);
        const auto offsets=view.mode==ProjectionMode::Flat?visibleFlatWorldOffsets(view):std::vector<double>{0};
        for(const auto offset:offsets) {
            QString path;
            for(std::size_t i=0;i<packet.segmentCount;++i) {
                const auto& points=*packet.startsEnds;
                Point sourceA{points[i*4],points[i*4+1]},sourceB{points[i*4+2],points[i*4+3]};
                auto a=projectPoint(sourceA,view,offset),b=projectPoint(sourceB,view,offset);
                if(!a.finite||!b.finite||(!a.visibleHemisphere&&!b.visibleHemisphere))continue;
                if(a.visibleHemisphere!=b.visibleHemisphere) {
                    auto visible=a.visibleHemisphere?sourceA:sourceB,hidden=a.visibleHemisphere?sourceB:sourceA;
                    // Match the production stroke shader's geographic horizon clipping.
                    for(int step=0;step<16;++step) {
                        const Point mid{(visible.x+hidden.x)*.5,(visible.y+hidden.y)*.5};
                        if(projectPoint(mid,view,offset).visibleHemisphere)visible=mid;else hidden=mid;
                    }
                    if(!a.visibleHemisphere)a=projectPoint(visible,view,offset);else b=projectPoint(visible,view,offset);
                }
                path+=QString("M%1 %2 L%3 %4 ").arg(a.x,0,'g',17).arg(a.y,0,'g',17).arg(b.x,0,'g',17).arg(b.y,0,'g',17);
            }
            if(!path.isEmpty())paths.append(QVariantMap{{"path",path},{"line",!held.geometry->lines.empty()},{"removed",!held.successor}});
        }
    }
    return paths;
}
QVariantMap EditorController::mapInteractionStyle(const QString& role,bool direct,bool shared) const {
    using namespace mapstyle;
    const auto r=role=="candidate"?InteractionRole::Candidate:role=="hover"?InteractionRole::Hover:
        role=="secondary"?InteractionRole::Secondary:role=="edit-target"?InteractionRole::EditTarget:InteractionRole::Primary;
    Options options;options.dark=appearancePreferences().value("effectiveTheme").toString()=="dark";
    options.directManipulation=direct;options.sharedBoundary=shared;
    const auto v=sceneBridge_.viewState();const auto s=interactionStroke(r,options,{v.viewportWidth,v.viewportHeight,v.scale,v.mode==ProjectionMode::Flat});
    return {{"color",QString("#%1").arg(s.color,6,16,QChar('0'))},{"width",s.width},{"alpha",s.alpha},{"fillAlpha",s.fillAlpha},{"dashOn",s.dashOn},{"dashOff",s.dashOff}};
}
QVariantList EditorController::geometryDraftPaths() const
{
    QVariantList paths;if(!geometryEdit_)return paths;
    if(geometryEdit_->territorySelection)return territorySelectionPaths();
    if(geometryEdit_->preview) {
        const auto& afterSource=geometryEdit_->preview->change().after();
        const auto& beforeSource=geometryEdit_->preview->change().before();
        const auto month=geometryEdit_->base.timelineMonth();
        const auto dated=!month.empty()&&!isStaticTimeline(afterSource);
        auto afterView=dated?std::optional<TimelineDocumentView>{timelineDocumentView(afterSource,month)}:std::nullopt;
        auto beforeView=dated?std::optional<TimelineDocumentView>{timelineDocumentView(beforeSource,month)}:std::nullopt;
        const auto& document=afterView?afterView->document:afterSource;
        std::vector<ObjectRef> refs{geometryEdit_->target};
        const auto& before=beforeView?beforeView->document:beforeSource;
        if(geometryEdit_->tool=="boundary") {
            refs.clear();const auto beforeIndex=validateDocument(before),afterIndex=validateDocument(document);
            for(const auto& ref:geometryEdit_->preview->change().impact().changedObjects)if(ref.domain=="territorial") {
                const auto previous=objectGeometry(before,beforeIndex,ref);
                const auto successor=objectGeometry(document,afterIndex,ref);
                if(!(previous==successor))refs.push_back(ref);
            }
            if(geometryEdit_->platformPlan)for(const auto& impact:geometryEdit_->platformPlan->impacts)
                if((impact.kind=="clip-child"||impact.kind=="remove-child"||impact.kind=="ownership-change")&&std::find(refs.begin(),refs.end(),impact.target)==refs.end())refs.push_back(impact.target);
        }
        if(geometryEdit_->splitIntent)refs.push_back(territorialRef(geometryEdit_->splitIntent->createdId));
        const auto index=validateDocument(document);
        for(const auto& ref:refs) {
            const auto geometryRef=objectGeometry(document,index,ref);
            const bool removed=!geometryRef;
            const auto previous=removed?objectGeometry(before,validateDocument(before),ref):std::optional<GeometryRef>{};
            const auto geometry=geometryRef?document.geometries.get(*geometryRef):previous?before.geometries.get(*previous):nullptr;if(!geometry)continue;
            for(const auto& polygon:geometry->polygons) {
                QString path;
                for(const auto& ring:polygon) {
                    for(std::size_t i=0;i<ring.size();++i) {const auto point=projection_.project(ring[i]);path+=QString("%1%2 %3 ").arg(i?"L":"M").arg(point.x,0,'g',17).arg(point.y,0,'g',17);}
                    path+="Z ";
                }
                paths.append(QVariantMap{{"path",path},{"vertices",QVariantList{}},{"hole",false},{"preview",true},{"ownerId",QString::fromStdString(ref.id)},{"removed",removed},{"created",geometryEdit_->tool!="boundary"&&!(ref==geometryEdit_->target)}});
            }
        }
        return paths;
    }
    if(geometryEdit_->tool=="boundary") {
        if(!boundaryGeometryReady())return paths;
        const auto& session=*geometryEdit_->boundarySession;QVariantList vertices;
        for(std::size_t i=0;i<session.nodes().size();++i){const auto& node=session.nodes()[i];const auto point=projection_.project(node.coordinate);QStringList owners;for(const auto& owner:node.owners)owners.append(QString::fromStdString(owner));
            vertices.append(QVariantMap{{"x",point.x},{"y",point.y},{"polygon",0},{"ring",0},{"vertex",int(i)},{"ownerIds",owners},{"nodeKey",QString::fromStdString(sharedboundary::nodeKeyText(node.coordinate))},{"fixed",node.fixed},{"locked",!node.fixed&&!session.canMove(i)}});
        }
        bool first=true;for(const auto& segment:session.segments()){const auto a=projection_.project(session.nodes()[segment.start].coordinate),b=projection_.project(session.nodes()[segment.end].coordinate);paths.append(QVariantMap{{"path",QString("M%1 %2 L%3 %4").arg(a.x,0,'g',17).arg(a.y,0,'g',17).arg(b.x,0,'g',17).arg(b.y,0,'g',17)},{"vertices",first?vertices:QVariantList{}},{"hole",false},{"line",true},{"boundary",true}});first=false;}
        for(const auto& segment:session.activeSegments()){const auto a=projection_.project(segment.first),b=projection_.project(segment.second);paths.append(QVariantMap{{"path",QString("M%1 %2 L%3 %4").arg(a.x,0,'g',17).arg(a.y,0,'g',17).arg(b.x,0,'g',17).arg(b.y,0,'g',17)},{"vertices",QVariantList{}},{"hole",false},{"line",true},{"boundary",true},{"activeBoundary",true}});}
        return paths;
    }
    if(!isArea(coreSession_.draft().geometry())&&geometryEdit_->tool!="split") {
        const auto& g=coreSession_.draft().geometry();
        const auto sources=(g.type=="Point"||g.type=="MultiPoint")?std::vector<Ring>{g.points}:g.lines;
        for(std::size_t p=0;p<sources.size();++p){QString path;QVariantList vertices;
            for(std::size_t v=0;v<sources[p].size();++v){const auto point=projection_.project(sources[p][v]);path+=QString("%1%2 %3 ").arg(v?"L":"M").arg(point.x,0,'g',17).arg(point.y,0,'g',17);vertices.append(QVariantMap{{"x",point.x},{"y",point.y},{"polygon",int(p)},{"ring",0},{"vertex",int(v)}});}
            paths.append(QVariantMap{{"path",g.type=="MultiPoint"?QString{}:path},{"vertices",vertices},{"hole",false},{"line",true}});
        }return paths;
    }
    if(geometryEdit_->tool=="split") {const auto line=coreSession_.draft().coordinates();QString path;QVariantList vertices;for(std::size_t i=0;i<line.size();++i){const auto point=projection_.project(line[i]);path+=QString("%1%2 %3 ").arg(i?"L":"M").arg(point.x,0,'g',17).arg(point.y,0,'g',17);vertices.append(QVariantMap{{"x",point.x},{"y",point.y},{"polygon",0},{"ring",0},{"vertex",int(i)}});}paths.append(QVariantMap{{"path",path},{"vertices",vertices},{"hole",false},{"line",true}});return paths;}
    for(std::size_t polygon=0;polygon<coreSession_.draft().geometry().polygons.size();++polygon)
        for(std::size_t ring=0;ring<coreSession_.draft().geometry().polygons[polygon].size();++ring) {
            const auto& source=coreSession_.draft().geometry().polygons[polygon][ring];QString path;QVariantList vertices;
            for(std::size_t vertex=0;vertex<source.size();++vertex) {
                const auto point=projection_.project(source[vertex]);
                path+=QString("%1%2 %3 ").arg(vertex?"L":"M").arg(point.x,0,'g',17).arg(point.y,0,'g',17);
                vertices.append(QVariantMap{{"x",point.x},{"y",point.y},{"polygon",int(polygon)},{"ring",int(ring)},{"vertex",int(vertex)}});
            }
            if(source.size()>3)path+="Z";
            paths.append(QVariantMap{{"path",path},{"vertices",vertices},{"hole",ring>0}});
        }
    return paths;
}

bool EditorController::beginGeometryEdit(const QString& tool)
{
    if(geometryEdit_||structureDialogOpen()||hasPendingEdits())return false;
    const auto target=primaryObjectRef();if(!target||!selectedEditable())return false;
    const auto unit=selectedUnit();if(!unit)return false;
    const auto& view=project_.viewDocument();
    const auto geometry=view.geometries.get(pandoeditor::staticGeometryBinding(view,unit->id).geometryRef);if(!geometry)return false;
    geometryEdit_=GeometryEditSession{coreSession_,project_.snapshot(),*target,*geometry,tool,{}};geometryEdit_->epoch=coreEpoch();
    emit geometryEditChanged();return true;
}

bool EditorController::beginGeometryDraw()
{
    if(geometryEdit_||(structureDialogOpen()&&!createDraft_)||hasPendingEdits())return false;
    if(createDraft_) {
        if(!createDraft_->base.matches(project_)) { cancelStructureMutation();emit errorOccurred("STALE_STRUCTURE_SESSION");return false; }
        geometryEdit_=GeometryEditSession{coreSession_,createDraft_->base,territorialRef(createDraft_->intent.id),{"Polygon",{}, {}, {}},QStringLiteral("draw"),createDraft_->intent};geometryEdit_->epoch=coreEpoch();
    } else {
        if(!beginGeometryEdit(QStringLiteral("draw")))return false;
        coreSession_.draft().resetGeometry({"Polygon",{}, {}, {}});
    }
    emit geometryEditChanged();return true;
}

bool EditorController::geometryAddPointScreen(double x,double y,double radiusPixels,const QString& pointerType)
{
    const auto display=camera_.display();
    const auto point=map::editScreenToMap({x,y},display);
    return geometryAddPoint(point.x,point.y,map::editPixelRadiusToMap(radiusPixels,display),pointerType);
}

bool EditorController::geometryAddPoint(double x,double y,double tolerance,const QString& pointerType)
{
    if(!geometryEdit_||geometryEdit_->preview||geometryEdit_->stage=="setup"||geometryEdit_->choosingProviders||!std::isfinite(x)||!std::isfinite(y))return false;
    auto& edit=*geometryEdit_;
    if(edit.territorySelection) {
        const auto& state=edit.territorySelection->state();
        if(edit.stage!="selection"||state.activePhase!=TerritorySelectionPhase::Drawing||edit.applying||edit.selectionPending||edit.sourceChange||state.methodChangeConfirmation)return false;
    } else if(edit.tool!="draw"&&edit.tool!="annex"&&edit.tool!="split")return false;
    if(!coreSession_.draft().append(snappedGeometryPoint(x,y,tolerance,pointerType)))return false;
    ++edit.request;emit geometryEditChanged();return true;
}

bool EditorController::geometrySelectNearestScreen(double x,double y,double radiusPixels)
{
    const auto display=camera_.display();
    const auto point=map::editScreenToMap({x,y},display);
    return geometrySelectNearest(point.x,point.y,map::editPixelRadiusToMap(radiusPixels,display));
}

bool EditorController::geometrySelectNearest(double x,double y,double tolerance)
{
    if(geometryEdit_&&geometryEdit_->territorySelection)return false;
    if(!geometryEdit_||geometryEdit_->preview||!std::isfinite(x)||!std::isfinite(y)||tolerance<0)return false;
    auto& edit=*geometryEdit_;
    if(edit.tool=="boundary") {
        if(!boundaryGeometryReady()||edit.job)return false;
        edit.boundaryNode=map::nearestMovableBoundaryNode(*edit.boundarySession,{x,y},tolerance,mapCameraMetrics());
        emit geometryEditChanged();return edit.boundaryNode>=0;
    }
    const auto hit=map::nearestEditVertex(coreSession_.draft().geometry(),{x,y},tolerance,mapCameraMetrics());
    if(hit.vertex<0)coreSession_.draft().clearVertexSelection();else coreSession_.draft().selectVertex(hit.vertex,hit.polygon,hit.ring);
    emit geometryEditChanged();return hit.vertex>=0;
}

bool EditorController::geometryMoveSelectedVertexScreen(double x,double y,double radiusPixels,const QString& pointerType)
{
    const auto display=camera_.display();
    const auto point=map::editScreenToMap({x,y},display);
    return geometryMoveSelectedVertex(point.x,point.y,map::editPixelRadiusToMap(radiusPixels,display),pointerType);
}

bool EditorController::geometryMoveSelectedVertex(double x,double y,double tolerance,const QString& pointerType)
{
    if(geometryEdit_&&geometryEdit_->territorySelection)return false;
    if(!geometryEdit_||geometryEdit_->preview||!std::isfinite(x)||!std::isfinite(y))return false;
    auto& edit=*geometryEdit_;
    if(edit.tool!="boundary"&&coreSession_.draft().selectedVertexIndex()<0)return false;
    if(edit.tool=="boundary") {
        if(!boundaryGeometryReady()||edit.job||edit.boundaryNode<0)return false;
        const auto point=snappedGeometryPoint(x,y,tolerance,pointerType);
        if(!edit.boundarySession->move(std::size_t(edit.boundaryNode),point))return false;
        if(!edit.boundarySession->dragging())coreSession_.draft().replaceGeometry(edit.boundarySession->drafts().at(edit.target.id));
        edit.error.clear();++edit.request;emit geometryEditChanged();return true;
    }
    if(!coreSession_.draft().moveSelected(snappedGeometryPoint(x,y,tolerance,pointerType)))return false;
    ++edit.request;emit geometryEditChanged();return true;
}

bool EditorController::geometryBeginVertexDrag(){
    if(geometryEdit_&&geometryEdit_->tool=="boundary") {
        auto& edit=*geometryEdit_;
        if(!boundaryGeometryReady()||edit.preview||edit.job||edit.boundaryNode<0||!edit.boundarySession->beginDrag(std::size_t(edit.boundaryNode)))return false;
        edit.snapExcludedNodeKey=QString::fromStdString(sharedboundary::nodeKeyText(edit.boundarySession->nodes()[edit.boundaryNode].coordinate));return true;
    }
    if(!geometryEdit_||geometryEdit_->tool=="move"||geometryEdit_->preview)return false;
    return coreSession_.draft().beginDrag(coreSession_.draft().selectedVertexIndex(),coreSession_.draft().selectedPolygon(),coreSession_.draft().selectedRing());
}

void EditorController::geometryEndVertexDrag(bool cancel){
    if(geometryEdit_&&geometryEdit_->tool=="boundary") {
        auto& edit=*geometryEdit_;if(!edit.boundarySession||!edit.boundarySession->dragging())return;
        const bool changed=edit.boundarySession->endDrag(cancel||!boundaryGeometryReady());coreSession_.draft().replaceGeometry(edit.boundarySession->drafts().at(edit.target.id));
        if(!edit.boundarySession->valid()){edit.boundaryStatus="error";edit.error=QString::fromStdString(edit.boundarySession->error());}
        edit.snapPoint.reset();edit.snapIndicator.clear();edit.snapExcludedNodeKey.clear();++edit.request;emit geometryEditChanged();
        if(changed&&!requestGeometryPreview()){edit.boundarySession->resetDraft();coreSession_.draft().replaceGeometry(edit.boundarySession->drafts().at(edit.target.id));edit.boundaryNode=-1;emit geometryEditChanged();}return;
    }
    if(!geometryEdit_||geometryEdit_->tool=="move"||!coreSession_.draft().dragging())return;
    if(cancel)coreSession_.draft().cancelDrag();else coreSession_.draft().finishDrag();
    geometryEdit_->snapPoint.reset();geometryEdit_->snapIndicator.clear();++geometryEdit_->request;emit geometryEditChanged();
}

bool EditorController::geometrySetMoveMode(bool enabled){
    if(!geometryEdit_||!geometryEdit_->content||geometryEdit_->preview||coreSession_.draft().dragging()||(geometryEdit_->tool!="edit"&&geometryEdit_->tool!="move"))return false;
    geometryEdit_->tool=enabled?QStringLiteral("move"):QStringLiteral("edit");coreSession_.draft().clearVertexSelection();emit geometryEditChanged();return true;
}

bool EditorController::geometryBeginObjectDrag(){
    return geometryEdit_&&geometryEdit_->content&&geometryEdit_->tool=="move"&&!geometryEdit_->preview&&coreSession_.draft().beginObjectDrag();
}

bool EditorController::geometryTranslateObjectScreen(double deltaX,double deltaY){
    const auto display=camera_.display();
    const auto delta=map::editScreenDeltaToMap({deltaX,deltaY},display);
    return geometryTranslateObject(delta.x,delta.y);
}
bool EditorController::geometryTranslateObject(double dx,double dy){
    if(!geometryEdit_||geometryEdit_->tool!="move"||!coreSession_.draft().dragOrigin()||!std::isfinite(dx)||!std::isfinite(dy))return false;
    auto translated=map::translateEditGeometry(*coreSession_.draft().dragOrigin(),{dx,dy},mapCameraMetrics());
    if(!translated||!coreSession_.draft().applyObjectTranslation(std::move(translated->geometry),translated->moved))return false;
    ++geometryEdit_->request;emit geometryEditChanged();return true;
}

void EditorController::geometryEndObjectDrag(bool cancel){
    if(!geometryEdit_||geometryEdit_->tool!="move"||!coreSession_.draft().finishObjectDrag(cancel))return;
    ++geometryEdit_->request;emit geometryEditChanged();
}

bool EditorController::geometryInsertNearestScreen(double x,double y,double radiusPixels)
{
    const auto display=camera_.display();
    const auto point=map::editScreenToMap({x,y},display);
    return geometryInsertNearest(point.x,point.y,map::editPixelRadiusToMap(radiusPixels,display));
}

bool EditorController::geometryInsertNearest(double x,double y,double tolerance)
{
    if(!geometryEdit_||geometryEdit_->tool=="boundary"||geometryEdit_->territorySelection||geometryEdit_->preview||!std::isfinite(x)||!std::isfinite(y)||tolerance<0)return false;
    auto& edit=*geometryEdit_;const auto hit=map::nearestEditSegment(coreSession_.draft().geometry(),{x,y},tolerance,mapCameraMetrics());
    if(!hit||!coreSession_.draft().insertAt(hit->index.vertex-1,hit->coordinate,hit->index.polygon,hit->index.ring))return false;
    ++edit.request;emit geometryEditChanged();return true;
}

bool EditorController::geometryDeleteSelectedVertex()
{
    if(!geometryEdit_||geometryEdit_->tool=="boundary"||geometryEdit_->territorySelection||geometryEdit_->preview||!coreSession_.draft().deleteSelected())return false;
    ++geometryEdit_->request;emit geometryEditChanged();return true;
}

bool EditorController::geometryUndoDraft()
{
    if(geometryEdit_&&geometryEdit_->tool=="boundary") {auto& edit=*geometryEdit_;if(!boundaryGeometryReady()||edit.preview||edit.job||!edit.boundarySession->undo())return false;coreSession_.draft().replaceGeometry(edit.boundarySession->drafts().at(edit.target.id));edit.boundaryNode=-1;++edit.request;emit geometryEditChanged();return true;}
    if(geometryEdit_&&geometryEdit_->territorySelection) {
        if(geometryEdit_->applying||geometryEdit_->sourceChange||geometryEdit_->territorySelection->state().methodChangeConfirmation)return false;
        if(geometryEdit_->territorySelection->state().activePhase!=TerritorySelectionPhase::Drawing)return geometryUndoTerritoryPart();
    }
    if(!geometryEdit_||geometryEdit_->preview||!coreSession_.draft().undo())return false;
    ++geometryEdit_->request;emit geometryEditChanged();return true;
}

bool EditorController::geometryRedoDraft(){
    if(geometryEdit_&&geometryEdit_->tool=="boundary") {auto& edit=*geometryEdit_;if(!boundaryGeometryReady()||edit.preview||edit.job||!edit.boundarySession->redo())return false;coreSession_.draft().replaceGeometry(edit.boundarySession->drafts().at(edit.target.id));edit.boundaryNode=-1;++edit.request;emit geometryEditChanged();return true;}
    if(!geometryEdit_||geometryEdit_->preview||!coreSession_.draft().redo())return false;
    ++geometryEdit_->request;emit geometryEditChanged();return true;
}

bool EditorController::requestGeometryPreview()
try
{
    if(geometryEdit_&&geometryEdit_->territorySelection) {
        if(geometryEdit_->applying||geometryEdit_->sourceChange||geometryEdit_->territorySelection->state().methodChangeConfirmation)return false;
        if(geometryEdit_->territorySelection->state().activePhase==TerritorySelectionPhase::Drawing)return geometryFinishTerritoryDraft();
        scheduleTerritoryPreview();return true;
    }
    if(geometryEdit_&&geometryEdit_->tool=="boundary"&&(!boundaryGeometryReady()||geometryEdit_->job||geometryEdit_->boundarySession->dragging()||geometryEdit_->boundarySession->changedDrafts().size()<2))return false;
    std::string validationDetail;
    if(!geometryEdit_||geometryEdit_->preview||!geometryEdit_->base.matches(project_))return false;
    if(geometryEdit_->stage=="setup")return false;
    if(geometryEdit_->annexIntent&&geometryEdit_->choosingProviders)return false;
    if(geometryEdit_->tool!="split"&&geometryEdit_->tool!="merge"&&geometryEdit_->tool!="boundary"&&!map::validateEditGeometry(coreSession_.draft().geometry(),&validationDetail)){geometryEdit_->error=validationDetail.empty()?QStringLiteral("닫힌 유효 폴리곤이 필요합니다."):QStringLiteral("닫힌 유효 폴리곤이 필요합니다: %1").arg(QString::fromStdString(validationDetail));emit geometryEditChanged();return false;}
    auto& edit=*geometryEdit_;
    if(edit.createIntent) {
        auto create=*edit.createIntent;create.geometry=coreSession_.draft().geometry();
        auto prepared=prepareCoreRequest(coreTerritorialRequest(create));
        if(!prepared.ok()||!prepared.preview) {
            edit.error=QString::fromStdString(prepared.detail);
            commandError(prepared.error,edit.error);emit geometryEditChanged();return false;
        }
        edit.preview=std::move(prepared.preview);edit.error.clear();emit geometryEditChanged();return true;
    }
    if(edit.content) {
        if(!contentSession_||!contentSession_->base.matches(project_))return false;
        auto command=contentSession_->edit;
        if(auto value=std::get_if<DistributionEntry>(&command.value))value->territory.reset();
        auto prepared=prepareCoreRequest(coreContentRequest(command,&coreSession_.draft().geometry()));
        if(!prepared.ok()||!prepared.preview){edit.error=QString::fromStdString(prepared.detail);emit geometryEditChanged();return false;}
        edit.preview=std::move(prepared.preview);edit.error.clear();emit geometryEditChanged();return true;
    }
    if(
       !edit.createIntent&&!edit.mergeIntent&&!edit.annexIntent&&!edit.splitIntent&&
       !edit.coastIntent&&edit.boundaryOwners.empty()) {
        using V=codecjson::Value;auto payload=V::obj();payload.object["id"]=V::str(edit.target.id);
        payload.object["geometry"]=pandoeditor::projectcodec::webGeometryValue(coreSession_.draft().geometry());
        auto prepared=prepareCoreRequest(readWebTerritorialCommand(project_.snapshot(),"territorial.geometry",payload,coreCodecPorts()));
        if(!prepared.ok()||!prepared.preview) {
            edit.error=QString::fromStdString(prepared.detail);
            if(prepared.status!=CommandStatus::NoOp)commandError(prepared.error,edit.error);
            emit geometryEditChanged();return false;
        }
        edit.preview=std::move(prepared.preview);edit.error.clear();emit geometryEditChanged();return true;
    }
    TerritorialMutationIntent intent=ReplaceGeometryIntent{edit.target};
    if(edit.createIntent) { auto create=*edit.createIntent;create.geometry=coreSession_.draft().geometry();intent=std::move(create); }
    else if(edit.mergeIntent){intent=*edit.mergeIntent;}
    else if(edit.annexIntent){auto annex=*edit.annexIntent;annex.selection=coreSession_.draft().geometry();intent=std::move(annex);}
    else if(edit.splitIntent){intent=*edit.splitIntent;}
    else if(edit.coastIntent){auto coast=*edit.coastIntent;coast.draft=coreSession_.draft().geometry();intent=std::move(coast);}
    const auto schedule=[&](CommandJobRunner::Task task){
        if(edit.job)jobs_->cancel(edit.job->id());
        const auto request=edit.request;
        edit.error.clear();edit.boundaryImpactConfirmation=false;edit.boundaryImpactsApproved=false;
        // Canonical preview currentness is independent of preparation owners.
        // Match the pinned web request-time primary ID value (including empty),
        // so membership-only changes and an away/back round trip remain valid.
        if(edit.tool=="boundary")edit.boundaryPreviewSelectionId=selectedId();
        edit.job=jobs_->submit(edit.base,"territorial:geometry-edit",
            std::move(task),
            [this,request](std::uint64_t id,JobDisposition disposition,PrepareResult result){
                if(!geometryEdit_||!geometryEdit_->job||geometryEdit_->job->id()!=id)return;
                auto& current=*geometryEdit_;current.job.reset();
                if(current.request!=request||disposition!=JobDisposition::Accepted||!current.base.matches(project_)||(current.tool=="boundary"&&(!boundaryGeometryReady()||current.boundaryPreviewSelectionId!=selectedId()))) {
                    current.error=QStringLiteral("초안 또는 문서가 변경되어 계산 결과를 폐기했습니다.");
                } else if(!result.ok()||!result.preview) {
                    current.error=QString::fromStdString(result.detail.empty()?"GEOMETRY_PREPARATION_FAILED":result.detail);
                } else {
                    if(const auto mutation=territorialMutation(result.preview->change().request().args.action))current.platformPlan=mutation->plan;
                    result=prepareCoreTerritorialReceipt(std::move(result));
                    if(!result.ok()||!result.preview) {
                        current.error=QString::fromStdString(result.detail.empty()?"TERRITORIAL_MUTATION_FAILED":result.detail);
                        emit geometryEditChanged();return;
                    }
                    current.preview=std::move(result.preview);current.stage="review";current.error.clear();
                }
                emit geometryEditChanged();
            });
        emit geometryEditChanged();return true;
    };
    if(!edit.boundaryOwners.empty()) {
        const auto drafts=edit.boundarySession->changedDrafts();
        // Preparation stays an immutable view of the canonical source. The
        // detached owner payload alone travels into the preview calculation.
        edit.boundarySession->resetDraft();coreSession_.draft().replaceGeometry(edit.boundarySession->drafts().at(edit.target.id));edit.boundaryNode=-1;
        for(const auto& draft:drafts)if(!map::validateEditGeometry(draft.geometry,&validationDetail)){edit.error=QString::fromStdString(validationDetail);emit geometryEditChanged();return false;}
        return schedule([drafts](const ProjectSnapshot& snapshot,const JobToken& token){
            PrepareResult failed;failed.error=CommandError::PrepareFailed;if(token.cancelled())return failed;
            auto view=CommandProcessor::timelineViewSnapshot(snapshot);
            auto planned=CommandProcessor::planTerritorial(view,SharedBoundaryIntent{drafts});
            if(!planned.ok()||!planned.plan){failed.error=planned.error;failed.detail=planned.detail;return failed;}
            return prepareTerritorialGeometry(view,*planned.plan,token);
        });
    }
    if(edit.mergeIntent||edit.annexIntent||edit.splitIntent||edit.coastIntent) {
        return schedule([intent](const ProjectSnapshot& snapshot,const JobToken& token){
            auto view=CommandProcessor::timelineViewSnapshot(snapshot);
            if(const auto annex=std::get_if<AnnexTerritoryIntent>(&intent))
                return prepareDrawnTerritoryAnnex(view,*annex,token);
            auto planned=CommandProcessor::planTerritorial(view,intent);
            if(!planned.ok()||!planned.plan){PrepareResult failed;failed.error=planned.error;failed.detail=planned.detail;return failed;}
            return prepareTerritorialGeometry(view,*planned.plan,token);
        });
    }
    throw std::invalid_argument("UNKNOWN_GEOMETRY_WORKFLOW");
} catch(const std::exception& error) {if(geometryEdit_){geometryEdit_->error=QString::fromUtf8(error.what());emit geometryEditChanged();}emit errorOccurred("GEOMETRY_PREVIEW_FAILED: "+QString::fromUtf8(error.what()));return false;}


bool EditorController::confirmGeometryEdit()
{
    if(geometryEdit_&&geometryEdit_->territorySelection)return applyTerritorySelection();
    if(geometryEdit_&&geometryEdit_->tool=="boundary") {
        if(!boundaryGeometryReady()||!geometryEdit_->preview)return false;
        if(geometryEdit_->boundaryPreviewSelectionId!=selectedId()) {
            // The initial Apply currentness check discards only this preview;
            // the independently owned prepared boundary remains editable.
            CommandProcessor::cancel(*geometryEdit_->preview);geometryEdit_->preview.reset();
            geometryEdit_->boundaryImpactConfirmation=false;geometryEdit_->boundaryImpactsApproved=false;geometryEdit_->stage="selection";
            geometryEdit_->error=QStringLiteral("선택이 변경되어 미리보기를 폐기했습니다.");emit geometryEditChanged();return false;
        }
        if(!geometryEdit_->boundaryImpactsApproved) {
            const auto& mutation=geometryEdit_->platformPlan;
            if(mutation&&std::any_of(mutation->impacts.begin(),mutation->impacts.end(),[](const auto& impact){return impact.kind=="clip-child"||impact.kind=="remove-child"||impact.kind=="ownership-change";})) {
                geometryEdit_->boundaryImpactConfirmation=true;emit geometryEditChanged();return false;
            }
        }
    }
    if(!geometryEdit_||!geometryEdit_->preview)return false;
    QElapsedTimer commitMeasurement;commitMeasurement.start();const auto measuredFlow=geometryEdit_->tool;
    const QVariant measuredOwners=measuredFlow=="boundary"?QVariant::fromValue(qulonglong(geometryEdit_->boundaryOwners.size())):QVariant{};
    MapProjection next;try{
        const auto& after=geometryEdit_->preview->change().after();
        if(!isStaticTimeline(after)) {
            auto view=timelineDocumentView(after,project_.timelineCursor());
            next.rebuild(view.document,view.inactiveIds);
        } else next.rebuild(after);
    }catch(...){return false;}
    std::optional<ObjectRef> boundarySelectedAfter;
    if(geometryEdit_->tool=="boundary") {
        if(!staticParentRelation(geometryEdit_->base.document(),geometryEdit_->target.id).parentId.empty())boundarySelectedAfter=geometryEdit_->target;
        else if(geometryEdit_->platformPlan)if(const auto boundary=std::get_if<SharedBoundaryIntent>(&geometryEdit_->platformPlan->intent))if(!boundary->drafts.empty())boundarySelectedAfter=boundary->drafts.front().owner;
    }
    auto applied=confirmCorePreview(*geometryEdit_->preview,geometryEdit_->epoch);if(!applied.ok()){commandError(applied.error,QString::fromStdString(applied.detail));geometryEdit_->preview.reset();geometryEdit_->boundaryImpactConfirmation=false;geometryEdit_->boundaryImpactsApproved=false;geometryEdit_->stage="selection";geometryEdit_->error=QString::fromStdString(applied.detail);emit geometryEditChanged();return false;}
    if(project_.timelineEditsEnabled()) {
        auto before=timelineDocumentView(geometryEdit_->base.document(),project_.timelineCursor());
        holdConfirmedGeometry(before.document,applied.impact,geometryEdit_->target);
    } else holdConfirmedGeometry(geometryEdit_->base.document(),applied.impact,geometryEdit_->target);
    noteAppliedImpact(applied.impact);
    projection_=std::move(next);const bool created=bool(geometryEdit_->createIntent);const bool content=geometryEdit_->content;geometryEdit_.reset();coreSession_.clearDraft(true);if(content){contentSession_.reset();emit contentEditChanged();}if(created)createDraft_.reset();coreSession_.selection().setHover({});closeObjectChooser();
    if(boundarySelectedAfter){auto selected=selection_;selected.setMany(selectionRefsFor({*boundarySelectedAfter}),std::nullopt,"map");applySelection(std::move(selected));}
    publish(false);emit geometryChanged();emit structureChanged();emit geometryEditChanged();
    editingPerformance_.record("commit",measuredFlow,double(commitMeasurement.nsecsElapsed())/1e6,"completed",measuredOwners);
    emit renderQualityChanged();return true;
}

void EditorController::holdConfirmedGeometry(const ProjectDocument& before,const ChangeImpact& impact,const ObjectRef& target)
{
    geometryPresentationStrokes_.clear();geometryPresentationInstance_=project_.instanceId();geometryPresentationRevision_=project_.revision();
    const auto& after=project_.viewDocument();
    const auto beforeIndex=validateDocument(before);auto affected=impact.changedObjects;
    if(std::find(affected.begin(),affected.end(),target)==affected.end())affected.push_back(target);
    for(const auto& ref:affected) {
        const auto successor=objectGeometry(after,project_.viewIndex(),ref),previous=objectGeometry(before,beforeIndex,ref);
        if(successor==previous)continue;
        const auto geometry=successor?after.geometries.get(*successor):previous?before.geometries.get(*previous):nullptr;
        if(geometry&&(!geometry->polygons.empty()||!geometry->lines.empty()))geometryPresentationStrokes_.push_back({ref,successor,geometry});
    }
}

void EditorController::cancelGeometryEdit()
{
    // A pending boundary request stops the shared web Worker; a READY or
    // settled error cancellation does not. Rebase is deferred until a request.
    if(geometryEdit_&&geometryEdit_->tool=="boundary"&&geometryEdit_->boundaryStatus=="preparing"&&snapProvider_)
        snapProvider_->notifyWorkerStopped();
    resetGeometrySnap();
    if(!geometryEdit_)return;
    const auto boundaryInitialSelection=geometryEdit_->boundaryInitialSelection;
    std::optional<ObjectRef> boundaryChildPrimary;
    // Child entry has no root selection snapshot. cancelActiveMode reapplies
    // its current selected child as one selection; preview discard does not.
    if(geometryEdit_->tool=="boundary"&&!boundaryInitialSelection)if(const auto primary=primaryObjectRef();primary&&primary->domain=="territorial") {
        const auto found=project_.viewIndex().objects.find(*primary);
        if(found!=project_.viewIndex().objects.end()&&!project_.inactiveEntityIds().count(primary->id)&&project_.viewDocument().units.at(found->second).kind==UnitKind::General&&!staticParentRelation(project_.viewDocument(),primary->id).parentId.empty())boundaryChildPrimary=*primary;
    }
    if(geometryEdit_->boundaryCancelled)geometryEdit_->boundaryCancelled->store(true);if(geometryEdit_->territorySelection)cancelTerritoryCalculation();if(geometryEdit_->job)jobs_->cancel(geometryEdit_->job->id());if(geometryEdit_->preview)CommandProcessor::cancel(*geometryEdit_->preview);geometryEdit_.reset();coreSession_.clearDraft(true);
    // Pinned web snapshots omit each item's key, so restore cannot resolve
    // primaryKey and replaceMany falls back to the last surviving item.
    if(boundaryInitialSelection){auto restored=selection_;restored.setMany(boundaryInitialSelection->items(),std::nullopt,"map");restored.prune([this](const SelectionRef& ref){return project_.index().objects.count(asObjectRef(ref))>0;});applySelection(std::move(restored));}
    else if(boundaryChildPrimary){auto restored=selection_;restored.setMany(selectionRefsFor({*boundaryChildPrimary}),std::nullopt,"map");applySelection(std::move(restored));}
    emit geometryEditChanged();emit contentEditChanged();emit draftsChanged();emit dirtyChanged();
}

bool EditorController::geometryToggleProvider(const QVariantMap& object) {
    if(geometryEdit_&&geometryEdit_->territorySelection) {const auto ref=existingObjectRef(object);return ref&&toggleTerritorySource(*ref);}

    if(!geometryEdit_||geometryEdit_->preview||geometryEdit_->job||!geometryEdit_->choosingProviders||geometryEdit_->stage!="selection"||!geometryEdit_->base.matches(project_))return false;
    const auto ref=existingObjectRef(object);auto& edit=*geometryEdit_;
    if(!ref||ref->domain!="territorial"||*ref==edit.target||objectLocked(project_.document(),project_.index(),*ref))return false;
    const auto& target=project_.document().units.at(project_.index().objects.at(edit.target));
    const auto& provider=project_.document().units.at(project_.index().objects.at(*ref));
    if(target.kind!=provider.kind)return false;
    auto& providers=edit.mergeIntent?edit.mergeIntent->donors:edit.annexIntent->donors;
    const auto found=std::find(providers.begin(),providers.end(),*ref);
    if(found==providers.end())providers.push_back(*ref);else providers.erase(found);
    ++edit.request;edit.error.clear();emit geometryEditChanged();emit visualChanged();return true;
}
bool EditorController::geometryAdvanceStage() {
    if(geometryEdit_&&geometryEdit_->territorySelection)return advanceTerritoryStage();
    if(!geometryEdit_||geometryEdit_->preview||geometryEdit_->job)return false;
    auto& edit=*geometryEdit_;
    if(edit.stage=="setup"){edit.stage="selection";emit geometryEditChanged();return true;}
    if(edit.annexIntent&&edit.choosingProviders&&!edit.annexIntent->donors.empty()) {
        edit.choosingProviders=false;edit.error.clear();emit geometryEditChanged();return true;
    }
    return false;
}
bool EditorController::geometryBack() {
    if(geometryEdit_&&geometryEdit_->territorySelection)return backTerritoryStage();
    if(!geometryEdit_)return false;auto& edit=*geometryEdit_;
    if(edit.job){jobs_->cancel(edit.job->id());edit.job.reset();++edit.request;edit.error.clear();emit geometryEditChanged();return true;}
    if(edit.preview){CommandProcessor::cancel(*edit.preview);edit.preview.reset();edit.boundaryImpactConfirmation=false;edit.boundaryImpactsApproved=false;
        if(edit.tool=="boundary"&&edit.boundarySession){edit.boundarySession->resetDraft();coreSession_.draft().replaceGeometry(edit.boundarySession->drafts().at(edit.target.id));edit.boundaryNode=-1;}
        edit.stage="selection";edit.error.clear();++edit.request;emit geometryEditChanged();return true;}
    if(edit.annexIntent&&!edit.choosingProviders){edit.choosingProviders=true;emit geometryEditChanged();return true;}
    if(edit.tool=="boundary"){cancelGeometryEdit();return true;}
    if(edit.stage=="selection"){edit.stage="setup";edit.error.clear();emit geometryEditChanged();return true;}
    cancelGeometryEdit();return true;
}

QVariantMap EditorController::referenceDraftContext() const {
 if(!geometryEdit_)return {};
 const auto &edit=*geometryEdit_;if(!edit.base.matches(project_))return {};
 if(edit.preview||edit.job||edit.applying||edit.selectionPending||edit.previewPending||coreSession_.draft().dragging()||edit.sourceChange||edit.stage=="setup"||edit.choosingProviders||edit.tool=="boundary"||edit.tool=="move"||edit.tool=="coast")return {};
 if(edit.territorySelection&&(edit.stage!="selection"||edit.territorySelection->state().activePhase!=TerritorySelectionPhase::Drawing||edit.territorySelection->state().methodChangeConfirmation))return {};
 if(coreSession_.draft().selectedPolygon()<0||coreSession_.draft().selectedRing()<0)return {};
 if(!isArea(coreSession_.draft().geometry())&&coreSession_.draft().geometry().type!="LineString"&&coreSession_.draft().geometry().type!="MultiLineString"&&edit.tool!="split")return {};
 return {{"project",projectInstanceId()},{"revision",qulonglong(project_.revision())},{"session",edit.referenceSessionId},{"request",qulonglong(edit.request)}};
}
QVariantList EditorController::referenceDraftCoordinates() const {
 if(referenceDraftContext().isEmpty())return {};const auto &edit=*geometryEdit_;Ring path;
 if(edit.tool=="split"||(edit.territorySelection&&edit.territorySelection->state().activeMethod==TerritorySelectionMethod::Line))path=coreSession_.draft().coordinates();
 else if(isArea(coreSession_.draft().geometry())){if(coreSession_.draft().selectedPolygon()<0||coreSession_.draft().selectedRing()<0||size_t(coreSession_.draft().selectedPolygon())>=coreSession_.draft().geometry().polygons.size()||size_t(coreSession_.draft().selectedRing())>=coreSession_.draft().geometry().polygons[coreSession_.draft().selectedPolygon()].size())return {};path=coreSession_.draft().geometry().polygons[coreSession_.draft().selectedPolygon()][coreSession_.draft().selectedRing()];}
 else if(coreSession_.draft().selectedPolygon()>=0&&size_t(coreSession_.draft().selectedPolygon())<coreSession_.draft().geometry().lines.size())path=coreSession_.draft().geometry().lines[coreSession_.draft().selectedPolygon()];
 QVariantList result;for(const auto p:path){result.append(QVariant(QVariantList{p.x,p.y}));}return result;
}
bool EditorController::replaceReferenceDraft(const QVariantList &coordinates,const QVariantMap &context) {
 if(context.isEmpty()||context!=referenceDraftContext()||coordinates.size()<2)return false;
 Ring path;for(const auto &value:coordinates){const auto pair=value.toList();if(pair.size()!=2)return false;bool a=false,b=false;const double lon=pair[0].toDouble(&a),lat=pair[1].toDouble(&b);if(!a||!b||!std::isfinite(lon)||!std::isfinite(lat)||lon< -180||lon>180||lat< -90||lat>90)return false;path.push_back({lon,lat});}
 auto &edit=*geometryEdit_;
 if(isArea(coreSession_.draft().geometry())&&!coreSession_.draft().geometry().polygons.empty()&&(size_t(coreSession_.draft().selectedPolygon())>=coreSession_.draft().geometry().polygons.size()||size_t(coreSession_.draft().selectedRing())>=coreSession_.draft().geometry().polygons[coreSession_.draft().selectedPolygon()].size()))return false;
 if(!isArea(coreSession_.draft().geometry())&&!coreSession_.draft().geometry().lines.empty()&&size_t(coreSession_.draft().selectedPolygon())>=coreSession_.draft().geometry().lines.size())return false;
 // The reference-image port supplies stored geographic rings. Convert their
 // closing coordinate explicitly to the Core draft's open vertex sequence.
 if(isArea(coreSession_.draft().geometry())&&path.size()>1&&samePoint(path.front(),path.back()))path.pop_back();
 if(!coreSession_.draft().replaceCoordinates(std::move(path),true,-1,{},coreSession_.draft().selectedPolygon(),coreSession_.draft().selectedRing()))return false;
 edit.error.clear();++edit.request;emit geometryEditChanged();return true;
}

bool EditorController::mapKeyboardInputBlocked(QObject *window) const {
 const auto quick=qobject_cast<QQuickWindow*>(window);if(!quick)return true;
 for(auto *focus=quick->activeFocusItem();focus;focus=focus->parentItem())if(focus->property("cursorPosition").isValid()||focus->property("editable").isValid())return true;
 for(const auto *object:window->findChildren<QObject*>())if(object->property("visible").toBool()&&(object->property("modal").toBool()||object->property("modality").toInt()!=int(Qt::NonModal)))return true;
 return false;
}
bool EditorController::geometryNudgeSelectedVertex(double dx,double dy){
 if(!geometryEdit_||!std::isfinite(dx)||!std::isfinite(dy))return false;auto &edit=*geometryEdit_;
 const auto selected=edit.tool=="boundary"?edit.boundaryNode:coreSession_.draft().selectedVertexIndex();
 if(!edit.base.matches(project_)||selected<0||edit.preview||edit.job||edit.applying||edit.selectionPending||edit.previewPending||coreSession_.draft().dragging()||edit.territorySelection||edit.stage=="setup"||edit.choosingProviders||edit.tool=="move")return false;
 Point point;
 if(edit.tool=="boundary"){if(!boundaryGeometryReady()||size_t(selected)>=edit.boundarySession->nodes().size())return false;point=edit.boundarySession->nodes()[selected].coordinate;}
 else if(isArea(coreSession_.draft().geometry())){if(coreSession_.draft().selectedPolygon()<0||coreSession_.draft().selectedRing()<0||size_t(coreSession_.draft().selectedPolygon())>=coreSession_.draft().geometry().polygons.size()||size_t(coreSession_.draft().selectedRing())>=coreSession_.draft().geometry().polygons[coreSession_.draft().selectedPolygon()].size())return false;const auto &ring=coreSession_.draft().geometry().polygons[coreSession_.draft().selectedPolygon()][coreSession_.draft().selectedRing()];if(size_t(coreSession_.draft().selectedVertexIndex())>=ring.size())return false;point=ring[coreSession_.draft().selectedVertexIndex()];}
 else {const auto path=openPath(coreSession_.draft().geometry(),coreSession_.draft().selectedPolygon());if(!path||size_t(coreSession_.draft().selectedVertexIndex())>=path->size())return false;point=(*path)[coreSession_.draft().selectedVertexIndex()];}
 const auto screen=map::editMapToScreen(projection_.project(point),camera_.display());return geometryMoveSelectedVertexScreen(screen.x+dx,screen.y+dy,0);
}
