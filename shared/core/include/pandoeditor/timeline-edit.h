#pragma once
#include <pandoeditor/timeline-records.h>

namespace pandoeditor {
// Half-open changed intervals derived from record values, never UI estimates.
struct TimelineChangePeriod {ObjectRef objectRef;std::optional<std::string> from,until;};
std::vector<TimelineChangePeriod> timelineChangePeriods(const TimelineRecords&,const TimelineRecords&,const std::vector<ObjectRef>&);
// A patch is a domain command intent; absent fields retain the selected record value.
struct TimelineEditPatch {
    std::optional<GeometryRef> geometryRef;
    std::optional<std::string> rendering;
    std::optional<std::string> parentId, coverageMode;
};
struct TimelineEditResult { TimelineRecords records; bool changed=false; };
TimelineEditResult editTimelineRecordAtMonth(const TimelineRecords&,const std::string& collection,
    const ObjectRef& objectRef,const std::string& month,const TimelineEditPatch&);
TimelineRecords replaceGeometryBindingAtMonth(const TimelineRecords&,const ObjectRef& objectRef,
                                               const std::string& month,GeometryRef next,std::optional<std::string> rendering={});
TimelineRecords replaceParentRelationAtMonth(const TimelineRecords&,const ObjectRef& objectRef,
                                              const std::string& month,const std::string& parentId,
                                              const std::string& coverageMode);
TimelineRecords truncateTimelineEntityAtMonth(const TimelineRecords&,const ObjectRef& objectRef,
                                              const std::string& month,bool preserveFutureChanges=false);
TimelineRecords replacePropertyBindingAtMonth(const TimelineRecords&,const ObjectRef& objectRef,
    const std::string& month,const std::string& property,const std::string& value);
}
