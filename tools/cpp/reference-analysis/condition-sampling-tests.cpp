#include "condition-sampling.h"
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
int main(){try{
  struct Case{std::uint64_t epoch,index;bool gray;double contrast,brightness,saturation,resolution,blur;int quality;};
  const Case cases[]={
    {0,0,false,1.113031253495208,.9270620753039585,.515023184963751,1,0,95},
    {0,1,false,1.1402083829971228,.8989615289053056,1.0755284105022143,.75,0,75},
    {1,0,false,.9938474826696468,.9725480074178968,.5443796689781316,1,0,55},
    {5,123456,false,1.222297335559699,.9381893862465549,1.093927843153296,.75,.5,95},
    {1000,9999,true,1.157757056757728,.9172706026868441,1.1577589177812242,.5,0,75},
    {5000,42,true,1.103184223258039,.8736697161616835,1.1215176917489817,.75,.25,95},
    {0,1234567890123ULL,false,.7529384905251734,1.0872190025288226,1.0799497547525085,.5,.25,55}};
  for(const auto& c:cases){const auto r=pando::reference::trainingScanConditions(c.epoch,c.index);
    if(r.grayscale!=c.gray||std::abs(r.contrast-c.contrast)>1e-15||std::abs(r.brightness-c.brightness)>1e-15||
       std::abs(r.saturation-c.saturation)>1e-15||r.resolution!=c.resolution||r.blur!=c.blur||r.quality!=c.quality)
      throw std::runtime_error("Scan condition sequence differs from Python oracle");}
  bool rejected=false;try{pando::reference::trainingScanConditions(std::numeric_limits<std::uint64_t>::max(),0);}catch(const std::invalid_argument&){rejected=true;}
  if(!rejected)throw std::runtime_error("Overflowing training seed accepted");
  std::cout<<"Original training condition sequences and overflow refusal verified\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
