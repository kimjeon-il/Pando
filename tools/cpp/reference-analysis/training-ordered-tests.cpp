#include "training-ordered-step.h"
#include <ATen/Context.h>
#include <iostream>
#include <stdexcept>

int main(){try{
  torch::set_num_threads(2);at::globalContext().setDeterministicAlgorithms(true,false);torch::manual_seed(20261022);
  const torch::Device device(torch::kCPU);pando::reference::ReferenceBoundaryModel model;model->train();
  for(auto& parameter:model->encoder->parameters())parameter.requires_grad_(false);model->encoder->eval();
  torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4).weight_decay(1e-4));
  pando::reference::TrainingBatch batch{torch::zeros({1,3,64,64}),torch::zeros({1,3,32,32}),torch::zeros({1,4}),
    torch::zeros({1,7,64,64}),torch::ones({1,7,64,64})};
  pando::reference::SamplingState state{1,0,20261023,{9,4}};
  bool refused=false;try{pando::reference::orderedTrainingBatchStep(model,optimizer,batch,state,{4});}catch(const std::invalid_argument&){refused=true;}
  if(!refused||state.cursor!=0)throw std::runtime_error("Out-of-order batch advanced state");
  pando::reference::orderedTrainingBatchStep(model,optimizer,batch,state,{9});
  const auto checkpoint=pando::reference::saveTrainingCheckpoint(*model,optimizer,state,device);
  batch.tile.fill_(.1);const auto expectedLoss=pando::reference::orderedTrainingBatchStep(model,optimizer,batch,state,{4});
  pando::reference::ReferenceBoundaryModel resumed;torch::optim::AdamW resumedOptimizer(resumed->parameters(),torch::optim::AdamWOptions(1e-4).weight_decay(1e-4));
  auto restored=pando::reference::loadTrainingCheckpoint(*resumed,resumedOptimizer,checkpoint,device);
  if(restored.epoch!=1||restored.cursor!=1||restored.seed!=state.seed||restored.order!=state.order)throw std::runtime_error("Saved sampling state changed");
  const auto actualLoss=pando::reference::orderedTrainingBatchStep(resumed,resumedOptimizer,batch,restored,{4});
  if(actualLoss!=expectedLoss||restored.cursor!=2)throw std::runtime_error("Resumed batch loss or position differs");
  const auto actual=resumed->named_parameters(true);for(const auto& item:model->named_parameters(true))
    if(!actual.contains(item.key())||!torch::equal(item.value(),actual[item.key()]))throw std::runtime_error("Resumed parameter differs: "+item.key());
  const auto buffers=resumed->named_buffers(true);for(const auto& item:model->named_buffers(true))
    if(!buffers.contains(item.key())||!torch::equal(item.value(),buffers[item.key()]))throw std::runtime_error("Resumed buffer differs: "+item.key());
  std::cout<<"Ordered training and exact checkpoint resume verified\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
