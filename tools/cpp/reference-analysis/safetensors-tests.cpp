#include "safetensors.h"
#include <torch/torch.h>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

struct TinyModel:torch::nn::Module {
    torch::Tensor weight,counter;
    TinyModel(){weight=register_parameter("weight",torch::zeros({2}));counter=register_buffer("counter",torch::zeros({},torch::kInt64));}
};
std::vector<std::uint8_t> file(const std::string& header){
    std::vector<std::uint8_t> bytes(8+header.size()+16);const auto n=static_cast<std::uint64_t>(header.size());
    for(int i=0;i<8;i++)bytes[i]=static_cast<std::uint8_t>(n>>(i*8));std::memcpy(bytes.data()+8,header.data(),header.size());
    const float weights[]={1.25f,-2.5f};const std::int64_t counter=7;
    std::memcpy(bytes.data()+8+header.size(),weights,8);std::memcpy(bytes.data()+16+header.size(),&counter,8);return bytes;
}
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
int main(){
    try{
        const std::string good=R"({"weight":{"dtype":"F32","shape":[2],"data_offsets":[0,8]},"counter":{"dtype":"I64","shape":[],"data_offsets":[8,16]},"__metadata__":{"training":"weights-only"}})";
        TinyModel model;const auto meta=pando::reference::loadSafetensors(model,file(good));
        check(model.weight[0].item<float>()==1.25f&&model.weight[1].item<float>()==-2.5f,"Weight values differ");
        check(model.counter.item<std::int64_t>()==7&&meta.at("training")=="weights-only","Scalar buffer/metadata differ");
        for(const std::string bad:{
            R"({"weight":{"dtype":"F32","shape":[2],"data_offsets":[0,8]}})",
            R"({"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,8]},"counter":{"dtype":"I64","shape":[],"data_offsets":[8,16]}})",
            R"({"weight":{"dtype":"F32","shape":[2],"data_offsets":[0,8]},"counter":{"dtype":"I64","shape":[],"data_offsets":[4,12]}})",
            R"({"weight":{"dtype":"F32","shape":[2],"data_offsets":[0,8]},"weight":{"dtype":"F32","shape":[2],"data_offsets":[0,8]},"counter":{"dtype":"I64","shape":[],"data_offsets":[8,16]}})"}){
            TinyModel untouched;bool rejected=false;try{pando::reference::loadSafetensors(untouched,file(bad));}catch(const std::exception&){rejected=true;}
            check(rejected,"Invalid Safetensors input accepted");
            check(untouched.weight.sum().item<float>()==0&&untouched.counter.item<std::int64_t>()==0,"Invalid input mutated model state");
        }
        auto altered=file(good);altered[0]=255;TinyModel untouched;bool rejected=false;
        try{pando::reference::loadSafetensors(untouched,altered);}catch(const std::exception&){rejected=true;}check(rejected,"Invalid header length accepted");
        std::cout<<"Safetensors names, values, metadata and invalid inputs verified\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
