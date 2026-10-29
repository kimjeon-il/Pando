#pragma once
#include <pandoeditor/document.h>
#include <pandoeditor/territorialmutation.h>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace pandoeditor {
class ProjectSnapshot;
// IDs and pre-normalized search keys retain their original UTF-16 identity.
// Each result is the first matching row, or -1 for no match or ambiguity.
struct GisCountryName { std::u16string id,normalizedId,normalizedName; };
std::vector<int> resolveGisCountryNames(const std::vector<GisCountryName>&,
    const std::vector<std::u16string>& queries);
struct GisCountryAssignment { int index=-1;bool usedFallback=false,unresolvedField=false; };
struct GisCountryAssignmentGroup { int index=-1;std::vector<std::size_t> features; };
struct GisCountryAssignmentPlan { std::vector<GisCountryAssignment> assignments;std::vector<GisCountryAssignmentGroup> groups; };
GisCountryAssignmentPlan planGisCountryAssignments(const std::vector<GisCountryName>&,
    const std::u16string& fallback,const std::vector<std::u16string>& fields,const std::vector<bool>& hasField);
struct GisCountryShape { std::string id;bool hasGeometry=false;MultiPolygon geometry; };
struct GisTerritoryDonor { std::size_t index=0;double area=0;bool absorbed=false; };
struct GisTerritoryGroup {
    std::size_t index=0;std::vector<std::size_t> features;MultiPolygon geometry;
    double importedArea=0,existingArea=0,newArea=0;std::vector<GisTerritoryDonor> donors;
};
enum class GisTerritoryPlanStatus { Valid, Overlap, MissingOwner };
struct GisTerritoryGeometryPlan {
    GisTerritoryPlanStatus status=GisTerritoryPlanStatus::Valid;
    std::size_t left=0,right=0,missing=0;
    std::vector<GisTerritoryGroup> groups;
    double totalArea=0,transferArea=0,existingArea=0,newArea=0;
    std::vector<std::size_t> absorbed;
};
GisTerritoryGeometryPlan planGisTerritoryGeometry(const std::vector<GisCountryShape>&,
    const std::vector<MultiPolygon>&,const std::vector<GisCountryAssignmentGroup>&);
enum class GisTerritorialAreaUse { InputOverlap, CountryOverlap, Absorbed };
bool gisTerritorialAreaDecision(GisTerritorialAreaUse,double area,double firstReference,double secondReference);
enum class GisExchangeTarget { Project, General, Regional, Distribution, Generic };
struct GisTargetDescriptor {
    GisExchangeTarget target;
    std::string domain;
    bool replaceOnly=false,fallback=false;
};
std::optional<GisExchangeTarget> normalizeExchangeTarget(const std::string&,
    std::optional<GisExchangeTarget> fallback=GisExchangeTarget::Generic);
GisTargetDescriptor exchangeTargetDescriptor(GisExchangeTarget);

enum class GisImportKind { ProjectReplace, CountryMerge, Territorial, Generic, Distribution };
struct GisSource {std::string fileName,sourceKind;};
// Metadata-only immutable-in-use plan. File adapters populate mapping/payload
// after validation; no canonical mutation occurs before CommandProcessor confirm.
struct GisImportPlan {
    int version=1;
    std::string id,projectInstanceId,documentId;
    std::uint64_t revision=0;
    GisImportKind kind=GisImportKind::Generic;
    GisSource source;
    GisExchangeTarget target=GisExchangeTarget::Generic;
    std::vector<std::string> affectedIds;
    std::string mappingJson="{}",payloadJson="{}",summaryJson="{}";
};
GisImportPlan createGisImportPlan(const ProjectSnapshot&,std::string id,GisImportKind kind,
                                 GisSource,GisExchangeTarget,std::vector<std::string> affectedIds);
void assertCurrentGisImportPlan(const ProjectSnapshot&,const GisImportPlan&);

// The adapter supplies validated local geometry and source attributes. This
// typed plan owns the payload and is applied only to a candidate document.
struct GisGenericInput {
    std::string id,name;
    Geometry geometry;
    std::string propertiesJson="{}";
    std::string notes;
    std::uint32_t color=0x888888;
};
struct GisGenericImportPlan {
    GisImportPlan info;
    std::vector<GisGenericInput> features;
};
// The worker owns all geometry, including donor patches. The core repeats the
// candidate validation at command preparation; the live project is never a
// workspace for geometry operations.
struct GisTerritorialInput {
    std::string id,name,notes;
    UnitKind kind=UnitKind::Regional;
    Geometry geometry;
    std::optional<ObjectRef> parent,sovereign;
    Validity validity;
    std::optional<std::uint32_t> color;
    bool replaceExisting=false;
};
struct GisTerritorialImportPlan {
    GisImportPlan info;
    std::vector<GisTerritorialInput> units;
    std::vector<GeometryReplacement> countryReplacements;
};
struct GisDistributionInput {
    DistributionEntry entry;
    // GIS exports may materialize a territorial reference as a polygon. The
    // canonical entry keeps only the typed reference in that case.
    std::optional<Geometry> geometry;
};
struct GisDistributionImportPlan {
    GisImportPlan info;
    std::vector<DistributionLayer> layers;
    std::vector<GisDistributionInput> entries;
};
GisDistributionImportPlan planDistributionGisImport(const ProjectSnapshot&,std::string planId,
    GisSource,std::vector<DistributionLayer>,std::vector<GisDistributionInput>);
void applyDistributionGisImport(ProjectDocument&,const GisDistributionImportPlan&);
GisTerritorialImportPlan planTerritorialGisImport(const ProjectSnapshot&,std::string planId,
    GisSource,GisExchangeTarget,std::vector<GisTerritorialInput>,
    std::vector<GeometryReplacement> countryReplacements={});
void applyTerritorialGisImport(ProjectDocument&,const GisTerritorialImportPlan&);
GisGenericImportPlan planGenericGisImport(const ProjectSnapshot&,std::string planId,
    GisSource,std::vector<GisGenericInput>);
void applyGenericGisImport(ProjectDocument&,const GisGenericImportPlan&);
}
