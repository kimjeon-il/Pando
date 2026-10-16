#include <pandoeditor/timeline-resolver.h>
#include <pandoeditor/temporal.h>
#include <algorithm>

namespace pandoeditor {
bool validityContainsAtEnd(const Validity& validity,const TemporalValue& point) {
    const auto interval=normalizeTemporalInterval(validity.from,validity.to);
    return (!interval.start||compareTemporal(*interval.start,point,TemporalBoundary::Start,TemporalBoundary::End)<=0)
        &&(!interval.end||compareTemporal(*interval.end,point,TemporalBoundary::End,TemporalBoundary::End)>=0);
}
std::optional<std::size_t> selectTimelineVersion(const Validity& lifetime,
    const std::vector<Validity>& versions,const std::optional<std::string>& referenceDate) {
    if(!referenceDate||referenceDate->empty()) {
        if(versions.size()==1&&!lifetime.from&&!lifetime.to
            &&!versions.front().from&&!versions.front().to)return std::size_t{0};
        throw std::invalid_argument("A reference date is required for dated territorial geometry");
    }
    const auto point=parseTemporal(*referenceDate);
    if(!validityContainsAtEnd(lifetime,point))return std::nullopt;
    std::optional<std::size_t> selected;
    for(std::size_t i=0;i<versions.size();++i) {
        if(!validityContainsAtEnd(versions[i],point))continue;
        if(selected)throw TimelineError("PL-LIB-GEOMETRY","Ambiguous territorial geometry selection");
        selected=i;
    }
    return selected;
}
namespace {
bool active(const Validity& validity,const TemporalValue& point) {
    return validityContainsAtEnd(validity,point);
}
template<class Rows> const typename Rows::value_type* selected(const Rows& rows,const std::string& id,
                                                                  const TemporalValue& point) {
    const auto it=std::find_if(rows.begin(),rows.end(),[&](const auto& row){
        return row.entityId==id&&active(row.validity,point);
    });
    return it==rows.end()?nullptr:&*it;
}
}
const ResolvedEntity* ResolvedWorld::find(const std::string& id) const {
    const auto it=std::find_if(entities.begin(),entities.end(),[&](const auto& row){return row.id==id;});
    return it==entities.end()?nullptr:&*it;
}
std::string initialTimelineMonth(const TimelineRecords& records,const std::string& currentMonth) {
    const auto fallback=parseTemporal(currentMonth);
    if(fallback.precision!="month")throw TimelineError("INVALID_TIMELINE_CURSOR","month precision required");
    std::optional<TemporalValue> latest;
    const auto inspect=[&](const auto& rows){for(const auto& row:rows)if(row.validity.from) {
        const auto parsed=parseTemporal(*row.validity.from);
        if(!latest||latest->startKey<parsed.startKey)latest=parsed;
    }};
    inspect(records.lifetimes);inspect(records.geometryBindings);inspect(records.parentRelations);
    if(!latest)return fallback.canonical;
    if(latest->precision=="year")return latest->canonical+"-01";
    if(latest->precision=="date")return latest->canonical.substr(0,latest->canonical.size()-3);
    return latest->canonical;
}
HistoricalSourceAvailability classifyHistoricalSourceAvailability(const Validity& lifetime,
    const std::vector<Validity>& versions,const std::string& referenceDate) {
    if(selectTimelineVersion(lifetime,versions,referenceDate))return HistoricalSourceAvailability::Available;
    const auto point=parseTemporal(referenceDate);
    if(!validityContainsAtEnd(lifetime,point))return HistoricalSourceAvailability::Absent;
    return lifetime.from||lifetime.to?HistoricalSourceAvailability::GeometryGap:HistoricalSourceAvailability::Unknown;
}
ResolvedWorld resolveWorld(const TimelineRecords& records,const TimelineValidationContext& context,
                           const std::string& month) {
    const auto cursor=parseTemporal(month);
    if(cursor.precision!="month")throw TimelineError("INVALID_TIMELINE_CURSOR","month precision required");
    const auto point=temporalMonthEnd(cursor.canonical);
    const auto normalized=normalizeTimelineRecords(records,context);
    ResolvedWorld result;result.month=cursor.canonical;
    for(const auto& identity:context.entities) {
        const auto* lifetime=selected(normalized.lifetimes,identity.id,point);
        if(!lifetime)continue;
        const auto* geometry=selected(normalized.geometryBindings,identity.id,point);
        const auto* parent=selected(normalized.parentRelations,identity.id,point);
        result.entities.push_back({identity.id,geometry->geometryRef,parent->parentId,parent->coverageMode});
        result.entities.back().validity=lifetime->validity;
        for(const auto& property:normalized.propertyBindings)if(property.entityId==identity.id&&active(property.validity,point))
            result.entities.back().properties[property.property]=property.value;
    }
    for(auto& entity:result.entities) {
        auto parent=entity.parentId;
        while(!parent.empty()) {
            entity.ancestors.push_back(parent);
            parent=result.find(parent)->parentId;
        }
        entity.rootId=entity.ancestors.empty()?entity.id:entity.ancestors.back();
    }
    return result;
}
}
