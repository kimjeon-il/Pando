#include <pandoeditor/geometrydraft.h>
#include <pandoeditor/losslessjson.h>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <vector>

using namespace pandoeditor;
using V=codecjson::Value;
namespace {
void require(bool value,const char* detail){if(!value)throw std::runtime_error(detail);}
V coords(const Ring& points){auto rows=V::arr();for(const auto point:points){auto row=V::arr();row.array={V::num(point.x),V::num(point.y)};rows.array.push_back(std::move(row));}return rows;}
V snapshot(const GeometryDraft& draft){auto value=V::obj();value.object={
    {"coords",coords(draft.coordinates())},{"inputPhase",V::str(draft.inputPhase())},
    {"vertexInsertMode",V::boolean(draft.vertexInsertMode())},{"selectedVertexIndex",draft.selectedVertexIndex()<0?V{}:V::num(draft.selectedVertexIndex())},
    {"dragging",V::boolean(draft.dragging())},{"historyCount",V::num(draft.historyCount())},{"futureCount",V::num(draft.futureCount())},
    {"insertTarget",V{}}};
    if(const auto& target=draft.insertTarget();target){auto point=V::arr();point.array={V::num(target->coordinate.x),V::num(target->coordinate.y)};auto insertion=V::obj();insertion.object={{"segmentIndex",V::num(target->segmentIndex)},{"coordinate",std::move(point)}};value.object["insertTarget"]=std::move(insertion);}return value;
}
void frozenWebContract(){
    std::ifstream input(GEOMETRY_DRAFT_FIXTURE);require(input.good(),"missing frozen actual Web draft fixture");
    const auto fixture=codecjson::parse(std::string(std::istreambuf_iterator<char>(input),{}));require(fixture.array.size()==23,"frozen Web fixture must have23steps");
    GeometryDraft draft;std::size_t step=0;
    auto capture=[&](V result){const auto& expected=fixture.array.at(step++);require(result.encode()==expected.object.at("result").encode(),"draft action result differs from actual Web");const auto actual=snapshot(draft);const auto& expectedDraft=expected.object.at("snapshot").object.at("draft");for(const auto& [key,value]:actual.object)if(value.encode()!=expectedDraft.object.at(key).encode())throw std::runtime_error("actual Web draft mismatch at step"+std::to_string(step)+":"+key);};
    draft.start("polygon",{});draft.clear();capture(V::boolean(true));
    capture(V::boolean(draft.start("polygon",{{0,0},{12,0},{12,8}})));
    capture(V::boolean(draft.beginDrag(1)));capture(V::boolean(draft.finishDrag()));
    capture(V::boolean(draft.undo()));capture(V::boolean(draft.redo()));
    capture(V::boolean(draft.beginDrag(2)));capture(V::boolean(draft.queueDrag({14.125,9.25})));capture(V::boolean(draft.queueDrag({15.125,10.25})));
    capture(V::boolean(draft.finishDrag()));capture(V::boolean(draft.undo()));
    capture(V::boolean(draft.setInsertMode(true)));capture(V::boolean(draft.setInsertTarget(GeometryDraft::InsertTarget{2,{6,4}})));
    capture(V::boolean(draft.insertAt(2,{6,4})));capture(V::boolean(draft.deleteSelected()));
    capture(V::boolean(draft.undo()));capture(V::boolean(draft.redo()));capture(V::boolean(draft.selectVertex(999)));
    require(draft.beginDrag(1),"cancel fixture drag must begin");capture(V::boolean(draft.cancelDrag()));
    draft.clear();capture(V::boolean(true));capture(V::boolean(draft.undo()));
    for(int i=0;i<101;++i)require(draft.replaceCoordinates({{i+.125,0},{i+1.25,1},{i+2.5,3}},true,1,"refine"),"recorded bounded replacement");
    capture(V::num(draft.historyCount()));capture(V::boolean(draft.undo()));require(step==23,"all frozen steps compared");
}
void preciseRevisionAndCancellation(){
    GeometryDraft draft;draft.start("line",{{0,0},{1,1}});require(draft.revision()==0,"start resets draft revision");
    require(draft.beginDrag(1)&&draft.revision()==0,"begin checkpoints without coordinate revision");
    require(draft.moveDrag({1,1})&&draft.revision()==1,"same coordinate drag still revises");
    require(draft.queueDrag({9,10})&&draft.cancelDrag(),"cancel queued drag");require(draft.coordinates()[1].x==1&&draft.historyCount()==1,"cancel discards pending and retains checkpoint");
    require(draft.undo()&&draft.revision()==3,"draft Undo has actual Web helper plus mutation revisions");
    require(draft.redo()&&draft.revision()==5,"draft Redo has actual Web helper plus mutation revisions");
    require(draft.beginDrag(1)&&draft.moveDrag({2.125,3.25})&&draft.cancelDrag(),"cancel an applied move");require(draft.coordinates()[1].x==2.125,"cancel retains applied coordinates");
    require(draft.undo()&&draft.coordinates()[1].x==1,"cancel checkpoint remains undoable");
    draft.start("polygon",{{0,0},{0,0}});require(draft.coordinates().size()==2,"coincident input vertices remain distinct draft values");
    require(draft.replaceCoordinates({{0,0},{1,1},{0,0}})&&draft.coordinates().size()==3,"explicit repeated closing draft vertex is retained");
}
void nativeFullGeometryAndObjectDrag(){
    Geometry shape;shape.type="MultiPolygon";
    shape.polygons.push_back(Polygon{Ring{{0,0},{4,0},{4,4},{0,0}}});
    shape.polygons.push_back(Polygon{Ring{{10,10},{14,10},{14,14},{10,10}}});
    GeometryDraft draft(shape);require(draft.selectVertex(1,1,0),"native second polygon vertex selection");require(draft.moveSelected({15.125,10.25}),"native selected polygon move");
    require(draft.undo()&&draft.selectedPolygon()==1&&draft.selectedVertexIndex()==1,"history restores native path and selected vertex");require(draft.geometry().polygons[1][0][1].x==14,"other polygon snapshot restored");
    require(draft.redo()&&draft.geometry().polygons[1][0][1].x==15.125&&draft.geometry().polygons[0][0][1].x==4,"path Redo leaves untouched island exact");
    require(draft.undo(),"restore path before object gestures");
    const auto count=draft.historyCount();require(draft.beginObjectDrag()&&draft.finishObjectDrag(false)&&draft.historyCount()==count,"unmoved object drag preserves existing history policy");
    require(draft.beginObjectDrag(),"native whole object begin");auto translated=draft.geometry();translated.polygons[0][0][1].x=7;require(draft.applyObjectTranslation(std::move(translated),true),"native translation proposal");require(draft.finishObjectDrag(true)&&draft.geometry().polygons[0][0][1].x==4,"native object cancellation restores origin");
    require(draft.beginObjectDrag(),"native full translation commit begin");translated=draft.geometry();translated.polygons[0][0][1].x=7;translated.polygons[1][0][1].x=17;
    require(draft.applyObjectTranslation(std::move(translated),true)&&draft.finishObjectDrag(false),"native full translation commit");
    require(draft.undo()&&draft.geometry().polygons[0][0][1].x==4&&draft.geometry().polygons[1][0][1].x==14,"whole translation Undo restores both islands");
    require(draft.redo()&&draft.geometry().polygons[0][0][1].x==7&&draft.geometry().polygons[1][0][1].x==17,"whole translation Redo restores both proposals");
    Geometry line;line.type="LineString";line.lines={{{1,2},{3,4}}};require(draft.replaceGeometry(line,true),"recorded full geometry replacement");
    require(draft.undo()&&draft.geometry().type=="MultiPolygon"&&draft.geometry().polygons[1][0][1].x==17,"full replacement Undo restores old type and paths");
    require(draft.redo()&&draft.geometry().type=="LineString"&&draft.coordinates().size()==2,"full replacement Redo restores new geometry type");
    require(draft.replaceGeometry(shape)&&draft.historyCount()==0&&draft.futureCount()==0,"unrecorded full installation starts new local scope");
    draft.start("polygon",{});require(draft.append({1,1})&&draft.undo()&&draft.geometry().polygons[0][0].empty(),"path Undo restores empty ring without unrelated full snapshot");require(draft.redo()&&draft.coordinates().size()==1,"path Redo restores created vertex");
}
void normalSegmentHover(){
    GeometryDraft draft;require(draft.start("line",{{0,0},{4,4}}),"normal hover draft");
    require(!draft.vertexInsertMode(),"ordinary segment hover does not enable insertion mode");
    require(draft.setInsertTarget(GeometryDraft::InsertTarget{0,{2,2}}),"ordinary segment hover accepts a one-click handle");
    require(draft.insertTarget().has_value()&&draft.historyCount()==0&&draft.revision()==0,"hover target is presentation-only");
    require(!draft.setInsertTarget(GeometryDraft::InsertTarget{1,{9,9}}),"invalid segment remains rejected");
    require(draft.insertTarget()->segmentIndex==0,"invalid hover preserves the last valid target");
    require(draft.insertAt(0,{2,2})&&draft.coordinates().size()==3,"ordinary one-click segment insertion");
    require(draft.undo()&&draft.coordinates().size()==2,"ordinary insertion is one draft Undo boundary");
}
}
int main(){try{frozenWebContract();preciseRevisionAndCancellation();nativeFullGeometryAndObjectDrag();normalSegmentHover();std::cout<<"PASS frozen23-step Web draft, revision/cancel, native full geometry and normal segment hover\n";return 0;}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
