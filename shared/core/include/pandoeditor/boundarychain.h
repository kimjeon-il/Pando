#pragma once
#include <pandoeditor/geometry-types.h>
#include <utility>
#include <vector>

namespace pandoeditor {
// P5-5. The ordered edge list is the source contract for shared-country
// border dash continuity. It is independent of paint styles and project state.
using BoundaryEdge = std::pair<Point,Point>;
using BoundaryChain = std::vector<Point>;
// Walk from junctions/open ends first; closed loops second. Keep source edge
// order, input coordinates and their direction when possible. Never write back.
std::vector<BoundaryChain> connectBoundaryChains(const std::vector<BoundaryEdge>& edges);
}
