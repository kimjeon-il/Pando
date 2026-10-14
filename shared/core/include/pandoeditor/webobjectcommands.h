#pragma once
#include <pandoeditor/document.h>

namespace pandoeditor {
class ProjectSnapshot;
struct CommandRequest;
namespace codecjson { struct Value; }

// Current Web UI deletion intent. Core owns the atomic candidate, history,
// revision and selection publication; the reader never edits live state.
struct WebObjectRemoval { std::vector<ObjectRef> refs; };
CommandRequest readWebObjectRemoval(const ProjectSnapshot&,const codecjson::Value& payload);
ProjectDocument applyWebObjectRemoval(const ProjectSnapshot&,const WebObjectRemoval&);
std::string webTerritorialLabelDisplayId(const ProjectSnapshot&,const std::string& entityId);
}
