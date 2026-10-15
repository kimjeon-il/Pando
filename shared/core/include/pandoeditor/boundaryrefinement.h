#pragma once
#include <pandoeditor/boundarychain.h>
#include <vector>

namespace pandoeditor {
inline constexpr double kDefaultBoundaryEdgeDegrees=0.499;
// The same angular criterion governs C++ native fill-edge subdivision and
// WASM display-boundary refinement. It is not an editable geometry operation.
double boundaryMinimumDot(double requestedDegrees);
// Operates only on already seam-split display edges, in source order. Every
// accepted line is bisected until within the angular threshold, then rounded
// to the shared microdegree mesh grid using JS Math.round tie semantics.
std::vector<BoundaryEdge> refineDisplayBoundarySegments(
    const std::vector<BoundaryEdge>& source,
    double maxEdgeDegrees=kDefaultBoundaryEdgeDegrees);
}
