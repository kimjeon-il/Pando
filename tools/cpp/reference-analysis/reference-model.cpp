#include "reference-model.h"
#include <algorithm>
#include <array>
#include <vector>

namespace pando::reference {
namespace F=torch::nn::functional;
namespace {
struct HardSwishImpl:torch::nn::Module {torch::Tensor forward(const torch::Tensor& x){return torch::hardswish(x);}};
TORCH_MODULE(HardSwish);
int64_t divisible(int64_t value){
    auto result=std::max<int64_t>(8,((value+4)/8)*8);if(result*10<value*9)result+=8;return result;
}
torch::Tensor resize(const torch::Tensor& value,int64_t height,int64_t width){
    return F::interpolate(value,F::InterpolateFuncOptions().size(std::vector<int64_t>{height,width}).mode(torch::kBilinear).align_corners(false));
}
}
ConvNormImpl::ConvNormImpl(int64_t input,int64_t output,int64_t kernel,int64_t stride,int64_t groups,int activation){
    push_back(torch::nn::Conv2d(torch::nn::Conv2dOptions(input,output,kernel).stride(stride).padding((kernel-1)/2).groups(groups).bias(false)));
    push_back(torch::nn::BatchNorm2d(torch::nn::BatchNorm2dOptions(output).eps(.001).momentum(.01)));
    if(activation==1)push_back(torch::nn::ReLU(torch::nn::ReLUOptions().inplace(true)));
    if(activation==2)push_back(HardSwish());
}
torch::Tensor ConvNormImpl::forward(const torch::Tensor& input){return torch::nn::SequentialImpl::forward(input);}
SqueezeExcitationImpl::SqueezeExcitationImpl(int64_t channels,int64_t squeezed){
    fc1=register_module("fc1",torch::nn::Conv2d(torch::nn::Conv2dOptions(channels,squeezed,1)));
    fc2=register_module("fc2",torch::nn::Conv2d(torch::nn::Conv2dOptions(squeezed,channels,1)));
}
torch::Tensor SqueezeExcitationImpl::forward(const torch::Tensor& input){
    return input*torch::hardsigmoid(fc2->forward(torch::relu(fc1->forward(F::adaptive_avg_pool2d(input,F::AdaptiveAvgPool2dFuncOptions({1,1}))))));
}
InvertedResidualImpl::InvertedResidualImpl(int64_t input,int64_t kernel,int64_t expanded,int64_t output,bool squeeze,bool hard,int64_t stride){
    block=register_module("block",torch::nn::Sequential());residual=stride==1&&input==output;const int activation=hard?2:1;
    if(expanded!=input)block->push_back(ConvNorm(input,expanded,1,1,1,activation));
    block->push_back(ConvNorm(expanded,expanded,kernel,stride,expanded,activation));
    if(squeeze)block->push_back(SqueezeExcitation(expanded,divisible(expanded/4)));
    block->push_back(ConvNorm(expanded,output,1,1,1,0));
}
torch::Tensor InvertedResidualImpl::forward(const torch::Tensor& input){auto out=block->forward(input);return residual?out+input:out;}
DecodeImpl::DecodeImpl(int64_t incoming,int64_t skip,int64_t outgoing){
    conv=register_module("conv",torch::nn::Sequential(
        torch::nn::Conv2d(torch::nn::Conv2dOptions(incoming+skip,outgoing,3).padding(1).bias(false)),
        torch::nn::GroupNorm(torch::nn::GroupNormOptions(8,outgoing)),torch::nn::ReLU(torch::nn::ReLUOptions().inplace(true)),
        torch::nn::Conv2d(torch::nn::Conv2dOptions(outgoing,outgoing,3).padding(1).bias(false)),
        torch::nn::GroupNorm(torch::nn::GroupNormOptions(8,outgoing)),torch::nn::ReLU(torch::nn::ReLUOptions().inplace(true))));
}
torch::Tensor DecodeImpl::forward(const torch::Tensor& input,const torch::Tensor& skip){return conv->forward(torch::cat({resize(input,skip.size(2),skip.size(3)),skip},1));}
ReferenceBoundaryModelImpl::ReferenceBoundaryModelImpl(){
    encoder=register_module("encoder",torch::nn::Sequential());encoder->push_back(ConvNorm(3,16,3,2,1,2));
    struct Config{int input,kernel,expanded,output;bool squeeze,hard;int stride;};
    const std::array<Config,15> configs{{
        {16,3,16,16,false,false,1},{16,3,64,24,false,false,2},{24,3,72,24,false,false,1},
        {24,5,72,40,true,false,2},{40,5,120,40,true,false,1},{40,5,120,40,true,false,1},
        {40,3,240,80,false,true,2},{80,3,200,80,false,true,1},{80,3,184,80,false,true,1},{80,3,184,80,false,true,1},
        {80,3,480,112,true,true,1},{112,3,672,112,true,true,1},{112,5,672,160,true,true,2},
        {160,5,960,160,true,true,1},{160,5,960,160,true,true,1}}};
    for(const auto& row:configs)encoder->push_back(InvertedResidual(row.input,row.kernel,row.expanded,row.output,row.squeeze,row.hard,row.stride));
    encoder->push_back(ConvNorm(160,960,1,1,1,2));
    overview=register_module("overview",torch::nn::Sequential(torch::nn::Conv2d(torch::nn::Conv2dOptions(3,16,5).stride(2).padding(2)),torch::nn::ReLU(),
        torch::nn::Conv2d(torch::nn::Conv2dOptions(16,32,3).stride(2).padding(1)),torch::nn::ReLU(),torch::nn::AdaptiveAvgPool2d(torch::nn::AdaptiveAvgPool2dOptions({1,1}))));
    context=register_module("context",torch::nn::Sequential(torch::nn::Conv2d(torch::nn::Conv2dOptions(996,256,1)),torch::nn::ReLU()));
    decode=register_module("decode",torch::nn::ModuleList());decode->push_back(Decode(256,112,128));decode->push_back(Decode(128,40,96));
    decode->push_back(Decode(96,24,64));decode->push_back(Decode(64,16,32));head=register_module("head",torch::nn::Conv2d(torch::nn::Conv2dOptions(32,7,1)));
}
torch::Tensor ReferenceBoundaryModelImpl::forward(const torch::Tensor& tile,const torch::Tensor& overviewInput,const torch::Tensor& position){
    TORCH_CHECK(tile.dim()==4&&tile.size(1)==3&&overviewInput.dim()==4&&overviewInput.size(1)==3&&position.dim()==2&&position.size(1)==4,
        "Expected tile and overview NCHW RGB tensors and four position values");
    TORCH_CHECK(tile.size(0)==overviewInput.size(0)&&tile.size(0)==position.size(0),"Reference model batch sizes differ");
    std::vector<torch::Tensor> features;auto value=encoder->at<ConvNormImpl>(0).forward(tile);
    for(size_t i=1;i<=15;++i){value=encoder->at<InvertedResidualImpl>(i).forward(value);if(i==1||i==3||i==6||i==12)features.push_back(value);}
    value=encoder->at<ConvNormImpl>(16).forward(value);
    auto global=overview->forward(overviewInput).expand({-1,-1,value.size(2),value.size(3)});
    auto bounds=position.unsqueeze(-1).unsqueeze(-1).expand({-1,-1,value.size(2),value.size(3)});
    value=context->forward(torch::cat({value,global,bounds},1));
    for(size_t i=0;i<4;++i)value=decode[i]->as<DecodeImpl>()->forward(value,features[3-i]);
    return resize(head->forward(value),tile.size(2),tile.size(3));
}
}
