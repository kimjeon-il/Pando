#pragma once
#include <pandoeditor/project.h>
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/webterritorialcommands.h>
#include <functional>
#include <string>

namespace pandoeditor::projectcodec {
inline constexpr int ProjectVersion=14;
inline constexpr int TerritorialIdentityVersion=6;
enum class LabelReferencePolicy {NativeHard,WebNonOwning};
struct PlatformPorts {
    // Required synchronous boundary. It throws on invalid media and never
    // rewrites the supplied data URL; Qt and Web retain their own media checks.
    std::function<void(const std::string&)> validateFlagDataUrl;
    bool preserveWebAnnotations=false;
    codecjson::ParsedTextPolicy parsedTextPolicy=codecjson::ParsedTextPolicy::QtUtf8;
    LabelReferencePolicy labelReferencePolicy=LabelReferencePolicy::NativeHard;
};
codecjson::Value validateProjectSetup(const codecjson::Value&);
void requireNavigationMonth(const codecjson::Value&,const std::string&);
ProjectDocument decode(const std::string&,const PlatformPorts&);
std::string restoredTimelineMonth(const ProjectDocument&);
ProjectDocument decodeWeb(const std::string&,const PlatformPorts&);
ProjectDocument decodeWebValue(const codecjson::Value&,const PlatformPorts&);
ProjectDocument readWebSnapshot(const std::string&,const PlatformPorts&);
std::string webSnapshot(const ProjectSnapshot&);
ProjectDocument replaceWebTerritorialSource(const ProjectDocument&,const ProjectDocument&,const std::string& month);
ContentEdit readWebContentEdit(const ProjectSnapshot&,const ObjectRef&,const codecjson::Value&,bool create);
ContentEdit readNativeContentEdit(const ProjectSnapshot&,const ObjectRef&,const codecjson::Value&,bool create);
std::string geometrySha256(const Geometry&);
std::string sha256Bytes(const std::string&);
bool isWebContentId(const std::string&);
codecjson::Value normalizeWebSourceProvenance(const codecjson::Value&,const std::string& defaultKind="unsupported");
SourceProvenance readWebSourceProvenance(const codecjson::Value&,const std::string& defaultKind="unsupported");
std::uint32_t readWebColor(const codecjson::Value&);
codecjson::Value webColorValue(std::uint32_t);
Geometry readWebGeometry(const codecjson::Value&);
codecjson::Value webGeometryValue(const Geometry&);
codecjson::Value webContentValue(const ProjectSnapshot&,const ObjectRef&,const ContentValue* value=nullptr,const Geometry* geometry=nullptr);
WebTerritorialFeature readWebTerritorialIdentityFeature(const codecjson::Value&,const PlatformPorts&);
codecjson::Value normalizeWebTerritorialStoredIdentity(const codecjson::Value&);
codecjson::Value webTerritorialIdentityValue(const ProjectDocument&,const TerritorialUnit&);
struct WebStorageContext {
    std::optional<std::string> version,savedAt;
    std::string format="pandolab-project-state";
};
std::string encode(const Project&,const PlatformPorts&);
std::string encode(const ProjectSnapshot&,const PlatformPorts&);
void validateNativeLabelReferences(const ProjectDocument&);
std::string encodeWeb(const ProjectSnapshot&,const PlatformPorts&,const WebStorageContext& context={});
// The validated canonical export tree is shared by file and autosave writers.
codecjson::Value encodeWebValue(const ProjectSnapshot&,const PlatformPorts&,const WebStorageContext& context={});
std::string encodeWebDelta(const ProjectDocument& before,const ProjectDocument& after,const ChangeImpact&);
}
