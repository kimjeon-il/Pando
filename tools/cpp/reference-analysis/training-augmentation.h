#pragma once
#include <torch/torch.h>
#include <stdexcept>

namespace pando::reference {
// Training inputs are ImageNet-normalized. Apply brightness in RGB space,
// then restore the model's normalized representation.
inline torch::Tensor normalizedBrightness(const torch::Tensor& input,const torch::Tensor& factor){
    if(input.dim()!=4||input.size(1)!=3||!input.is_floating_point()||factor.numel()!=1||
        factor.device()!=input.device()||!torch::isfinite(factor).item<bool>()||factor.item<double>()<=0)
        throw std::invalid_argument("Invalid reference brightness inputs");
    const auto mean=torch::tensor({.485f,.456f,.406f},input.options()).reshape({1,3,1,1});
    const auto deviation=torch::tensor({.229f,.224f,.225f},input.options()).reshape({1,3,1,1});
    return (((input*deviation+mean)*factor).clamp(0,1)-mean)/deviation;
}
}
