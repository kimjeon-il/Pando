#pragma once
#include "training-checkpoint.h"
#include "training-step.h"
#include <stdexcept>
#include <vector>

namespace pando::reference {
inline void validateOrderedTrainingBatch(const TrainingBatch& batch,const SamplingState& state,const std::vector<std::int64_t>& indices){
    if(state.epoch<0||state.seed<0||state.cursor<0||indices.empty()||batch.tile.dim()!=4||batch.tile.size(0)!=static_cast<std::int64_t>(indices.size())||
       static_cast<std::uint64_t>(state.cursor)>state.order.size()||indices.size()>state.order.size()-static_cast<std::size_t>(state.cursor))
        throw std::invalid_argument("Invalid ordered training batch");
    for(std::size_t i=0;i<indices.size();++i)if(indices[i]<0||indices[i]!=state.order[static_cast<std::size_t>(state.cursor)+i])
        throw std::invalid_argument("Training batch differs from saved sample order");
}
// Cursor advances only after the complete ordered batch has been applied.
inline double orderedTrainingBatchStep(ReferenceBoundaryModel& model,torch::optim::AdamW& optimizer,const TrainingBatch& batch,
    SamplingState& state,const std::vector<std::int64_t>& indices,const c10::optional<torch::Tensor>& positiveWeight=c10::nullopt){
    validateOrderedTrainingBatch(batch,state,indices);
    const auto loss=trainingBatchStep(model,optimizer,batch,positiveWeight);state.cursor+=static_cast<std::int64_t>(indices.size());return loss;
}
}
