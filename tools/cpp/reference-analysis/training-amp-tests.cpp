#include "training-amp.h"
#include <iostream>
#include <limits>
#include <stdexcept>

int main(){try{
  const torch::Device cpu(torch::kCPU);pando::reference::TrainingAmpState state;
  std::vector<torch::Tensor> gradients{torch::tensor({65536.f,131072.f})};
  if(!pando::reference::unscaleAndUpdateTrainingAmp(gradients,state,cpu)||!torch::equal(gradients[0],torch::tensor({1.f,2.f}))||
     state.scale!=65536.f||state.growthTracker!=1)throw std::runtime_error("Finite gradient unscale differs");
  gradients={torch::tensor({std::numeric_limits<float>::infinity()})};
  if(pando::reference::unscaleAndUpdateTrainingAmp(gradients,state,cpu)||state.scale!=32768.f||state.growthTracker!=0)
    throw std::runtime_error("Overflow did not skip and reduce scale");
  state={1.f,1999};gradients={torch::tensor({3.f})};
  if(!pando::reference::unscaleAndUpdateTrainingAmp(gradients,state,cpu)||state.scale!=2.f||state.growthTracker!=0)
    throw std::runtime_error("Growth interval differs");
  auto parameter=torch::tensor(1.f,torch::TensorOptions().requires_grad(true));
  std::vector<torch::Tensor> parameters{parameter};torch::optim::SGD optimizer(parameters,torch::optim::SGDOptions(.1));
  state={65536.f,0};parameter.mutable_grad()=torch::tensor(std::numeric_limits<float>::infinity());
  if(pando::reference::applyTrainingAmpGradients(parameters,optimizer,state,cpu)||parameter.item<float>()!=1.f||state.scale!=32768.f)
    throw std::runtime_error("Overflow updated an optimizer parameter");
  parameter.mutable_grad()=torch::tensor(2.f*state.scale);
  if(!pando::reference::applyTrainingAmpGradients(parameters,optimizer,state,cpu)||parameter.item<float>()>=1.f)
    throw std::runtime_error("Finite gradient failed to resume optimizer updates");
  bool refused=false;try{std::vector<torch::Tensor> empty;pando::reference::unscaleAndUpdateTrainingAmp(empty,state,cpu);}catch(const std::invalid_argument&){refused=true;}
  if(!refused)throw std::runtime_error("Empty AMP gradients were accepted");
  std::cout<<"Training AMP unscale, overflow skip and scale growth verified\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
