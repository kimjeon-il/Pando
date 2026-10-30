#include "training-step.h"
#include <ATen/Context.h>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

int main(){try{
  torch::set_num_threads(2);at::globalContext().setDeterministicAlgorithms(true,false);
  pando::reference::ReferenceBoundaryModel model;
  {torch::NoGradGuard guard;for(auto& item:model->named_parameters(true)){auto value=item.value();
    if(value.dim()>1){std::int64_t fan=1;for(std::int64_t axis=1;axis<value.dim();++axis)fan*=value.size(axis);
      auto data=(torch::remainder(torch::arange(value.numel(),torch::kFloat32),17)-8)*(.1/std::sqrt(double(fan))/8);value.copy_(data.reshape(value.sizes()));}
    else if(item.key().size()>=6&&item.key().substr(item.key().size()-6)=="weight")value.fill_(1);else value.fill_(.01);}}
  model->train();for(auto& parameter:model->encoder->parameters())parameter.requires_grad_(false);model->encoder->eval();
  auto before=model->encoder->at<pando::reference::ConvNormImpl>(0).named_buffers(true)["1.running_mean"].clone();
  torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4).weight_decay(1e-4));
  pando::reference::TrainingBatch batch{torch::zeros({1,3,64,64}),torch::zeros({1,3,32,32}),torch::zeros({1,4}),
    torch::zeros({1,7,64,64}),torch::ones({1,7,64,64})};
  batch.target.index_put_({torch::indexing::Slice(),torch::indexing::Slice(),torch::indexing::Slice(20,40),torch::indexing::Slice(20,40)},1);
  batch.valid.index_put_({torch::indexing::Slice(),torch::indexing::Slice(),torch::indexing::Slice(0,10),torch::indexing::Slice()},0);
  const auto weights=torch::tensor({1.f,2.f,3.f,4.f,5.f,6.f,7.f});
  const double loss=pando::reference::trainingBatchStep(model,optimizer,batch,weights);
  if(!std::isfinite(loss)||std::abs(loss-1.8224329948425293)>.005)throw std::runtime_error("Weighted training loss differs from Python");
  const auto flat=model->head->weight.detach().flatten();const double expected[]={-.017777608707547188,-.01556776836514473,-.013158323243260384,-.01094860304147005,-.008938760496675968};
  for(int i=0;i<5;++i)if(std::abs(flat[i].item<double>()-expected[i])>0.00005)throw std::runtime_error("AdamW update differs from Python");
  if(!torch::equal(before,model->encoder->at<pando::reference::ConvNormImpl>(0).named_buffers(true)["1.running_mean"]))throw std::runtime_error("Frozen encoder statistics changed");
  for(const auto& parameter:model->encoder->parameters())if(parameter.grad().defined())throw std::runtime_error("Frozen encoder received gradient");
  auto old=model->head->weight.detach().clone();batch.tile.fill_(std::numeric_limits<float>::quiet_NaN());bool refused=false;
  try{pando::reference::trainingBatchStep(model,optimizer,batch,weights);}catch(const std::runtime_error&){refused=true;}
  if(!refused||!torch::equal(old,model->head->weight.detach()))throw std::runtime_error("Nonfinite input changed the model");
  std::cout<<"Weighted frozen-encoder AdamW step and nonfinite refusal verified\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
