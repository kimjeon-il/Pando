#pragma once
#include <torch/torch.h>
#include <cstdint>
#include <string>
#include <vector>

namespace pando::reference {
struct SamplingState {
    int64_t epoch=0,cursor=0,seed=0;
    std::vector<int64_t> order;
};
// Restore only into a fresh model and optimizer, never the live training state.
std::string saveTrainingCheckpoint(torch::nn::Module& model,torch::optim::AdamW& optimizer,
    const SamplingState& sampling,const torch::Device& device);
SamplingState loadTrainingCheckpoint(torch::nn::Module& freshModel,torch::optim::AdamW& freshOptimizer,
    const std::string& bytes,const torch::Device& device);
}
