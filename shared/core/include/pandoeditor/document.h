#pragma once
#include <pandoeditor/presentation.h>
#include <pandoeditor/temporal.h>
#include <pandoeditor/geometry-types.h>
#include <pandoeditor/geometryprovenance.h>
#include <pandoeditor/timeline-records.h>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <tuple>
#include <vector>

namespace pandoeditor {
inline ObjectRef territorialRef(const std::string& id) { return {"territorial",id}; }
enum class UnitKind { General, Regional };
struct SourceProvenance {
    std::string kind="user", dataset, version, sourceId, sourceFormat, sourceType, importedAt;
    // Lossless JSON object; parsing is owned by the codec boundary.
    std::string details="{}";
};
struct LibraryOrigin {
    std::string libraryId,geometryVersionId;
    std::optional<std::string> referenceDate;
    std::string sourceId,sourceVersion,certainty;
    bool partial=false;
    std::vector<std::string> missingLibraryRefs;
    bool operator==(const LibraryOrigin& other) const {
        return std::tie(libraryId,geometryVersionId,referenceDate,sourceId,sourceVersion,
                        certainty,partial,missingLibraryRefs)==
               std::tie(other.libraryId,other.geometryVersionId,other.referenceDate,other.sourceId,
                        other.sourceVersion,other.certainty,other.partial,
                        other.missingLibraryRefs);
    }
};
enum class FlagPolicy { Default, None, Embedded };
struct TerritorialSymbolStyle {
    FlagPolicy policy=FlagPolicy::Default;
    std::string embeddedDataUrl;
    // Original country default retained when a country becomes a subunit.
    // Independent of the editable override so reset can restore the default.
    std::string defaultCountryId;
    // Present (including empty) when conversion captured an explicit override.
    std::optional<std::string> defaultFlagDataUrl;
};
struct CountryDetails { std::string capital; };
struct PlaceLabel {
    std::string id, name, kind="custom", notes;
    GeometryRef geometry;
    std::optional<ObjectRef> territory;
    SourceProvenance source;
    // The immutable built-in record that this ordinary user label copied.
    std::optional<std::string> sourcePlaceId;
    // Current Web label annotations, including explicit null. Missingness is
    // distinct from a present JSON value; no second label DTO is retained.
    std::optional<std::string> metadata;
    std::optional<std::set<std::string>> webFields;
};
std::set<std::string> labelWebFields(const PlaceLabel&);
struct HydroFeature {
    std::string id, name, kind="river", notes;
    GeometryRef geometry;
    std::uint32_t color=0x3388cc;
    bool locked=false;
    SourceProvenance source;
    std::optional<std::string> sourceFeatureId;
    // Fields outside the typed current hydro properties remain annotations.
    // Reserved identity/name/source/color fields are never copied here.
    std::string annotations="{}";
    std::optional<std::set<std::string>> webPropertyFields;
};
std::set<std::string> hydroWebPropertyFields(const HydroFeature&);
struct DistributionLayer {
    std::string id, name, unit;
    std::uint32_t color=0x8c68d8;
    bool locked=false;
    std::optional<std::string> parentId;
    std::vector<std::string> groups;
    Validity validity;
    std::string metadata="{}";
    DistributionValueScale valueScale;
    bool explicitColor=true;
};
struct DistributionEntry {
    std::string id, layerId;
    std::optional<ObjectRef> territory;
    std::optional<GeometryRef> geometry;
    double value=0;
    std::string certainty="unknown", metadata="{}";
    Validity validity;
};
struct GenericFeature {
    std::string id, name, notes;
    GeometryRef geometry;
    std::uint32_t color=0x888888;
    bool locked=false, fallbackOnly=true;
    SourceProvenance source;
    bool explicitColor=true;
};
struct PhysicalDataSettings {
    std::string dataset, version, source;
    std::vector<std::string> hiddenHydroIds;
};
struct TerritorialUnit {
    std::string id, name, notes;
    UnitKind kind=UnitKind::General;
    bool locked=false;
    // Country base name is immutable source data; name is the current override.
    std::string baseName;
    bool nameExplicit=true;
    std::optional<LibraryOrigin> libraryOrigin;
    // Additional supported annotation metadata, lossless through the codec.
    std::string metadata="{}", sourceFolderId, sourceEntityId, sourceGeometryVersion;
};
struct ObjectStyle { std::uint32_t color=0xa8c7db; double opacity=1; bool explicitColor=true; };
// Immutable codec evidence for the current native file's hydro item namespace.
// Visibility itself lives only in WebPresentation::itemVisibility["hydro"].
struct PresentationCatalog {
    std::map<std::string,std::string> hydroLayers;
    std::vector<std::string> countryLabelIds;
    std::map<std::string,std::string> builtinSubunitSources;
};
struct PresentationState {
    WebPresentation webPresentation;
    std::map<ObjectRef,ObjectStyle> objectStyles;
    std::shared_ptr<const PresentationCatalog> catalog;
};
struct PreservedExtension {
    std::string id, sourceFormat="pandoeditor-project";
    int sourceSchema=3;
    std::string jsonPointer, payload;
    std::string status="unsupported", dependencyKnowledge="unknown";
    std::vector<ObjectRef> dependencies;
    std::vector<std::string> forbiddenEffects;
    // Unknown envelope fields are retained by the codec too.
    std::string envelopeExtras="{}";
};
struct ProjectDocument {
    std::string documentId;
    // Input-only codec hint. Live cursor ownership remains Project session state.
    // Supported file header, source and physical-view annotations. The codec
    // owns this lossless JSON object; temporal/content facts remain typed below.
    std::string exchangeMetadata=R"({"projectSetup":{"initialMonth":"1970-01","timelineRange":null,"initialMapBounds":null,"sourceMode":"empty"}})";
    std::vector<TerritorialUnit> units;
    // Ordered Core history projection used by source-relative rendering and
    // autosave. It is never a file field or a client-supplied mutation list.
    std::vector<std::string> dirtyTerritorialIds;
    std::map<ObjectRef,CountryDetails> countryDetails;
    std::map<ObjectRef,TerritorialSymbolStyle> symbols;
    std::vector<PlaceLabel> labels;
    std::vector<HydroFeature> hydro;
    std::vector<DistributionLayer> distributionLayers;
    std::vector<DistributionEntry> distributionEntries;
    std::vector<GenericFeature> genericFeatures;
    PhysicalDataSettings physicalData;
    GeometryStore geometries;
    GeometryProvenance geometryProvenance;
    TimelineRecords timelineRecords;
    PresentationState presentation;
    std::vector<PreservedExtension> extensions;
    ProjectDocument()=default;
};
// References into the canonical document: no second editable copy, including geometry.
struct CountryView {
    const std::string &id, &name;
    const MultiPolygon& polygons;
    // Resolved explicit/default display color: a snapshot value, not a borrowed conditional.
    std::uint32_t color;
    const std::string& memo;
    const double& opacity;
    const bool& locked;
};
struct DocumentIndex {
    std::map<ObjectRef,std::size_t> objects;
    std::map<ObjectRef,std::vector<ObjectRef>> children, dependents;
    std::map<ObjectRef,std::vector<std::size_t>> parentRelationsByUnit;
    std::map<GeometryRef,std::vector<ObjectRef>> geometryUsers;
};
DocumentIndex validateDocument(const ProjectDocument& document);
void indexContent(const ProjectDocument&, DocumentIndex&);
bool sameContent(const ProjectDocument&, const ProjectDocument&);
// Derived from live canonical content; Undo needs no separate hidden-ID state.
std::set<std::string> copiedPlaceSourceIds(const ProjectDocument&);
std::optional<GeometryRef> objectGeometry(const ProjectDocument&,const DocumentIndex&,const ObjectRef&);
bool objectLocked(const ProjectDocument&,const DocumentIndex&,const ObjectRef&);
std::string contentGroup(const ProjectDocument&,const ObjectRef&);
std::vector<CountryView> countryViews(const ProjectDocument& document);
std::vector<TimelineEntityIdentity> timelineEntityCatalog(const ProjectDocument&);
bool isStaticTimeline(const ProjectDocument&);
void requireStaticTimeline(const ProjectDocument&);
const TimelineGeometryBinding& staticGeometryBinding(const ProjectDocument&,const std::string& entityId);
TimelineGeometryBinding& staticGeometryBinding(ProjectDocument&,const std::string& entityId);
const TimelineParentRelation& staticParentRelation(const ProjectDocument&,const std::string& entityId);
TimelineParentRelation& staticParentRelation(ProjectDocument&,const std::string& entityId);
const TimelineLifetime& staticLifetime(const ProjectDocument&,const std::string& entityId);
TimelineLifetime& staticLifetime(ProjectDocument&,const std::string& entityId);
void addStaticTerritorialRecords(ProjectDocument&,const std::string& entityId,GeometryRef,
                                 const std::string& parentId="",const std::string& coverageMode="explicit");
void removeTerritorialRecords(ProjectDocument&,const std::vector<std::string>& entityIds);
bool isRootGeneral(const ProjectDocument&,const TerritorialUnit&);
std::vector<std::string> blockingExtensions(const ProjectDocument&, const ObjectRef&, const std::string& effect);
bool effectAllowed(const ProjectDocument&, const ObjectRef&, const std::string& effect);
} // namespace pandoeditor
