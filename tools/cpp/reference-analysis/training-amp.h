#pragma once
#include "training-ordered-step.h"
#include <ATen/autocast_mode.h>
#include <ATen/ops/_amp_foreach_non_finite_check_and_unscale.h>
#include <ATen/ops/_amp_update_scale.h>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace pando::reference {
struct TrainingAmpState {float scale=65536.f;std::int32_t growthTracker=0;};
struct TrainingAmpResult {double loss;bool applied;};
class TrainingCudaAutocast {
    bool enabled;at::ScalarType dtype;
public:
    TrainingCudaAutocast():enabled(at::autocast::is_autocast_enabled(at::kCUDA)),dtype(at::autocast::get_autocast_dtype(at::kCUDA)){
        at::autocast::set_autocast_dtype(at::kCUDA,at::kHalf);at::autocast::set_autocast_enabled(at::kCUDA,true);at::autocast::increment_nesting();}
    ~TrainingCudaAutocast(){if(at::autocast::decrement_nesting()==0)at::autocast::clear_cache();
        at::autocast::set_autocast_enabled(at::kCUDA,enabled);at::autocast::set_autocast_dtype(at::kCUDA,dtype);}
    TrainingCudaAutocast(const TrainingCudaAutocast&)=delete;TrainingCudaAutocast& operator=(const TrainingCudaAutocast&)=delete;
};
// Uses the same GradScaler primitives and defaults as torch.amp.GradScaler.
inline bool unscaleAndUpdateTrainingAmp(std::vector<torch::Tensor>& gradients,TrainingAmpState& state,const torch::Device& device){
    if(gradients.empty()||!std::isfinite(state.scale)||state.scale<=0||state.growthTracker<0||state.growthTracker>=2000)
        throw std::invalid_argument("Invalid training AMP state");
    for(const auto& gradient:gradients)if(!gradient.defined()||gradient.device()!=device||gradient.scalar_type()!=torch::kFloat32||gradient.is_sparse())
        throw std::invalid_argument("Training AMP expects dense float32 gradients on one device");
    torch::NoGradGuard guard;auto scale=torch::full({},state.scale,torch::TensorOptions().device(device).dtype(torch::kFloat32));
    auto tracker=torch::full({},state.growthTracker,torch::TensorOptions().device(device).dtype(torch::kInt32));
    auto found=torch::zeros({},torch::TensorOptions().device(device).dtype(torch::kFloat32));
    const auto inverse=scale.to(torch::kFloat64).reciprocal().to(torch::kFloat32);
    at::_amp_foreach_non_finite_check_and_unscale_(gradients,found,inverse);
    const bool applied=found.item<float>()==0;
    at::_amp_update_scale_(scale,tracker,found,2.0,.5,2000);
    state.scale=scale.item<float>();state.growthTracker=tracker.item<std::int32_t>();return applied;
}
inline bool applyTrainingAmpGradients(const std::vector<torch::Tensor>& parameters,torch::optim::Optimizer& optimizer,
    TrainingAmpState& state,const torch::Device& device){
    std::vector<torch::Tensor> gradients;for(const auto& parameter:parameters)if(parameter.grad().defined())gradients.push_back(parameter.grad());
    const bool applied=unscaleAndUpdateTrainingAmp(gradients,state,device);
    torch::nn::utils::clip_grad_norm_(parameters,1.0,2.0,false);if(applied)optimizer.step();return applied;
}
inline TrainingAmpResult orderedTrainingAmpStep(ReferenceBoundaryModel& model,torch::optim::AdamW& optimizer,const TrainingBatch& batch,
    SamplingState& sampling,const std::vector<std::int64_t>& indices,TrainingAmpState& state,
    const c10::optional<torch::Tensor>& positiveWeight=c10::nullopt){
    validateOrderedTrainingBatch(batch,sampling,indices);
    if(!batch.tile.device().is_cuda())throw std::invalid_argument("AMP training requires CUDA");optimizer.zero_grad(true);
    torch::Tensor loss;{TrainingCudaAutocast autocast;loss=boundaryLoss(model->forward(batch.tile,batch.overview,batch.position),batch.target,batch.valid,positiveWeight);}
    if(!torch::isfinite(loss).item<bool>())throw std::runtime_error("Nonfinite training loss");
    (loss*state.scale).backward();const bool applied=applyTrainingAmpGradients(model->parameters(),optimizer,state,batch.tile.device());
    sampling.cursor+=static_cast<std::int64_t>(indices.size());return {loss.item<double>(),applied};
}
}
