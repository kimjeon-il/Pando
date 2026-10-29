#include <pandoeditor/gisexchange.h>
#include <pandoeditor/project.h>
#include <pandoeditor/geometrypredicates.h>
#include <pandoeditor/polygonclipping.h>
#include <pandoeditor/sphericalpolygon.h>
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <limits>
#include <set>
#include <stdexcept>

namespace pandoeditor {
bool gisTerritorialAreaDecision(GisTerritorialAreaUse use,double area,double first,double second) {
    const auto jsMax=[](double a,double b){return std::isnan(a)||std::isnan(b)?std::numeric_limits<double>::quiet_NaN():std::max(a,b);};
    if(use==GisTerritorialAreaUse::InputOverlap) {
        const auto smaller=std::isnan(first)||std::isnan(second)?std::numeric_limits<double>::quiet_NaN():std::min(first,second);
        return area>jsMax(0.000001,jsMax(1.,smaller)*1e-9);
    }
    const auto threshold=jsMax(0.000001,first*1e-10);
    return use==GisTerritorialAreaUse::CountryOverlap?!(area<=threshold):area<=threshold;
}
std::vector<int> resolveGisCountryNames(const std::vector<GisCountryName>& countries,
    const std::vector<std::u16string>& queries) {
    struct Match { std::u16string id;int index=-1;bool ambiguous=false; };
    std::map<std::u16string,Match> lookup;
    for(std::size_t index=0;index<countries.size();++index) {
        const auto& country=countries[index];if(country.id.empty())continue;
        for(const auto* key:{&country.normalizedId,&country.normalizedName}) {
            if(key->empty())continue;
            auto [found,inserted]=lookup.emplace(*key,Match{country.id,int(index),false});
            if(!inserted&&found->second.id!=country.id)found->second.ambiguous=true;
        }
    }
    std::vector<int> result;result.reserve(queries.size());
    for(const auto& query:queries){const auto found=lookup.find(query);
        result.push_back(query.empty()||found==lookup.end()||found->second.ambiguous?-1:found->second.index);}
    return result;
}
GisCountryAssignmentPlan planGisCountryAssignments(const std::vector<GisCountryName>& countries,
    const std::u16string& fallback,const std::vector<std::u16string>& fields,const std::vector<bool>& hasField) {
    if(fields.size()!=hasField.size())throw std::invalid_argument("INVALID_GIS_COUNTRY_NAMES: assignment arrays");
    std::vector<std::u16string> queries;queries.reserve(fields.size()+1);queries.push_back(fallback);
    queries.insert(queries.end(),fields.begin(),fields.end());const auto matches=resolveGisCountryNames(countries,queries);
    GisCountryAssignmentPlan result;result.assignments.reserve(fields.size());
    std::map<std::u16string,std::size_t> groupIndexes;
    for(std::size_t i=0;i<fields.size();++i) {
        const auto index=hasField[i]?matches[i+1]:matches.front();
        result.assignments.push_back({index,!hasField[i]&&index>=0,hasField[i]&&index<0});
        if(index>=0) {
            const auto [position,inserted]=groupIndexes.emplace(countries[std::size_t(index)].id,result.groups.size());
            if(inserted)result.groups.push_back({index,{}});
            result.groups[position->second].features.push_back(i);
        }
    }
    return result;
}
GisTerritoryGeometryPlan planGisTerritoryGeometry(const std::vector<GisCountryShape>& countries,
    const std::vector<MultiPolygon>& features,const std::vector<GisCountryAssignmentGroup>& groups) {
    const auto area=[](const MultiPolygon& polygons) {
        std::vector<std::vector<DisplayMetricRing>> input;input.reserve(polygons.size());
        for(const auto& polygon:polygons){auto& output=input.emplace_back();output.reserve(polygon.size());
            for(const auto& ring:polygon){const bool closed=ring.size()>1&&ring.front().x==ring.back().x&&ring.front().y==ring.back().y;
                output.push_back({ring,closed});}}
        return displayGeometryAreaKm2(input);
    };
    const auto unite=[](const std::vector<MultiPolygon>& shapes) {
        if(shapes.empty())return MultiPolygon{};
        if(shapes.size()==1)return shapes.front();
        return clipPolygons(PolygonOperation::Union,shapes);
    };
    const auto bounds=[](const MultiPolygon& polygons)->std::optional<std::array<double,4>> {
        std::optional<std::array<double,4>> result;
        for(const auto& polygon:polygons)for(const auto& ring:polygon)for(const auto& point:ring){
            if(!result)result=std::array<double,4>{point.x,point.y,point.x,point.y};
            else {(*result)[0]=std::min((*result)[0],point.x);(*result)[1]=std::min((*result)[1],point.y);
                (*result)[2]=std::max((*result)[2],point.x);(*result)[3]=std::max((*result)[3],point.y);}
        }
        return result;
    };
    const auto intersects=[](const auto& a,const auto& b){return a&&b&&
        (*a)[0]<=(*b)[2]&&(*b)[0]<=(*a)[2]&&(*a)[1]<=(*b)[3]&&(*b)[1]<=(*a)[3];};
    std::vector<std::optional<std::array<double,4>>> featureBounds,countryBounds;
    featureBounds.reserve(features.size());for(const auto& feature:features)featureBounds.push_back(bounds(feature));
    countryBounds.reserve(countries.size());for(const auto& country:countries)countryBounds.push_back(bounds(country.geometry));
    std::vector<std::optional<double>> featureAreas(features.size());
    const auto featureArea=[&](std::size_t index){if(!featureAreas[index])featureAreas[index]=area(features[index]);return *featureAreas[index];};
    GisTerritoryGeometryPlan result;
    for(std::size_t left=0;left<features.size();++left)for(std::size_t right=left+1;right<features.size();++right){
        if(!intersects(featureBounds[left],featureBounds[right]))continue;
        const auto overlap=clipPolygons(PolygonOperation::Intersection,{features[left],features[right]});
        const auto leftArea=featureArea(left),rightArea=featureArea(right);
        if(!overlap.empty()&&gisTerritorialAreaDecision(GisTerritorialAreaUse::InputOverlap,area(overlap),leftArea,rightArea)){
            result.status=GisTerritoryPlanStatus::Overlap;result.left=left;result.right=right;return result;
        }
    }
    std::map<std::string,std::size_t> countryIndexes;
    for(std::size_t i=0;i<countries.size();++i)countryIndexes[countries[i].id]=i;
    std::set<std::string> absorbedIds;
    for(const auto& group:groups){
        if(group.index<0||std::size_t(group.index)>=countries.size())throw std::invalid_argument("INVALID_GIS_PLAN: country group");
        const auto& ownerId=countries[std::size_t(group.index)].id;const auto owner=countryIndexes.find(ownerId);
        if(owner==countryIndexes.end()||!countries[owner->second].hasGeometry){
            result.status=GisTerritoryPlanStatus::MissingOwner;result.missing=std::size_t(group.index);return result;
        }
        GisTerritoryGroup output;output.index=std::size_t(group.index);output.features=group.features;
        std::vector<MultiPolygon> incoming;incoming.reserve(group.features.size());
        for(const auto index:group.features){if(index>=features.size())throw std::invalid_argument("INVALID_GIS_PLAN: feature index");
            if(!features[index].empty())incoming.push_back(features[index]);}
        output.geometry=unite(incoming);output.importedArea=area(output.geometry);
        const auto importedBounds=bounds(output.geometry);
        std::vector<MultiPolygon> covered;
        for(std::size_t index=0;index<countries.size();++index){const auto& country=countries[index];
            if(!country.hasGeometry||!intersects(importedBounds,countryBounds[index]))continue;
            const auto overlap=clipPolygons(PolygonOperation::Intersection,{output.geometry,country.geometry});
            if(overlap.empty())continue;
            const auto overlapArea=area(overlap);
            if(!gisTerritorialAreaDecision(GisTerritorialAreaUse::CountryOverlap,overlapArea,output.importedArea,0))continue;
            covered.push_back(overlap);
            if(country.id==ownerId){output.existingArea+=overlapArea;continue;}
            const auto remainder=clipPolygons(PolygonOperation::Difference,{country.geometry,output.geometry});
            const bool full=remainder.empty()||gisTerritorialAreaDecision(GisTerritorialAreaUse::Absorbed,area(remainder),overlapArea,0);
            output.donors.push_back({index,overlapArea,full});
            if(full&&absorbedIds.insert(country.id).second)result.absorbed.push_back(index);
        }
        const auto coveredGeometry=unite(covered);
        const auto unclaimed=coveredGeometry.empty()?output.geometry:
            clipPolygons(PolygonOperation::Difference,{output.geometry,coveredGeometry});
        output.newArea=unclaimed.empty()?0:area(unclaimed);
        result.totalArea+=output.importedArea;double transfer=0.;for(const auto& donor:output.donors)transfer+=donor.area;
        result.transferArea+=transfer;result.existingArea+=output.existingArea;result.newArea+=output.newArea;
        result.groups.push_back(std::move(output));
    }
    return result;
}
namespace {
std::string trim(const std::string& raw) {
    const auto start=raw.find_first_not_of(" \t\r\n"),end=raw.find_last_not_of(" \t\r\n");
    return start==std::string::npos?"":raw.substr(start,end-start+1);
}
}
std::optional<GisExchangeTarget> normalizeExchangeTarget(const std::string& source,
    std::optional<GisExchangeTarget> fallback) {
    const auto name=trim(source);
    if(name=="project")return GisExchangeTarget::Project;
    if(name=="general")return GisExchangeTarget::General;
    if(name=="regional")return GisExchangeTarget::Regional;
    if(name=="distribution")return GisExchangeTarget::Distribution;
    if(name=="generic")return GisExchangeTarget::Generic;
    return fallback;
}
GisTargetDescriptor exchangeTargetDescriptor(GisExchangeTarget target) {
    switch(target) {
    case GisExchangeTarget::Project:return {target,"project",true,false};
    case GisExchangeTarget::General:
    case GisExchangeTarget::Regional:return {target,"territorial",false,false};
    case GisExchangeTarget::Distribution:return {target,"distribution",false,false};
    case GisExchangeTarget::Generic:return {target,"generic",false,true};
    }
    throw std::invalid_argument("INVALID_GIS_TARGET");
}
GisImportPlan createGisImportPlan(const ProjectSnapshot& project,std::string id,GisImportKind kind,
                                 GisSource source,GisExchangeTarget target,
                                 std::vector<std::string> affectedIds) {
    if(id.empty())throw std::invalid_argument("INVALID_GIS_PLAN: id");
    if(kind<GisImportKind::ProjectReplace||kind>GisImportKind::Distribution)
        throw std::invalid_argument("INVALID_GIS_PLAN: kind");
    (void)exchangeTargetDescriptor(target);
    std::set<std::string> seen;
    std::vector<std::string> unique;
    for(auto& item:affectedIds) {
        item=trim(item);
        if(!item.empty()&&seen.insert(item).second)unique.push_back(item);
    }
    return {1,std::move(id),project.instanceId(),project.document().documentId,
            project.revision(),kind,std::move(source),target,std::move(unique)};
}
void assertCurrentGisImportPlan(const ProjectSnapshot& project,const GisImportPlan& plan) {
    if(plan.version!=1||plan.id.empty()||plan.kind<GisImportKind::ProjectReplace||
       plan.kind>GisImportKind::Distribution)
        throw std::invalid_argument("INVALID_GIS_PLAN");
    (void)exchangeTargetDescriptor(plan.target);
    if(plan.projectInstanceId!=project.instanceId()||plan.documentId!=project.document().documentId||
       plan.revision!=project.revision())
        throw std::invalid_argument("STALE_GIS_PLAN");
}
GisTerritorialImportPlan planTerritorialGisImport(const ProjectSnapshot& project,
    std::string planId,GisSource source,GisExchangeTarget target,
    std::vector<GisTerritorialInput> units,std::vector<GeometryReplacement> replacements) {
    if(target!=GisExchangeTarget::General&&
       target!=GisExchangeTarget::Regional)
        throw std::invalid_argument("INVALID_GIS_PLAN: territorial target");
    if(units.empty())throw std::invalid_argument("INVALID_GIS_PLAN: empty territorial import");
    std::vector<std::string> ids;
    std::set<std::string> unique;
    const auto kind=target==GisExchangeTarget::General?UnitKind::General:UnitKind::Regional;
    for(const auto& row:units) {
        if(row.id.empty()||row.name.empty()||row.kind!=kind||!unique.insert(row.id).second||
           (row.color&&*row.color>0xffffff))
            throw std::invalid_argument("INVALID_GIS_PLAN: territorial row");
        const auto found=project.index().objects.find(territorialRef(row.id));
        if(row.replaceExisting != (found!=project.index().objects.end()) ||
           (row.replaceExisting && project.document().units.at(found->second).kind!=UnitKind::General))
            throw std::invalid_argument("DUPLICATE_ID: territorial import");
        ids.push_back(row.id);
    }
    std::set<ObjectRef> patched;
    for(const auto& patch:replacements) {
        const auto found=project.index().objects.find(patch.owner);
        if(patch.owner.domain!="territorial"||found==project.index().objects.end()||
           project.document().units.at(found->second).kind!=UnitKind::General||
           !patched.insert(patch.owner).second||unique.count(patch.owner.id))
            throw std::invalid_argument("INVALID_GIS_PLAN: country patch owner");
    }
    GisTerritorialImportPlan plan{createGisImportPlan(project,std::move(planId),
        GisImportKind::Territorial,
        std::move(source),target,std::move(ids)),std::move(units),std::move(replacements)};
    auto candidate=project.document();
    applyTerritorialGisImport(candidate,plan);
    reconcileGeometryProvenance(project.document(),candidate);
    validateDocument(candidate);
    for(std::size_t i=0;i<candidate.units.size();++i)if(isRootGeneral(candidate,candidate.units[i]))
        for(std::size_t j=i+1;j<candidate.units.size();++j)if(isRootGeneral(candidate,candidate.units[j])) {
            const auto& left=*candidate.geometries.get(staticGeometryBinding(candidate,territorialRef(candidate.units[i].id)).geometryRef);
            const auto& right=*candidate.geometries.get(staticGeometryBinding(candidate,territorialRef(candidate.units[j].id)).geometryRef);
            if(geometrySignificantOverlap(left,right))
                throw std::invalid_argument("GIS_COUNTRY_OVERLAP");
        }
    return plan;
}
void applyTerritorialGisImport(ProjectDocument& document,const GisTerritorialImportPlan& plan) {
    if(plan.units.empty()||plan.info.affectedIds.size()!=plan.units.size()||
       (plan.info.target!=GisExchangeTarget::General&&
        plan.info.target!=GisExchangeTarget::Regional)||
       plan.info.kind!=GisImportKind::Territorial)
        throw std::invalid_argument("INVALID_GIS_PLAN: territorial payload");
    std::set<std::string> seen;
    std::set<ObjectRef> patched;
    auto replace=[&](TerritorialUnit& unit,const Geometry& geometry) {
        auto& binding=staticGeometryBinding(document,territorialRef(unit.id));GeometryRef ref=binding.geometryRef;
        do {
            if(ref.version==std::numeric_limits<std::uint32_t>::max())
                throw std::invalid_argument("INVALID_GIS_PLAN: geometry version overflow");
            ++ref.version;
        }while(document.geometries.get(ref));
        document.geometries.insert(ref,geometry);
        binding.geometryRef=ref;
    };
    for(const auto& patch:plan.countryReplacements) {
        auto unit=std::find_if(document.units.begin(),document.units.end(),
            [&](const auto& row){return territorialRef(row.id)==patch.owner;});
        if(patch.owner.domain!="territorial"||!patched.insert(patch.owner).second||
           unit==document.units.end()||unit->kind!=UnitKind::General)
            throw std::invalid_argument("INVALID_GIS_PLAN: country patch");
        replace(*unit,patch.geometry);
    }
    for(std::size_t i=0;i<plan.units.size();++i) {
        const auto& input=plan.units[i];
        if(input.sovereign)throw std::invalid_argument("UNSUPPORTED_POLITICAL_RELATION");
        if(input.validity.from||input.validity.to)throw std::invalid_argument("TIMELINE_ACTIVATION: dated import requires T4");
        const auto kind=plan.info.target==GisExchangeTarget::General?UnitKind::General:UnitKind::Regional;
        if(input.id.empty()||input.name.empty()||plan.info.affectedIds[i]!=input.id||
           input.kind!=kind||!seen.insert(input.id).second||
           (input.color&&*input.color>0xffffff))
            throw std::invalid_argument("INVALID_GIS_PLAN: territorial row");
        auto unit=std::find_if(document.units.begin(),document.units.end(),
            [&](const auto& row){return row.id==input.id;});
        if(input.replaceExisting) {
            if(kind!=UnitKind::General||unit==document.units.end()||unit->kind!=kind||
               patched.count(territorialRef(input.id)))
                throw std::invalid_argument("INVALID_GIS_PLAN: country replacement");
            replace(*unit,input.geometry);
            unit->name=input.name;unit->nameExplicit=true;unit->notes=input.notes;
            if(input.validity.from||input.validity.to)throw std::invalid_argument("TIMELINE_ACTIVATION: dated import requires T4");
        } else {
            if(unit!=document.units.end())throw std::invalid_argument("DUPLICATE_ID: territorial import");
            GeometryRef ref{"gis-territorial:"+input.id,1};
            if(document.geometries.get(ref))throw std::invalid_argument("DUPLICATE_ID: GIS geometry");
            document.geometries.insert(ref,input.geometry);
            TerritorialUnit created;created.id=input.id;created.name=input.name;
            created.nameExplicit=true;created.baseName=kind==UnitKind::General?input.name:"";
            created.notes=input.notes;created.kind=kind;
            if(input.validity.from||input.validity.to)throw std::invalid_argument("TIMELINE_ACTIVATION: dated import requires T4");
            document.units.push_back(std::move(created));
            const auto owner=territorialRef(input.id);
            document.presentation.objectStyles.emplace(owner,ObjectStyle{});
            if(input.sovereign)throw std::invalid_argument("UNSUPPORTED_POLITICAL_RELATION");
            addStaticTerritorialRecords(document,input.id,ref,input.parent?input.parent->id:"","explicit");
        }
        if(input.color) {
            auto& style=document.presentation.objectStyles[territorialRef(input.id)];
            style.color=*input.color;style.explicitColor=true;
        }
    }
}
GisDistributionImportPlan planDistributionGisImport(const ProjectSnapshot& project,
    std::string planId,GisSource source,std::vector<DistributionLayer> layers,
    std::vector<GisDistributionInput> entries) {
    if(entries.empty())throw std::invalid_argument("INVALID_GIS_PLAN: empty distribution import");
    std::set<std::string> layerIds,entryIds;
    for(const auto& layer:layers) {
        if(layer.id.empty()||!layerIds.insert(layer.id).second||
           project.index().objects.count({"distributionLayer",layer.id}))
            throw std::invalid_argument("DUPLICATE_ID: distribution layer");
    }
    std::vector<std::string> ids;
    for(const auto& row:entries) {
        const auto& entry=row.entry;
        if(entry.id.empty()||!entryIds.insert(entry.id).second||
           project.index().objects.count({"distributionEntry",entry.id})||
           (bool(entry.territory)==bool(row.geometry))||entry.geometry)
            throw std::invalid_argument("INVALID_GIS_PLAN: distribution entry");
        const auto existing=project.index().objects.find({"distributionLayer",entry.layerId});
        if(existing==project.index().objects.end()&&!layerIds.count(entry.layerId))
            throw std::invalid_argument("DANGLING_REF: distribution layer");
        if(existing!=project.index().objects.end()&&
           project.document().distributionLayers.at(existing->second).locked)
            throw std::invalid_argument("LOCKED: distribution layer");
        ids.push_back(entry.id);
    }
    GisDistributionImportPlan plan{createGisImportPlan(project,std::move(planId),
        GisImportKind::Distribution,std::move(source),GisExchangeTarget::Distribution,
        std::move(ids)),std::move(layers),std::move(entries)};
    auto candidate=project.document();applyDistributionGisImport(candidate,plan);
    reconcileGeometryProvenance(project.document(),candidate);
    validateDocument(candidate);
    return plan;
}
void applyDistributionGisImport(ProjectDocument& document,const GisDistributionImportPlan& plan) {
    if(plan.info.kind!=GisImportKind::Distribution||
       plan.info.target!=GisExchangeTarget::Distribution||plan.entries.empty()||
       plan.entries.size()!=plan.info.affectedIds.size())
        throw std::invalid_argument("INVALID_GIS_PLAN: distribution payload");
    std::set<std::string> layerIds,entryIds;
    for(const auto& layer:plan.layers) {
        if(layer.id.empty()||!layerIds.insert(layer.id).second||
           std::any_of(document.distributionLayers.begin(),document.distributionLayers.end(),
               [&](const auto& existing){return existing.id==layer.id;}))
            throw std::invalid_argument("DUPLICATE_ID: distribution layer");
        document.distributionLayers.push_back(layer);
    }
    for(std::size_t i=0;i<plan.entries.size();++i) {
        const auto& input=plan.entries[i];auto entry=input.entry;
        if(entry.id.empty()||plan.info.affectedIds[i]!=entry.id||
           !entryIds.insert(entry.id).second||bool(entry.territory)==bool(input.geometry)||
           entry.geometry||std::any_of(document.distributionEntries.begin(),
               document.distributionEntries.end(),[&](const auto& existing){return existing.id==entry.id;}))
            throw std::invalid_argument("INVALID_GIS_PLAN: distribution IDs/source");
        if(input.geometry) {
            GeometryRef ref{"gis-distribution:"+entry.id,1};
            if(document.geometries.get(ref))throw std::invalid_argument("DUPLICATE_ID: distribution geometry");
            document.geometries.insert(ref,*input.geometry);entry.geometry=ref;
        }
        document.distributionEntries.push_back(std::move(entry));
    }
}
GisGenericImportPlan planGenericGisImport(const ProjectSnapshot& project,std::string planId,
    GisSource source,std::vector<GisGenericInput> features) {
    if(features.empty())throw std::invalid_argument("INVALID_GIS_PLAN: empty generic import");
    std::set<std::string> seen;
    std::vector<std::string> ids;
    for(const auto& feature:features) {
        if(feature.id.empty()||!seen.insert(feature.id).second||
           project.index().objects.count({"generic",feature.id}))
            throw std::invalid_argument("DUPLICATE_ID: generic feature");
        ids.push_back(feature.id);
    }
    GisGenericImportPlan plan{createGisImportPlan(project,std::move(planId),
        GisImportKind::Generic,std::move(source),GisExchangeTarget::Generic,std::move(ids)),
        std::move(features)};
    auto candidate=project.document();
    applyGenericGisImport(candidate,plan);
    reconcileGeometryProvenance(project.document(),candidate);
    validateDocument(candidate);
    return plan;
}
void applyGenericGisImport(ProjectDocument& document,const GisGenericImportPlan& plan) {
    if(plan.info.kind!=GisImportKind::Generic||plan.info.target!=GisExchangeTarget::Generic||
       plan.features.empty()||plan.info.affectedIds.size()!=plan.features.size())
        throw std::invalid_argument("INVALID_GIS_PLAN: generic payload");
    std::set<std::string> seen;
    for(std::size_t i=0;i<plan.features.size();++i) {
        const auto& feature=plan.features[i];
        if(feature.id.empty()||plan.info.affectedIds[i]!=feature.id||!seen.insert(feature.id).second)
            throw std::invalid_argument("INVALID_GIS_PLAN: generic IDs");
        if(std::any_of(document.genericFeatures.begin(),document.genericFeatures.end(),
             [&](const auto& existing){return existing.id==feature.id;}))
            throw std::invalid_argument("DUPLICATE_ID: generic feature");
        GeometryRef geometry{"gis-generic:"+feature.id,1};
        document.geometries.insert(geometry,feature.geometry);
        GenericFeature row;row.id=feature.id;row.name=feature.name;row.notes=feature.notes;
        row.color=feature.color;row.geometry=geometry;
        row.source.kind="gis";row.source.dataset=plan.info.source.fileName;
        row.source.sourceFormat=plan.info.source.sourceKind;
        row.source.sourceId=feature.id;row.source.details=feature.propertiesJson;
        document.genericFeatures.push_back(std::move(row));
    }
}
}
