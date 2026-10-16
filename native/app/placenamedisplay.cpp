#include "placenamedisplay.h"
#include <QSet>
#include <QDateTime>
#include <pandoeditor/placenames.h>
#include <stdexcept>

PlaceLanguageSelection normalizedPlaceLanguages(const QVariantMap& values) {
    PlaceLanguageSelection selected{values.value("ko").toBool(),
        values.value("en").toBool(),values.value("native").toBool()};
    return selected.ko||selected.en||selected.native?selected:PlaceLanguageSelection{};
}
QVariantMap placeLanguagesToVariant(const PlaceLanguageSelection& selected) {
    return {{"ko",selected.ko},{"en",selected.en},{"native",selected.native}};
}
std::optional<PlaceLanguageSelection> toggledPlaceLanguage(
    const PlaceLanguageSelection& current,const QString& language,bool checked) {
    PlaceLanguageSelection next=current;
    bool* flag=nullptr;
    if(language=="ko")flag=&next.ko;
    else if(language=="en")flag=&next.en;
    else if(language=="native")flag=&next.native;
    else throw std::invalid_argument("Unknown place display language");
    if(*flag==checked)return {};
    *flag=checked;
    if(!next.ko&&!next.en&&!next.native)return {};
    return next;
}
std::vector<PlaceDisplayRow> resolvePlaceDisplayRows(
    const PlaceRecord& record,const PlaceLanguageSelection& selected,const QString& mapDate,const QString& sourceReferenceDate) {
    pandoeditor::PlaceNameInput input;
    input.names={record.name.toStdString(),record.nameEn.toStdString(),record.nameNative.toStdString()};
    for(const auto& value:record.nameNativeExtras)input.nativeExtras.push_back(value.toStdString());
    for(const auto& transition:record.nameTimeline) {
        pandoeditor::PlaceNamePeriod period;period.fromDate=transition.fromDate.toStdString();period.fromYear=transition.fromYear;
        const QString names[]{transition.ko,transition.en,transition.native};
        for(std::size_t i=0;i<3;++i)if(!names[i].isEmpty())period.names[i]=names[i].toStdString();
        if(transition.nativeExtras)for(const auto& value:*transition.nativeExtras)period.nativeExtras.push_back(value.toStdString());
        input.timeline.push_back(std::move(period));
    }
    const auto reference=sourceReferenceDate.isEmpty()?QDateTime::currentDateTimeUtc().date().toString(Qt::ISODate):sourceReferenceDate;
    QSet<QString> seen;std::vector<PlaceDisplayRow> rows;
    const auto add=[&](const QString& language,const QString& value,bool modernName) {
        const auto name=value.trimmed();
        const auto key=name.normalized(QString::NormalizationForm_KC).toLower();
        if(name.isEmpty()||seen.contains(key))return;
        seen.insert(key);rows.push_back({language,(modernName?QStringLiteral("(현)"):QString())+name,modernName});
    };
    for(const auto& row:pandoeditor::resolvePlaceNames(input,{selected.ko,selected.en,selected.native},mapDate.toStdString(),reference.toStdString()))
        add(QString::fromStdString(row.language),QString::fromStdString(row.text),row.modernName);
    return rows;
}
