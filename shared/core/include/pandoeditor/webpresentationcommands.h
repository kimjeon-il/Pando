#pragma once
#include <pandoeditor/presentationcommands.h>
#include <pandoeditor/losslessjson.h>
namespace pandoeditor {
LabelSettings readWebLabelSettings(const codecjson::Value&);
PresentationAction readWebPresentationCommand(const ProjectSnapshot&,const std::string&,const codecjson::Value&);
}
