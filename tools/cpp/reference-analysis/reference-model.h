#pragma once
#include <torch/torch.h>

namespace pando::reference {
struct ConvNormImpl:torch::nn::SequentialImpl {
    ConvNormImpl(int64_t input,int64_t output,int64_t kernel,int64_t stride,int64_t groups,int activation);
    torch::Tensor forward(const torch::Tensor& input);
};
TORCH_MODULE(ConvNorm);

struct SqueezeExcitationImpl:torch::nn::Module {
    torch::nn::Conv2d fc1{nullptr},fc2{nullptr};
    SqueezeExcitationImpl(int64_t channels,int64_t squeezed);
    torch::Tensor forward(const torch::Tensor& input);
};
TORCH_MODULE(SqueezeExcitation);

struct InvertedResidualImpl:torch::nn::Module {
    torch::nn::Sequential block{nullptr};bool residual=false;
    InvertedResidualImpl(int64_t input,int64_t kernel,int64_t expanded,int64_t output,bool squeeze,bool hard,int64_t stride);
    torch::Tensor forward(const torch::Tensor& input);
};
TORCH_MODULE(InvertedResidual);

struct DecodeImpl:torch::nn::Module {
    torch::nn::Sequential conv{nullptr};
    DecodeImpl(int64_t incoming,int64_t skip,int64_t outgoing);
    torch::Tensor forward(const torch::Tensor& input,const torch::Tensor& skip);
};
TORCH_MODULE(Decode);

struct ReferenceBoundaryModelImpl:torch::nn::Module {
    torch::nn::Sequential encoder{nullptr},overview{nullptr},context{nullptr};
    torch::nn::ModuleList decode{nullptr};torch::nn::Conv2d head{nullptr};
    ReferenceBoundaryModelImpl();
    torch::Tensor forward(const torch::Tensor& tile,const torch::Tensor& overviewInput,const torch::Tensor& position);
};
TORCH_MODULE(ReferenceBoundaryModel);
}
