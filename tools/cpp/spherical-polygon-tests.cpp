#include <pandoeditor/sphericalpolygon.h>
#include <cassert>
#include <cmath>
#include <stdexcept>
#include <iostream>

using namespace pandoeditor;
namespace {
Geometry polygon(std::initializer_list<Ring> rings) {
    Geometry geometry;
    geometry.type="Polygon";
    geometry.polygons.push_back(Polygon(rings));
    return geometry;
}
void rejected(const Geometry& geometry) {
    bool caught=false;
    try {(void)normalizeSphericalPolygonGeometry(geometry);}
    catch(const std::invalid_argument&) {caught=true;}
    assert(caught);
}
void checkCore() {
    // The raw source is never rewritten. A counterclockwise planar shell
    // represents the wrong D3 spherical interior until normalized.
    const auto original=polygon({{{0,0},{2,0},{2,2},{0,2},{0,0}}});
    assert(!hasCanonicalSphericalWinding(original));
    const auto normalized=normalizeSphericalPolygonGeometry(original);
    assert(hasCanonicalSphericalWinding(normalized));
    assert(original.polygons[0][0][1].x==2);
    assert(normalized.polygons[0][0][0].y==2);

    // A hole must be retained and rewound; a degenerate hole must fail.
    const auto withHole=polygon({
        {{0,0},{0,2},{2,2},{2,0},{0,0}},
        {{0.5,0.5},{0.5,1.5},{1.5,1.5},{1.5,0.5},{0.5,0.5}}
    });
    const auto normalizedHole=normalizeSphericalPolygonGeometry(withHole);
    assert(normalizedHole.polygons[0].size()==2);
    assert(hasCanonicalSphericalWinding(normalizedHole));
    rejected(polygon({
        {{0,0},{0,2},{2,2},{2,0},{0,0}},
        {{1,1},{1,1},{1,1},{1,1}}
    }));

    // Use the spherical interior for seam-crossing and polar shells.
    const auto dateLine=polygon({
        {{179,-2},{179,2},{-179,2},{-179,-2},{179,-2}}
    });
    const auto seam=normalizeSphericalPolygonGeometry(dateLine);
    assert(hasCanonicalSphericalWinding(seam));
    assert(sphericalRingSignedArea(seam.polygons[0][0])>0);
    assert(sphericalRingSignedArea(seam.polygons[0][0])<0.01);
    const auto polar=polygon({
        {{170,80},{90,85},{0,89},{-90,85},{-170,80},{170,80}}
    });
    assert(hasCanonicalSphericalWinding(normalizeSphericalPolygonGeometry(polar)));
    const auto world=polygon({
        {{-180,-90},{-180,90},{180,90},{180,-90},{-180,-90}}
    });
    assert(hasCanonicalSphericalWinding(world));

    // Unbounded planar clipping edges are split into at most 180-degree
    // intervals, without deleting islands, shells, or holes.
    const auto longEdge=polygon({
        {{-170,-2},{-170,2},{170,2},{170,-2},{-170,-2}}
    });
    const auto sliced=normalizeClippedSphericalPolygonGeometry(longEdge);
    assert(sliced.polygons[0][0].size()>longEdge.polygons[0][0].size());
    for(std::size_t i=1;i<sliced.polygons[0][0].size();++i)
        assert(std::abs(sliced.polygons[0][0][i].x-sliced.polygons[0][0][i-1].x)<=180);

    // Invalid ring structure is observable instead of being silently dropped.
    rejected(polygon({{{0,0},{1,1},{0,0}}}));
    rejected(polygon({
        {{0,0},{0,2},{2,2},{2,0},{0,0}},
        {{-180,-90},{-180,90},{180,90},{180,-90},{-180,-90}}
    }));
}
}
int main() {
    checkCore();
    std::cout<<"Shared C++ spherical polygon tests passed\n";
}
