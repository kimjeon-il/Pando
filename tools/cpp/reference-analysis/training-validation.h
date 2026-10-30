#pragma once
#include "training-step.h"

namespace pando::reference {
// Validation always uses evaluation mode, no gradient, and unweighted loss.
inline double validationBatchLoss(ReferenceBoundaryModel& model,const TrainingBatch& batch){
    model->eval();torch::NoGradGuard guard;
    const auto loss=boundaryLoss(model->forward(batch.tile,batch.overview,batch.position),batch.target,batch.valid);
    if(!torch::isfinite(loss).item<bool>())throw std::runtime_error("Nonfinite validation loss");return loss.item<double>();
}
}
