#include <pandoeditor/webterritorialcommands.h>
#include <pandoeditor/project.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/timeline-view.h>
#include <algorithm>
#include <limits>
#include <map>
#include <set>

namespace pandoeditor {
namespace {
using Rows=std::vector<WebTerritorialFeature>;
struct ActiveFrame {Rows rows;std::map<std::string,GeometryRef> bindings;};
void require(bool condition,const char* code,const char* detail) {if(!condition)throw TimelineError(code,detail);}
bool sameValidity(const Validity& a,const Validity& b){return a.from==b.from&&a.to==b.to;}
WebTerritorialFeature identityRow(const ProjectDocument& d,const TerritorialUnit& unit) {
    WebTerritorialFeature row;row.identity=unit;const auto ref=territorialRef(unit.id);
    const auto style=d.presentation.objectStyles.find(ref);row.style=style==d.presentation.objectStyles.end()?ObjectStyle{0,1,false}:style->second;
    if(const auto found=d.countryDetails.find(ref);found!=d.countryDetails.end())row.countryDetails=found->second;
    if(const auto found=d.symbols.find(ref);found!=d.symbols.end())row.symbol=found->second;
    return row;
}
ActiveFrame activeFrame(const ProjectSnapshot& snapshot) {
    const auto& source=snapshot.document();
    const auto projection=snapshot.timelineEditsEnabled()?std::optional<TimelineDocumentView>{timelineDocumentView(source,snapshot.timelineMonth())}:std::nullopt;
    const auto& d=projection?projection->document:source;ActiveFrame frame;
    const auto append=[&](const TerritorialUnit& unit,GeometryRef geometry,const std::string& parent,const std::string& coverage,Validity validity) {
        auto row=identityRow(d,unit);const auto shape=d.geometries.get(geometry);
        require(bool(shape),"invalid","Territorial geometry is missing.");row.geometry=*shape;row.parentId=parent;row.coverageMode=coverage;row.validity=std::move(validity);
        frame.bindings.emplace(unit.id,geometry);frame.rows.push_back(std::move(row));
    };
    if(snapshot.timelineEditsEnabled()) {
        require(!snapshot.timelineMonth().empty(),"TIMELINE_ACTIVATION","A timeline month is required.");
        const auto point=parseTemporal(snapshot.timelineMonth());require(point.precision=="month","INVALID_TIMELINE_CURSOR","Month precision is required.");
        const auto world=resolveWorld(source.timelineRecords,{timelineEntityCatalog(source),[&](const ObjectRef& owner,const GeometryRef& ref){return bool(source.geometries.get(ref));}},snapshot.timelineMonth());
        for(const auto& resolved:world.entities) {
            if(resolved.objectRef.domain!="territorial")continue;
            const auto found=snapshot.index().objects.find(resolved.objectRef);require(found!=snapshot.index().objects.end(),"invalid","Territorial identity is missing.");
            append(d.units.at(found->second),resolved.geometryRef,resolved.parentId,resolved.coverageMode,resolved.validity);
        }
    } else {
        require(isStaticTimeline(d),"TIMELINE_ACTIVATION","Static records are required before month editing is activated.");
        for(const auto& unit:d.units) {
            const auto& parent=staticParentRelation(d,unit.id);append(unit,staticGeometryBinding(d,territorialRef(unit.id)).geometryRef,parent.parentId,parent.coverageMode,staticLifetime(d,territorialRef(unit.id)).validity);
        }
    }
    return frame;
}
std::map<std::string,std::size_t> indexRows(const Rows& rows) {
    std::map<std::string,std::size_t> result;
    for(std::size_t i=0;i<rows.size();++i)require(!rows[i].identity.id.empty()&&result.emplace(rows[i].identity.id,i).second,"invalid","Territorial IDs must be nonempty and unique.");
    return result;
}
std::string root(const Rows& rows,const std::map<std::string,std::size_t>& index,const std::string& id) {
    auto found=index.find(id);require(found!=index.end(),"invalid","Territorial parent is missing.");
    const auto node=[](const WebTerritorialFeature& row){return TerritorialRootNode<std::string>{row.identity.id,row.parentId,
        row.identity.kind==UnitKind::Regional,row.identity.kind==UnitKind::General};};
    const auto result=inspectTerritorialRoot(node(rows[found->second]),[&](const std::string& parent)->std::optional<TerritorialRootNode<std::string>>{
        const auto next=index.find(parent);return next==index.end()?std::nullopt:std::optional(node(rows[next->second]));
    });
    require(result.status!=TerritorialRootStatus::RegionalParent,"invalid","Independent regions cannot have parents.");
    require(result.status!=TerritorialRootStatus::Cycle,"invalid","Territorial parent relationship is cyclic.");
    require(result.status!=TerritorialRootStatus::MissingParent,"invalid","Territorial parent is missing.");
    require(result.status!=TerritorialRootStatus::WrongParentKind,"invalid","A territorial parent must be a general entity.");
    return result.root;
}
void validateHierarchy(const Rows& rows) {
    const auto index=indexRows(rows);
    for(const auto& row:rows) {
        require(row.identity.kind==UnitKind::General||row.identity.kind==UnitKind::Regional,"invalid","Unsupported territorial kind.");
        require(row.coverageMode=="explicit"||row.coverageMode=="partition","invalid","Unsupported territorial coverage mode.");
        require(!row.parentId.empty()||row.coverageMode=="explicit","invalid","Root entities and independent regions require explicit geometry.");
        (void)root(rows,index,row.identity.id);
    }
}
Rows changedRows(const ActiveFrame& before,const WebTerritorialEdit& edit) {
    auto next=before.rows;const auto index=indexRows(before.rows);
    const auto existing=[&](const std::string& id,const char* code) -> std::size_t {
        const auto found=index.find(id);require(found!=index.end(),code,"Territorial entity was not found at the current month.");return found->second;
    };
    if(edit.operation==WebTerritorialOperation::Geometry) {
        require(edit.features.size()==1,"invalid","A geometry command needs one result.");
        next[existing(edit.id,"not-found")].geometry=edit.features[0].geometry;
    } else if(edit.operation==WebTerritorialOperation::Parent) {
        const auto at=existing(edit.id,"not-found");const auto& old=before.rows[at];
        require(!old.identity.locked,"locked","Territorial entity is locked.");
        require(old.identity.kind==UnitKind::General,"unsupported-parent-type","Only general entities have administrative parents.");
        if(old.parentId==edit.parentId)return next;
        next[at].parentId=edit.parentId;if(edit.parentId.empty())next[at].coverageMode="explicit";
        try {
            validateHierarchy(next);const auto after=indexRows(next);
            for(const auto& row:before.rows)if(row.identity.locked)
                require(root(before.rows,index,row.identity.id)==root(next,after,row.identity.id),"invalid-parent","A locked descendant cannot change its root.");
        } catch(const TimelineError& error) {throw TimelineError("invalid-parent",error.what());}
    } else if(edit.operation==WebTerritorialOperation::CopyRegion) {
        const auto& source=before.rows[existing(edit.sourceId,"invalid-source")];
        require(source.identity.kind==UnitKind::General,"invalid-source","Independent region copy requires a general source.");
        require(!edit.id.empty()&&!index.count(edit.id),"invalid","Duplicate or empty independent region ID.");
        WebTerritorialFeature row;row.identity.id=edit.id;row.identity.kind=UnitKind::Regional;row.identity.name=edit.newName;
        row.geometry=source.geometry;row.coverageMode="explicit";row.style={edit.color.value_or(0),1,bool(edit.color)};next.push_back(std::move(row));
    } else if(edit.operation==WebTerritorialOperation::Replace)next=edit.features;
    else if(edit.operation==WebTerritorialOperation::Create) {
        require(edit.features.size()==1,"invalid","A create command needs one feature.");
        require(!index.count(edit.features[0].identity.id),"invalid","Duplicate territorial creation ID.");next.push_back(edit.features[0]);
    } else if(edit.operation==WebTerritorialOperation::Patch||edit.operation==WebTerritorialOperation::Remove) {
        const auto incoming=indexRows(edit.features);const std::set<std::string> removed(edit.removedIds.begin(),edit.removedIds.end());
        for(const auto& row:edit.features) {
            require(!removed.count(row.identity.id),"invalid","An entity cannot be changed and removed together.");
            const auto old=index.find(row.identity.id);
            if(old!=index.end())require(before.rows[old->second].identity.kind==row.identity.kind,"invalid","An existing entity kind cannot change through applyChanges.");
        }
        next.clear();std::set<std::string> used;
        for(const auto& row:before.rows)if(!removed.count(row.identity.id)) {
            const auto replacement=incoming.find(row.identity.id);
            next.push_back(replacement==incoming.end()?row:edit.features[replacement->second]);used.insert(row.identity.id);
        }
        for(const auto& row:edit.features)if(!used.count(row.identity.id))next.push_back(row);
    } else throw TimelineError("invalid","Unknown territorial operation.");
    validateHierarchy(next);return next;
}
struct Allocator {
    ProjectDocument& candidate;
    std::map<std::string,std::uint32_t> versions;
    std::set<std::string> recordIds;
    explicit Allocator(ProjectDocument& d):candidate(d) {
        for(const auto& [ref,geometry]:d.geometries.versions())versions[ref.id]=std::max(versions[ref.id],ref.version);
        refreshRecords();
    }
    void refreshRecords() {
        recordIds.clear();for(const auto& row:candidate.timelineRecords.lifetimes)recordIds.insert(row.id);
        for(const auto& row:candidate.timelineRecords.geometryBindings)recordIds.insert(row.id);
        for(const auto& row:candidate.timelineRecords.parentRelations)recordIds.insert(row.id);
        for(const auto& row:candidate.timelineRecords.propertyBindings)recordIds.insert(row.id);
    }
    std::string record(const std::string& base) {
        auto id=base;for(std::uint64_t suffix=1;recordIds.count(id);++suffix)id=base+":"+std::to_string(suffix);
        recordIds.insert(id);return id;
    }
    GeometryRef version(const std::string& id,const Geometry& geometry) {
        const auto previous=versions[id];require(previous<std::numeric_limits<std::uint32_t>::max(),"INVALID_GEOMETRY","Geometry version overflow.");
        const GeometryRef ref{id,previous+1};candidate.geometries.insert(ref,geometry);versions[id]=ref.version;return ref;
    }
    GeometryRef fresh(const std::string& id,const Geometry& geometry) {
        const auto base="territorial-geometry:"+id;auto next=base;
        for(std::uint64_t suffix=1;versions.count(next);++suffix)next=base+":"+std::to_string(suffix);
        return version(next,geometry);
    }
};
void eraseIdentity(ProjectDocument& d,const std::string& id) {
    d.units.erase(std::remove_if(d.units.begin(),d.units.end(),[&](const auto& unit){return unit.id==id;}),d.units.end());
    const auto owner=territorialRef(id);d.countryDetails.erase(owner);d.symbols.erase(owner);d.presentation.objectStyles.erase(owner);
}
void setIdentity(ProjectDocument& d,const WebTerritorialFeature& row,bool appendOnly=false) {
    const auto found=std::find_if(d.units.begin(),d.units.end(),[&](const auto& unit){return unit.id==row.identity.id;});
    if(found==d.units.end()) {
        d.units.push_back(row.identity);
    }else {require(!appendOnly,"invalid","Territorial identity already exists.");*found=row.identity;}
    const auto owner=territorialRef(row.identity.id);d.presentation.objectStyles[owner]=row.style;
    if(row.countryDetails)d.countryDetails[owner]=*row.countryDetails;else d.countryDetails.erase(owner);
    if(row.symbol)d.symbols[owner]=*row.symbol;else d.symbols.erase(owner);
}
void applyStatic(ProjectDocument& d,const Rows& next) {
    std::set<std::string> ids;for(const auto& row:next)ids.insert(row.identity.id);
    const auto filter=[&](auto& rows){rows.erase(std::remove_if(rows.begin(),rows.end(),[&](const auto& row){return row.objectRef.domain=="territorial"&&!ids.count(row.objectRef.id);}),rows.end());};
    filter(d.timelineRecords.lifetimes);filter(d.timelineRecords.geometryBindings);filter(d.timelineRecords.parentRelations);filter(d.timelineRecords.propertyBindings);
    std::vector<std::string> deleted;for(const auto& unit:d.units)if(!ids.count(unit.id))deleted.push_back(unit.id);
    for(const auto& id:deleted)eraseIdentity(d,id);
    Allocator allocate(d);
    for(const auto& row:next) {
        require(!row.validity.from&&!row.validity.to,"TIMELINE_ACTIVATION","Dated creation or validity changes require month editing.");
        const auto& id=row.identity.id;const auto owner=territorialRef(id);auto binding=std::find_if(d.timelineRecords.geometryBindings.begin(),d.timelineRecords.geometryBindings.end(),[&](const auto& value){return value.objectRef==owner;});
        if(binding==d.timelineRecords.geometryBindings.end()) {
            const auto geometry=allocate.version("territorial-geometry:"+id,row.geometry);
            d.timelineRecords.geometryBindings.push_back({allocate.record("geometry:"+id),territorialRef(id),{},geometry});
        } else if(!sameGeometryValue(*d.geometries.get(binding->geometryRef),row.geometry))binding->geometryRef=allocate.version(binding->geometryRef.id,row.geometry);
        if(std::none_of(d.timelineRecords.lifetimes.begin(),d.timelineRecords.lifetimes.end(),[&](const auto& value){return value.objectRef==owner;}))
            d.timelineRecords.lifetimes.push_back({allocate.record("lifetime:"+id),territorialRef(id),{}});
        auto parent=std::find_if(d.timelineRecords.parentRelations.begin(),d.timelineRecords.parentRelations.end(),[&](const auto& value){return value.objectRef==owner;});
        if(parent==d.timelineRecords.parentRelations.end())d.timelineRecords.parentRelations.push_back({allocate.record("parent:"+id),territorialRef(id),{},row.parentId,row.coverageMode});
        else {parent->parentId=row.parentId;parent->coverageMode=row.coverageMode;}
        setIdentity(d,row);
    }
    // Static replace follows the incoming order. applyChanges has already
    // retained old order and appended new rows before reaching this boundary.
    std::vector<TerritorialUnit> units;units.reserve(next.size());for(const auto& row:next)units.push_back(row.identity);d.units=std::move(units);
}
void applyMonth(ProjectDocument& d,const ActiveFrame& before,const Rows& next,const std::string& month,bool preserveFutureChanges) {
    const auto previous=indexRows(before.rows),after=indexRows(next);
    for(const auto& row:before.rows)if(!after.count(row.identity.id)) {
        d.timelineRecords=truncateTimelineEntityAtMonth(d.timelineRecords,territorialRef(row.identity.id),month,preserveFutureChanges);
        if(std::none_of(d.timelineRecords.lifetimes.begin(),d.timelineRecords.lifetimes.end(),[&](const auto& value){return value.objectRef==territorialRef(row.identity.id);} ))eraseIdentity(d,row.identity.id);
    }
    Allocator allocate(d);
    const auto parentPeriod=[&](std::string parentId,bool mapCoverage) -> Validity {
        while(!parentId.empty()) {
            if(const auto old=previous.find(parentId);old!=previous.end())return mapCoverage
                ?timelineMapCoverageAtMonth(d.timelineRecords,territorialRef(parentId),month):before.rows[old->second].validity;
            parentId=next[after.at(parentId)].parentId;
        }
        return {};
    };
    for(const auto& row:next) {
        const auto& id=row.identity.id;const auto old=previous.find(id);
        if(old==previous.end()) {
            require(std::none_of(d.units.begin(),d.units.end(),[&](const auto& unit){return unit.id==id;})&&!row.validity.from&&!row.validity.to,
                "TIMELINE_ACTIVATION","A historical identity or explicit dates cannot be reused for a new current-month entity.");
            const auto geometry=allocate.fresh(id,row.geometry);const Validity interval{month,parentPeriod(row.parentId,false).to};
            const auto coverage=parentPeriod(row.parentId,true);
            const Validity mapInterval{coverage.from&&parseTemporal(month).startKey<parseTemporal(*coverage.from).startKey?coverage.from:month,coverage.to};
            d.timelineRecords.lifetimes.push_back({allocate.record("lifetime:"+id),territorialRef(id),interval});
            d.timelineRecords.geometryBindings.push_back({allocate.record("geometry:"+id),territorialRef(id),mapInterval,geometry});
            d.timelineRecords.parentRelations.push_back({allocate.record("parent:"+id),territorialRef(id),mapInterval,row.parentId,row.coverageMode});
            setIdentity(d,row,true);
        } else {
            const auto& original=before.rows[old->second];
            require(row.identity.kind==original.identity.kind&&sameValidity(row.validity,original.validity),"TIMELINE_ACTIVATION","Current-month edits cannot change existing identity kind or lifetime.");
            setIdentity(d,row);
            if(!sameGeometryValue(row.geometry,original.geometry)) {
                const auto geometry=allocate.version(before.bindings.at(id).id,row.geometry);
                d.timelineRecords=replaceGeometryBindingAtMonth(d.timelineRecords,territorialRef(id),month,geometry);
            }
            if(row.parentId!=original.parentId||row.coverageMode!=original.coverageMode) {
                d.timelineRecords=replaceParentRelationAtMonth(d.timelineRecords,territorialRef(id),month,row.parentId,row.coverageMode);
            }
        }
    }
}
}
ProjectDocument applyWebTerritorialEdit(const ProjectSnapshot& snapshot,const WebTerritorialEdit& edit,TerritorialEditContext context) {
    const auto before=activeFrame(snapshot);const auto next=changedRows(before,edit);auto candidate=snapshot.document();
    if(snapshot.timelineEditsEnabled()) {
        applyMonth(candidate,before,next,snapshot.timelineMonth(),context==TerritorialEditContext::LibraryImport);
        const auto projected=timelineDocumentView(snapshot.document(),snapshot.timelineMonth());
        captureTimelinePropertyChanges(snapshot.document(),projected.document,candidate,snapshot.timelineMonth());
    }else applyStatic(candidate,next);
    candidate.timelineRecords=normalizeTimelineRecords(candidate.timelineRecords,{timelineEntityCatalog(candidate),[&](const ObjectRef& owner,const GeometryRef& ref){
        const auto geometry=candidate.geometries.get(ref);return geometry&&(geometry->type=="Polygon"||geometry->type=="MultiPolygon"||(owner.domain=="hydro"&&(geometry->type=="LineString"||geometry->type=="MultiLineString")));}});
    if(context!=TerritorialEditContext::SourceAdmission)validateTimelineParentChanges(snapshot.document(),candidate);
    return candidate;
}
}
