#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/timeline-records.h>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>

// Source must remain byte-for-byte equivalent in meaning to the shared
// tests/fixtures/portability/timeline-edit.json. The Node oracle verifies it.
using namespace pandoeditor;
namespace {
TimelineRecords source() {
    TimelineRecords rows;
    rows.lifetimes = {
        {"life:A", "A", {{"1914-06-15"}, {}}},
        {"life:B", "B", {}},
    };
    rows.geometryBindings = {
        {"A:original", "A", {{"1914-06-15"}, {"1915-12-31"}}, {"shape", 1}},
        {"A:future", "A", {{"1916"}, {}}, {"shape", 3}},
        {"B:shape", "B", {}, {"shape", 1}},
    };
    rows.parentRelations = {
        {"parent:A", "A", {{"1914-06-15"}, {}}, "", "explicit"},
        {"parent:B", "B", {}, "", "explicit"},
    };
    return rows;
}
void endpoint(const std::optional<std::string>& value) {
    std::cout << (value ? *value : "~");
}
void print(const TimelineRecords& rows) {
    for (const auto& row : rows.lifetimes) {
        std::cout << "L|" << row.id << '|' << row.entityId << '|';
        endpoint(row.validity.from);
        std::cout << '|';
        endpoint(row.validity.to);
        std::cout << '\n';
    }
    for (const auto& row : rows.geometryBindings) {
        std::cout << "G|" << row.id << '|' << row.entityId << '|';
        endpoint(row.validity.from);
        std::cout << '|';
        endpoint(row.validity.to);
        std::cout << '|' << row.geometryRef.id << '|' << row.geometryRef.version << '\n';
    }
    for (const auto& row : rows.parentRelations) {
        std::cout << "P|" << row.id << '|' << row.entityId << '|';
        endpoint(row.validity.from);
        std::cout << '|';
        endpoint(row.validity.to);
        std::cout << '|' << row.parentId << '|' << row.coverageMode << '\n';
    }
}
}
int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "Usage: timeline_edit_probe source|geometry|parent|truncate [month] [value ...]\n";
        return 2;
    }
    try {
        const auto original = source();
        const TimelineValidationContext context{
            {{"A", "general"}, {"B", "general"}},
            [](const GeometryRef& ref) { return ref.id == "shape" && ref.version >= 1 && ref.version <= 3; },
        };
        normalizeTimelineRecords(original, context);
        const std::string operation = argv[1];
        if (operation == "source") {
            if (argc != 2) return 2;
            print(original);
            return 0;
        }
        if (argc < 3) return 2;
        const std::string month = argv[2];
        TimelineRecords changed;
        if (operation == "geometry" && argc == 4) {
            changed = replaceGeometryBindingAtMonth(original, "A", month,
                GeometryRef{"shape", static_cast<std::uint32_t>(std::stoul(argv[3]))});
        } else if (operation == "parent" && argc == 5) {
            changed = replaceParentRelationAtMonth(original, "A", month, argv[3], argv[4]);
        } else if (operation == "truncate" && argc == 3) {
            changed = truncateTimelineEntityAtMonth(original, "A", month);
        } else {
            return 2;
        }
        normalizeTimelineRecords(changed, context);
        print(changed);
        return 0;
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
