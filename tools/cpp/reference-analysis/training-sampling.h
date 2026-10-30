#pragma once
#include "condition-sampling.h"
#include <algorithm>
#include <cstdint>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace pando::reference {
// One entry per supervised tile; its value is the original duplicate group.
inline std::vector<std::uint64_t> balancedTrainingOrder(const std::vector<std::vector<std::string>>& datasets,
    std::uint64_t epoch,std::uint64_t seed){
    if(datasets.empty()||epoch>std::numeric_limits<std::uint64_t>::max()-seed)throw std::invalid_argument("Balanced training requires valid datasets and seed");
    std::size_t total=0,largest=0;std::vector<std::map<std::string,std::vector<std::uint64_t>>> groups;
    for(const auto& tiles:datasets){std::map<std::string,std::vector<std::uint64_t>> grouped;
        if(tiles.size()>std::numeric_limits<std::size_t>::max()-total)throw std::invalid_argument("Training tile count exceeds range");
        for(std::size_t i=0;i<tiles.size();++i){if(tiles[i].empty())throw std::invalid_argument("Training duplicate group required");grouped[tiles[i]].push_back(total+i);}
        if(grouped.empty())throw std::invalid_argument("Balanced training requires supervised original maps");
        total+=tiles.size();largest=std::max(largest,grouped.size());groups.push_back(std::move(grouped));}
    const auto quota=std::max(total/groups.size()+(total%groups.size()!=0),largest);TrainingRandom random(seed+epoch);
    if(quota>std::numeric_limits<std::size_t>::max()/groups.size())throw std::invalid_argument("Balanced training order exceeds range");
    std::vector<std::uint64_t> result;result.reserve(quota*groups.size());
    for(const auto& grouped:groups){std::vector<const std::vector<std::uint64_t>*> rows;for(const auto& [key,values]:grouped)rows.push_back(&values);
        for(const auto* values:rows)result.push_back((*values)[random.below(values->size())]);
        for(std::size_t i=rows.size();i<quota;++i){const auto* values=rows[random.below(rows.size())];result.push_back((*values)[random.below(values->size())]);}}
    for(std::size_t i=result.size();i>1;--i){const auto j=random.below(i);std::swap(result[i-1],result[j]);}
    return result;
}
}
