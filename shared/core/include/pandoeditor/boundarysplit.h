#pragma once
#include <pandoeditor/boundarychain.h>
#include <array>
#include <cstddef>
#include <vector>

namespace pandoeditor {
// One longitude frame for geographic broad phase and exact segment projection.
// Longitudes may use any equivalent 360-degree turn; edges follow the shortest
// connected longitude interval, preserving their original direction and t.
double boundaryLongitudeNear(double longitude,double anchor);
BoundaryEdge connectedBoundaryEdge(BoundaryEdge edge);
std::vector<std::pair<double,double>> boundaryLongitudeRanges(double west,double east);
using BoundaryBox=std::array<double,4>;
std::vector<BoundaryBox> boundaryEdgeBoxes(BoundaryEdge edge);
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
