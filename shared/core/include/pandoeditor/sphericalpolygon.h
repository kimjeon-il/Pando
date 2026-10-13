#pragma once
#include <pandoeditor/geometry-types.h>

namespace pandoeditor {
// D3's spherical fill convention: outer shells enclose less than a hemisphere,
// holes enclose the complementary area. These routines do not perform planar
// topology repair, remove islands/holes, or mutate their input.
double sphericalRingSignedArea(const Ring& ring);
Ring normalizeSphericalRing(const Ring& ring, bool shell);
void requireCanonicalSphericalWinding(const Geometry& geometry);
bool hasCanonicalSphericalWinding(const Geometry& geometry) noexcept;
Geometry normalizeSphericalPolygonGeometry(const Geometry& geometry);
Geometry normalizeClippedSphericalPolygonGeometry(const Geometry& geometry);
} // namespace pandoeditor
