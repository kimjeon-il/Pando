#pragma once
#include <pandoeditor/timeline-records.h>
#include <pandoeditor/temporal.h>

namespace pandoeditor {
struct ResolvedEntity {
    std::string id;
    GeometryRef geometryRef;
    std::string parentId, coverageMode, rootId;
    std::vector<std::string> ancestors;
    Validity validity;
};
struct ResolvedWorld {
    std::string month;
    std::vector<ResolvedEntity> entities;
    const ResolvedEntity* find(const std::string& id) const;
};

// One inclusive as-of-boundary rule for project and library object histories.
bool validityContainsAtEnd(const Validity&,const TemporalValue&);
std::optional<std::size_t> selectTimelineVersion(const Validity& lifetime,
    const std::vector<Validity>& versions,const std::optional<std::string>& referenceDate);

// The input catalog supplies stable identity order; records and geometry are
// validated before the month-end view is assembled.
ResolvedWorld resolveWorld(const TimelineRecords&, const TimelineValidationContext&,
                           const std::string& month);
std::string initialTimelineMonth(const TimelineRecords&,const std::string& currentMonth);
}
