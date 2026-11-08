#pragma once
#include <pandoeditor/boundarychain.h>
#include <vector>

namespace pandoeditor {
// Source-coordinates only; broad-phase spatial indexing remains owned by
// the Worker. All candidate edges must already intersect its padded box.
struct BoundaryOverlapRequest {
    BoundaryEdge source;
    std::vector<BoundaryEdge> candidates;
};
// Subtract collinear covered intervals from each source outline, preserving
// source/candidate ordering, original end coordinates, and partial remainders.
// Called through the same shared core library in native Qt and WebAssembly.
std::vector<std::vector<BoundaryEdge>> subtractBoundaryOverlaps(
    const std::vector<BoundaryOverlapRequest>& requests);
}
