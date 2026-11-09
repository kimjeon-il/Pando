#include <pandoeditor/document.h>
#include <pandoeditor/geometrypredicates.h>
#include "documentstate.h"
#include <algorithm>
#include <cmath>
#include <set>
#include <stdexcept>

namespace pandoeditor {
namespace {
void require(bool ok,const std::string& code) { if(!ok) throw std::invalid_argument(code); }
bool opacity(double x) { return std::isfinite(x) && x>=0 && x<=1; }
void point(Point p) { require(std::isfinite(p.x)&&std::isfinite(p.y)&&std::abs(p.x)<=180&&std::abs(p.y)<=90,"INVALID_GEOMETRY: coordinate"); }
void validateGeometry(const Geometry& g,bool canonical) {
    if(g.type=="Point" || g.type=="MultiPoint") {
        require(!g.points.empty() && (g.type!="Point" || g.points.size()==1) && g.lines.empty() && g.polygons.empty(),"INVALID_GEOMETRY: points");
        for(auto p:g.points) point(p);
    } else if(g.type=="LineString" || g.type=="MultiLineString") {
        require(!g.lines.empty() && (g.type!="LineString" || g.lines.size()==1) && g.points.empty() && g.polygons.empty(),"INVALID_GEOMETRY: lines");
        for(const auto& r:g.lines) { require(r.size()>=2,"INVALID_GEOMETRY: line size"); for(auto p:r) point(p); }
    } else {
        require((g.type=="Polygon" || g.type=="MultiPolygon") && !g.polygons.empty() && (g.type!="Polygon" || g.polygons.size()==1) && g.points.empty() && g.lines.empty(),"INVALID_GEOMETRY: polygon type");
        for(const auto& poly:g.polygons) {
            require(!poly.empty(),"INVALID_GEOMETRY: empty polygon");
            for(const auto& ring:poly) {
                require(ring.size()>=4 && ring.front().x==ring.back().x && ring.front().y==ring.back().y,"INVALID_GEOMETRY: open ring");
                if(canonical) {
                    for(const auto p:ring)point(p);
                    require(validateClippedTerritorialRing(ring).empty(),"INVALID_GEOMETRY: invalid canonical ring");
                } else {
                    double area=0;
                    for(std::size_t i=0;i<ring.size();++i) { point(ring[i]); auto a=ring[i],b=ring[(i+1)%ring.size()]; area+=a.x*b.y-b.x*a.y; }
                    require(std::abs(area)>=1e-14,"INVALID_GEOMETRY: degenerate ring");
                }
            }
        }
    }
}
}
void GeometryStore::declareResource(GeometryRef ref,GeometryResource resource) {
    require(!ref.id.empty()&&ref.version>0&&resource.decodedBytes>0&&resource.decodedBytes<=64*1024*1024
        &&resource.contentSha256.size()==64&&std::all_of(resource.contentSha256.begin(),resource.contentSha256.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');})
        &&(resource.type=="Polygon"||resource.type=="MultiPolygon"||resource.type=="LineString"||resource.type=="MultiLineString"),"INVALID_GEOMETRY_RESOURCE");
    const auto shape=get(ref);require(!shape||shape->type==resource.type,"INVALID_GEOMETRY_RESOURCE: type mismatch");
    require(resources_.emplace(std::move(ref),std::move(resource)).second,"DUPLICATE_ID: geometry resource");
}
bool GeometryStore::contains(const GeometryRef& ref) const {return versions_.count(ref)||resources_.count(ref);}
std::string GeometryStore::type(const GeometryRef& ref) const {
    if(const auto shape=get(ref))return shape->type;
    const auto found=resources_.find(ref);return found==resources_.end()?std::string{}:found->second.type;
}
void GeometryStore::requireReady(const std::vector<GeometryRef>& refs) const {
    std::set<GeometryRef> missing;for(const auto& ref:refs)if(!get(ref))missing.insert(ref);
    if(!missing.empty())throw GeometryUnavailable({missing.begin(),missing.end()});
}
void GeometryStore::insert(GeometryRef ref,Geometry geometry) {
    require(!ref.id.empty() && ref.version>0,"INVALID_GEOMETRY: version");
    validateGeometry(geometry,false);
    require(!resources_.count(ref)||resources_.at(ref).type==geometry.type,"INVALID_GEOMETRY_RESOURCE: type mismatch");
    require(versions_.emplace(std::move(ref),std::make_shared<const Geometry>(std::move(geometry))).second,"DUPLICATE_ID: geometry version");
}
void GeometryStore::insertCanonical(GeometryRef ref,Geometry geometry) {
    require(!ref.id.empty() && ref.version>0,"INVALID_GEOMETRY: version");
    validateGeometry(geometry,true);
    require(!resources_.count(ref)||resources_.at(ref).type==geometry.type,"INVALID_GEOMETRY_RESOURCE: type mismatch");
    require(versions_.emplace(std::move(ref),std::make_shared<const Geometry>(std::move(geometry))).second,"DUPLICATE_ID: geometry version");
}
void GeometryStore::retain(GeometryRef ref,std::shared_ptr<const Geometry> geometry) {
    require(!ref.id.empty()&&ref.version>0&&bool(geometry),"INVALID_GEOMETRY: retained version");
    validateGeometry(*geometry,true);
    require(versions_.emplace(std::move(ref),std::move(geometry)).second,"DUPLICATE_ID: geometry version");
}
void GeometryStore::retainFrom(const GeometryStore& source,const GeometryRef& sourceRef,GeometryRef destination) {
    require(!destination.id.empty()&&destination.version>0,"INVALID_GEOMETRY: retained version");
    const auto found=source.versions_.find(sourceRef);require(found!=source.versions_.end(),"DANGLING_REF: retained geometry");
    require(versions_.emplace(std::move(destination),found->second).second,"DUPLICATE_ID: geometry version");
}
std::shared_ptr<const Geometry> GeometryStore::get(const GeometryRef& ref) const {
    auto it=versions_.find(ref); return it==versions_.end()?nullptr:it->second;
}
bool GeometryStore::retainReadyFrom(const GeometryStore& source) {
    bool changed=false;
    for(const auto& [ref,resource]:source.resources_) {
        const auto target=resources_.find(ref);if(target==resources_.end())continue;
        require(std::tie(target->second.type,target->second.contentSha256,target->second.decodedBytes)==
            std::tie(resource.type,resource.contentSha256,resource.decodedBytes),"INVALID_GEOMETRY_RESOURCE: immutable catalog conflict");
        if(!get(ref)&&source.get(ref)){retainFrom(source,ref,ref);changed=true;}
    }
    return changed;
}
std::vector<TimelineEntityIdentity> timelineEntityCatalog(const ProjectDocument& d) {
    std::vector<TimelineEntityIdentity> result;
    for(const auto& unit:d.units)result.push_back({territorialRef(unit.id),unit.kind==UnitKind::General?"general":"regional"});
    for(const auto& water:d.hydro)result.push_back({ObjectRef{"hydro",water.id},water.kind});
    return result;
}
namespace {
template<class Rows> bool staticRows(const Rows& rows,const ObjectRef& id) {
    std::size_t count=0;
    for(const auto& row:rows)if(row.objectRef==id) {
        if(row.validity.from||row.validity.to)return false;
        ++count;
    }
    return count==1;
}
template<class Rows> auto& staticRow(Rows& rows,const ObjectRef& id) {
    if(!staticRows(rows,id))throw TimelineError("TIMELINE_ACTIVATION","Current editing requires a single unbounded record.");
    return *std::find_if(rows.begin(),rows.end(),[&](const auto& row){return row.objectRef==id;});
}
}
bool isStaticTimeline(const ProjectDocument& d) {
    if(!d.timelineRecords.propertyBindings.empty())return false;
    for(const auto& unit:d.units)if(!staticRows(d.timelineRecords.lifetimes,territorialRef(unit.id))
      ||!staticRows(d.timelineRecords.geometryBindings,territorialRef(unit.id))||!staticRows(d.timelineRecords.parentRelations,territorialRef(unit.id)))return false;
    for(const auto& water:d.hydro)if(!staticRows(d.timelineRecords.lifetimes,{"hydro",water.id})||!staticRows(d.timelineRecords.geometryBindings,{"hydro",water.id}))return false;
    return true;
}
void requireStaticTimeline(const ProjectDocument& d) {
    if(!isStaticTimeline(d))throw TimelineError("TIMELINE_ACTIVATION","Timeline activation requires T3/T4.");
}
const TimelineGeometryBinding& staticGeometryBinding(const ProjectDocument& d,const ObjectRef& id) {return staticRow(d.timelineRecords.geometryBindings,id);}
TimelineGeometryBinding& staticGeometryBinding(ProjectDocument& d,const ObjectRef& id) {return staticRow(d.timelineRecords.geometryBindings,id);}
const TimelineParentRelation& staticParentRelation(const ProjectDocument& d,const std::string& id) {return staticRow(d.timelineRecords.parentRelations,territorialRef(id));}
TimelineParentRelation& staticParentRelation(ProjectDocument& d,const std::string& id) {return staticRow(d.timelineRecords.parentRelations,territorialRef(id));}
const TimelineLifetime& staticLifetime(const ProjectDocument& d,const ObjectRef& id) {return staticRow(d.timelineRecords.lifetimes,id);}
TimelineLifetime& staticLifetime(ProjectDocument& d,const ObjectRef& id) {return staticRow(d.timelineRecords.lifetimes,id);}
bool isRootGeneral(const ProjectDocument& d,const TerritorialUnit& u) {
    return u.kind==UnitKind::General&&staticParentRelation(d,u.id).parentId.empty();
}
void addStaticTerritorialRecords(ProjectDocument& d,const std::string& id,GeometryRef geometry,
                                 const std::string& parent,const std::string& coverage) {
    addStaticObjectRecords(d,territorialRef(id),std::move(geometry));
    d.timelineRecords.parentRelations.push_back({"parent:"+id,territorialRef(id),{},parent,coverage});
}
void addStaticObjectRecords(ProjectDocument& d,const ObjectRef& ref,GeometryRef geometry) {
    for(const auto& row:d.timelineRecords.lifetimes)require(row.objectRef!=ref,"DUPLICATE_ID: lifetime owner");
    const auto key=ref.domain+":"+ref.id;
    d.timelineRecords.lifetimes.push_back({"lifetime:"+key,ref,{}});
    d.timelineRecords.geometryBindings.push_back({"geometry:"+key,ref,{},std::move(geometry)});
}
void removeObjectTimelineRecords(ProjectDocument& d,const ObjectRef& ref) {
    const auto erase=[&](auto& rows){rows.erase(std::remove_if(rows.begin(),rows.end(),[&](const auto& row){return row.objectRef==ref;}),rows.end());};
    erase(d.timelineRecords.lifetimes);erase(d.timelineRecords.geometryBindings);erase(d.timelineRecords.parentRelations);erase(d.timelineRecords.propertyBindings);
}
void removeTerritorialRecords(ProjectDocument& d,const std::vector<std::string>& ids) {
    const std::set<std::string> removed(ids.begin(),ids.end());
    const auto erase=[&](auto& rows){rows.erase(std::remove_if(rows.begin(),rows.end(),[&](const auto& row){return row.objectRef.domain=="territorial" && removed.count(row.objectRef.id);}),rows.end());};
    erase(d.timelineRecords.lifetimes);erase(d.timelineRecords.geometryBindings);erase(d.timelineRecords.parentRelations);
}
namespace {
DocumentIndex validateDocumentImpl(const ProjectDocument& d,void(*readContent)(const ProjectDocument&,DocumentIndex&)) {
    validatePresentation(d);
    require(!d.documentId.empty(),"INVALID_DOCUMENT: documentId");
    DocumentIndex idx;
    for(std::size_t i=0;i<d.units.size();++i) {
        const auto& u=d.units[i]; auto ref=territorialRef(u.id);
        const auto metadata=codecjson::parse(u.metadata);
        if(metadata.object.count("nameDetails"))normalizeTerritorialNames(metadata.object.at("nameDetails"));
        require(!u.id.empty(),"INVALID_UNIT: id");
        require(u.kind==UnitKind::General || u.kind==UnitKind::Regional,"INVALID_UNIT: kind");
        if(u.libraryOrigin) {
            require(!u.libraryOrigin->libraryId.empty()&&!u.libraryOrigin->geometryVersionId.empty(),
                    "INVALID_LIBRARY_ORIGIN: identity");
            if(u.libraryOrigin->referenceDate)parseTemporal(*u.libraryOrigin->referenceDate);
            for(const auto& missing:u.libraryOrigin->missingLibraryRefs)
                require(!missing.empty(),"INVALID_LIBRARY_ORIGIN: missing ref");
        }
        require(idx.objects.emplace(ref,i).second,"DUPLICATE_ID: territorial unit");
        require(d.presentation.objectStyles.count(ref),"DANGLING_REF: presentation missing");
    }
    readContent(d,idx);
    for(const auto& [ref,s]:d.presentation.objectStyles) require(idx.objects.count(ref)&&s.color<=0xffffff&&opacity(s.opacity),"INVALID_STYLE");
    const auto records=normalizeTimelineRecords(d.timelineRecords,{timelineEntityCatalog(d),[&](const ObjectRef& owner,const GeometryRef& ref){
        const auto type=d.geometries.type(ref);return owner.domain=="territorial"?(type=="Polygon"||type=="MultiPolygon"):(type=="Polygon"||type=="MultiPolygon"||type=="LineString"||type=="MultiLineString");
    }});
    for(const auto& binding:records.geometryBindings)idx.geometryUsers[binding.geometryRef].push_back(binding.objectRef);
    for(std::size_t i=0;i<records.parentRelations.size();++i) {
        const auto& row=records.parentRelations[i];const auto owner=territorialRef(row.objectRef.id);
        idx.parentRelationsByUnit[owner].push_back(i);
        if(!row.parentId.empty()) {const auto parent=territorialRef(row.parentId);idx.children[parent].push_back(owner);idx.dependents[parent].push_back(owner);}
    }
    std::set<std::string> extensionIds;
    for(const auto& e:d.extensions) {
        require(!e.id.empty()&&extensionIds.insert(e.id).second&&!e.payload.empty(),"INVALID_EXTENSION");
        require(e.dependencyKnowledge=="known"||e.dependencyKnowledge=="unknown","INVALID_EXTENSION: dependencies");
        require(e.status=="unsupported"||e.status=="migrationArchive","INVALID_EXTENSION: status");
        for(const auto& ref:e.dependencies) {
            require(idx.objects.count(ref),"DANGLING_REF: extension");
            idx.dependents[ref].push_back({"extension",e.id});
        }
    }
    validateGeometryProvenance(d);
    return idx;
}
}
DocumentIndex validateDocument(const ProjectDocument& d){return validateDocumentImpl(d,indexContent);}
DocumentIndex detail::validateCommandBatchInterim(const ProjectDocument& d){return validateDocumentImpl(d,indexCommandBatchContent);}
std::vector<CountryView> countryViews(const ProjectDocument& d,const std::set<ObjectRef>& inactive) {
    static const std::uint32_t countryDefault=0xcccccc;
    std::vector<CountryView> result;
    requireStaticTimeline(d);
    for(const auto& u:d.units) if(!inactive.count(territorialRef(u.id))&&isRootGeneral(d,u)) {
        d.geometries.requireReady({staticGeometryBinding(d,territorialRef(u.id)).geometryRef});
        auto ref=territorialRef(u.id); const auto& s=d.presentation.objectStyles.at(ref);
        const std::uint32_t resolvedColor=s.explicitColor?s.color:countryDefault;
        result.push_back({u.id,(u.nameExplicit&&!u.name.empty()?u.name:u.baseName),d.geometries.get(staticGeometryBinding(d,territorialRef(u.id)).geometryRef)->polygons,resolvedColor,u.notes,s.opacity,u.locked});
    }
    return result;
}
std::vector<std::string> blockingExtensions(const ProjectDocument& d,const ObjectRef& ref,const std::string& effect) {
    std::vector<std::string> result;
    for(const auto& e:d.extensions) {
        if(e.envelopeExtras!="{}" && effect!="name" && effect!="notes") { result.push_back(e.id); continue; }
        if(e.status=="migrationArchive") continue;
        bool related=std::find(e.dependencies.begin(),e.dependencies.end(),ref)!=e.dependencies.end();
        if(e.dependencyKnowledge=="unknown" && effect!="name" && effect!="notes") { result.push_back(e.id); continue; }
        if(related && (e.forbiddenEffects.empty()||std::find(e.forbiddenEffects.begin(),e.forbiddenEffects.end(),effect)!=e.forbiddenEffects.end())) result.push_back(e.id);
    }
    return result;
}
bool effectAllowed(const ProjectDocument& d,const ObjectRef& ref,const std::string& effect) {
    return blockingExtensions(d,ref,effect).empty();
}
} // namespace pandoeditor
