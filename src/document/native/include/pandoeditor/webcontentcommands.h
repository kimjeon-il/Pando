#pragma once
#include <pandoeditor/projectcodec.h>

namespace pandoeditor {
// Current service constructor/metadata DTOs become typed commands. The project
// remains the sole content/history owner; imports are validated as one candidate.
CommandRequest readWebContentCommand(const ProjectSnapshot&,const std::string& operationId,
                                    const codecjson::Value& payload);
}
