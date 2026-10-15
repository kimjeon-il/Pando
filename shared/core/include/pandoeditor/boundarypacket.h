#pragma once
#include <pandoeditor/boundarychain.h>
#include <pandoeditor/boundaryrefinement.h>
#include <cstddef>
#include <string>
#include <vector>

namespace pandoeditor {
// P5-5: a display-only result. Geometry sources, editable rings and styles are
// deliberately not part of this contract. Native Qt and Web/WASM link it.
struct SharedStrokeSource {
    BoundaryEdge edge;
    std::vector<std::string> ownerIds;
};
struct SharedStrokeSegment {
    BoundaryEdge edge;
    std::vector<std::string> ownerIds;
    float chainPhase=0;
};
struct SharedStrokeRange {
    std::string ownerKey;
    std::size_t first=0, count=0;
};
struct SharedStrokePacket {
    std::vector<SharedStrokeSegment> segments;
    std::vector<SharedStrokeRange> ownerRanges;
    std::vector<std::string> ownerIds;
};

// Source order is authoritative. Callers that require locale-aware owner-key
// ordering must order their source rows before the call. Within each owner
// group, this kernel preserves junctions, seam splits and continuous dash phase.
SharedStrokePacket assembleSharedStrokePacket(
    const std::vector<SharedStrokeSource>& sources,
    double maxEdgeDegrees=kDefaultBoundaryEdgeDegrees);

// Cheap offline cache integrity gate: exactly one chain edge per input edge.
// Do not refine or allocate the render packet when validating published v1 data.
std::size_t verifySharedStrokeChains(const std::vector<SharedStrokeSource>& sources);
}
