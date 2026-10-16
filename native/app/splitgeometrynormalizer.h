#pragma once
#include <pandoeditor/geometryoperations.h>
namespace pandoeditor {
struct SplitGeometryNormalizationResult {
    GeometryOperationStatus status=GeometryOperationStatus::Failed;
    Geometry geometry;
    std::string detail;
    bool inputUnchanged=false;
    bool succeeded() const noexcept {
        return status==GeometryOperationStatus::Completed || status==GeometryOperationStatus::Empty;
    }
};
// Source coordinates and component order are retained. Raw cut-worker input
// must not be prewrapped through this API. Empty is a successful calculation.
SplitGeometryNormalizationResult wrapSplitGeometry(const Geometry& geometry,
    const GeometryCancellation& cancelled={});
// Ordinary entity-store normalization: keep raw geographic edges unsegmented.
SplitGeometryNormalizationResult normalizeSplitRawGeometry(const Geometry& geometry,
    const GeometryCancellation& cancelled={});
SplitGeometryNormalizationResult normalizeSplitClippedGeometry(const Geometry& geometry,
    const GeometryCancellation& cancelled={});
}
