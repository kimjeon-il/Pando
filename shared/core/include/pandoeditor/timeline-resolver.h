#pragma once
#include <pandoeditor/timeline-records.h>
#include <pandoeditor/temporal.h>

namespace pandoeditor {
struct ResolvedEntity {
    ObjectRef objectRef;
    GeometryRef geometryRef;
    std::string rendering="{}";
    std::string parentId, coverageMode, rootId;
    std::vector<std::string> ancestors;
    Validity validity;
    std::map<std::string,std::string> properties;
};
struct ResolvedWorld {
    std::string month;
    std::vector<ResolvedEntity> entities;
    const ResolvedEntity* find(const ObjectRef&) const;
};

// One inclusive as-of-boundary rule for project and library object histories.
bool validityContainsAtEnd(const Validity&,const TemporalValue&);
std::optional<std::size_t> selectTimelineVersion(const Validity& lifetime,
    const std::vector<Validity>& versions,const std::optional<std::string>& referenceDate);
enum class HistoricalSourceAvailability { Available,GeometryGap,Absent,Unknown };
HistoricalSourceAvailability classifyHistoricalSourceAvailability(const Validity& lifetime,
    const std::vector<Validity>& versions,const std::string& referenceDate);

// The input catalog supplies stable identity order; records and geometry are
// validated before the month-end view is assembled.
ResolvedWorld resolveWorld(const TimelineRecords&, const TimelineValidationContext&,
                           const std::string& month);
std::string initialTimelineMonth(const TimelineRecords&,const std::string& currentMonth);
// Connected map-data coverage containing the cursor, across adjacent versions.
// Input records must already be validated; a map-data gap is not a lifetime end.
Validity timelineMapCoverageAtMonth(const TimelineRecords&,const ObjectRef&,const std::string& month);
}
