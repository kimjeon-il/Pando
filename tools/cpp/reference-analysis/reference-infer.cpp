#include "reference-model.h"
#include "reference-io.h"
#include "safetensors.h"
#include <torch/torch.h>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace fs=std::filesystem;
namespace {
int run(const std::vector<fs::path>& args){
    if(args.size()!=6)throw std::runtime_error("Usage: pando-reference-infer DEVICE SAFETENSORS TILE_F32 OVERVIEW_F32 POSITION_F32");
    const auto device=pando::reference::selectDevice(args[1].string());
    pando::reference::ReferenceBoundaryModel model;
    const auto metadata=pando::reference::loadSafetensors(*model,pando::reference::readBounded(args[2],256*1024*1024));
    const auto architecture=metadata.find("architecture");
    if(architecture==metadata.end()||architecture->second!="mobilenetv3-unet-context-v1")throw std::runtime_error("Reference checkpoint architecture is missing or incompatible");
    model->to(device);model->eval();torch::NoGradGuard guard;
    const auto output=model->forward(pando::reference::readFloatTensor(args[3],{1,3,512,512}).to(device),
        pando::reference::readFloatTensor(args[4],{1,3,256,256}).to(device),pando::reference::readFloatTensor(args[5],{1,4}).to(device)).to(torch::kCPU).contiguous();
    if(output.sizes()!=torch::IntArrayRef({1,7,512,512})||!torch::isfinite(output).all().item<bool>())throw std::runtime_error("Reference inference returned invalid logits");
#ifdef _WIN32
    if(_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Cannot set binary stdout");
#endif
    std::cout.write(static_cast<const char*>(output.data_ptr()),static_cast<std::streamsize>(output.numel()*sizeof(float)));
    if(!std::cout)throw std::runtime_error("Cannot write reference logits");return 0;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
#else
int main(int argc,char** argv){
#endif
    try{std::vector<fs::path> args;for(int i=0;i<argc;++i)args.emplace_back(argv[i]);return run(args);}
    catch(const std::exception& error){std::cerr<<"reference-infer: "<<error.what()<<'\n';return 1;}
}
