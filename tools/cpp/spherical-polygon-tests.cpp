#include <pandoeditor/sphericalpolygon.h>
#include <pandoeditor/exactplanar.h>
#include "../../tests/native/geometry/fixtures/clipped-positive-rings.h"
#include <limits>
#include <set>
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
void checkExactClipped() {
    // Predicate sign must not underflow, overflow, or depend on long double.
    exactplanar::ProductSum tiny;tiny.add(std::numeric_limits<double>::denorm_min(),std::numeric_limits<double>::denorm_min());
    assert(tiny.sign()==1);
    tiny.add(std::numeric_limits<double>::denorm_min(),std::numeric_limits<double>::denorm_min(),-1);
    assert(tiny.sign()==0);
    const double huge=std::numeric_limits<double>::max()/2;
    assert(exactplanar::orientation({0,0},{huge,0},{0,huge})==1);
    const auto vertices=[](const Ring& ring) {
        std::multiset<std::pair<double,double>> points;
        for(std::size_t i=0;i+1<ring.size();++i)points.insert({ring[i].x,ring[i].y});
        return points;
    };
    for(const auto& ring:allClippedPositiveRings()) {
        const auto source=polygon({ring});
        const auto snapshot=vertices(ring);
        assert(exactplanar::areaSign(ring)>0);
        assert(!exactplanar::ringIssue(ring));
        rejected(source); // The separate source admission contract is unchanged.
        const auto normalized=normalizeClippedSphericalPolygonGeometry(source);
        assert(vertices(normalized.polygons[0][0])==snapshot);
        assert(normalized.polygons[0][0].size()==ring.size());
        assert(hasCanonicalSphericalWinding(normalized,true));
        // Winding inspection is not source admission: normalization has its own strict gate.
        rejected(normalized);
        const auto again=normalizeClippedSphericalPolygonGeometry(normalized);
        for(std::size_t i=0;i<ring.size();++i)
            assert(exactplanar::equal(again.polygons[0][0][i],normalized.polygons[0][0][i]));
        assert(vertices(source.polygons[0][0])==snapshot);
    }
    for(const auto& ring:std::vector<Ring>{
        {{0,0},{1,1},{2,2},{0,0}},
        {{0,0},{2,2},{0,2},{2,0},{0,0}},
        {{0,0},{3,2},{0,2},{2,0},{0,0}},
        {{0,0},{2,0},{1,0},{1,1},{0,0}}
    }) {
        bool caught=false;
        try {(void)normalizeClippedSphericalPolygonGeometry(polygon({ring}));}
        catch(const std::invalid_argument&){caught=true;}
        assert(caught);
    }
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
    assert(hasCanonicalSphericalWinding(sliced));
    assert(sliced.polygons[0][0].size()>longEdge.polygons[0][0].size());
    for(std::size_t i=1;i<sliced.polygons[0][0].size();++i)
        assert(std::abs(sliced.polygons[0][0][i].x-sliced.polygons[0][0][i-1].x)<=180);
    const auto slicedHole=normalizeClippedSphericalPolygonGeometry(polygon({
        {{-175,-10},{-175,10},{175,10},{175,-10},{-175,-10}},
        {{-165,-5},{165,-5},{165,5},{-165,5},{-165,-5}}
    }));
    assert(slicedHole.polygons[0].size()==2);
    assert(hasCanonicalSphericalWinding(slicedHole));
    assert(hasCanonicalSphericalWinding(normalizeClippedSphericalPolygonGeometry(world)));

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
    checkExactClipped();
    std::cout<<"Shared C++ spherical polygon tests passed\n";
}
