#include "reference-io.h"
#include "reference-model.h"
#include "reference-onnx.h"
#include "safetensors.h"
#include "training-checkpoint.h"
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace fs=std::filesystem;
namespace {
int run(const std::vector<fs::path>& args){
    const bool checkpoint=args.size()==5&&args[1]==fs::path("--checkpoint");
    if(args.size()!=3&&!checkpoint)throw std::runtime_error("Usage: pando-reference-onnx-export WEIGHTS|--diagnostic NEW_OUTPUT, or --checkpoint DEVICE CHECKPOINT NEW_OUTPUT");
    const auto output=args.back();
    if(fs::exists(output))throw std::runtime_error("ONNX output exists; preserve the existing file");
    const auto device=pando::reference::selectDevice(checkpoint?args[2].string():"cpu");
    const bool diagnostic=!checkpoint&&args[1]==fs::path("--diagnostic");
    if(diagnostic)torch::manual_seed(20261022);
    pando::reference::ReferenceBoundaryModel model;
    if(checkpoint){
        model->to(device);
        torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4));
        const auto data=pando::reference::readBounded(args[3],1024ULL*1024*1024);
        pando::reference::loadTrainingCheckpoint(*model,optimizer,std::string(data.begin(),data.end()),device);
        model->to(torch::kCPU);
    }else if(!diagnostic){
        const auto metadata=pando::reference::loadSafetensors(*model,pando::reference::readBounded(args[1],256*1024*1024));
        const auto architecture=metadata.find("architecture"),scope=metadata.find("trainingOnly");
        if(architecture==metadata.end()||architecture->second!="mobilenetv3-unet-context-v1"||scope==metadata.end()||scope->second!="true")
            throw std::runtime_error("A pending training-only reference checkpoint is required");
    }
    model->eval();const auto bytes=pando::reference::exportReferenceOnnx(model);
    pando::reference::writeNewFile(output,bytes);
    std::cout<<"{\"trainingOnly\":true,\"releaseApproved\":false,\"diagnostic\":"<<(diagnostic?"true":"false")
        <<",\"checkpoint\":"<<(checkpoint?"true":"false")<<",\"opset\":17,\"bytes\":"<<bytes.size()<<"}\n";return 0;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
#else
int main(int argc,char** argv){
#endif
    try{std::vector<fs::path> args;for(int i=0;i<argc;++i)args.emplace_back(argv[i]);return run(args);}
    catch(const std::exception& error){std::cerr<<"reference-onnx-export: "<<error.what()<<'\n';return 1;}
}
