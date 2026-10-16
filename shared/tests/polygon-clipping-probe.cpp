#include <pandoeditor/polygonclipping.h>
#include <pandoeditor/losslessjson.h>
#include <iostream>
#include <stdexcept>
using namespace pandoeditor;
using V=codecjson::Value;
int main(){
    std::string line;
    while(std::getline(std::cin,line))try{
        const auto input=codecjson::parse(line);const auto name=input.object.at("operation").string;
        PolygonOperation op;
        if(name=="union")op=PolygonOperation::Union;
        else if(name=="difference")op=PolygonOperation::Difference;
        else if(name=="intersection")op=PolygonOperation::Intersection;
        else if(name=="xor")op=PolygonOperation::Xor;
        else throw std::invalid_argument("operation");
        std::vector<MultiPolygon> operands;
        for(const auto& multi:input.object.at("operands").array){MultiPolygon polygons;
            for(const auto& poly:multi.array){Polygon rings;for(const auto& ring:poly.array){Ring points;
                for(const auto& p:ring.array)points.push_back({codecjson::finiteNumber(p.array.at(0)),codecjson::finiteNumber(p.array.at(1))});
                rings.push_back(std::move(points));}polygons.push_back(std::move(rings));}operands.push_back(std::move(polygons));}
        auto output=V::obj();
        const auto cancelled=input.object.find("cancelled");
        try{
            const auto result=clipPolygons(op,operands,[&]{return cancelled!=input.object.end()&&cancelled->second.raw=="true";});
            auto rows=V::arr();for(const auto& poly:result){auto rings=V::arr();for(const auto& ring:poly){auto points=V::arr();for(auto p:ring){auto pair=V::arr();pair.array={V::num(p.x),V::num(p.y)};points.array.push_back(std::move(pair));}rings.array.push_back(std::move(points));}rows.array.push_back(std::move(rings));}
            output.object["result"]=std::move(rows);
        }catch(const PolygonCalculationCancelled&){output.object["cancelled"]=V::boolean(true);}
        std::cout<<output.encode()<<'\n';
    }catch(const std::exception& error){auto output=V::obj();output.object["error"]=V::str(error.what());std::cout<<output.encode()<<'\n';}
}
