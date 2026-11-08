#pragma once
#include <pandoeditor/losslessjson.h>
#include <cstdint>
#include <vector>
namespace pandoeditor {
// Semantic bits: international, administrative, coast, hydro, transport, text, frame.
codecjson::Value referenceBoundaryGraph(int width,int height,const std::vector<std::uint8_t>& labels,
    const std::vector<float>& confidence,double threshold=.55,double simplifyTolerance=.75,double maximumGapPixels=6);
codecjson::Value editReferenceBoundaryGraph(const codecjson::Value& graph,const codecjson::Value& command);
}
