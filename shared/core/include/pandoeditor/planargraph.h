#pragma once
#include <pandoeditor/geometry-types.h>
#include <cstddef>
#include <vector>
namespace pandoeditor {
struct PlanarGraphEdge {std::size_t id,a,b;};
struct PlanarGraphFace {Ring ring;std::vector<std::size_t> edgeIds;double area=0;};
// Nodes and edges must already be noded. Traversal preserves source edge ids.
std::vector<PlanarGraphFace> tracePlanarGraphFaces(const Ring& nodes,const std::vector<PlanarGraphEdge>& edges);
}
