#include <pandoeditor/timeline-resolver.h>
#include <pandoeditor/temporal.h>
#include <algorithm>
#include <map>

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
template<class Row> using RowsByEntity=std::map<ObjectRef,std::vector<const Row*>>;
template<class Row> RowsByEntity<Row> indexRows(const std::vector<Row>& rows) {
    RowsByEntity<Row> index;
    for(const auto& row:rows)index[row.objectRef].push_back(&row);
    return index;
}
template<class Row> const Row* selected(const RowsByEntity<Row>& index,const ObjectRef& id,
                                      const TemporalValue& point) {
    const auto found=index.find(id);
    if(found==index.end())return nullptr;
    const auto& rows=found->second;
    const auto it=std::find_if(rows.begin(),rows.end(),[&](const auto* row){
        return active(row->validity,point);
    });
    return it==rows.end()?nullptr:*it;
}
}
const ResolvedEntity* ResolvedWorld::find(const ObjectRef& id) const {
    const auto it=std::find_if(entities.begin(),entities.end(),[&](const auto& row){return row.objectRef==id;});
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
Validity timelineMapCoverageAtMonth(const TimelineRecords& records,const ObjectRef& id,const std::string& month) {
    const auto cursor=parseTemporal(month);
    if(cursor.precision!="month")throw TimelineError("INVALID_TIMELINE_CURSOR","month precision required");
    const auto point=temporalMonthEnd(cursor.canonical);
    std::vector<TemporalInterval> intervals;
    for(const auto& row:records.geometryBindings)if(row.objectRef==id)
        intervals.push_back(normalizeTemporalInterval(row.validity.from,row.validity.to));
    std::sort(intervals.begin(),intervals.end(),[](const auto& a,const auto& b) {
        return b.start&&(!a.start||a.start->startKey<b.start->startKey);
    });
    std::optional<TemporalInterval> coverage;
    for(const auto& interval:intervals) {
        if(coverage&&coverage->end&&interval.start&&temporalFollowingDay(coverage->end->endKey)<interval.start->startKey) {
            const Validity value{coverage->validFrom,coverage->validTo};
            if(validityContainsAtEnd(value,point))return value;
            coverage.reset();
        }
        coverage=coverage?normalizeTemporalInterval(coverage->validFrom,interval.validTo):interval;
    }
    if(coverage) {
        const Validity value{coverage->validFrom,coverage->validTo};
        if(validityContainsAtEnd(value,point))return value;
    }
    throw TimelineError("TIMELINE_INACTIVE","No map coverage for "+id.domain+":"+id.id+" at "+month);
}
ResolvedWorld resolveWorld(const TimelineRecords& records,const TimelineValidationContext& context,
                           const std::string& month) {
    const auto cursor=parseTemporal(month);
    const auto point=cursor.precision=="month"?temporalMonthEnd(cursor.canonical):cursor;
    const auto normalized=normalizeTimelineRecords(records,context);
    // Read-only indexes live only as long as this normalized snapshot. Keep
    // record order inside each entity and evaluate dates at the same point.
    const auto lifetimes=indexRows(normalized.lifetimes);
    const auto geometries=indexRows(normalized.geometryBindings);
    const auto parents=indexRows(normalized.parentRelations);
    const auto properties=indexRows(normalized.propertyBindings);
    ResolvedWorld result;result.month=cursor.canonical;
    for(const auto& identity:context.entities) {
        const auto* lifetime=selected(lifetimes,identity.objectRef,point);
        if(!lifetime)continue;
        const auto* geometry=selected(geometries,identity.objectRef,point);
        const auto* parent=selected(parents,identity.objectRef,point);
        if(!geometry)continue; // Validated paired coverage may be absent during a lifetime.
        result.entities.push_back({identity.objectRef,geometry->geometryRef,geometry->rendering,parent?parent->parentId:"",parent?parent->coverageMode:"explicit"});
        result.entities.back().validity=lifetime->validity;
        const auto found=properties.find(identity.objectRef);
        if(found!=properties.end())for(const auto* property:found->second)if(active(property->validity,point))
            result.entities.back().properties[property->property]=property->value;
    }
    std::map<std::string,const ResolvedEntity*> resolvedById;
    for(const auto& entity:result.entities)if(entity.objectRef.domain=="territorial")resolvedById.emplace(entity.objectRef.id,&entity);
    for(auto& entity:result.entities) {
        auto parent=entity.parentId;
        while(!parent.empty()) {
            entity.ancestors.push_back(parent);
            parent=resolvedById.at(parent)->parentId;
        }
        entity.rootId=entity.ancestors.empty()?entity.objectRef.id:entity.ancestors.back();
    }
    return result;
}
}
