#pragma once
#include <pandoeditor/geometry-types.h>
#include <pandoeditor/geometryoperations.h>

namespace pandoeditor {
// D3's spherical fill convention: outer shells enclose less than a hemisphere,
// holes enclose the complementary area. These routines do not perform planar
// topology repair, remove islands/holes, or mutate their input.
double sphericalRingSignedArea(const Ring& ring);
// D3 spherical fill area, including complements and compensated polygon sum.
double sphericalPolygonArea(const Geometry&,const GeometryCancellation& cancelled={});
Ring normalizeSphericalRing(const Ring& ring, bool shell);
void requireCanonicalSphericalWinding(const Geometry& geometry);
bool hasCanonicalSphericalWinding(const Geometry& geometry) noexcept;
Geometry normalizeSphericalPolygonGeometry(const Geometry& geometry);
Geometry normalizeClippedSphericalPolygonGeometry(const Geometry& geometry);
} // namespace pandoeditor
