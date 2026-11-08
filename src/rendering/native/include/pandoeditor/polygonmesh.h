#pragma once
#include <pandoeditor/boundaryrefinement.h>
#include <pandoeditor/geometry-types.h>
#include <array>
#include <cstdint>
#include <functional>
#include <vector>

namespace pandoeditor {
inline constexpr std::uint32_t kPolygonMeshAlgorithmRevision=5;
using MeshPosition=std::array<double,2>;
using MeshTriangle=std::array<std::uint32_t,3>;
struct MeshParameterSpace {
    int pole=0;
    MeshPosition project(const MeshPosition&) const;
    MeshPosition unproject(const MeshPosition&,double longitudeAnchor) const;
};
struct MeshBoundaryChain {
    std::vector<std::uint32_t> vertices;
    std::vector<std::uint8_t> visible;
};
struct PolygonFillMesh {
    MeshParameterSpace space;
    std::vector<MeshPosition> geographic,parameter;
    std::vector<MeshTriangle> triangles,removedTriangles;
    std::vector<MeshBoundaryChain> boundaryChains;
    // Clean source vertices precede derived refinement vertices. These offsets
    // preserve editable ring identity independently from display subdivision.
    std::vector<std::uint32_t> sourceRingOffsets{0};
};
// Display-only mesh: seam unwrap, polar projection, checked hole triangulation
// and conforming spherical refinement have one owner for Qt and Web/WASM.
// Callers own packed output buffers and flat-view longitude clones.
PolygonFillMesh buildPolygonFillMesh(const Polygon&,
    double maxEdgeDegrees=kDefaultBoundaryEdgeDegrees,bool validate=true,
    const std::function<void()>& checkCancelled={});
}
