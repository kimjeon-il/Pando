#include <pandoeditor/placenames.h>
#include <pandoeditor/temporal.h>
#include <stdexcept>

namespace pandoeditor {
std::vector<PlaceNameRow> resolvePlaceNames(const PlaceNameInput& input,
    const std::array<bool,3>& languages,const std::string& mapDate,const std::string& sourceReferenceDate) {
    auto names=input.names;auto nativeExtras=input.nativeExtras;
    std::array<bool,3> evidenced{};bool historical=false;
    if(!mapDate.empty()) {
        const auto date=parseTemporal(mapDate),reference=parseTemporal(sourceReferenceDate);
        if(date.precision!="date"||reference.precision!="date")throw std::invalid_argument("Place naming requires exact dates.");
        historical=date.year<reference.year||(date.year==reference.year&&date.month<reference.month);
        for(const auto& period:input.timeline) {
            auto year=std::to_string(period.fromYear);if(year.size()<4)year=std::string(4-year.size(),'0')+year;
            const auto boundary=parseTemporal(period.fromDate.empty()?year:period.fromDate);
            if(compareTemporal(boundary,date)>0)break;
            for(std::size_t i=0;i<names.size();++i)if(period.names[i]){names[i]=*period.names[i];evidenced[i]=true;}
            if(period.names[2])nativeExtras=period.nativeExtras;
        }
    }
    std::vector<PlaceNameRow> rows;
    constexpr const char* keys[]{"ko","en","native"};
    const auto append=[&](std::size_t language,const std::string& text){
        if(!text.empty())rows.push_back({keys[language],text,historical&&!evidenced[language]});
    };
    for(std::size_t i=0;i<names.size();++i)if(languages[i]){
        append(i,names[i]);if(i==2)for(const auto& extra:nativeExtras)append(i,extra);
    }
    return rows;
}
}
