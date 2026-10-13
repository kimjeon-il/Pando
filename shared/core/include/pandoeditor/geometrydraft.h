#pragma once
#include <pandoeditor/geometry-types.h>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace pandoeditor {
// Detached coordinates and local editing history. Projection, snapping, hit
// tests, topology kernels and document history remain outside this owner.
class GeometryDraft {
public:
    struct InsertTarget {int segmentIndex=-1;Point coordinate;};
    explicit GeometryDraft(Geometry geometry={});
    const Geometry& geometry() const noexcept {return geometry_;}
    Ring coordinates() const;
    int selectedPolygon() const noexcept {return polygon_;}
    int selectedRing() const noexcept {return ring_;}
    int selectedVertexIndex() const noexcept {return vertex_;}
    const std::string& inputPhase() const noexcept {return inputPhase_;}
    bool vertexInsertMode() const noexcept {return insertMode_;}
    const std::optional<InsertTarget>& insertTarget() const noexcept {return insertTarget_;}
    bool dragging() const noexcept {return dragKind_!=DragKind::None;}
    std::size_t historyCount() const noexcept {return history_.size();}
    std::size_t futureCount() const noexcept {return future_.size();}
    std::uint64_t revision() const noexcept {return revision_;}
    bool start(const std::string& shape,const Ring& coords,const std::string& phase="draw");
    void clear();
    void resetGeometry(Geometry geometry);
    bool replaceCoordinates(Ring coords,bool record=false,int selected=-1,const std::string& phase={},int polygon=0,int ring=0);
    // Whole replacements start at the first path. Unrecorded installation is
    // a new local history scope; topology sessions keep their own history.
    bool replaceGeometry(Geometry geometry,bool record=false,int selected=-1,const std::string& phase={});
    bool append(Point coordinate);
    bool selectVertex(int index,int polygon=0,int ring=0);
    void clearVertexSelection() noexcept {vertex_=-1;insertTarget_.reset();}
    bool setPhase(const std::string& phase);
    bool setInsertMode(bool enabled);
    bool setInsertTarget(std::optional<InsertTarget> target);
    bool insertAt(int segmentIndex,Point coordinate,int polygon=0,int ring=0);
    bool deleteSelected();
    bool removeLast();
    bool moveSelected(Point coordinate);
    bool undo();
    bool redo();
    // Begin captures the drag-selected index with the PRE-drag input phase.
    // An unmoved/cancelled vertex gesture retains that single checkpoint.
    bool beginDrag(int index,int polygon=0,int ring=0);
    bool queueDrag(Point coordinate);
    bool flushDrag();
    bool moveDrag(Point coordinate);
    bool finishDrag();
    bool cancelDrag();
    // Native full-object translation proposals come from the map engine and
    // use their separate origin/rollback policy, not vertex-draft cancellation.
    bool beginObjectDrag();
    const std::optional<Geometry>& dragOrigin() const noexcept;
    bool applyObjectTranslation(Geometry geometry,bool moved);
    bool finishObjectDrag(bool cancel);
private:
    enum class DragKind {None,Vertex,Object};
    struct Snapshot {
        // Ordinary draft edits retain only the changed path. Whole-object
        // proposals explicitly retain the full value instead.
        std::optional<Geometry> fullGeometry;
        Ring coordinates;
        std::string geometryType;
        int pathPolygon=0,pathRing=0;
        std::size_t pathCount=0,ringCount=0;
        int polygon=0,ring=0,vertex=-1;
        std::string inputPhase="draw";
    };
    Snapshot fullSnapshot() const;
    Snapshot pathSnapshot(int polygon,int ring) const;
    Snapshot inverseSnapshot(const Snapshot&) const;
    void restore(Snapshot snapshot);
    void checkpoint(Snapshot snapshot);
    void mutated();
    Ring coordinates(int polygon,int ring) const;
    bool assignCoordinates(Geometry& geometry,Ring coords,int polygon,int ring) const;
    Geometry geometry_;
    int polygon_=0,ring_=0,vertex_=-1;
    std::string inputPhase_="draw";
    bool insertMode_=false;
    std::optional<InsertTarget> insertTarget_;
    std::vector<Snapshot> history_,future_;
    std::uint64_t revision_=0;
    DragKind dragKind_=DragKind::None;
    std::optional<Point> pendingMove_;
    std::optional<Snapshot> objectBefore_;
    bool objectMoved_=false;
};
}
