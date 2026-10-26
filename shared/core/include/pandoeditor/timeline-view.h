#pragma once
#include <pandoeditor/document.h>
#include <pandoeditor/timeline-resolver.h>
#include <set>

namespace pandoeditor {
struct TimelineDocumentView {
    ProjectDocument document;
    ResolvedWorld world;
    std::set<ObjectRef> inactiveIds;
};

// A read-only static projection for existing render and pick consumers. The
// source document and its dated records remain the only persistent state.
// An already validated resolution can be reused by selection, projection and transport.
// No retained world cache is created; caller owns the short-lived result.
TimelineDocumentView timelineDocumentView(const ProjectDocument&, const std::string& month,
                                          const ResolvedWorld* resolved = nullptr);
// Capture only effective property differences, then restore immutable defaults.
void captureTimelinePropertyChanges(const ProjectDocument& source,const ProjectDocument& beforeView,
    ProjectDocument& candidate,const std::string& month);
// Validate affected parent relationships at every geometry/relation boundary.
void validateTimelineParentChanges(const ProjectDocument& before,const ProjectDocument& after);
}
