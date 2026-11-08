#pragma once
#include <array>
#include <optional>
#include <string>
#include <vector>

namespace pandoeditor {
struct PlaceNamePeriod {
    std::string fromDate;
    int fromYear=0;
    std::array<std::optional<std::string>,3> names;
    std::vector<std::string> nativeExtras;
};
struct PlaceNameInput {
    std::array<std::string,3> names;
    std::vector<std::string> nativeExtras;
    std::vector<PlaceNamePeriod> timeline;
};
struct PlaceNameRow { std::string language,text;bool modernName=false; };
// A naming transition establishes evidence only for the languages it contains.
// No transition is evidence of a city's existence or historical absence.
std::vector<PlaceNameRow> resolvePlaceNames(const PlaceNameInput&,
    const std::array<bool,3>& languages,const std::string& mapDate,
    const std::string& sourceReferenceDate);
}
