#include "reference-model.h"
#include "reference-io.h"
#include "training-checkpoint.h"
#include <torch/torch.h>
#include <filesystem>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs=std::filesystem;
namespace {
void saveTensor(const fs::path& path,const torch::Tensor& input){
  const auto value=input.to(torch::kCPU).contiguous();
  pando::reference::writeNewFile(path,std::string(static_cast<const char*>(value.data_ptr()),static_cast<std::size_t>(value.numel()*sizeof(float))));
}
void saveWeights(const fs::path& path,torch::nn::Module& model){
  std::map<std::string,torch::Tensor> tensors;
  for(const auto& item:model.named_parameters(true))tensors.emplace(item.key(),item.value());
  for(const auto& item:model.named_buffers(true))if(!tensors.emplace(item.key(),item.value()).second)throw std::runtime_error("Duplicate synthetic tensor");
  std::ostringstream header;header<<"{\"__metadata__\":{\"architecture\":\"mobilenetv3-unet-context-v1\",\"trainingOnly\":\"true\"}";
  std::string payload;for(const auto& [name,input]:tensors){
    if(name.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.")!=std::string::npos)throw std::runtime_error("Invalid synthetic tensor name");
    const auto value=input.to(torch::kCPU).contiguous();const char* dtype=value.scalar_type()==torch::kFloat32?"F32":value.scalar_type()==torch::kInt64?"I64":nullptr;
    if(!dtype)throw std::runtime_error("Unexpected synthetic tensor dtype");
    const auto begin=payload.size(),length=static_cast<std::size_t>(value.numel()*value.element_size());
    payload.append(static_cast<const char*>(value.data_ptr()),length);
    header<<",\""<<name<<"\":{\"dtype\":\""<<dtype<<"\",\"shape\":[";
    for(std::int64_t i=0;i<value.dim();++i){if(i)header<<',';header<<value.size(i);}
    header<<"],\"data_offsets\":["<<begin<<','<<payload.size()<<"]}";
  }
  header<<'}';const auto json=header.str();std::string file(8,'\0');
  for(int i=0;i<8;i++)file[static_cast<std::size_t>(i)]=static_cast<char>((std::uint64_t(json.size())>>(8*i))&255);
  file+=json;file+=payload;pando::reference::writeNewFile(path,file);
}
int run(const std::vector<fs::path>& args){
  if(args.size()!=2||!fs::is_directory(args[1]))throw std::invalid_argument("Expected existing fixture directory");
  torch::set_num_threads(2);torch::manual_seed(20261030);
  const torch::Device device(torch::kCPU);pando::reference::ReferenceBoundaryModel model;model->to(device);model->eval();
  torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4));
  const pando::reference::SamplingState sampling{0,0,20261030,{0}};
  const auto checkpoint=pando::reference::saveTrainingCheckpoint(*model,optimizer,sampling,device);
  pando::reference::writeNewFile(args[1]/"checkpoint.pt",checkpoint);
  saveWeights(args[1]/"weights.safetensors",*model);
  const auto tile=torch::zeros({1,3,512,512}),overview=torch::zeros({1,3,256,256}),position=torch::tensor({0.f,0.f,1.f,1.f}).reshape({1,4});
  torch::NoGradGuard guard;const auto expected=model->forward(tile,overview,position).to(torch::kCPU).contiguous();
  if(!torch::isfinite(expected).all().item<bool>())throw std::runtime_error("Invalid synthetic inference fixture");
  saveTensor(args[1]/"tile.f32",tile);saveTensor(args[1]/"overview.f32",overview);saveTensor(args[1]/"position.f32",position);saveTensor(args[1]/"expected.f32",expected);
  saveTensor(args[1]/"expected-probabilities.f32",expected.sigmoid());
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
