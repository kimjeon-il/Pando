#pragma once
#include <pandoeditor/losslessjson.h>
#include <array>
#include <optional>
#include <string>

namespace pandoeditor {
// Analysis coordinate conversion, independent of the application's viewport.
// Angles are degrees, projected coordinates east/north metres. No datum shift.
struct MapProjection {
    std::string kind="geographic",ellipsoid="WGS84";
    double lon0=0,lat0=0,lat1=0,lat2=0,radius=6378137,eccentricity=0.08181919084262149,k0=1,x0=0,y0=0;
};
MapProjection readMapProjection(const codecjson::Value&);
codecjson::Value writeMapProjection(const MapProjection&);
std::optional<std::array<double,2>> forwardMapProjection(const MapProjection&,std::array<double,2>);
std::optional<std::array<double,2>> inverseMapProjection(const MapProjection&,std::array<double,2>);
}
