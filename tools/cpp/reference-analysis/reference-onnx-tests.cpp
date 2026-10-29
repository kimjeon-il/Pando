#include "reference-onnx.h"
#include "reference-io.h"
#include "training-checkpoint.h"
#include <torch/torch.h>
#include <filesystem>
#include <iostream>
#include <stdexcept>

namespace fs=std::filesystem;
namespace {
std::string raw(const torch::Tensor& value){
    const auto contiguous=value.to(torch::kCPU).contiguous();
    if(contiguous.scalar_type()!=torch::kFloat32)throw std::runtime_error("Expected float32 tensor");
    return {static_cast<const char*>(contiguous.data_ptr()),static_cast<std::size_t>(contiguous.numel()*sizeof(float))};
}
int run(const std::vector<fs::path>& args){
    const bool checkpoint=args.size()==8&&args[1]==fs::path("--checkpoint");
    if((args.size()!=2&&!checkpoint)||!fs::is_directory(args.back()))throw std::runtime_error("An existing empty diagnostic directory is required");
    const auto dir=args.back();
    for(const auto* name:{"model.onnx","tile.f32","overview.f32","position.f32","expected.f32"})
        if(fs::exists(dir/name))throw std::runtime_error("Diagnostic output exists");
    const auto device=pando::reference::selectDevice(checkpoint?args[2].string():"cpu");
    torch::manual_seed(20261029);pando::reference::ReferenceBoundaryModel model;
    bool refusedTrainingMode=false;
    try{pando::reference::exportReferenceOnnx(model);}catch(const std::exception&){refusedTrainingMode=true;}
    if(!refusedTrainingMode)throw std::runtime_error("ONNX exporter accepted training-mode normalization");
    if(checkpoint){
        model->to(device);
        torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4));
        const auto data=pando::reference::readBounded(args[3],1024ULL*1024*1024);
        pando::reference::loadTrainingCheckpoint(*model,optimizer,std::string(data.begin(),data.end()),device);
    }
    model->eval();torch::NoGradGuard guard;
    const auto tile=checkpoint?pando::reference::readFloatTensor(args[4],{1,3,512,512}):
        (torch::remainder(torch::arange(3*512*512,torch::kFloat32),251)/250).reshape({1,3,512,512});
    const auto overview=checkpoint?pando::reference::readFloatTensor(args[5],{1,3,256,256}):
        (torch::remainder(torch::arange(3*256*256,torch::kFloat32),197)/196).reshape({1,3,256,256});
    const auto position=checkpoint?pando::reference::readFloatTensor(args[6],{1,4}):torch::tensor({.1f,-.2f,.3f,.4f}).reshape({1,4});
    const auto expected=model->forward(tile.to(device),overview.to(device),position.to(device));
    if(!torch::isfinite(expected).all().item<bool>())throw std::runtime_error("Synthetic reference output is nonfinite");
    model->to(torch::kCPU);
    const auto onnx=pando::reference::exportReferenceOnnx(model);
    pando::reference::writeNewFile(dir/"tile.f32",raw(tile));pando::reference::writeNewFile(dir/"overview.f32",raw(overview));
    pando::reference::writeNewFile(dir/"position.f32",raw(position));pando::reference::writeNewFile(dir/"expected.f32",raw(expected));
    pando::reference::writeNewFile(dir/"model.onnx",onnx);return 0;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
#else
int main(int argc,char** argv){
#endif
    try{std::vector<fs::path> args;for(int i=0;i<argc;++i)args.emplace_back(argv[i]);return run(args);}
    catch(const std::exception& error){std::cerr<<"reference-onnx-tests: "<<error.what()<<'\n';return 1;}
}
