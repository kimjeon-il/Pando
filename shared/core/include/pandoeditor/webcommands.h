#pragma once
#include <pandoeditor/projectcodec.h>

namespace pandoeditor {
std::string webCommandString(const codecjson::Value&);
std::optional<double> webCommandNumber(const codecjson::Value&);
std::vector<ObjectRef> webTerritorialStyleTargets(const codecjson::Value&);
CommandRequest readWebTerritorialStyleCommand(const ProjectSnapshot&,const std::string&,
                                             const codecjson::Value&);
CommandRequest readWebObjectEditCommand(const ProjectSnapshot&,const std::string&,const codecjson::Value&);
// Current Web DTO conversion only. The resulting request is validated and
// committed by the existing CommandProcessor and Project history owner.
CommandRequest readWebMetadataCommand(const ProjectSnapshot&,const codecjson::Value& payload,
                                     const projectcodec::PlatformPorts&);
}
