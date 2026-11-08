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
template<class Row> struct IndexedRow {
    const Row* value;
    TemporalInterval validity;
};
template<class Row> using RowsByEntity=std::map<ObjectRef,std::vector<IndexedRow<Row>>>;
template<class Row> RowsByEntity<Row> indexRows(const std::vector<Row>& rows) {
    RowsByEntity<Row> index;
    for(const auto& row:rows)
        index[row.objectRef].push_back({&row,normalizeTemporalInterval(row.validity.from,row.validity.to)});
    return index;
}
bool active(const TemporalInterval& interval,const TemporalKey& atEnd) {
    return (!interval.start||!(atEnd<interval.start->startKey))
        &&(!interval.end||!(interval.end->endKey<atEnd));
}
template<class Row> const Row* selected(const RowsByEntity<Row>& index,const ObjectRef& id,
                                       const TemporalKey& atEnd) {
    const auto found=index.find(id);
    if(found==index.end())return nullptr;
    const auto& rows=found->second;
    const auto it=std::find_if(rows.begin(),rows.end(),[&](const auto& row){
        return active(row.validity,atEnd);
    });
    return it==rows.end()?nullptr:it->value;
}
}
struct PreparedTimelineWorld::Data {
    TimelineRecords records;
    std::vector<TimelineEntityIdentity> entities;
    RowsByEntity<TimelineLifetime> lifetimes;
    RowsByEntity<TimelineGeometryBinding> geometries;
    RowsByEntity<TimelineParentRelation> parents;
    RowsByEntity<TimelinePropertyBinding> properties;
};
PreparedTimelineWorld::PreparedTimelineWorld(const TimelineRecords& records,const TimelineValidationContext& context) {
    auto next=std::make_shared<Data>();
    next->records=normalizeTimelineRecords(records,context);
    next->entities=context.entities;
    next->lifetimes=indexRows(next->records.lifetimes);
    next->geometries=indexRows(next->records.geometryBindings);
    next->parents=indexRows(next->records.parentRelations);
    next->properties=indexRows(next->records.propertyBindings);
    data_=std::move(next);
}
const ResolvedEntity* ResolvedWorld::find(const ObjectRef& id) const {
    if(!offsets.empty()) {
        const auto found=offsets.find(id);
        return found==offsets.end()||found->second>=entities.size()?nullptr:&entities[found->second];
    }
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
ResolvedWorld PreparedTimelineWorld::resolve(const std::string& month) const {
    const auto cursor=parseTemporal(month);
    const auto point=cursor.precision=="month"?temporalMonthEnd(cursor.canonical):cursor;
    const TemporalKey atEnd=point.endKey;
    const auto& index=*data_;
    ResolvedWorld result;result.month=cursor.canonical;
    result.entities.reserve(index.entities.size());
    for(const auto& [ref,properties]:index.properties)
        for(const auto& property:properties)if(active(property.validity,atEnd))
            result.activeProperties[ref][property.value->property]=property.value->value;
    for(const auto& identity:index.entities) {
        const auto* lifetime=selected(index.lifetimes,identity.objectRef,atEnd);
        if(!lifetime)continue;
        const auto* geometry=selected(index.geometries,identity.objectRef,atEnd);
        const auto* parent=selected(index.parents,identity.objectRef,atEnd);
        if(!geometry)continue; // Validated paired coverage may be absent during a lifetime.
        result.entities.push_back({identity.objectRef,geometry->geometryRef,geometry->rendering,parent?parent->parentId:"",parent?parent->coverageMode:"explicit"});
        auto& entity=result.entities.back();
        entity.validity=lifetime->validity;
        result.offsets.emplace(identity.objectRef,result.entities.size()-1);
        const auto found=result.activeProperties.find(identity.objectRef);
        if(found!=result.activeProperties.end())entity.properties=found->second;
    }
    std::map<std::string,std::size_t> resolvedById;
    for(std::size_t i=0;i<result.entities.size();++i)
        if(result.entities[i].objectRef.domain=="territorial")
            resolvedById.emplace(result.entities[i].objectRef.id,i);
    for(auto& entity:result.entities) {
        auto parent=entity.parentId;
        while(!parent.empty()) {
            entity.ancestors.push_back(parent);
            parent=result.entities.at(resolvedById.at(parent)).parentId;
        }
        entity.rootId=entity.ancestors.empty()?entity.objectRef.id:entity.ancestors.back();
    }
    return result;
}
ResolvedWorld resolveWorld(const TimelineRecords& records,const TimelineValidationContext& context,
                           const std::string& month) {
    // Preserve date-input precedence before validating independent records.
    const auto cursor=parseTemporal(month);
    return PreparedTimelineWorld(records,context).resolve(cursor.canonical);
}
}
