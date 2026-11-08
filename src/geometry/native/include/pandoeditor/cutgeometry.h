#pragma once
#include <pandoeditor/geometryoperations.h>
#include <pandoeditor/losslessjson.h>
#include <memory>
namespace pandoeditor {
// Prepared source owns immutable rings and boundary indexes. Requests only
// replace the draft/view; callers replace this object on a geometry revision.
class PreparedCutGeometry {
public:
    explicit PreparedCutGeometry(const Geometry&);
    ~PreparedCutGeometry();
    PreparedCutGeometry(PreparedCutGeometry&&) noexcept;
    PreparedCutGeometry& operator=(PreparedCutGeometry&&) noexcept;
    codecjson::Value prepare(const codecjson::Value& request,const GeometryCancellation& = {}) const;
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
Geometry wrapClippedPolygonGeometry(const Geometry&,const GeometryCancellation& = {});
codecjson::Value cutSegmentIntersection(Point,Point,Point,Point,double epsilon=1e-10);
}
