#pragma once
#include <pandoeditor/geometryoperations.h>

namespace pandoeditor {
// Ordered operands, in longitude/latitude or projected coordinates. No input
// normalization or geographic validation is implicit in this planar kernel.
// The caller owns geographic admission and empty-result object lifetime.
enum class PolygonOperation { Union, Difference, Intersection, Xor };
MultiPolygon clipPolygons(PolygonOperation, const std::vector<MultiPolygon>&,
    const GeometryCancellation& cancelled = {}, bool precisionRetry = false);
struct PolygonCalculationCancelled {};
}
