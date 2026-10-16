#pragma once
#include "placeruntimestore.h"
#include <QVariantMap>
#include <QString>
#include <optional>
#include <vector>

struct PlaceLanguageSelection { bool ko=true,en=false,native=false; };
struct PlaceDisplayRow { QString language,text;bool modernName=false; };

// Platform adapters; shared C++ owns per-language temporal naming evidence.
PlaceLanguageSelection normalizedPlaceLanguages(const QVariantMap& value);
QVariantMap placeLanguagesToVariant(const PlaceLanguageSelection& value);
std::optional<PlaceLanguageSelection> toggledPlaceLanguage(
    const PlaceLanguageSelection& current,const QString& language,bool checked);
std::vector<PlaceDisplayRow> resolvePlaceDisplayRows(
    const PlaceRecord& record,const PlaceLanguageSelection& selected,const QString& mapDate={},
    const QString& sourceReferenceDate={});
