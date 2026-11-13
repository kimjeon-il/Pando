// JSON-lines transport only; algorithms remain in the product Core.
#include <sstream>
#include <pandoeditor/polygonclipping.h>
#include <pandoeditor/losslessjson.h>
#include <iostream>
#include <stdexcept>
using namespace pandoeditor;
using V=codecjson::Value;
void polygon(std::istream& inputStream,std::ostream& outputStream){
    std::string line;
    while(std::getline(inputStream,line))try{
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
        outputStream<<output.encode()<<'\n';
    }catch(const std::exception& error){auto output=V::obj();output.object["error"]=V::str(error.what());outputStream<<output.encode()<<'\n';}
}

#include <pandoeditor/cutgeometry.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/polygonwrapping.h>
#include <pandoeditor/sphericalpolygon.h>
#include <iostream>
using namespace pandoeditor;
void cut(std::istream& inputStream,std::ostream& outputStream){std::string line;while(std::getline(inputStream,line))try{
    const auto request=codecjson::parse(line);
    if(request.object.count("operation")){
        const auto source=projectcodec::readWebGeometry(request.object.at("input"));
        const auto result=request.object.at("operation").string=="wrap"?wrapPolygonGeometry(source):normalizeClippedSphericalPolygonGeometry(source);
        outputStream<<(result.polygons.empty()&&request.object.at("operation").string!="wrap"?"null":projectcodec::webGeometryValue(result).encode())<<'\n';continue;
    }
    PreparedCutGeometry source(projectcodec::readWebGeometry(request.object.at("source")));
    outputStream<<source.prepare(request).encode()<<'\n';
}catch(const std::exception& error){auto out=codecjson::Value::obj();out.object["error"]=codecjson::Value::str(error.what());outputStream<<out.encode()<<'\n';}}

#include <pandoeditor/riverpartition.h>
#include <pandoeditor/polygonclipping.h>
#include <iostream>
using namespace pandoeditor;
void river(std::istream& inputStream,std::ostream& outputStream){std::string line;while(std::getline(inputStream,line))try{
    const auto input=codecjson::parse(line);auto op=input.object.find("operation");
    const auto result=op==input.object.end()?riverPartitionOperation("envelope",input):riverPartitionOperation(op->second.string,input.object.at("input"));
    outputStream<<result.encode()<<'\n';
}catch(const PolygonCalculationCancelled&){outputStream<<"{\"cancelled\":true}\n";}
catch(const std::exception& error){auto out=codecjson::Value::obj();out.object["error"]=codecjson::Value::str(error.what());outputStream<<out.encode()<<'\n';}}

int main(){
 std::string line;
 while(std::getline(std::cin,line))try{
  const auto request=codecjson::parse(line);
  std::istringstream input(request.object.at("input").encode()+"\n");
  const auto kind=request.object.at("kind").string;
  if(kind=="polygon")polygon(input,std::cout);
  else if(kind=="cut")cut(input,std::cout);
  else if(kind=="river")river(input,std::cout);
  else throw std::invalid_argument("Unknown calculation kind");
 }catch(const std::exception& error){auto out=codecjson::Value::obj();out.object["error"]=codecjson::Value::str(error.what());std::cout<<out.encode()<<'\n';}
}
