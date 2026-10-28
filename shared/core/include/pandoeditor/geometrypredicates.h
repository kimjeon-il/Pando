#pragma once
#include <pandoeditor/document.h>

namespace pandoeditor {
double planarArea(const Geometry& geometry) noexcept;
bool significantArea(double area, double referenceArea) noexcept;
bool geometryContains(const Geometry& container, const Geometry& subject);
bool geometrySignificantOverlap(const Geometry& left, const Geometry& right);

struct TerritorialRingIssue {
    std::string kind;
    Point coordinate{};
    // Original coordinate index is retained so the web boundary can return
    // the original coordinate, including any additional dimensions.
    std::optional<std::size_t> coordinateIndex, vertexIndex, segmentIndex;
};
std::vector<TerritorialRingIssue> validateTerritorialRing(const Ring& ring);
// Sum each polygon's nonnegative shell-minus-holes area without closing rings.
double territorialValidationArea(const MultiPolygon& polygons) noexcept;
bool validateGisGeometry(const MultiPolygon& polygons);
double gisValidationArea(const MultiPolygon& polygons) noexcept;
}
