#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/temporal.h>
#include <algorithm>
#include <set>
#include <limits>
#include <sstream>
#include <iomanip>

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
    for(const auto& row:rows.propertyBindings)ids.insert(row.id);
    auto result=base;
    for(unsigned suffix=1;ids.count(result);++suffix)result=base+":"+std::to_string(suffix);
    return result;
}
template<class Rows,class Change> TimelineEditResult replace(const TimelineRecords& original,Rows TimelineRecords::* field,
        const ObjectRef& id,const std::string& cursor,Change change) {
    const auto month=parseTemporal(cursor);
    if(month.precision!="month")throw TimelineError("INVALID_TIMELINE_CURSOR","month precision required");
    const auto point=temporalMonthEnd(month.canonical);
    auto result=original;
    auto& rows=result.*field;
    const auto it=std::find_if(rows.begin(),rows.end(),[&](const auto& row){return row.objectRef==id&&active(row.validity,point);});
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
TimelineRecords replaceGeometryBindingAtMonth(const TimelineRecords& rows,const ObjectRef& id,
                                               const std::string& month,GeometryRef next,std::optional<std::string> rendering) {
    return replace(rows,&TimelineRecords::geometryBindings,id,month,[&](auto& row){
        const auto metadata=rendering.value_or(row.rendering);
        if(row.geometryRef==next&&row.rendering==metadata)return false;row.geometryRef=next;row.rendering=metadata;return true;
    }).records;
}
TimelineRecords replaceParentRelationAtMonth(const TimelineRecords& rows,const ObjectRef& id,
                                              const std::string& month,const std::string& parentId,
                                              const std::string& coverageMode) {
    return replace(rows,&TimelineRecords::parentRelations,id,month,[&](auto& row){
        if(row.parentId==parentId&&row.coverageMode==coverageMode)return false;
        row.parentId=parentId;row.coverageMode=coverageMode;return true;
    }).records;
}
TimelineEditResult editTimelineRecordAtMonth(const TimelineRecords& original,const std::string& collection,
    const ObjectRef& id,const std::string& month,const TimelineEditPatch& patch) {
    if(collection=="geometryBindings") {
        if(patch.parentId||patch.coverageMode)throw TimelineError("TIMELINE_EDIT_PATCH","Unexpected parent patch field.");
        return replace(original,&TimelineRecords::geometryBindings,id,month,[&](auto& row) {
            const auto ref=patch.geometryRef.value_or(row.geometryRef);const auto metadata=patch.rendering.value_or(row.rendering);
            if(row.geometryRef==ref&&row.rendering==metadata)return false;row.geometryRef=ref;row.rendering=metadata;return true;
        });
    }
    if(collection=="parentRelations") {
        if(patch.geometryRef||patch.rendering)throw TimelineError("TIMELINE_EDIT_PATCH","Unexpected geometry patch field.");
        return replace(original,&TimelineRecords::parentRelations,id,month,[&](auto& row) {
            const auto nextParent=patch.parentId.value_or(row.parentId);
            const auto nextCoverage=patch.coverageMode.value_or(row.coverageMode);
            if(row.parentId==nextParent&&row.coverageMode==nextCoverage)return false;
            row.parentId=nextParent;row.coverageMode=nextCoverage;return true;
        });
    }
    throw TimelineError("TIMELINE_EDIT_COLLECTION","Unsupported timeline record collection.");
}
TimelineRecords truncateTimelineEntityAtMonth(const TimelineRecords& original,const ObjectRef& id,
                                              const std::string& cursor,bool preserveFutureChanges) {
    const auto month=parseTemporal(cursor);
    if(month.precision!="month")throw TimelineError("INVALID_TIMELINE_CURSOR","month precision required");
    const auto lastMonth=shiftTemporalMonth(month.canonical,-1);
    auto result=original;
    const auto lifetime=std::find_if(original.lifetimes.begin(),original.lifetimes.end(),[&](const auto& row){return row.objectRef==id&&active(row.validity,temporalMonthEnd(month.canonical));});
    if(lifetime==original.lifetimes.end())return original;
    const auto lifetimeEnd=normalizeTemporalInterval(lifetime->validity.from,lifetime->validity.to).end;
    std::optional<TemporalValue> resume;
    if(preserveFutureChanges) {
        const auto point=temporalMonthEnd(month.canonical);
        const auto inspect=[&](const auto& rows){for(const auto& row:rows)if(row.objectRef==id&&row.validity.from) {
            const auto start=parseTemporal(*row.validity.from);
            if(point.endKey<start.startKey&&(!resume||start.startKey<resume->startKey))resume=start;
        }};
        inspect(original.lifetimes);inspect(original.geometryBindings);inspect(original.parentRelations);inspect(original.propertyBindings);
    }
    const auto truncate=[&](auto& rows) {
        using Row=typename std::decay_t<decltype(rows)>::value_type;
        std::vector<Row> kept;
        kept.reserve(rows.size());
        for(auto row:rows) {
            if(row.objectRef!=id){kept.push_back(std::move(row));continue;}
            const auto interval=normalizeTemporalInterval(row.validity.from,row.validity.to);
            if(lifetimeEnd&&interval.start&&lifetimeEnd->endKey<interval.start->startKey){kept.push_back(std::move(row));continue;}
            if(interval.end&&interval.end->endKey<month.startKey){kept.push_back(std::move(row));continue;}
            if(resume&&(!interval.end||!(interval.end->endKey<resume->startKey))) {
                auto future=row;
                if(!interval.start||interval.start->startKey<resume->startKey) {
                    future.validity.from=resume->canonical;future.id=nextRecordId(original,row.id+":resume:"+resume->canonical);
                }
                kept.push_back(std::move(future));
            }
            if(interval.start&&!(interval.start->startKey<month.startKey))continue;
            row.validity.to=lastMonth;
            kept.push_back(std::move(row));
        }
        rows=std::move(kept);
    };
    truncate(result.lifetimes);truncate(result.geometryBindings);truncate(result.parentRelations);truncate(result.propertyBindings);
    // Explicit deletion of the final map interval removes the project identity
    // through existing callers, even when source lifetime dates precede the map.
    if(std::none_of(result.geometryBindings.begin(),result.geometryBindings.end(),[&](const auto& row){return row.objectRef==id;})) {
        const auto erase=[&](auto& rows){rows.erase(std::remove_if(rows.begin(),rows.end(),[&](const auto& row){return row.objectRef==id;}),rows.end());};
        erase(result.lifetimes);erase(result.parentRelations);erase(result.propertyBindings);
    }
    return result;
}
TimelineRecords replacePropertyBindingAtMonth(const TimelineRecords& original,const ObjectRef& id,
    const std::string& cursor,const std::string& property,const std::string& value) {
    const auto month=parseTemporal(cursor);
    if(month.precision!="month")throw TimelineError("INVALID_TIMELINE_CURSOR","month precision required");
    auto result=original;const auto point=temporalMonthEnd(month.canonical);
    auto& rows=result.propertyBindings;
    auto selected=std::find_if(rows.begin(),rows.end(),[&](const auto& row){return row.objectRef==id&&row.property==property&&active(row.validity,point);});
    if(selected!=rows.end()) {
        if(selected->value==value)return result;
        auto changed=*selected;changed.value=value;
        if(!selected->validity.from||parseTemporal(*selected->validity.from).startKey<month.startKey) {
            changed.id=nextRecordId(original,selected->id+":"+month.canonical);changed.validity.from=month.canonical;
            selected->validity.to=shiftTemporalMonth(month.canonical,-1);rows.push_back(std::move(changed));
        }else *selected=std::move(changed);
        return result;
    }
    const auto life=std::find_if(result.lifetimes.begin(),result.lifetimes.end(),[&](const auto& row){return row.objectRef==id&&active(row.validity,point);});
    if(life==result.lifetimes.end())throw TimelineError("TIMELINE_INACTIVE","property owner is inactive");
    auto end=life->validity.to;
    for(const auto& row:rows)if(row.objectRef==id&&row.property==property&&row.validity.from) {
        const auto start=parseTemporal(*row.validity.from);
        if(month.startKey<start.startKey) {
            const auto nextMonth=start.precision=="year"?start.canonical+"-01":start.precision=="date"?start.canonical.substr(0,start.canonical.size()-3):start.canonical;
            const auto day=start.startKey.day-1;
            const auto previous=day>0?nextMonth+"-"+(day<10?"0":"")+std::to_string(day):shiftTemporalMonth(nextMonth,-1);
            if(!end||parseTemporal(previous).endKey<parseTemporal(*end).endKey)end=previous;
        }
    }
    const auto begin=life->validity.from&&month.startKey<parseTemporal(*life->validity.from).startKey?*life->validity.from:month.canonical;
    rows.push_back({nextRecordId(original,"property:"+id.domain+":"+id.id+":"+property+":"+month.canonical),id,{begin,end},property,value});
    return result;
}
}

namespace pandoeditor {
std::vector<TimelineChangePeriod> timelineChangePeriods(const TimelineRecords& before,const TimelineRecords& after,const std::vector<ObjectRef>& ids) {
    const TemporalKey low{std::numeric_limits<int>::min(),1,1},high{std::numeric_limits<int>::max(),1,1};
    const auto start=[&](const Validity& v){return v.from?parseTemporal(*v.from).startKey:low;};
    const auto end=[&](const Validity& v){return v.to?temporalFollowingDay(parseTemporal(*v.to).endKey):high;};
    const auto text=[&](const TemporalKey& k)->std::optional<std::string>{
        if(k==low||k==high)return {};
        std::ostringstream out; if(k.year<0)out<<'-';else if(k.year>9999)out<<'+';
        out<<std::setfill('0')<<std::setw(4)<<std::abs(k.year)<<'-'<<std::setw(2)<<k.month<<'-'<<std::setw(2)<<k.day;return out.str();
    };
    std::vector<TimelineChangePeriod> result;
    for(const auto& id:ids) {
        std::set<TemporalKey> points{low,high};
        const auto collect=[&](const auto& rows){for(const auto& r:rows)if(r.objectRef==id){points.insert(start(r.validity));points.insert(end(r.validity));}};
        for(const auto* records:{&before,&after}){collect(records->lifetimes);collect(records->geometryBindings);collect(records->parentRelations);collect(records->propertyBindings);}
        const auto signature=[&](const TimelineRecords& records,const TemporalKey& key){
            std::vector<std::string> parts;
            const auto contains=[&](const auto& r){return r.objectRef==id && !(key<start(r.validity)) && key<end(r.validity);};
            bool alive=false;for(const auto& r:records.lifetimes)if(contains(r))alive=true;
            if(!alive)return parts;
            parts.push_back("alive");
            for(const auto& r:records.geometryBindings)if(contains(r)){parts.push_back("geometry");parts.push_back(r.geometryRef.id);parts.push_back(std::to_string(r.geometryRef.version));parts.push_back(r.rendering);}
            for(const auto& r:records.parentRelations)if(contains(r)){parts.push_back("parent");parts.push_back(r.parentId);parts.push_back(r.coverageMode);}
            std::map<std::string,std::string> properties;for(const auto& r:records.propertyBindings)if(contains(r))properties[r.property]=r.value;
            for(const auto& p:properties){parts.push_back(p.first);parts.push_back(p.second);}return parts;
        };
        std::optional<TemporalKey> from;
        for(auto it=points.begin();std::next(it)!=points.end();++it){
            const bool changed=signature(before,*it)!=signature(after,*it);
            if(changed&&!from)from=*it;
            if(!changed&&from){result.push_back({id,text(*from),text(*it)});from.reset();}
        }
        if(from)result.push_back({id,text(*from),{}});
    }
    return result;
}
}
