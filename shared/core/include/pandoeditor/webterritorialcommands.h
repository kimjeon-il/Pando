#pragma once
#include <pandoeditor/document.h>

namespace pandoeditor {
class ProjectSnapshot;
struct CommandRequest;
namespace codecjson { struct Value; }
namespace projectcodec { struct PlatformPorts; }

enum class WebTerritorialOperation { Create,Geometry,Parent,Remove,Patch,Replace,CopyRegion };
struct WebTerritorialFeature {
    TerritorialUnit identity;
    Geometry geometry;
    std::string parentId,coverageMode;
    Validity validity;
    ObjectStyle style;
    std::optional<CountryDetails> countryDetails;
    std::optional<TerritorialSymbolStyle> symbol;
};
// A typed current Web store intent. Common command prepare owns current-month
// admission, archive versions, records, dependencies and atomic publication.
struct WebTerritorialEdit {
    WebTerritorialOperation operation=WebTerritorialOperation::Create;
    std::vector<WebTerritorialFeature> features;
    std::vector<std::string> removedIds;
    std::string id,parentId,sourceId,newName;
    std::optional<std::uint32_t> color;
};
CommandRequest readWebTerritorialCommand(const ProjectSnapshot&,const std::string& operationId,
                                        const codecjson::Value&,const projectcodec::PlatformPorts&);
codecjson::Value normalizeWebTerritorialResolvedFeature(const codecjson::Value&);
ProjectDocument applyWebTerritorialEdit(const ProjectSnapshot&,const WebTerritorialEdit&);
}
