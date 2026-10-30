#include "training-sampling.h"
#include <iostream>
#include <algorithm>
#include <stdexcept>
#include <vector>
int main(){try{
  const std::vector<std::vector<std::string>> datasets={{"b","a","a","a","b"},{"z","x","y","y"}};
  struct Case{std::uint64_t epoch,seed;std::vector<std::uint64_t> expected;};
  for(const Case& c:{Case{0,20261029,{4,6,6,3,0,8,5,3,8,4}},Case{1,20261029,{5,6,4,3,8,7,5,3,0,4}},
                      Case{11,42,{3,4,7,1,6,8,0,5,4,6}}})
    if(pando::reference::balancedTrainingOrder(datasets,c.epoch,c.seed)!=c.expected)throw std::runtime_error("Balanced tile order differs from original");
  std::vector<std::string> large(90,"a"),small;large.push_back("b");
  for(int i=0;i<9;++i)small.push_back(std::to_string(i));
  const std::vector<std::vector<std::string>> unequal{large,small};
  const auto balanced=pando::reference::balancedTrainingOrder(unequal,0,123);
  if(balanced.size()!=100||std::count_if(balanced.begin(),balanced.end(),[](auto i){return i<91;})!=50||
    std::count(balanced.begin(),balanced.end(),90)<=10||balanced==pando::reference::balancedTrainingOrder(unequal,1,123))
    throw std::runtime_error("Unequal corpora were not balanced across epochs");
  for(std::uint64_t i=90;i<100;++i)if(std::find(balanced.begin(),balanced.end(),i)==balanced.end())throw std::runtime_error("A training original was omitted");
  std::vector<std::string> diverse;for(int i=0;i<99;++i)diverse.push_back(std::to_string(i));
  const auto extreme=pando::reference::balancedTrainingOrder({{"one"},diverse},0,123);
  if(extreme.size()!=198||std::count(extreme.begin(),extreme.end(),0)!=99)throw std::runtime_error("Original coverage unbalanced corpus contributions");
  bool rejected=false;try{pando::reference::balancedTrainingOrder({{}},0,0);}catch(const std::invalid_argument&){rejected=true;}
  if(!rejected)throw std::runtime_error("Unsupervised corpus was accepted");
  std::cout<<"Original balanced training orders verified\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
