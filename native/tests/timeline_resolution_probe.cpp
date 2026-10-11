#include <pandoeditor/timeline-resolver.h>
#include <iostream>
#include <stdexcept>
#include <string>

// Mirrors the timelineRecords and entity ordering in
// tests/fixtures/timeline-exchange/complex.json (web/app portability corpus).
// The Node oracle checks every month against the web's shared golden file.
using namespace pandoeditor;

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "Usage: timeline_resolution_probe YYYY-MM ...\n";
        return 2;
    }
    try {
        TimelineRecords records;
        records.lifetimes = {
            {"life:A", "A", {}},
            {"life:C", "C", {}},
            {"life:R", "R", {}},
            {"B:ancient", "B", {{"-0001"}, {"0001"}}},
            {"B:modern", "B", {{"1910-01-02"}, {"1920-03"}}},
        };
        records.geometryBindings = {
            {"shape:C", "C", {}, {"shape", 1}},
            {"shape:R", "R", {}, {"shape", 1}},
            {"A:old", "A", {{}, {"1914-06"}}, {"shape", 1}},
            {"A:new", "A", {{"1914-07"}, {}}, {"shape", 2}},
            {"B:ancient-shape", "B", {{"-0001"}, {"0001"}}, {"shape", 1}},
            {"B:modern-shape", "B", {{"1910-01-02"}, {"1920-03"}}, {"shape", 1}},
        };
        records.parentRelations = {
            {"parent:A", "A", {}, "", "explicit"},
            {"parent:C", "C", {}, "", "explicit"},
            {"parent:R", "R", {}, "", "explicit"},
            {"B:ancient-parent", "B", {{"-0001"}, {"0001"}}, "A", "partition"},
            {"B:old-parent", "B", {{"1910-01-02"}, {"1915"}}, "A", "partition"},
            {"B:new-parent", "B", {{"1916"}, {"1920-03"}}, "C", "explicit"},
        };
        const TimelineValidationContext context{
            {{"A", "general"}, {"B", "general"}, {"C", "general"}, {"R", "regional"}},
            [](const GeometryRef& ref) {
                return ref.id == "shape" && (ref.version == 1 || ref.version == 2);
            },
        };
        for (int i = 1; i < argc; ++i) {
            const auto world = resolveWorld(records, context, argv[i]);
            std::cout << world.month;
            for (const auto& entity : world.entities) {
                std::cout << '|' << entity.id << ',' << entity.geometryRef.id
                          << ',' << entity.geometryRef.version << ',' << entity.parentId
                          << ',' << entity.rootId << ',';
                for (std::size_t j = 0; j < entity.ancestors.size(); ++j) {
                    if (j) std::cout << '/';
                    std::cout << entity.ancestors[j];
                }
            }
            std::cout << '\n';
        }
        return 0;
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
