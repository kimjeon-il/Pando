#include "reference-model.h"
#include "safetensors.h"
#include <torch/torch.h>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#endif

namespace fs=std::filesystem;
namespace {
std::vector<std::uint8_t> bytes(const fs::path& path,std::uint64_t limit){
    const auto size=fs::file_size(path);if(size>limit)throw std::runtime_error("Reference input exceeds its size limit");
    std::vector<std::uint8_t> result(static_cast<size_t>(size));std::ifstream input(path,std::ios::binary);
    if(!input||!input.read(reinterpret_cast<char*>(result.data()),static_cast<std::streamsize>(result.size())))throw std::runtime_error("Cannot read reference input");
    return result;
}
torch::Tensor inputTensor(const fs::path& path,const std::vector<int64_t>& shape){
    std::uint64_t count=1;for(const auto n:shape)count*=n;
    const auto data=bytes(path,count*4);if(data.size()!=count*4)throw std::runtime_error("Reference tensor has an incorrect byte length");
    auto tensor=torch::empty(shape,torch::TensorOptions().dtype(torch::kFloat32));std::memcpy(tensor.data_ptr(),data.data(),data.size());
    if(!torch::isfinite(tensor).all().item<bool>())throw std::runtime_error("Reference tensor contains nonfinite values");return tensor;
}
int run(const std::vector<fs::path>& args){
    if(args.size()!=6)throw std::runtime_error("Usage: pando-reference-infer DEVICE SAFETENSORS TILE_F32 OVERVIEW_F32 POSITION_F32");
    // Match the validated Python runtime and avoid thread-count-dependent logits.
    torch::set_num_threads(2);
    const auto choice=args[1].string();torch::Device device(torch::kCPU);
    if(choice=="cuda"){
#ifdef _WIN32
        // CPU SDK builds can use the matching installed CUDA LibTorch runtime.
        // Load its registration hooks before querying the device.
        if(!LoadLibraryW(L"torch_cuda.dll"))throw std::runtime_error("Cannot load torch_cuda.dll, Win32 error "+std::to_string(GetLastError()));
#endif
        if(!torch::cuda::is_available())throw std::runtime_error("CUDA was requested but is unavailable");device=torch::Device(torch::kCUDA);
    }
    else if(choice!="cpu")throw std::runtime_error("Device must be cpu or cuda");
    pando::reference::ReferenceBoundaryModel model;
    const auto metadata=pando::reference::loadSafetensors(*model,bytes(args[2],256*1024*1024));
    const auto architecture=metadata.find("architecture");
    if(architecture==metadata.end()||architecture->second!="mobilenetv3-unet-context-v1")throw std::runtime_error("Reference checkpoint architecture is missing or incompatible");
    model->to(device);model->eval();torch::NoGradGuard guard;
    const auto output=model->forward(inputTensor(args[3],{1,3,512,512}).to(device),
        inputTensor(args[4],{1,3,256,256}).to(device),inputTensor(args[5],{1,4}).to(device)).to(torch::kCPU).contiguous();
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
