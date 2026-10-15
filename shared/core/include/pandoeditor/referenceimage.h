#pragma once

#include <pandoeditor/losslessjson.h>
#include <array>
#include <functional>
#include <optional>
#include <string>

namespace pandoeditor {
// Platform image IO, OCR and map projection remain with the caller. All
// calibration/placement numerical rules use this shared implementation.
using ReferencePoint = std::array<double, 2>;
struct ReferenceProjection {
    std::function<std::optional<ReferencePoint>(ReferencePoint)> project;
    std::function<std::optional<ReferencePoint>(ReferencePoint)> unproject;
};
codecjson::Value referenceImageOperation(const std::string& operation,
    const codecjson::Value& input, const ReferenceProjection& projection = {});
std::optional<ReferencePoint> projectReferenceImageWarp(const codecjson::Value& warp,
    ReferencePoint point,bool geographic=true);
}
