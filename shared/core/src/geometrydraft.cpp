#include <pandoeditor/geometrydraft.h>
#include <algorithm>
#include <stdexcept>
#include <utility>

namespace pandoeditor {
namespace {
bool area(const Geometry& value){return value.type=="Polygon"||value.type=="MultiPolygon";}
bool same(Point a,Point b){return a.x==b.x&&a.y==b.y;}
std::string phase(const std::string& value){return value=="refine"?"refine":"draw";}
}
GeometryDraft::GeometryDraft(Geometry geometry):geometry_(std::move(geometry)){}
Ring GeometryDraft::coordinates(int polygon,int ring) const {
    Ring result;
    if(geometry_.type=="Point"||geometry_.type=="MultiPoint")result=geometry_.points;
    else if(area(geometry_)){if(polygon<0||ring<0||std::size_t(polygon)>=geometry_.polygons.size()||std::size_t(ring)>=geometry_.polygons[polygon].size())return {};result=geometry_.polygons[polygon][ring];}
    else {if(polygon<0||std::size_t(polygon)>=geometry_.lines.size())return {};result=geometry_.lines[polygon];}
    if(area(geometry_)&&result.size()>1&&same(result.front(),result.back()))result.pop_back();
    return result;
}
Ring GeometryDraft::coordinates() const{return coordinates(polygon_,ring_);}
bool GeometryDraft::assignCoordinates(Geometry& geometry,Ring coords,int polygon,int ring) const {
    if(polygon<0||ring<0)return false;
    if(geometry.type=="Point"||geometry.type=="MultiPoint"){geometry.points=std::move(coords);return true;}
    if(area(geometry)){
        if(geometry.polygons.size()<=std::size_t(polygon))geometry.polygons.resize(std::size_t(polygon)+1);
        if(geometry.polygons[polygon].size()<=std::size_t(ring))geometry.polygons[polygon].resize(std::size_t(ring)+1);
        // The storage shape remains a closed geographic ring; the draft API
        // exposes its editable vertices once, including the closing segment.
        if(!coords.empty())coords.push_back(coords.front());
        geometry.polygons[polygon][ring]=std::move(coords);return true;
    }
    if(geometry.lines.size()<=std::size_t(polygon))geometry.lines.resize(std::size_t(polygon)+1);
    geometry.lines[polygon]=std::move(coords);return true;
}
GeometryDraft::Snapshot GeometryDraft::fullSnapshot() const {
    Snapshot value;value.fullGeometry=geometry_;value.polygon=polygon_;value.ring=ring_;value.vertex=vertex_;value.inputPhase=inputPhase_;return value;
}
GeometryDraft::Snapshot GeometryDraft::pathSnapshot(int polygon,int ring) const {
    Snapshot value;value.geometryType=geometry_.type;value.pathPolygon=polygon;value.pathRing=ring;
    value.polygon=polygon_;value.ring=ring_;value.vertex=vertex_;value.inputPhase=inputPhase_;
    if(geometry_.type=="Point"||geometry_.type=="MultiPoint")value.coordinates=geometry_.points;
    else if(area(geometry_)){
        value.pathCount=geometry_.polygons.size();
        if(polygon>=0&&std::size_t(polygon)<value.pathCount){value.ringCount=geometry_.polygons[polygon].size();if(ring>=0&&std::size_t(ring)<value.ringCount)value.coordinates=geometry_.polygons[polygon][ring];}
    } else {value.pathCount=geometry_.lines.size();if(polygon>=0&&std::size_t(polygon)<value.pathCount)value.coordinates=geometry_.lines[polygon];}
    return value;
}
GeometryDraft::Snapshot GeometryDraft::inverseSnapshot(const Snapshot& value) const{return value.fullGeometry?fullSnapshot():pathSnapshot(value.pathPolygon,value.pathRing);}
void GeometryDraft::restore(Snapshot value){
    if(value.fullGeometry)geometry_=std::move(*value.fullGeometry);
    else {
        if(value.geometryType!=geometry_.type)throw std::logic_error("DRAFT_HISTORY: geometry type changed outside recorded edit");
        if(geometry_.type=="Point"||geometry_.type=="MultiPoint")geometry_.points=std::move(value.coordinates);
        else if(area(geometry_)){
            geometry_.polygons.resize(value.pathCount);
            if(value.pathPolygon>=0&&std::size_t(value.pathPolygon)<value.pathCount){auto& polygon=geometry_.polygons[value.pathPolygon];polygon.resize(value.ringCount);if(value.pathRing>=0&&std::size_t(value.pathRing)<value.ringCount)polygon[value.pathRing]=std::move(value.coordinates);}
        } else {geometry_.lines.resize(value.pathCount);if(value.pathPolygon>=0&&std::size_t(value.pathPolygon)<value.pathCount)geometry_.lines[value.pathPolygon]=std::move(value.coordinates);}
    }
    polygon_=value.polygon;ring_=value.ring;vertex_=value.vertex;inputPhase_=std::move(value.inputPhase);
}
void GeometryDraft::checkpoint(Snapshot value){history_.push_back(std::move(value));if(history_.size()>100)history_.erase(history_.begin());future_.clear();}
void GeometryDraft::mutated(){++revision_;if(coordinates().size()<2)insertMode_=false;insertTarget_.reset();}
bool GeometryDraft::start(const std::string& shape,const Ring& coords,const std::string& input){
    if(shape!="line"&&shape!="polygon")return false;
    geometry_={shape=="polygon"?"Polygon":"LineString",{},{},{}};polygon_=ring_=0;vertex_=-1;
    assignCoordinates(geometry_,coords,0,0);inputPhase_=phase(input);insertMode_=false;insertTarget_.reset();history_.clear();future_.clear();revision_=0;dragKind_=DragKind::None;pendingMove_.reset();objectBefore_.reset();objectMoved_=false;return true;
}
void GeometryDraft::resetGeometry(Geometry value){const auto nextRevision=revision_+1;*this=GeometryDraft(std::move(value));revision_=nextRevision;}
void GeometryDraft::clear(){resetGeometry(Geometry{geometry_.type,{},{},{}});}
bool GeometryDraft::replaceCoordinates(Ring coords,bool record,int selected,const std::string& input,int polygon,int ring){
    if(polygon<0||ring<0)return false;
    if(record)checkpoint(pathSnapshot(polygon,ring));
    assignCoordinates(geometry_,std::move(coords),polygon,ring);polygon_=polygon;ring_=ring;
    if(!input.empty())inputPhase_=phase(input);const auto count=coordinates().size();vertex_=selected>=0&&std::size_t(selected)<count?selected:-1;mutated();return true;
}
bool GeometryDraft::replaceGeometry(Geometry value,bool record,int selected,const std::string& input){
    if(record)checkpoint(fullSnapshot());else {history_.clear();future_.clear();}
    geometry_=std::move(value);polygon_=ring_=0;if(!input.empty())inputPhase_=phase(input);const auto count=coordinates().size();vertex_=selected>=0&&std::size_t(selected)<count?selected:-1;mutated();return true;
}
bool GeometryDraft::append(Point point){if(insertMode_)return false;auto coords=coordinates(0,0);if(geometry_.type=="Point")coords={point};else coords.push_back(point);const auto selected=int(coords.size())-1;return replaceCoordinates(std::move(coords),true,selected,"draw");}
bool GeometryDraft::selectVertex(int index,int polygon,int ring){
    const auto count=coordinates(polygon,ring).size();if(index<0||std::size_t(index)>=count)return false;
    if(vertex_==index&&polygon_==polygon&&ring_==ring&&inputPhase_=="refine"&&!insertTarget_)return false;
    polygon_=polygon;ring_=ring;vertex_=index;inputPhase_="refine";insertTarget_.reset();return true;
}
bool GeometryDraft::setPhase(const std::string& input){const auto next=phase(input);if(next==inputPhase_)return false;inputPhase_=next;return true;}
bool GeometryDraft::setInsertMode(bool enabled){if(enabled&&(dragging()||coordinates().size()<2))return false;if(insertMode_==enabled)return false;insertMode_=enabled;insertTarget_.reset();if(enabled)inputPhase_="refine";return true;}
bool GeometryDraft::setInsertTarget(std::optional<InsertTarget> target){if(target){const auto count=int(coordinates().size());const auto segments=area(geometry_)&&count>=3?count:std::max(0,count-1);if(target->segmentIndex<0||target->segmentIndex>=segments)return false;}insertTarget_=std::move(target);return true;}
bool GeometryDraft::insertAt(int segment,Point point,int polygon,int ring){
    auto coords=coordinates(polygon,ring);const auto count=int(coords.size());const auto segments=area(geometry_)&&count>=3?count:std::max(0,count-1);if(segment<0||segment>=segments)return false;
    const auto index=area(geometry_)&&segment==count-1?count:segment+1;coords.insert(coords.begin()+index,point);return replaceCoordinates(std::move(coords),true,index,"refine",polygon,ring);
}
bool GeometryDraft::deleteSelected(){auto coords=coordinates();if(vertex_<0||std::size_t(vertex_)>=coords.size())return false;const auto index=vertex_;coords.erase(coords.begin()+index);const auto selected=coords.empty()?-1:std::min(std::max(0,index-1),int(coords.size())-1);return replaceCoordinates(std::move(coords),true,selected,"refine",polygon_,ring_);}
bool GeometryDraft::removeLast(){auto coords=coordinates();if(coords.empty())return false;coords.pop_back();const auto selected=vertex_>=0&&std::size_t(vertex_)<coords.size()?vertex_:coords.empty()?-1:int(coords.size())-1;return replaceCoordinates(std::move(coords),true,selected,{},polygon_,ring_);}
bool GeometryDraft::moveSelected(Point point){auto coords=coordinates();if(vertex_<0||std::size_t(vertex_)>=coords.size())return false;coords[vertex_]=point;return replaceCoordinates(std::move(coords),dragKind_!=DragKind::Vertex,vertex_,"refine",polygon_,ring_);}
bool GeometryDraft::undo(){if(history_.empty())return false;future_.push_back(inverseSnapshot(history_.back()));restore(std::move(history_.back()));history_.pop_back();++revision_;mutated();return true;}
bool GeometryDraft::redo(){if(future_.empty())return false;history_.push_back(inverseSnapshot(future_.back()));restore(std::move(future_.back()));future_.pop_back();++revision_;mutated();return true;}
bool GeometryDraft::beginDrag(int index,int polygon,int ring){
    if(dragging()||index<0||std::size_t(index)>=coordinates(polygon,ring).size())return false;
    // A native path change is part of the checkpoint identity. The selected
    // drag index replaces the previous index before the phase changes.
    polygon_=polygon;ring_=ring;auto before=pathSnapshot(polygon,ring);before.vertex=index;checkpoint(std::move(before));vertex_=index;inputPhase_="refine";insertTarget_.reset();pendingMove_.reset();dragKind_=DragKind::Vertex;return true;
}
bool GeometryDraft::queueDrag(Point point){if(dragKind_!=DragKind::Vertex)return false;pendingMove_=point;return true;}
bool GeometryDraft::flushDrag(){if(dragKind_!=DragKind::Vertex||!pendingMove_)return false;const auto point=*pendingMove_;pendingMove_.reset();return moveDrag(point);}
bool GeometryDraft::moveDrag(Point point){if(dragKind_!=DragKind::Vertex)return false;return moveSelected(point);}
bool GeometryDraft::finishDrag(){if(dragKind_!=DragKind::Vertex)return false;flushDrag();dragKind_=DragKind::None;return true;}
bool GeometryDraft::cancelDrag(){if(dragKind_!=DragKind::Vertex)return false;pendingMove_.reset();dragKind_=DragKind::None;return true;}
bool GeometryDraft::beginObjectDrag(){if(dragging())return false;objectBefore_=fullSnapshot();objectMoved_=false;dragKind_=DragKind::Object;return true;}
const std::optional<Geometry>& GeometryDraft::dragOrigin() const noexcept {static const std::optional<Geometry> empty;return objectBefore_?objectBefore_->fullGeometry:empty;}
bool GeometryDraft::applyObjectTranslation(Geometry value,bool moved){if(dragKind_!=DragKind::Object)return false;geometry_=std::move(value);objectMoved_=moved;mutated();return true;}
bool GeometryDraft::finishObjectDrag(bool cancel){
    if(dragKind_!=DragKind::Object)return false;
    if(cancel){restore(std::move(*objectBefore_));mutated();}
    else if(objectMoved_){history_.push_back(std::move(*objectBefore_));if(history_.size()>100)history_.erase(history_.begin());future_.clear();}
    objectBefore_.reset();objectMoved_=false;dragKind_=DragKind::None;return true;
}
}
