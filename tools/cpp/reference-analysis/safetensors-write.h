#pragma once
#include <torch/torch.h>
#include <cstdint>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>

namespace pando::reference {
// Export model tensors only. Optimizer and RNG state remain in the checkpoint.
inline std::string saveModelSafetensors(torch::nn::Module& model){
  const std::uint16_t endian=1;if(*reinterpret_cast<const std::uint8_t*>(&endian)!=1)throw std::runtime_error("Safetensors requires little endian");
  std::map<std::string,torch::Tensor> tensors;
  for(const auto& item:model.named_parameters(true))tensors.emplace(item.key(),item.value());
  for(const auto& item:model.named_buffers(true))if(!tensors.emplace(item.key(),item.value()).second)throw std::runtime_error("Duplicate model tensor");
  std::ostringstream header;header<<"{\"__metadata__\":{\"architecture\":\"mobilenetv3-unet-context-v1\",\"trainingOnly\":\"true\"}";
  std::string payload;
  for(const auto& [name,input]:tensors){
    if(name.empty()||name.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.")!=std::string::npos)throw std::runtime_error("Invalid model tensor name");
    const auto value=input.to(torch::kCPU).contiguous();const char* dtype=value.scalar_type()==torch::kFloat32?"F32":value.scalar_type()==torch::kInt64?"I64":nullptr;
    if(!dtype)throw std::runtime_error("Unexpected model tensor dtype");
    if(value.scalar_type()==torch::kFloat32&&!torch::isfinite(value).all().item<bool>())throw std::runtime_error("Nonfinite model tensor");
    const auto begin=payload.size(),length=static_cast<std::size_t>(value.numel()*value.element_size());
    if(length>256ULL*1024*1024-begin)throw std::runtime_error("Model tensors exceed size limit");
    payload.append(static_cast<const char*>(value.data_ptr()),length);
    header<<",\""<<name<<"\":{\"dtype\":\""<<dtype<<"\",\"shape\":[";
    for(std::int64_t i=0;i<value.dim();++i){if(i)header<<',';header<<value.size(i);}
    header<<"],\"data_offsets\":["<<begin<<','<<payload.size()<<"]}";
  }
  header<<'}';auto json=header.str();json.append((8-json.size()%8)%8,' ');
  if(json.size()>64ULL*1024*1024)throw std::runtime_error("Model tensor header exceeds size limit");
  std::string file(8,'\0');for(int i=0;i<8;++i)file[static_cast<std::size_t>(i)]=static_cast<char>((std::uint64_t(json.size())>>(8*i))&255);
  return file+json+payload;
}
}
