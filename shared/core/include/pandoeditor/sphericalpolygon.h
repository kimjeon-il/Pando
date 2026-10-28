#pragma once
#include <pandoeditor/geometry-types.h>
#include <pandoeditor/geometryoperations.h>
#include <optional>

namespace pandoeditor {
// D3's spherical fill convention: outer shells enclose less than a hemisphere,
// holes enclose the complementary area. These routines do not perform planar
// topology repair, remove islands/holes, or mutate their input.
double sphericalRingSignedArea(const Ring& ring);
// D3 spherical fill area, including complements and compensated polygon sum.
double sphericalPolygonArea(const Geometry&,const GeometryCancellation& cancelled={});
// Display metrics retain the editor's existing integral and mean Earth radius;
// they are distinct from the D3 spherical fill calculation above.
struct DisplayMetricRing { Ring points; bool closed=false; };
double displayGeometryAreaKm2(const std::vector<std::vector<DisplayMetricRing>>& polygons);
double displayLineDistanceKm(const std::vector<std::optional<Point>>& points);
Ring normalizeSphericalRing(const Ring& ring, bool shell);
void requireCanonicalSphericalWinding(const Geometry& geometry);
bool hasCanonicalSphericalWinding(const Geometry& geometry) noexcept;
Geometry normalizeSphericalPolygonGeometry(const Geometry& geometry);
Geometry normalizeClippedSphericalPolygonGeometry(const Geometry& geometry);
} // namespace pandoeditor
