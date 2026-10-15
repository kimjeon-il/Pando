#pragma once
#include <pandoeditor/boundarychain.h>
#include <cstddef>
#include <vector>

namespace pandoeditor {
// Ordered geographic broad phase + exact epsilon projection for topology
// construction. Node indices refer to the caller's insertion-ordered,
// topology-key-deduplicated coordinate array.
struct BoundarySplitCandidate {
    std::size_t nodeIndex=0;
    double t=0;
};
std::vector<std::vector<BoundarySplitCandidate>> boundarySplitCandidates(
    const std::vector<BoundaryEdge>& edges,const std::vector<Point>& uniqueNodes,
    double epsilon=1e-7);
}
