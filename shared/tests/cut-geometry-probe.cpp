#include <pandoeditor/cutgeometry.h>
#include <pandoeditor/projectcodec.h>
#include <iostream>
using namespace pandoeditor;
int main(){std::string line;while(std::getline(std::cin,line))try{
    const auto request=codecjson::parse(line);PreparedCutGeometry source(projectcodec::readWebGeometry(request.object.at("source")));
    std::cout<<source.prepare(request).encode()<<'\n';
}catch(const std::exception& error){auto out=codecjson::Value::obj();out.object["error"]=codecjson::Value::str(error.what());std::cout<<out.encode()<<'\n';}}
