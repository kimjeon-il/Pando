#pragma once
#include <torch/torch.h>

namespace pando::reference {
// Preserves channel-specific validity and optional positive class weights.
torch::Tensor boundaryLoss(const torch::Tensor& logits,const torch::Tensor& target,
    const torch::Tensor& valid,const c10::optional<torch::Tensor>& positiveWeight=c10::nullopt);
}
