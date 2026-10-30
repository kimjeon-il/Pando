#include "training-photometry.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
std::vector<std::uint8_t> load(const std::string& path){std::ifstream stream(path,std::ios::binary);if(!stream)throw std::runtime_error("Photometry oracle missing");return std::vector<std::uint8_t>(std::istreambuf_iterator<char>(stream),std::istreambuf_iterator<char>());}
int main(int argc,char** argv){try{
  if(argc!=2)throw std::runtime_error("Expected photometry fixture directory");const std::string root=argv[1];const auto input=load(root+"/input.rgb");
  struct Case{const char* name;bool gray;double contrast,brightness,saturation;};
  for(const Case c: {Case{"color",false,1.2,.87,1.3},Case{"gray",true,.76,1.08,.52},Case{"neutral",false,1,1,1},Case{"dark",false,.9,.85,.5}}){
    const auto result=pando::reference::applyTrainingPhotometry(input,13,9,c.gray,c.contrast,c.brightness,c.saturation);
    if(result!=load(root+"/"+c.name+".rgb"))throw std::runtime_error(std::string("Photometry differs: ")+c.name);
  }
  for(const auto& c: {std::pair<double,const char*>{.25,"blur-025.rgb"},{.5,"blur-050.rgb"}})
    if(pando::reference::applyTrainingGaussianBlur(input,13,9,c.first)!=load(root+"/"+c.second))throw std::runtime_error("Gaussian blur differs from original");
  if(pando::reference::applyTrainingGaussianBlur({10,20,30},1,1,.5)!=std::vector<std::uint8_t>({10,20,30}))throw std::runtime_error("Blur edge changed a single pixel");
  bool refused=false;try{pando::reference::applyTrainingPhotometry(input,13,9,false,-1,1,1);}catch(const std::invalid_argument&){refused=true;}
  if(!refused)throw std::runtime_error("Invalid photometry factor accepted");
  std::cout<<"Original RGB photometry pixels verified\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
