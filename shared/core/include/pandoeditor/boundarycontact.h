#pragma once
#include <pandoeditor/boundarychain.h>
#include <vector>

namespace pandoeditor {
// The source edge retains original traversal direction, while interiorSide
// already reflects spherical polygon winding. Display seams are not inputs.
struct BoundaryInteriorRef {
    BoundaryEdge source;
    double interiorSide=0;
};
// Shared country edges are internal only when owner interiors oppose one another.
bool boundaryOpposingInteriors(const BoundaryEdge& displayed,
                              const std::vector<BoundaryInteriorRef>& ownerRefs);
}
