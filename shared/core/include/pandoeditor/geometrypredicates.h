#pragma once
#include <pandoeditor/document.h>
#include <array>

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
using GisComponentBounds = std::array<double,4>;
struct GisOverlapCandidate {
    std::size_t leftIndex, rightIndex;
    std::vector<std::pair<std::size_t,std::size_t>> componentPairs;
};
class GisOverlapCandidateIterator {
public:
    GisOverlapCandidateIterator(std::vector<std::vector<GisComponentBounds>> bounds,
        std::vector<bool> affected, bool scoped);
    std::optional<GisOverlapCandidate> next();
    bool isSignificant(double area) const noexcept { return !(area<=1e-8); }
private:
    std::vector<std::vector<GisComponentBounds>> bounds_;
    std::vector<bool> affected_;
    std::vector<std::size_t> affectedIndexes_;
    bool scoped_;
    std::size_t left_=0,right_=1;
};
}
