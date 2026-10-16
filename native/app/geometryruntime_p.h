#pragma once
#include <pandoeditor/geometryoperations.h>
namespace pandoeditor {
// River-worker intermediate only. This value is never a canonical replacement:
// the caller must normalize and strictly validate before constructing a receipt.
struct RiverGeometryIntermediateResult {
    GeometryOperationStatus status=GeometryOperationStatus::Failed;
    Geometry geometry;
    std::string detail;
    bool succeeded() const noexcept {
        return status==GeometryOperationStatus::Completed||status==GeometryOperationStatus::Empty;
    }
};
RiverGeometryIntermediateResult calculateRiverGeometryIntermediate(
    const GeometryOperationRequest&,const GeometryCancellation& cancelled={});
}
