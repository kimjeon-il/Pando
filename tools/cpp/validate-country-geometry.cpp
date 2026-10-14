// Canonical and preview territorial geometry validator.
// Uses the D3 spherical winding contract and GEOS topology checks.
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/sphericalpolygon.h>
#include <geos_c.h>
#include <zlib.h>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using V = pandoeditor::codecjson::Value;
namespace fs = std::filesystem;

namespace {
const V& field(const V& value, const std::string& name) {
    if(value.kind!=V::Object)throw std::runtime_error("Expected JSON object for "+name);
    const auto found=value.object.find(name);
    if(found==value.object.end())throw std::runtime_error("Missing JSON field: "+name);
    return found->second;
}
std::string str(const V& value) {
    if(value.kind!=V::String)throw std::runtime_error("Expected JSON string");
    return value.string;
}
double num(const V& value) {return pandoeditor::codecjson::finiteNumber(value);}
const std::vector<V>& array(const V& value) {
    if(value.kind!=V::Array)throw std::runtime_error("Expected JSON array");
    return value.array;
}
std::string read(const fs::path& path) {
    std::ifstream input(path,std::ios::binary);
    if(!input)throw std::runtime_error("Cannot read "+path.string());
    return {std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>()};
}
std::string gunzip(const fs::path& path) {
    gzFile file=gzopen(path.string().c_str(),"rb");
    if(!file)throw std::runtime_error("Cannot open compressed preview "+path.string());
    std::string result;char buffer[32768];int n=0;
    while((n=gzread(file,buffer,sizeof(buffer)))>0)result.append(buffer,n);
    const int status=gzclose(file);
    if(n<0||status!=Z_OK)throw std::runtime_error("Invalid gzip preview "+path.string());
    return result;
}
struct Point {double x=0,y=0;};
Point point(const V& value) {
    const auto& row=array(value);
    if(row.size()!=2)throw std::runtime_error("INVALID_POLYGON_COORDINATE: expected lon/lat");
    const auto x=num(row[0]),y=num(row[1]);
    if(std::abs(x)>180||std::abs(y)>90)throw std::runtime_error("INVALID_POLYGON_COORDINATE: out of range");
    return {x,y};
}
std::vector<Point> ring(const V& value) {
    const auto& values=array(value);std::vector<Point> result;result.reserve(values.size());
    for(const auto& element:values)result.push_back(point(element));
    if(result.size()<4)throw std::runtime_error("INVALID_POLYGON_RING: fewer than four positions");
    if(result.front().x!=result.back().x||result.front().y!=result.back().y)
        throw std::runtime_error("INVALID_POLYGON_RING: ring is open");
    std::set<std::pair<double,double>> distinct;
    for(std::size_t i=0;i+1<result.size();++i) {
        distinct.insert({result[i].x,result[i].y});
        if(result[i].x==result[i+1].x&&result[i].y==result[i+1].y)
            throw std::runtime_error("INVALID_POLYGON_RING: consecutive duplicate vertex");
    }
    if(distinct.size()<3)throw std::runtime_error("INVALID_POLYGON_RING: degenerate ring");
    return result;
}
// Share the exact spherical interior/winding rules with the production
// C++ core rather than maintaining an independent generator-side formula.
pandoeditor::Geometry parsedPolygon(const V& source) {
    pandoeditor::Geometry geometry;
    geometry.type=str(field(source,"type"));
    if(geometry.type!="Polygon"&&geometry.type!="MultiPolygon")
        throw std::runtime_error("Expected Polygon/MultiPolygon");
    const auto& coordinates=field(source,"coordinates");
    const auto polygon=[&](const V& value) {
        pandoeditor::Polygon result;
        for(const auto& sourceRing:array(value)) {
            pandoeditor::Ring output;
            for(const auto p:ring(sourceRing))output.push_back({p.x,p.y});
            result.push_back(std::move(output));
        }
        return result;
    };
    if(geometry.type=="Polygon")geometry.polygons.push_back(polygon(coordinates));
    else for(const auto& value:array(coordinates))geometry.polygons.push_back(polygon(value));
    return geometry;
}
void validateSphericalPolygon(const V& source) {
    pandoeditor::requireCanonicalSphericalWinding(parsedPolygon(source));
}
class Topology {
    GEOSContextHandle_t context=GEOS_init_r();
    GEOSGeoJSONReader* reader=GEOSGeoJSONReader_create_r(context);
public:
    using Geometry=std::shared_ptr<GEOSGeometry>;
    ~Topology(){GEOSGeoJSONReader_destroy_r(context,reader);GEOS_finish_r(context);}
    Geometry fromJson(const V& value) {
        const auto bytes=value.encode();
        auto* geometry=GEOSGeoJSONReader_readGeometry_r(context,reader,bytes.c_str());
        if(!geometry)throw std::runtime_error("GEOS failed to decode GeoJSON geometry");
        return Geometry(geometry,[this](GEOSGeometry* g){GEOSGeom_destroy_r(context,g);});
    }
    void valid(const Geometry& geometry) {
        if(GEOSisEmpty_r(context,geometry.get())!=0)throw std::runtime_error("Empty GEOS geometry");
        if(GEOSisValid_r(context,geometry.get())!=1) {
            char* detail=GEOSisValidReason_r(context,geometry.get());
            const std::string reason=detail?detail:"unknown";GEOSFree_r(context,detail);
            throw std::runtime_error("INVALID_TOPOLOGY: "+reason);
        }
    }
    double overlap(const Geometry& left,const Geometry& right) {
        auto* intersection=GEOSIntersection_r(context,left.get(),right.get());
        if(!intersection)throw std::runtime_error("GEOS intersection failed");
        double area=0;const int ok=GEOSArea_r(context,intersection,&area);
        GEOSGeom_destroy_r(context,intersection);
        if(!ok)throw std::runtime_error("GEOS area failed");
        return area;
    }
};
struct Feature {std::string id;Topology::Geometry shape;double minX,minY,maxX,maxY;};
void checkCollection(Topology& topology,const std::string& label,const V& value) {
    if(str(field(value,"type"))!="FeatureCollection")throw std::runtime_error("Invalid FeatureCollection");
    const auto& features=array(field(value,"features"));
    constexpr std::size_t expected=258;
    if(features.size()!=expected)throw std::runtime_error(label+": expected 258 countries, got "+std::to_string(features.size()));
    std::set<std::string> ids;std::vector<Feature> geometries;
    std::vector<std::string> errors;
    for(const auto& row:features) {
        std::string id;
        try {
            id=str(field(row,"id"));
            if(id.empty()||!ids.insert(id).second)throw std::runtime_error("Missing or duplicate country ID");
            const auto& properties=field(row,"properties");
            if(properties.kind!=V::Object||properties.object.size()!=1||!properties.object.count("name"))
                throw std::runtime_error("Expected only country name");
            const auto& geometry=field(row,"geometry");
            validateSphericalPolygon(geometry);
            auto shape=topology.fromJson(geometry);
            topology.valid(shape);
            double minX=180,minY=90,maxX=-180,maxY=-90;
            const auto scan=[&](const auto& self,const V& node)->void {
                if(node.kind!=V::Array)throw std::runtime_error("Unexpected coordinate structure");
                if(node.array.size()==2&&node.array[0].kind==V::Number&&node.array[1].kind==V::Number) {
                    auto point=::point(node);minX=std::min(minX,point.x);maxX=std::max(maxX,point.x);
                    minY=std::min(minY,point.y);maxY=std::max(maxY,point.y);
                } else for(const auto& child:node.array)self(self,child);
            };
            scan(scan,field(geometry,"coordinates"));
            geometries.push_back({id,std::move(shape),minX,minY,maxX,maxY});
        } catch(const std::exception& e) {
            errors.push_back((id.empty()?"?":id)+": "+e.what());
        }
    }
    std::sort(geometries.begin(),geometries.end(),[](const auto& a,const auto& b){return a.minX<b.minX;});
    for(std::size_t i=0;i<geometries.size();++i)for(std::size_t j=i+1;j<geometries.size();++j) {
        const auto& a=geometries[i];const auto& b=geometries[j];
        if(b.minX>a.maxX)break;
        if(b.minY>a.maxY||b.maxY<a.minY)continue;
        try {
            const auto overlap=topology.overlap(a.shape,b.shape);
            if(overlap>1e-14)errors.push_back(a.id+"/"+b.id+": overlapping "+std::to_string(overlap));
        }catch(const std::exception& e){errors.push_back(a.id+"/"+b.id+": "+e.what());}
    }
    if(!errors.empty()) {
        std::ostringstream error;error<<label<<" validation failed ("<<errors.size()<<" errors)\n";
        for(std::size_t i=0;i<std::min<std::size_t>(errors.size(),200);++i)error<<"- "<<errors[i]<<"\n";
        throw std::runtime_error(error.str());
    }
    std::cout<<label<<": "<<features.size()<<" countries valid\n";
}
void auditCatalog(Topology& topology,const fs::path& root) {
    const auto directory=root/"assets/data/territorial-entities/source/countries";
    if(!fs::is_directory(directory))throw std::runtime_error("Missing catalog source directory");
    std::vector<fs::path> files;
    for(const auto& entry:fs::directory_iterator(directory))
        if(entry.is_regular_file()&&entry.path().extension()==".json")files.push_back(entry.path());
    std::sort(files.begin(),files.end());
    std::size_t examined=0,failed=0;
    for(const auto& file:files) {
        const auto lineage=pandoeditor::codecjson::parse(read(file));
        for(const auto& entity:array(field(lineage,"entities"))) {
            const auto id=str(field(entity,"entityId"));
            for(const auto& version:array(field(entity,"geometryVersions"))) {
                ++examined;
                try {
                    const auto& geometry=field(version,"geometry");
                    validateSphericalPolygon(geometry);
                    auto shape=topology.fromJson(geometry);topology.valid(shape);
                }catch(const std::exception& e){
                    ++failed;
                    std::cerr<<file.filename().string()<<":"<<id<<":"
                        <<str(field(version,"versionId"))<<": "<<e.what()<<"\n";
                }
            }
        }
    }
    std::cout<<"Catalog C++ geometry audit: "<<examined<<" versions, "<<failed<<" failures\n";
    if(failed)throw std::runtime_error("Existing catalog contains invalid geometry versions");
}
void selfTest() {
    auto valid=[&](const std::string& raw){validateSphericalPolygon(pandoeditor::codecjson::parse(raw));};
    valid(R"({"type":"Polygon","coordinates":[[[0,0],[0,2],[2,2],[2,0],[0,0]]]})");
    valid(R"({"type":"Polygon","coordinates":[[[179,-2],[179,2],[-179,2],[-179,-2],[179,-2]]]})");
    valid(R"({"type":"Polygon","coordinates":[[[170,80],[90,85],[0,89],[-90,85],[-170,80],[170,80]]]})");
    bool rejected=false;
    try{valid(R"({"type":"Polygon","coordinates":[[[0,0],[0,2],[2,2],[2,0],[0,0]],[[1,1],[1,1],[1,1],[1,1]]]})");}
    catch(const std::exception&){rejected=true;}
    if(!rejected)throw std::runtime_error("invalid hole accepted");
    std::cout<<"C++ spherical validator self-test passed\n";
}
} // namespace

int main(int argc,char** argv) {
    try {
        bool canonicalOnly=false,smoke=false,audit=false;
        fs::path root=fs::current_path();
        for(int i=1;i<argc;++i) {
            if(std::string(argv[i])=="--canonical-only")canonicalOnly=true;
            else if(std::string(argv[i])=="--self-test")smoke=true;
            else if(std::string(argv[i])=="--audit-catalog")audit=true;
            else if(std::string(argv[i])=="--root"&&i+1<argc)root=argv[++i];
            else throw std::runtime_error("Unknown argument: "+std::string(argv[i]));
        }
        if(smoke){selfTest();return 0;}
        Topology topology;
        if(audit){auditCatalog(topology,root);return 0;}
        const auto canonical=pandoeditor::codecjson::parse(read(root/"assets/data/territorial-entities/generated/current-world.geojson"));
        checkCollection(topology,"canonical",canonical);
        if(canonicalOnly)return 0;
        const auto settings=pandoeditor::codecjson::parse(read(root/"assets/data/world/build-input.json"));
        const auto manifestPath=str(field(settings,"legacyPreviewManifest"));
        const auto manifest=pandoeditor::codecjson::parse(read(root/"assets/data"/manifestPath));
        const auto& assets=field(manifest,"assets");
        const auto& preview=field(assets,"previewCountries");
        const auto path=root/"assets/data"/str(field(preview,"url"));
        const auto decoded=pandoeditor::codecjson::parse(gunzip(path));
        checkCollection(topology,"preview",decoded);
        const auto& a=array(field(canonical,"features")),&b=array(field(decoded,"features"));
        for(std::size_t i=0;i<a.size();++i)
            if(str(field(a[i],"id"))!=str(field(b[i],"id")))throw std::runtime_error("Preview country identity/order mismatch");
        return 0;
    } catch(const std::exception& error) {
        std::cerr<<"territorial-geometry-check: "<<error.what()<<"\n";
        return 1;
    }
}
