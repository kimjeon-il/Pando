#pragma once
#include <pandoeditor/referenceimage.h>
#include <cstdint>
#include <string>
#include <vector>

namespace pandoeditor {
struct ReferenceGradientField {
    int width=0,height=0;
    double sourceWidth=0,sourceHeight=0,scaleX=0,scaleY=0,peakEdgeStrength=0,meanEdgeStrength=0;
    std::vector<float> gradient,gradientX,gradientY;
};
struct ReferenceTraceOptions {
    double searchRadius=256,snapRadius=8,gradientWeight=.67,directionWeight=.23,turnWeight=.10,corridorWeight=.08,minimumPeakEdge=.02,maxExpansions=650000;
};
struct ReferenceTraceTree {
    bool ok=false;std::string reason;
    ReferencePoint anchor{};std::optional<ReferencePoint> target;
    int minX=0,minY=0,maxX=0,maxY=0,boxWidth=0,boxHeight=0,startIndex=0,expansions=0;
    std::vector<int> parents;
    std::vector<double> distances;
};
struct ReferenceTraceResult {
    bool ok=false;std::string reason;std::vector<ReferencePoint> points;
    double meanEdgeStrength=0,corridorRadius=0;int rawPointCount=0;
};
ReferenceGradientField buildReferenceGradientField(int width,int height,const std::vector<std::uint8_t>& rgba,double sourceWidth,double sourceHeight);
ReferencePoint snapReferenceAnchor(const ReferenceGradientField&,ReferencePoint,double radius=8,bool refinement=false);
ReferenceTraceTree buildReferenceTraceTree(const ReferenceGradientField&,ReferencePoint,std::optional<ReferencePoint> target={},const ReferenceTraceOptions& options={});
ReferenceTraceResult traceReferencePath(const ReferenceGradientField&,const ReferenceTraceTree&,ReferencePoint,double snapRadius=8,double minimumMeanEdge=.035);
std::vector<ReferencePoint> simplifyReferenceTrace(const std::vector<ReferencePoint>&,double tolerance);
ReferenceTraceResult refineReferenceTrace(const ReferenceGradientField&,const std::vector<ReferencePoint>& roughPoints,double corridorRadius=12,double tolerance=1.5,double minimumPeakEdge=.02,double minimumMeanEdge=.06);
}
