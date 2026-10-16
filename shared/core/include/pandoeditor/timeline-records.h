#pragma once
#include <pandoeditor/geometry-types.h>
#include <functional>
#include <stdexcept>

namespace pandoeditor {
inline constexpr std::uint32_t TimelineRecordSchemaVersion = 2;

struct TimelineLifetime {
    std::string id, entityId;
    Validity validity;
};
struct TimelineGeometryBinding {
    std::string id, entityId;
    Validity validity;
    GeometryRef geometryRef;
};
struct TimelineParentRelation {
    std::string id, entityId;
    Validity validity;
    std::string parentId, coverageMode;
};
struct TimelinePropertyBinding {
    std::string id, entityId;
    Validity validity;
    // name, flag, or color. The validated value is lossless canonical JSON.
    std::string property, value;
};
struct TimelineRecords {
    std::uint32_t schemaVersion = TimelineRecordSchemaVersion;
    std::vector<TimelineLifetime> lifetimes;
    std::vector<TimelineGeometryBinding> geometryBindings;
    std::vector<TimelineParentRelation> parentRelations;
    std::vector<TimelinePropertyBinding> propertyBindings;
};
// A read-only validation input, not another persisted entity collection.
struct TimelineEntityIdentity { std::string id, entityKind; };
struct TimelineValidationContext {
    std::vector<TimelineEntityIdentity> entities;
    std::function<bool(const GeometryRef&)> geometryExists;
};
class TimelineError : public std::invalid_argument {
public:
    TimelineError(const std::string& category, const std::string& detail)
        : std::invalid_argument(category + ": " + detail), code(category) {}
    const std::string code;
};

// Pure value normalization. Live project persistence/codec integration is T2-2.
TimelineRecords normalizeTimelineRecords(const TimelineRecords&, const TimelineValidationContext&);
}
