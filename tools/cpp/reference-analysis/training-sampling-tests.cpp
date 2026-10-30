#include "training-sampling.h"
#include <iostream>
#include <stdexcept>
#include <vector>
int main(){try{
  const std::vector<std::vector<std::string>> datasets={{"b","a","a","a","b"},{"z","x","y","y"}};
  struct Case{std::uint64_t epoch,seed;std::vector<std::uint64_t> expected;};
  for(const Case& c:{Case{0,20261029,{4,6,6,3,0,8,5,3,8,4}},Case{1,20261029,{5,6,4,3,8,7,5,3,0,4}},
                      Case{11,42,{3,4,7,1,6,8,0,5,4,6}}})
    if(pando::reference::balancedTrainingOrder(datasets,c.epoch,c.seed)!=c.expected)throw std::runtime_error("Balanced tile order differs from original");
  bool rejected=false;try{pando::reference::balancedTrainingOrder({{}},0,0);}catch(const std::invalid_argument&){rejected=true;}
  if(!rejected)throw std::runtime_error("Unsupervised corpus was accepted");
  std::cout<<"Original balanced training orders verified\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
