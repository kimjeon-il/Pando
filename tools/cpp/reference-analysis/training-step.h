#pragma once
#include "boundary-loss.h"
#include "reference-model.h"
#include <torch/torch.h>
#include <stdexcept>

namespace pando::reference {
struct TrainingBatch {torch::Tensor tile,overview,position,target,valid;};
inline double trainingBatchStep(ReferenceBoundaryModel& model,torch::optim::AdamW& optimizer,const TrainingBatch& batch,
    const c10::optional<torch::Tensor>& positiveWeight=c10::nullopt){
    optimizer.zero_grad(true);
    const auto logits=model->forward(batch.tile,batch.overview,batch.position);
    const auto loss=boundaryLoss(logits,batch.target,batch.valid,positiveWeight);
    if(!torch::isfinite(loss).item<bool>())throw std::runtime_error("Nonfinite training loss");
    loss.backward();torch::nn::utils::clip_grad_norm_(model->parameters(),1.0,2.0,true);optimizer.step();return loss.item<double>();
}
}
