#pragma once
#include <pandoeditor/presentation.h>
#include <pandoeditor/temporal.h>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

namespace pandoeditor {
struct Geometry;
bool sameGeometryValue(const Geometry&,const Geometry&);
using Ring = std::vector<Point>;
using Polygon = std::vector<Ring>;
using MultiPolygon = std::vector<Polygon>;
struct GeometryRef {
    std::string id;
    std::uint32_t version=1;
    bool operator<(const GeometryRef& b) const { return std::tie(id,version)<std::tie(b.id,b.version); }
    bool operator==(const GeometryRef& b) const { return id==b.id && version==b.version; }
};
struct Geometry {
    std::string type="MultiPolygon";
    std::vector<Point> points;
    std::vector<Ring> lines;
    MultiPolygon polygons;
};
struct GeometryResource {
    std::string type,contentSha256;
    std::uint64_t decodedBytes=0;
};
struct GeometryUnavailable : std::runtime_error {
    const std::vector<GeometryRef> refs;
    explicit GeometryUnavailable(std::vector<GeometryRef> missing)
        :std::runtime_error("GEOMETRY_UNLOADED: required immutable resources are not ready"),refs(std::move(missing)){}
};
class GeometryStore {
public:
    void declareResource(GeometryRef,GeometryResource);
    bool contains(const GeometryRef&) const;
    std::string type(const GeometryRef&) const;
    const auto& resources() const {return resources_;}
    void requireReady(const std::vector<GeometryRef>&) const;
    void insert(GeometryRef ref, Geometry geometry);
    void retain(GeometryRef,std::shared_ptr<const Geometry>);
    void retainFrom(const GeometryStore& validatedSource,const GeometryRef& sourceRef,GeometryRef destinationRef);
    std::shared_ptr<const Geometry> get(const GeometryRef& ref) const;
    const auto& versions() const { return versions_; }
private:
    std::map<GeometryRef,GeometryResource> resources_;
    std::map<GeometryRef,std::shared_ptr<const Geometry>> versions_;
};
struct Validity { std::optional<std::string> from, to; };
std::pair<std::int64_t,std::int64_t> temporalBounds(const Validity& validity);
}
