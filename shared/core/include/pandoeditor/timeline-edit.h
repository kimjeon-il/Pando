#pragma once
#include <pandoeditor/timeline-records.h>

namespace pandoeditor {
// A patch is a domain command intent; absent fields retain the selected record value.
struct TimelineEditPatch {
    std::optional<GeometryRef> geometryRef;
    std::optional<std::string> parentId, coverageMode;
};
struct TimelineEditResult { TimelineRecords records; bool changed=false; };
TimelineEditResult editTimelineRecordAtMonth(const TimelineRecords&,const std::string& collection,
    const std::string& entityId,const std::string& month,const TimelineEditPatch&);
TimelineRecords replaceGeometryBindingAtMonth(const TimelineRecords&,const std::string& entityId,
                                               const std::string& month,GeometryRef next);
TimelineRecords replaceParentRelationAtMonth(const TimelineRecords&,const std::string& entityId,
                                              const std::string& month,const std::string& parentId,
                                              const std::string& coverageMode);
TimelineRecords truncateTimelineEntityAtMonth(const TimelineRecords&,const std::string& entityId,
                                              const std::string& month);
}
