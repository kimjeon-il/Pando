#include "boundary-loss.h"
#include <vector>

namespace pando::reference {
namespace F=torch::nn::functional;
namespace {
torch::Tensor pool(const torch::Tensor& value,std::vector<int64_t> kernel,std::vector<int64_t> padding){
    return F::max_pool2d(value,F::MaxPool2dFuncOptions(kernel).stride(1).padding(padding));
}
torch::Tensor skeleton(torch::Tensor value){
    auto result=torch::relu(value-pool(-pool(-value,{3,3},{1,1}),{3,3},{1,1}));
    for(int i=0;i<10;++i){
        value=torch::minimum(-pool(-value,{3,1},{1,0}),-pool(-value,{1,3},{0,1}));
        auto opened=pool(-pool(-value,{3,3},{1,1}),{3,3},{1,1});
        auto update=torch::relu(value-opened);result=result+torch::relu(update-result*update);
    }
    return result;
}
}
torch::Tensor boundaryLoss(const torch::Tensor& logits,const torch::Tensor& target,
    const torch::Tensor& valid,const c10::optional<torch::Tensor>& positiveWeight){
    TORCH_CHECK(logits.dim()==4 && logits.size(1)==7,"Expected seven-channel NCHW logits");
    TORCH_CHECK(target.sizes()==logits.sizes(),"Target shape must match logits");
    TORCH_CHECK(valid.dim()==4 && valid.size(0)==logits.size(0) && valid.size(2)==logits.size(2)
        && valid.size(3)==logits.size(3) && (valid.size(1)==1 || valid.size(1)==logits.size(1)),"Invalid supervision mask shape");
    const auto mask=valid.expand_as(logits),probability=torch::sigmoid(logits)*mask,truth=target*mask;
    auto options=F::BinaryCrossEntropyWithLogitsFuncOptions().reduction(torch::kNone);
    if(positiveWeight){
        TORCH_CHECK(positiveWeight->numel()==7,"Positive weights must contain seven values");
        options.pos_weight(positiveWeight->to(logits.options()).view({1,-1,1,1}));
    }
    const auto bce=(F::binary_cross_entropy_with_logits(logits,target,options)*mask).sum()/mask.sum().clamp_min(1);
    const std::vector<int64_t> axes{0,2,3};
    const auto active=(mask.sum(axes)>0).to(logits.scalar_type());
    const auto dice=((1-(2*(probability*truth).sum(axes)+1)/(probability.sum(axes)+truth.sum(axes)+1))*active).sum()/active.sum().clamp_min(1);
    using torch::indexing::Slice;
    const auto predicted=skeleton(probability.index({Slice(),Slice(0,3)})),reference=skeleton(truth.index({Slice(),Slice(0,3)}));
    const auto precision=((predicted*truth.index({Slice(),Slice(0,3)})).sum()+1)/(predicted.sum()+1);
    const auto recall=((reference*probability.index({Slice(),Slice(0,3)})).sum()+1)/(reference.sum()+1);
    const auto connectivity=1-2*precision*recall/(precision+recall).clamp_min(1e-6);
    return bce+dice+.1*connectivity;
}
}
