#include <pandoeditor/riverpartition.h>
#include <pandoeditor/polygonclipping.h>
#include <iostream>
using namespace pandoeditor;
int main(){std::string line;while(std::getline(std::cin,line))try{
    const auto input=codecjson::parse(line);auto op=input.object.find("operation");
    const auto result=op==input.object.end()?riverPartitionOperation("envelope",input):riverPartitionOperation(op->second.string,input.object.at("input"));
    std::cout<<result.encode()<<'\n';
}catch(const PolygonCalculationCancelled&){std::cout<<"{\"cancelled\":true}\n";}
catch(const std::exception& error){auto out=codecjson::Value::obj();out.object["error"]=codecjson::Value::str(error.what());std::cout<<out.encode()<<'\n';}}
