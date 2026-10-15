#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/temporal.h>
#include <algorithm>
#include <set>

namespace pandoeditor {
namespace {
bool active(const Validity& validity,const TemporalValue& point) {
    const auto dates=normalizeTemporalInterval(validity.from,validity.to);
    return (!dates.start || !(point.endKey<dates.start->startKey))
        && (!dates.end || !(dates.end->endKey<point.endKey));
}
std::string nextRecordId(const TimelineRecords& rows,const std::string& base) {
    std::set<std::string> ids;
    for(const auto& row:rows.lifetimes)ids.insert(row.id);
    for(const auto& row:rows.geometryBindings)ids.insert(row.id);
    for(const auto& row:rows.parentRelations)ids.insert(row.id);
    auto result=base;
    for(unsigned suffix=1;ids.count(result);++suffix)result=base+":"+std::to_string(suffix);
    return result;
}
template<class Rows,class Change> TimelineEditResult replace(const TimelineRecords& original,Rows TimelineRecords::* field,
        const std::string& id,const std::string& cursor,Change change) {
    const auto month=parseTemporal(cursor);
    if(month.precision!="month")throw TimelineError("INVALID_TIMELINE_CURSOR","month precision required");
    const auto point=temporalMonthEnd(month.canonical);
    auto result=original;
    auto& rows=result.*field;
    const auto it=std::find_if(rows.begin(),rows.end(),[&](const auto& row){return row.entityId==id&&active(row.validity,point);});
    if(it==rows.end())throw TimelineError("TIMELINE_INACTIVE","entity has no record at month end");
    auto changed=*it;
    if(!change(changed))return {original,false};
    const bool split=!it->validity.from || parseTemporal(*it->validity.from).startKey<month.startKey;
    if(!split){*it=std::move(changed);return {std::move(result),true};}
    const auto index=std::distance(rows.begin(),it);
    changed.id=nextRecordId(original,it->id+":"+month.canonical);
    changed.validity.from=month.canonical;
    rows[index].validity.to=shiftTemporalMonth(month.canonical,-1);
    rows.insert(rows.begin()+index+1,std::move(changed));
    return {std::move(result),true};
}
}
TimelineRecords replaceGeometryBindingAtMonth(const TimelineRecords& rows,const std::string& id,
                                               const std::string& month,GeometryRef next) {
    return replace(rows,&TimelineRecords::geometryBindings,id,month,[&](auto& row){
        if(row.geometryRef==next)return false;row.geometryRef=next;return true;
    }).records;
}
TimelineRecords replaceParentRelationAtMonth(const TimelineRecords& rows,const std::string& id,
                                              const std::string& month,const std::string& parentId,
                                              const std::string& coverageMode) {
    return replace(rows,&TimelineRecords::parentRelations,id,month,[&](auto& row){
        if(row.parentId==parentId&&row.coverageMode==coverageMode)return false;
        row.parentId=parentId;row.coverageMode=coverageMode;return true;
    }).records;
}
TimelineEditResult editTimelineRecordAtMonth(const TimelineRecords& original,const std::string& collection,
    const std::string& id,const std::string& month,const TimelineEditPatch& patch) {
    if(collection=="geometryBindings") {
        if(patch.parentId||patch.coverageMode)throw TimelineError("TIMELINE_EDIT_PATCH","Unexpected parent patch field.");
        return replace(original,&TimelineRecords::geometryBindings,id,month,[&](auto& row) {
            if(!patch.geometryRef||row.geometryRef==*patch.geometryRef)return false;
            row.geometryRef=*patch.geometryRef;return true;
        });
    }
    if(collection=="parentRelations") {
        if(patch.geometryRef)throw TimelineError("TIMELINE_EDIT_PATCH","Unexpected geometry patch field.");
        return replace(original,&TimelineRecords::parentRelations,id,month,[&](auto& row) {
            const auto nextParent=patch.parentId.value_or(row.parentId);
            const auto nextCoverage=patch.coverageMode.value_or(row.coverageMode);
            if(row.parentId==nextParent&&row.coverageMode==nextCoverage)return false;
            row.parentId=nextParent;row.coverageMode=nextCoverage;return true;
        });
    }
    throw TimelineError("TIMELINE_EDIT_COLLECTION","Unsupported timeline record collection.");
}
TimelineRecords truncateTimelineEntityAtMonth(const TimelineRecords& original,const std::string& id,
                                              const std::string& cursor) {
    const auto month=parseTemporal(cursor);
    if(month.precision!="month")throw TimelineError("INVALID_TIMELINE_CURSOR","month precision required");
    const auto lastMonth=shiftTemporalMonth(month.canonical,-1);
    auto result=original;
    const auto truncate=[&](auto& rows) {
        using Row=typename std::decay_t<decltype(rows)>::value_type;
        std::vector<Row> kept;
        kept.reserve(rows.size());
        for(auto row:rows) {
            if(row.entityId!=id){kept.push_back(std::move(row));continue;}
            const auto interval=normalizeTemporalInterval(row.validity.from,row.validity.to);
            if(interval.end&&interval.end->endKey<month.startKey){kept.push_back(std::move(row));continue;}
            if(interval.start&&!(interval.start->startKey<month.startKey))continue;
            row.validity.to=lastMonth;
            kept.push_back(std::move(row));
        }
        rows=std::move(kept);
    };
    truncate(result.lifetimes);truncate(result.geometryBindings);truncate(result.parentRelations);
    return result;
}
}
