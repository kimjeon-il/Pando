#pragma once
#include <torch/torch.h>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace pando::reference {
std::vector<std::uint8_t> readBounded(const std::filesystem::path& path,std::uint64_t limit);
torch::Tensor readFloatTensor(const std::filesystem::path& path,const std::vector<int64_t>& shape);
torch::Device selectDevice(const std::string& choice);
void writeNewFile(const std::filesystem::path& path,const std::string& bytes);
}
