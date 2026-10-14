// JSON transport for the shared C++ spherical polygon normalizer.
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/sphericalpolygon.h>
#include <cmath>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <utility>

using V = pandoeditor::codecjson::Value;

namespace {
const V& field(const V& value, const std::string& name) {
    if(value.kind!=V::Object)throw std::invalid_argument("Expected polygon object");
    const auto found=value.object.find(name);
    if(found==value.object.end())throw std::invalid_argument("Missing polygon field: "+name);
    return found->second;
}
const std::vector<V>& array(const V& value) {
    if(value.kind!=V::Array)throw std::invalid_argument("Expected polygon coordinates array");
    return value.array;
}
pandoeditor::Ring ring(const V& value) {
    pandoeditor::Ring result;
    for(const auto& position:array(value)) {
        const auto& pair=array(position);
        if(pair.size()!=2)throw std::invalid_argument("Expected longitude/latitude pair");
        const auto x=pandoeditor::codecjson::finiteNumber(pair[0]);
        const auto y=pandoeditor::codecjson::finiteNumber(pair[1]);
        if(std::abs(x)>180||std::abs(y)>90)throw std::invalid_argument("INVALID_POLYGON_COORDINATE");
        result.push_back({x,y});
    }
    return result;
}
pandoeditor::Polygon polygon(const V& value) {
    pandoeditor::Polygon result;
    for(const auto& row:array(value))result.push_back(ring(row));
    return result;
}
pandoeditor::Geometry decode(const V& value) {
    const auto& type=field(value,"type");
    if(type.kind!=V::String)throw std::invalid_argument("Expected polygon type");
    pandoeditor::Geometry result;result.type=type.string;
    const auto& coordinates=field(value,"coordinates");
    if(result.type=="Polygon")result.polygons.push_back(polygon(coordinates));
    else if(result.type=="MultiPolygon")for(const auto& row:array(coordinates))result.polygons.push_back(polygon(row));
    else throw std::invalid_argument("Expected Polygon/MultiPolygon");
    return result;
}
V encodeRing(const pandoeditor::Ring& ring) {
    auto result=V::arr();
    for(const auto point:ring) {
        auto pair=V::arr();pair.array={V::num(point.x),V::num(point.y)};
        result.array.push_back(std::move(pair));
    }
    return result;
}
V encodePolygon(const pandoeditor::Polygon& polygon) {
    auto result=V::arr();
    for(const auto& ring:polygon)result.array.push_back(encodeRing(ring));
    return result;
}
V encode(const pandoeditor::Geometry& geometry, const std::string& requestedType) {
    auto result=V::obj();result.object["type"]=V::str(requestedType);
    auto coordinates=V::arr();
    if(requestedType=="Polygon")coordinates=encodePolygon(geometry.polygons.at(0));
    else for(const auto& polygon:geometry.polygons)coordinates.array.push_back(encodePolygon(polygon));
    result.object["coordinates"]=std::move(coordinates);
    return result;
}
V normalize(const V& input) {
    const auto source=decode(input);
    const auto normalized=pandoeditor::normalizeSphericalPolygonGeometry(source);
    return encode(normalized,source.type);
}
}

int main() {
    try {
        const std::string input{std::istreambuf_iterator<char>{std::cin},std::istreambuf_iterator<char>{}};
        const auto request=pandoeditor::codecjson::parse(input);
        if(request.kind==V::Array) {
            auto output=V::arr();
            for(const auto& row:request.array) {
                auto result=V::obj();
                try {result.object["geometry"]=normalize(row);result.object["ok"]=V::boolean(true);}
                catch(const std::exception& error) {
                    result.object["error"]=V::str(error.what());result.object["ok"]=V::boolean(false);
                }
                output.array.push_back(std::move(result));
            }
            std::cout<<output.encode()<<'\n';
        } else std::cout<<normalize(request).encode()<<'\n';
        return 0;
    } catch(const std::exception& error) {
        std::cerr<<"polygon-normalize: "<<error.what()<<'\n';
        return 1;
    }
}
