// Private real-input resume proof. This is not model evaluation or release.
#include "boundary-loss.h"
#include "reference-io.h"
#include "reference-model.h"
#include "safetensors.h"
#include "training-checkpoint.h"
#include "training-augmentation.h"
#include "training-step.h"
#include <torch/torch.h>
#include <ATen/Context.h>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs=std::filesystem;
namespace {
using pando::reference::ReferenceBoundaryModel;
struct Sample {torch::Tensor tile,overview,position,target,valid;};
double update(ReferenceBoundaryModel& model,torch::optim::AdamW& optimizer,const Sample& sample,const torch::Device& device){
    // One paired brightness draw makes replay depend on the recorded RNG.
    const auto factor=.85+.25*torch::rand({},torch::TensorOptions().dtype(torch::kFloat32).device(device));
    return pando::reference::trainingBatchStep(model,optimizer,{pando::reference::normalizedBrightness(sample.tile,factor),
        pando::reference::normalizedBrightness(sample.overview,factor),sample.position,sample.target,sample.valid});
}
int run(const std::vector<fs::path>& args){
    if(args.size()!=10)throw std::runtime_error("Usage: reference-training-proof DEVICE WEIGHTS TILE OVERVIEW POSITION TARGET VALID NEW_CHECKPOINT TILE_INDEX");
    if(fs::exists(args[8]))throw std::runtime_error("Checkpoint already exists; preserve the existing file");
    const auto device=pando::reference::selectDevice(args[1].string());
    at::globalContext().setDeterministicAlgorithms(true,false);
    const auto source=pando::reference::readBounded(args[2],256*1024*1024);
    Sample sample{pando::reference::readFloatTensor(args[3],{1,3,512,512}).to(device),
        pando::reference::readFloatTensor(args[4],{1,3,256,256}).to(device),pando::reference::readFloatTensor(args[5],{1,4}).to(device),
        pando::reference::readFloatTensor(args[6],{1,7,512,512}).to(device),pando::reference::readFloatTensor(args[7],{1,7,512,512}).to(device)};
    if(sample.valid.min().item<float>()<0||sample.valid.max().item<float>()>1||sample.target.min().item<float>()<0||sample.target.max().item<float>()>1
        ||sample.valid.sum().item<double>()==0)throw std::runtime_error("Real training sample has invalid supervision");
    std::size_t consumed=0;const auto text=args[9].string();const auto index=std::stoll(text,&consumed);
    if(index<0||consumed!=text.size())throw std::runtime_error("Invalid real training tile index");
    ReferenceBoundaryModel original;const auto metadata=pando::reference::loadSafetensors(*original,source);
    const auto architecture=metadata.find("architecture"),scope=metadata.find("trainingOnly");
    if(architecture==metadata.end()||architecture->second!="mobilenetv3-unet-context-v1"||scope==metadata.end()||scope->second!="true")
        throw std::runtime_error("A pending training-only reference checkpoint is required");
    original->to(device);original->train();for(auto& parameter:original->encoder->parameters())parameter.requires_grad_(false);original->encoder->eval();
    torch::optim::AdamW optimizer(original->parameters(),torch::optim::AdamWOptions(1e-4));torch::manual_seed(20261029);
    if(device.is_cuda()){auto generator=at::globalContext().defaultGenerator(device);generator.set_current_seed(20261029);}
    const auto firstLoss=update(original,optimizer,sample,device);
    const pando::reference::SamplingState sampling{0,1,20261029,{index,index}};
    const auto encoded=pando::reference::saveTrainingCheckpoint(*original,optimizer,sampling,device);
    pando::reference::writeNewFile(args[8],encoded);
    const auto saved=pando::reference::readBounded(args[8],1024ULL*1024*1024);
    const std::string persisted(saved.begin(),saved.end());if(persisted!=encoded)throw std::runtime_error("Stored checkpoint bytes differ");
    const auto nextLoss=update(original,optimizer,sample,device);
    ReferenceBoundaryModel resumed;resumed->to(device);torch::optim::AdamW restored(resumed->parameters(),torch::optim::AdamWOptions(1e-4));
    const auto state=pando::reference::loadTrainingCheckpoint(*resumed,restored,persisted,device);
    if(state.epoch!=sampling.epoch||state.cursor!=sampling.cursor||state.seed!=sampling.seed||state.order!=sampling.order)
        throw std::runtime_error("Restored training sample order differs");
    const auto resumedLoss=update(resumed,restored,sample,device);
    if(nextLoss!=resumedLoss)throw std::runtime_error("Resumed real-input loss differs");
    const auto expected=original->named_parameters(true),actual=resumed->named_parameters(true);
    if(expected.size()!=actual.size())throw std::runtime_error("Resumed parameter inventory differs");
    for(const auto& item:expected){if(!actual.contains(item.key())||!torch::equal(item.value(),actual[item.key()]))throw std::runtime_error("Resumed model parameter differs: "+item.key());}
    const auto expectedBuffers=original->named_buffers(true),actualBuffers=resumed->named_buffers(true);
    if(expectedBuffers.size()!=actualBuffers.size())throw std::runtime_error("Resumed buffer inventory differs");
    for(const auto& item:expectedBuffers){if(!actualBuffers.contains(item.key())||!torch::equal(item.value(),actualBuffers[item.key()]))throw std::runtime_error("Resumed model buffer differs: "+item.key());}
    std::cout<<"{\"purpose\":\"real-input-resume-proof\",\"trainingOnly\":true,\"releaseApproved\":false,\"preprocessing\":\"rgb-brightness-then-imagenet-normalization\",\"firstLoss\":"<<firstLoss
        <<",\"resumedLoss\":"<<resumedLoss<<",\"exactModelResume\":true,\"tileIndex\":"<<index<<"}\n";return 0;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
#else
int main(int argc,char** argv){
#endif
    try{std::vector<fs::path> args;for(int i=0;i<argc;++i)args.emplace_back(argv[i]);return run(args);}
    catch(const std::exception& error){std::cerr<<"reference-training-proof: "<<error.what()<<'\n';return 1;}
}
