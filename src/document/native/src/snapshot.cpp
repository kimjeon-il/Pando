#include <pandoeditor/project.h>
#include "documentstate.h"

namespace pandoeditor {
const ProjectDocument& ProjectSnapshot::document() const noexcept { return state_->document; }
const std::set<ObjectRef>& ProjectSnapshot::inactiveObjectRefs() const noexcept { return state_->inactiveIds; }
const DocumentIndex& ProjectSnapshot::index() const noexcept { return state_->index; }
const CountryView* ProjectSnapshot::country(const std::string& id) const {
    auto it=state_->countryIndex.find(id); return it==state_->countryIndex.end()?nullptr:&state_->countries[it->second];
}
bool ProjectSnapshot::matches(const Project& p) const noexcept {
    return instanceId_==p.instanceId() && revision_==p.revision() &&
        (timelineMonth_.empty()||timelineMonth_==p.timelineCursor()) && timelineEditsEnabled_==p.timelineEditsEnabled() && document().documentId==p.document().documentId;
}
}
