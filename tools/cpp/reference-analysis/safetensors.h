#pragma once
#include <torch/torch.h>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace pando::reference {
// Validate every name, type, shape and byte range before changing model state.
std::map<std::string,std::string> loadSafetensors(torch::nn::Module& model,const std::vector<std::uint8_t>& file);
}
