#pragma once
#include "reference-model.h"
#include <cstdint>
#include <stdexcept>

namespace pando::reference {
// Match training initialization for channels with no positive or negative truth.
inline void initializeUnobservedChannels(ReferenceBoundaryModel& model,std::uint32_t mask){
  if(mask>127)throw std::invalid_argument("Invalid unobserved channel mask");
  torch::NoGradGuard guard;
  for(std::int64_t channel=0;channel<7;++channel)if(mask&(1u<<channel)){
    model->head->weight.select(0,channel).zero_();model->head->bias.select(0,channel).fill_(-20);
  }
}
}
