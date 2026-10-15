#pragma once
#include <pandoeditor/boundarychain.h>
#include <cstddef>
#include <utility>
#include <vector>

namespace pandoeditor {
// Country edge sources are supplied in existing prepared-feature order.
// Source metadata is used only for exact candidate ordering.
struct CountryContactRow {
    BoundaryEdge edge;
    unsigned polygon=0,ring=0,segment=0;
};
struct CountryContactFeature { std::vector<CountryContactRow> rows; };
struct CountryContactRef {
    std::size_t owner=0,row=0;
    double startT=0,endT=0;
};
struct CountryContactSegment {
    BoundaryEdge edge;
    std::vector<CountryContactRef> refs;
};
struct CountryContactResult {
    // Owner index in the pair (0 or 1), then the source row index.
    std::vector<std::pair<std::size_t,std::size_t>> candidates;
    // Source-seam filtered, shared-only edges, preserving insertion order.
    std::vector<CountryContactSegment> segments;
};
// Geographic broad-phase indexing, contact candidate detection, vertex
// splitting, shared ownership and display-seam filtering are all implemented
// here. The Worker retains only source identity and incremental patch caches.
std::vector<CountryContactResult> buildCountryContactPairs(
    const std::vector<CountryContactFeature>& features,
    const std::vector<std::pair<std::size_t,std::size_t>>& pairs);
}
