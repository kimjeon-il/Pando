#include <pandoeditor/cutgeometry.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/polygonwrapping.h>
#include <pandoeditor/sphericalpolygon.h>
#include <iostream>
using namespace pandoeditor;
int main(){std::string line;while(std::getline(std::cin,line))try{
    const auto request=codecjson::parse(line);
    if(request.object.count("operation")){
        const auto source=projectcodec::readWebGeometry(request.object.at("input"));
        const auto result=request.object.at("operation").string=="wrap"?wrapPolygonGeometry(source):normalizeClippedSphericalPolygonGeometry(source);
        std::cout<<(result.polygons.empty()?"null":projectcodec::webGeometryValue(result).encode())<<'\n';continue;
    }
    PreparedCutGeometry source(projectcodec::readWebGeometry(request.object.at("source")));
    std::cout<<source.prepare(request).encode()<<'\n';
}catch(const std::exception& error){auto out=codecjson::Value::obj();out.object["error"]=codecjson::Value::str(error.what());std::cout<<out.encode()<<'\n';}}
