#pragma once

#include <pandoeditor/losslessjson.h>
#include <pandoeditor/mapprojection.h>
#include <array>
#include <functional>
#include <optional>
#include <string>
#include <vector>
#include <cstdint>

namespace pandoeditor {
// Platform image IO, OCR and map projection remain with the caller. All
// calibration/placement numerical rules use this shared implementation.
using ReferencePoint = std::array<double, 2>;
struct ReferenceProjection {
    std::function<std::optional<ReferencePoint>(ReferencePoint)> project;
    std::function<std::optional<ReferencePoint>(ReferencePoint)> unproject;
};
struct PreparedReferenceWarp {
    MapProjection projection;
    enum Mode { Invalid, Similarity, Affine, Projective, ThinPlateSpline } mode=Invalid;
    std::vector<double> xCoefficients,yCoefficients;
    std::vector<ReferencePoint> controlPoints;
    bool restrictToImage=false,flipX=false,flipY=false;
};
struct ReferenceWarpMesh {
    int columns=0,rows=0;
    // u,v,longitude,latitude per vertex; non-projectable coordinates are NaN.
    std::vector<double> vertices;
    std::vector<std::uint32_t> triangles;
};
PreparedReferenceWarp prepareReferenceImageWarp(const codecjson::Value& descriptor);
std::optional<ReferencePoint> projectReferenceImageWarp(const PreparedReferenceWarp& warp,
    ReferencePoint point,bool geographic=true);
std::optional<ReferencePoint> projectReferenceImagePoint(const PreparedReferenceWarp& warp,
    const codecjson::Value& point);
ReferenceWarpMesh buildReferenceImageMesh(const PreparedReferenceWarp& warp,double columns=24,double rows=16);
codecjson::Value referenceImageOperation(const std::string& operation,
    const codecjson::Value& input, const ReferenceProjection& projection = {});
std::optional<ReferencePoint> projectReferenceImageWarp(const codecjson::Value& warp,
    ReferencePoint point,bool geographic=true);
}
