#include "reference-model.h"
#include "reference-io.h"
#include "training-checkpoint.h"
#include <torch/torch.h>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs=std::filesystem;
namespace {
void saveTensor(const fs::path& path,const torch::Tensor& input){
  const auto value=input.to(torch::kCPU).contiguous();
  pando::reference::writeNewFile(path,std::string(static_cast<const char*>(value.data_ptr()),static_cast<std::size_t>(value.numel()*sizeof(float))));
}
int run(const std::vector<fs::path>& args){
  if(args.size()!=2||!fs::is_directory(args[1]))throw std::invalid_argument("Expected existing fixture directory");
  torch::set_num_threads(2);torch::manual_seed(20261030);
  const torch::Device device(torch::kCPU);pando::reference::ReferenceBoundaryModel model;model->to(device);model->eval();
  torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4));
  const pando::reference::SamplingState sampling{0,0,20261030,{0}};
  const auto checkpoint=pando::reference::saveTrainingCheckpoint(*model,optimizer,sampling,device);
  pando::reference::writeNewFile(args[1]/"checkpoint.pt",checkpoint);
  const auto tile=torch::zeros({1,3,512,512}),overview=torch::zeros({1,3,256,256}),position=torch::tensor({0.f,0.f,1.f,1.f}).reshape({1,4});
  torch::NoGradGuard guard;const auto expected=model->forward(tile,overview,position).to(torch::kCPU).contiguous();
  if(!torch::isfinite(expected).all().item<bool>())throw std::runtime_error("Invalid synthetic inference fixture");
  saveTensor(args[1]/"tile.f32",tile);saveTensor(args[1]/"overview.f32",overview);saveTensor(args[1]/"position.f32",position);saveTensor(args[1]/"expected.f32",expected);
  std::cout<<"Synthetic private checkpoint fixture ready\n";return 0;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
#else
int main(int argc,char** argv){
#endif
  try{std::vector<fs::path> args;for(int i=0;i<argc;++i)args.emplace_back(argv[i]);return run(args);}
  catch(const std::exception& error){std::cerr<<"training-infer-fixture: "<<error.what()<<'\n';return 1;}
}
