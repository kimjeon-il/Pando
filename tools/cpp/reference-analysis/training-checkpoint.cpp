#include "training-checkpoint.h"
#include <ATen/Context.h>
#include <map>
#include <sstream>
#include <stdexcept>

namespace pando::reference {
namespace {
void validate(const SamplingState& state,const torch::Device& device){
    if(state.epoch<0||state.cursor<0||state.seed<0||static_cast<std::uint64_t>(state.cursor)>state.order.size())
        throw std::invalid_argument("Invalid training sampling state");
    for(const auto item:state.order)if(item<0)throw std::invalid_argument("Invalid training sample index");
    if(!device.is_cpu()&&!device.is_cuda())throw std::invalid_argument("Only CPU or CUDA training checkpoints are supported");
}
std::map<std::string,bool> flags(const c10::IValue& value){
    if(!value.isGenericDict())throw std::runtime_error("Invalid training checkpoint flags");
    std::map<std::string,bool> result;
    for(const auto& item:value.toGenericDict()){
        if(!item.key().isString()||!item.value().isBool())throw std::runtime_error("Invalid training checkpoint flag value");
        if(!result.emplace(item.key().toStringRef(),item.value().toBool()).second)throw std::runtime_error("Duplicate training checkpoint flag");
    }
    return result;
}
}
std::string saveTrainingCheckpoint(torch::nn::Module& model,torch::optim::AdamW& optimizer,
    const SamplingState& sampling,const torch::Device& device){
    validate(sampling,device);
    torch::serialize::OutputArchive archive,modelArchive,optimizerArchive;
    model.save(modelArchive);optimizer.save(optimizerArchive);archive.write("model",modelArchive);archive.write("optimizer",optimizerArchive);
    const auto header=torch::tensor({int64_t{1},sampling.epoch,sampling.cursor,sampling.seed,
        int64_t{device.is_cuda()?1:0},int64_t{device.is_cuda()?device.index():-1},int64_t{model.is_training()?1:0}},torch::kInt64);
    archive.write("header",header,true);archive.write("sampling",torch::tensor(sampling.order,torch::kInt64),true);
    c10::Dict<std::string,bool> parameters,modes;
    for(const auto& item:model.named_parameters(true))parameters.insert(item.key(),item.value().requires_grad());
    for(const auto& item:model.named_modules("",false))modes.insert(item.key(),item.value()->is_training());
    archive.write("requiresGrad",c10::IValue(parameters));archive.write("trainingModes",c10::IValue(modes));
    archive.write("rngCPU",at::globalContext().defaultGenerator(torch::Device(torch::kCPU)).get_state(),true);
    if(device.is_cuda())archive.write("rngCUDA",at::globalContext().defaultGenerator(device).get_state(),true);
    std::ostringstream stream(std::ios::out|std::ios::binary);archive.save_to(stream);return stream.str();
}
SamplingState loadTrainingCheckpoint(torch::nn::Module& freshModel,torch::optim::AdamW& freshOptimizer,
    const std::string& bytes,const torch::Device& device){
    if(bytes.empty()||bytes.size()>1024ULL*1024*1024)throw std::invalid_argument("Invalid training checkpoint length");
    torch::serialize::InputArchive archive,modelArchive,optimizerArchive;archive.load_from(bytes.data(),bytes.size());
    torch::Tensor header,order,cpuRng,cudaRng;c10::IValue parameterValue,modeValue;
    archive.read("header",header,true);archive.read("sampling",order,true);archive.read("rngCPU",cpuRng,true);
    archive.read("requiresGrad",parameterValue);archive.read("trainingModes",modeValue);
    const auto parameterFlags=flags(parameterValue),modeFlags=flags(modeValue);
    const auto parameters=freshModel.named_parameters(true);
    const auto modules=freshModel.named_modules("",false);
    if(parameterFlags.size()!=parameters.size()||modeFlags.size()!=modules.size())throw std::runtime_error("Training checkpoint model inventory differs");
    for(const auto& item:parameters)if(!parameterFlags.count(item.key()))throw std::runtime_error("Training checkpoint parameter missing");
    for(const auto& item:modules)if(!modeFlags.count(item.key()))throw std::runtime_error("Training checkpoint module missing");
    if(header.scalar_type()!=torch::kInt64||header.dim()!=1||header.numel()!=7||order.scalar_type()!=torch::kInt64||order.dim()!=1)
        throw std::runtime_error("Invalid training checkpoint metadata");
    header=header.to(torch::kCPU).contiguous();order=order.to(torch::kCPU).contiguous();
    const auto* fields=header.data_ptr<int64_t>();const bool cuda=fields[4]==1;
    if(fields[0]!=1||(fields[4]!=0&&fields[4]!=1)||(fields[6]!=0&&fields[6]!=1)||cuda!=device.is_cuda()||(cuda&&fields[5]!=device.index()))
        throw std::runtime_error("Training checkpoint format or device differs");
    SamplingState sampling{fields[1],fields[2],fields[3],{}};
    const auto* samples=order.data_ptr<int64_t>();for(int64_t i=0;i<order.numel();++i)sampling.order.push_back(samples[i]);validate(sampling,device);
    if(cuda)archive.read("rngCUDA",cudaRng,true);
    archive.read("model",modelArchive);archive.read("optimizer",optimizerArchive);
    freshModel.load(modelArchive);freshOptimizer.load(optimizerArchive);
    freshModel.train(fields[6]==1);
    for(const auto& item:modules)item.value()->train(modeFlags.at(item.key()));
    for(const auto& item:parameters)item.value().requires_grad_(parameterFlags.at(item.key()));
    auto cpu=at::globalContext().defaultGenerator(torch::Device(torch::kCPU));cpu.set_state(cpuRng.to(torch::kCPU));
    if(cuda){auto gpu=at::globalContext().defaultGenerator(device);gpu.set_state(cudaRng.to(torch::kCPU));}
    return sampling;
}
}
