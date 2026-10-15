#include <pandoeditor/boundarycontact.h>
#include <cmath>
#include <stdexcept>

namespace pandoeditor {
namespace {
double normalizedLongitude(double value) {
    if(!std::isfinite(value)||std::abs(value)>1'000'000)
        throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: longitude outside supported range");
    while(value>180.)value-=360.;
    while(value< -180.)value+=360.;
    return value;
}
double longitudeNear(double value,double reference) {
    // Equivalent to Web normalizeLongitudeNear across +/-180.
    double longitude=normalizedLongitude(value);
    if(!std::isfinite(reference))
        throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: nonfinite reference");
    while(longitude-reference>180.)longitude-=360.;
    while(longitude-reference< -180.)longitude+=360.;
    return longitude;
}
void requirePoint(Point point) {
    if(!std::isfinite(point.x)||!std::isfinite(point.y)
       ||std::abs(point.x)>1'000'000||std::abs(point.y)>90.)
        throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: invalid geographic point");
}
int jsSign(double value) {
    return value>0?1:value<0?-1:0;
}
}
bool boundaryOpposingInteriors(const BoundaryEdge& segment,
                              const std::vector<BoundaryInteriorRef>& refs) {
    requirePoint(segment.first);requirePoint(segment.second);
    const double dx=longitudeNear(segment.second.x,segment.first.x)-segment.first.x;
    const double dy=segment.second.y-segment.first.y;
    bool first=true;
    double initial=0;
    for(const auto& ref:refs) {
        requirePoint(ref.source.first);requirePoint(ref.source.second);
        if(!std::isfinite(ref.interiorSide))
            throw std::invalid_argument("INVALID_BOUNDARY_INTERIOR: nonfinite side");
        const double edgeDx=longitudeNear(ref.source.second.x,ref.source.first.x)-ref.source.first.x;
        const double direction=double(jsSign(edgeDx*dx+
            (ref.source.second.y-ref.source.first.y)*dy));
        const double side=direction*ref.interiorSide;
        if(first){initial=side;first=false;}
        else if(side!=initial)return true;
    }
    return false;
}
}
