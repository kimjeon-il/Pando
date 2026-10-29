#include "reference-io.h"
#include "reference-model.h"
#include "reference-onnx.h"
#include "safetensors.h"
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace fs=std::filesystem;
namespace {
int run(const std::vector<fs::path>& args){
    if(args.size()!=3)throw std::runtime_error("Usage: pando-reference-onnx-export WEIGHTS|--diagnostic NEW_OUTPUT");
    if(fs::exists(args[2]))throw std::runtime_error("ONNX output exists; preserve the existing file");
    torch::set_num_threads(2);const bool diagnostic=args[1]==fs::path("--diagnostic");
    if(diagnostic)torch::manual_seed(20261022);
    pando::reference::ReferenceBoundaryModel model;
    if(!diagnostic){
        const auto metadata=pando::reference::loadSafetensors(*model,pando::reference::readBounded(args[1],256*1024*1024));
        const auto architecture=metadata.find("architecture"),scope=metadata.find("trainingOnly");
        if(architecture==metadata.end()||architecture->second!="mobilenetv3-unet-context-v1"||scope==metadata.end()||scope->second!="true")
            throw std::runtime_error("A pending training-only reference checkpoint is required");
    }
    model->eval();const auto bytes=pando::reference::exportReferenceOnnx(model);
    pando::reference::writeNewFile(args[2],bytes);
    std::cout<<"{\"trainingOnly\":true,\"releaseApproved\":false,\"diagnostic\":"<<(diagnostic?"true":"false")
        <<",\"opset\":17,\"bytes\":"<<bytes.size()<<"}\n";return 0;
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
