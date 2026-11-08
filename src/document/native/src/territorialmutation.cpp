#include <pandoeditor/territorialmutation.h>
#include <pandoeditor/project.h>
#include <pandoeditor/geometrypredicates.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#ifdef __EMSCRIPTEN__
#include <emscripten/em_math.h>
#endif

namespace pandoeditor {
namespace {
const TerritorialUnit& unit(const ProjectSnapshot& s,const ObjectRef& ref) {
    if(ref.domain!="territorial") throw std::invalid_argument("INVALID_TARGETS");
    auto it=s.index().objects.find(ref); if(it==s.index().objects.end()) throw std::invalid_argument("INVALID_TARGETS");
    return s.document().units.at(it->second);
}
const TimelineParentRelation* parentRecord(const ProjectDocument& d,const ObjectRef& ref) {return &staticParentRelation(d,ref.id);}
ObjectRef administrativeRoot(const ProjectDocument& d,ObjectRef ref) {
    for(std::size_t i=0;i<d.units.size();++i){const auto& p=staticParentRelation(d,ref.id);if(p.parentId.empty())return ref;ref=territorialRef(p.parentId);}
    throw std::invalid_argument("PARENT_CYCLE");
}
std::shared_ptr<const Geometry> shape(const ProjectDocument& d,const ObjectRef& ref){return d.geometries.get(staticGeometryBinding(d,territorialRef(ref.id)).geometryRef);}
void unlocked(const TerritorialUnit& u){if(u.locked)throw std::invalid_argument("LOCKED");}
TerritorialMutationPlan initial(const ProjectSnapshot& s,TerritorialMutationKind kind,TerritorialMutationIntent intent) {
    requireStaticTimeline(s.document());TerritorialMutationPlan p; p.projectInstanceId=s.instanceId();p.documentId=s.document().documentId;p.baseRevision=s.revision();p.kind=kind;p.intent=std::move(intent);return p;
}
void guard(TerritorialMutationPlan& p,const ProjectDocument& d,const ObjectRef& ref,const std::string& effect) {
    for(const auto& id:blockingExtensions(d,ref,effect)) { auto it=std::find_if(d.extensions.begin(),d.extensions.end(),[&](const auto& e){return e.id==id;}); if(it!=d.extensions.end())p.retainedGuards.push_back({id,it->payload}); }
}
bool rewritable(const PreservedExtension& e) {
    if(e.status=="migrationArchive"||e.dependencyKnowledge!="known"||e.envelopeExtras!="{}")return false;
    return e.jsonPointer=="/distributionEntries"||e.jsonPointer=="/itemVisibility"||e.jsonPointer=="/labelSettings"||e.jsonPointer=="/genericFeatures";
}
void requireRewritableGuards(const TerritorialMutationPlan& p,const ProjectDocument& d) {
    for(const auto& g:p.retainedGuards) {auto it=std::find_if(d.extensions.begin(),d.extensions.end(),[&](const auto& e){return e.id==g.id;});if(it==d.extensions.end()||!rewritable(*it))throw std::invalid_argument("UNSUPPORTED_DEPENDENCY");}
}
bool descendant(const ProjectDocument& d,const ObjectRef& child,const ObjectRef& ancestor) {
    auto current=child;for(std::size_t i=0;i<d.units.size();++i){const auto& p=staticParentRelation(d,current.id);if(p.parentId.empty())return false;current=territorialRef(p.parentId);if(current==ancestor)return true;}return false;
}
double cross(Point a,Point b,Point c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
bool adjacent(const Geometry& a,const Geometry& b) {
    constexpr double lineTolerance=1e-7,overlapTolerance=1e-8;
    struct Edge { Point a,b;double minX,maxX,minY,maxY; };
    auto edges=[](const Geometry& g){std::vector<Edge> out;for(const auto& p:g.polygons)for(const auto& r:p)for(std::size_t i=1;i<r.size();++i){const auto a=r[i-1],b=r[i];out.push_back({a,b,std::min(a.x,b.x),std::max(a.x,b.x),std::min(a.y,b.y),std::max(a.y,b.y)});}return out;};
    const auto left=edges(a);auto right=edges(b);
    if(left.empty()||right.empty())return false;
    struct Node { double minX,maxX,minY,maxY;std::size_t begin,end,left,right; };
    std::vector<Node> nodes;nodes.reserve(right.size()*2);
    const auto build=[&](auto&& self,std::size_t begin,std::size_t end)->std::size_t {
        const auto infinity=std::numeric_limits<double>::infinity();
        Node node{infinity,-infinity,infinity,-infinity,begin,end,0,0};
        for(auto i=begin;i<end;++i){node.minX=std::min(node.minX,right[i].minX);node.maxX=std::max(node.maxX,right[i].maxX);
            node.minY=std::min(node.minY,right[i].minY);node.maxY=std::max(node.maxY,right[i].maxY);}
        const auto index=nodes.size();nodes.push_back(node);
        if(end-begin>8){const auto middle=begin+(end-begin)/2;const bool splitX=node.maxX-node.minX>=node.maxY-node.minY;
            std::nth_element(right.begin()+begin,right.begin()+middle,right.begin()+end,[splitX](const Edge& x,const Edge& y){return splitX?x.minX<y.minX:x.minY<y.minY;});
            const auto first=self(self,begin,middle),second=self(self,middle,end);nodes[index].left=first;nodes[index].right=second;}
        return index;
    };
    const auto root=build(build,0,right.size());
    for(const auto& edge:left){const auto& p=edge.a;const auto& q=edge.b;const auto dx=q.x-p.x,dy=q.y-p.y;
#ifdef __EMSCRIPTEN__
        const auto length=emscripten_math_hypot(2,dx,dy);
#else
        const auto length=std::hypot(dx,dy);
#endif
        if(!length)continue;
        const auto overlaps=[&](double minX,double maxX,double minY,double maxY){return
            maxX>=edge.minX-lineTolerance&&minX<=edge.maxX+lineTolerance&&
            maxY>=edge.minY-lineTolerance&&minY<=edge.maxY+lineTolerance;};
        const auto query=[&](auto&& self,std::size_t index)->bool{
            const auto& node=nodes[index];if(!overlaps(node.minX,node.maxX,node.minY,node.maxY))return false;
            if(node.end-node.begin>8)return self(self,node.left)||self(self,node.right);
            for(auto i=node.begin;i<node.end;++i){const auto& candidate=right[i];
                if(!overlaps(candidate.minX,candidate.maxX,candidate.minY,candidate.maxY))continue;
                const auto& u=candidate.a;const auto& v=candidate.b;
                if(std::abs(cross(p,q,u))/length>lineTolerance||std::abs(cross(p,q,v))/length>lineTolerance)continue;
                const auto parameter=[&](Point r){return ((r.x-p.x)*dx+(r.y-p.y)*dy)/(length*length);};
                if(std::min(1.,std::max(parameter(u),parameter(v)))-std::max(0.,std::min(parameter(u),parameter(v)))>overlapTolerance)return true;
            }return false;};
        if(query(query,root))return true;}
    return false;
}
}
SubunitSelectionStatus inspectSubunitSelection(const std::vector<SubunitSelectionItem>& items,
    bool deferConnectivity,bool requireSubunits,std::vector<std::size_t>* order) {
    if(items.size()<2|| (requireSubunits&&std::any_of(items.begin(),items.end(),[](const auto& item){return !item.subunit;})))
        return SubunitSelectionStatus::InvalidSelection;
    for(const auto& item:items)if(item.parentId!=items.front().parentId)return SubunitSelectionStatus::DifferentParent;
    for(const auto& item:items)if(item.locked)return SubunitSelectionStatus::Locked;
    if(deferConnectivity)return SubunitSelectionStatus::Valid;
    std::vector<std::size_t> connected{0},pending;
    for(std::size_t i=1;i<items.size();++i)pending.push_back(i);
    while(!pending.empty()){
        const auto found=std::find_if(pending.begin(),pending.end(),[&](auto candidate){
            return items[candidate].geometry&&std::any_of(connected.begin(),connected.end(),[&](auto current){
                return items[current].geometry&&adjacent(*items[candidate].geometry,*items[current].geometry);
            });
        });
        if(found==pending.end())return SubunitSelectionStatus::Disconnected;
        connected.push_back(*found);pending.erase(found);
    }
    if(order)*order=std::move(connected);
    return SubunitSelectionStatus::Valid;
}
namespace {
void transferScope(const ProjectSnapshot& s,TerritorialMutationPlan& plan,
                   const ObjectRef& target,const ObjectRef& destination) {
    const auto& doc=s.document();const auto old=administrativeRoot(doc,target);
    if(old==target||old==destination)throw std::invalid_argument("ADMINISTRATIVE_PARENT_MISMATCH");
    plan.geometry.readOwners={target,old};if(!(target==destination))plan.geometry.readOwners.push_back(destination);
    plan.affectedObjects=plan.geometry.readOwners;const auto targetShape=shape(doc,target);
    for(const auto& candidate:doc.units) {
        const auto ref=territorialRef(candidate.id);if(ref==target)continue;
        if(descendant(doc,ref,target)){plan.affectedObjects.push_back(ref);continue;}
        if(candidate.kind!=UnitKind::General||!descendant(doc,ref,old))continue;
        if(geometrySignificantOverlap(*shape(doc,ref),*targetShape)){plan.geometry.readOwners.push_back(ref);plan.geometry.removableOwners.push_back(ref);plan.affectedObjects.push_back(ref);}
    }
    for(const auto& ref:plan.geometry.readOwners)plan.geometry.replacements.push_back({ref,ref});
    for(const auto& ref:plan.affectedObjects) {
        unlocked(unit(s,ref));guard(plan,doc,ref,"geometry");guard(plan,doc,ref,"relation");

    }
    for(const auto& ref:plan.geometry.removableOwners)guard(plan,doc,ref,"delete");
    requireRewritableGuards(plan,doc);
    plan.requiresConfirmation=true;
}
}
TerritorialMutationPlan planChangeParent(const ProjectSnapshot& s,const ChangeParentIntent& in) {
    const auto& target=unit(s,in.target);const auto& parent=unit(s,in.parent);unlocked(target);unlocked(parent);
    if(target.kind!=UnitKind::General||parent.kind!=UnitKind::General||in.target==in.parent||descendant(s.document(),in.parent,in.target))throw std::invalid_argument("VALIDATION_FAILED");
    if(!geometryContains(*shape(s.document(),in.parent),*shape(s.document(),in.target)))throw std::invalid_argument("GEOMETRY_OUTSIDE_PARENT");
    auto p=initial(s,TerritorialMutationKind::ChangeParent,in);p.targets={in.target};p.affectedObjects={in.target,in.parent};p.selectedAfter=in.target;p.impacts.push_back({"change-parent",in.target,"territorial.parent.changed"});guard(p,s.document(),in.target,"relation");return p;
}
TerritorialMutationPlan planRegionSovereign(const ProjectSnapshot&,const ChangeRegionSovereignIntent&) {
    throw std::invalid_argument("UNSUPPORTED_POLITICAL_RELATION: sovereignty is not an administrative parent");
}
TerritorialMutationPlan planCreate(const ProjectSnapshot& s,const CreateTerritorialIntent& in) {
    requireStaticTimeline(s.document());
    if(in.id.empty()||s.index().objects.count(territorialRef(in.id)))throw std::invalid_argument("DUPLICATE_ID");
    if(in.sovereign)throw std::invalid_argument("UNSUPPORTED_POLITICAL_RELATION");
    if(in.validity.from||in.validity.to)throw std::invalid_argument("TIMELINE_ACTIVATION: dated creation requires T4");
    GeometryStore preflight;preflight.insert({"create-preflight",1},in.geometry);
    if(in.parent){const auto& parent=unit(s,*in.parent);unlocked(parent);if(in.kind!=UnitKind::General||parent.kind!=UnitKind::General)throw std::invalid_argument("INVALID_PARENT_KIND");if(!geometryContains(*shape(s.document(),*in.parent),in.geometry))throw std::invalid_argument("GEOMETRY_OUTSIDE_PARENT");}
    auto kind=in.kind==UnitKind::Regional?TerritorialMutationKind::CreateRegion:in.parent?TerritorialMutationKind::CreateSubunit:TerritorialMutationKind::CreateCountry;
    auto p=initial(s,kind,in);p.targets={territorialRef(in.id)};p.affectedObjects=p.targets;p.selectedAfter=p.targets.front();p.geometry.kind=GeometryRequirementKind::Prepared;p.geometry.operation="create";p.impacts.push_back({"create",p.targets.front(),"territorial.create"});guard(p,s.document(),p.targets.front(),"add");return p;
}
TerritorialMutationPlan planDelete(const ProjectSnapshot& s,const DeleteTerritorialIntent& in) {
    if(in.targets.empty())throw std::invalid_argument("INVALID_TARGETS");auto p=initial(s,TerritorialMutationKind::DeleteUnits,in);p.targets=in.targets;p.affectedObjects=in.targets;p.requiresConfirmation=true;
    for(const auto& ref:in.targets){const auto& u=unit(s,ref);unlocked(u);for(const auto& r:s.document().timelineRecords.parentRelations)if(r.parentId==ref.id&&std::find(in.targets.begin(),in.targets.end(),territorialRef(r.objectRef.id))==in.targets.end())throw std::invalid_argument("HAS_BASE_CHILD");guard(p,s.document(),ref,"delete");requireRewritableGuards(p,s.document());
        for(const auto& extension:s.document().extensions) {
            if(extension.status=="migrationArchive")continue;
            if(extension.jsonPointer=="/distributionEntries"||extension.jsonPointer=="/genericFeatures")p.rewrites.push_back({extension.jsonPointer,ReferenceRewriteOperation::RemoveEntry,ref.id,{}});
            else if(extension.jsonPointer=="/itemVisibility"||extension.jsonPointer=="/labelSettings")p.rewrites.push_back({extension.jsonPointer,ReferenceRewriteOperation::DeleteKey,ref.id,{}});
        }
        p.impacts.push_back({"delete",ref,"territorial.delete"});if(isRootGeneral(s.document(),u))p.kind=TerritorialMutationKind::DeleteCountry;}
    return p;
}
TerritorialMutationPlan planTransfer(const ProjectSnapshot& s,const TransferSubunitIntent& in) {
    const auto& u=unit(s,in.target);const auto& d=unit(s,in.destinationCountry);
    if(u.kind!=UnitKind::General||!isRootGeneral(s.document(),d))throw std::invalid_argument("VALIDATION_FAILED");
    auto p=initial(s,TerritorialMutationKind::TransferSubunit,in);p.targets={in.target};
    p.geometry.kind=GeometryRequirementKind::WorkerPatch;p.geometry.operation="transfer";
    transferScope(s,p,in.target,in.destinationCountry);p.selectedAfter=in.target;
    for(const auto& ref:p.affectedObjects)p.impacts.push_back({"transfer",ref,"territorial.transfer.geometry"});
    return p;
}
TerritorialMutationPlan planConversion(const ProjectSnapshot& s,const ConvertTerritorialTypeIntent& in) {
    const auto& u=unit(s,in.source);unlocked(u);
    if(in.sovereign)throw std::invalid_argument("UNSUPPORTED_POLITICAL_RELATION");
    if(u.kind!=UnitKind::General||in.targetKind!=UnitKind::General)throw std::invalid_argument("kind changes require a new entity identity");
    if(!in.generatedId.empty()&&in.generatedId!=u.id)throw std::invalid_argument("administrative parent changes preserve entity identity");
    const bool promote=!in.parent;const auto& current=staticParentRelation(s.document(),u.id);
    if(promote==current.parentId.empty())throw std::invalid_argument("INVALID_ARGUMENTS");
    if(in.parent){const auto& parent=unit(s,*in.parent);unlocked(parent);if(parent.kind!=UnitKind::General||*in.parent==in.source||descendant(s.document(),*in.parent,in.source))throw std::invalid_argument("INVALID_PARENT_KIND");if(!geometryContains(*shape(s.document(),*in.parent),*shape(s.document(),in.source)))throw std::invalid_argument("GEOMETRY_OUTSIDE_PARENT");}
    auto p=initial(s,promote?TerritorialMutationKind::PromoteSubunitToCountry:TerritorialMutationKind::ConvertCountryToSubunit,in);
    p.targets={in.source};p.affectedObjects={in.source};p.selectedAfter=in.source;p.requiresConfirmation=true;
    // General identity is independent of its administrative position. A parent
    // change does not replace the identity or infer a political relationship.
    guard(p,s.document(),in.source,"relation");requireRewritableGuards(p,s.document());p.impacts.push_back({"convert",in.source,"territorial.parent.changed"});return p;
}
TerritorialMutationPlan planReplaceGeometry(const ProjectSnapshot& s,const ReplaceGeometryIntent& in) {
    const auto& target=unit(s,in.target);unlocked(target);

    auto p=initial(s,TerritorialMutationKind::ReplaceGeometry,in);
    p.targets={in.target};p.affectedObjects={in.target};p.selectedAfter=in.target;
    p.geometry.kind=GeometryRequirementKind::WorkerPatch;p.geometry.operation="replace";
    p.geometry.readOwners={in.target};p.geometry.replacements={{in.target,in.target}};
    p.impacts.push_back({"geometry",in.target,"territorial.geometry.replace"});
    guard(p,s.document(),in.target,"geometry");requireRewritableGuards(p,s.document());
    p.requiresConfirmation=true;return p;
}
TerritorialMutationPlan planMerge(const ProjectSnapshot& s,const MergeTerritorialIntent& in) {
    if(in.donors.empty())throw std::invalid_argument("INVALID_TARGETS");
    const auto& target=unit(s,in.target);unlocked(target);
    std::vector<ObjectRef> owners{in.target};
    for(const auto& donor:in.donors)if(donor==in.target||std::find(owners.begin(),owners.end(),donor)!=owners.end())throw std::invalid_argument("INVALID_TARGETS");else owners.push_back(donor);
    const auto targetRelation=parentRecord(s.document(),in.target);
    for(const auto& donor:in.donors) {
        const auto& candidate=unit(s,donor);unlocked(candidate);
        if(candidate.kind!=target.kind)throw std::invalid_argument("VALIDATION_FAILED");
        const auto relation=parentRecord(s.document(),donor);
        if(target.kind==UnitKind::General) {
            if(targetRelation->parentId!=relation->parentId)
                throw std::invalid_argument("ADMINISTRATIVE_PARENT_MISMATCH");
        }
    }
    std::vector<std::shared_ptr<const Geometry>> selectionGeometry;
    std::vector<SubunitSelectionItem> selection;
    for(const auto& ref:owners){
        const auto& selected=unit(s,ref);const auto relation=parentRecord(s.document(),ref);
        selectionGeometry.push_back(shape(s.document(),ref));
        selection.push_back({selected.kind==UnitKind::General&&!relation->parentId.empty(),selected.locked,
            relation->parentId,selectionGeometry.back().get()});
    }
    if(inspectSubunitSelection(selection,false,false)==SubunitSelectionStatus::Disconnected)
        throw std::invalid_argument("GEOMETRY_NOT_CONNECTED");
    auto p=initial(s,TerritorialMutationKind::MergeTerritorial,in);p.targets=owners;p.affectedObjects=owners;p.selectedAfter=in.target;p.requiresConfirmation=true;
    p.geometry.kind=GeometryRequirementKind::WorkerPatch;p.geometry.operation="merge";p.geometry.readOwners=owners;
    p.geometry.replacements.push_back({in.target,in.target});
    for(const auto& donor:in.donors){p.geometry.replacements.push_back({donor,donor});p.geometry.removableOwners.push_back(donor);guard(p,s.document(),donor,"delete");guard(p,s.document(),donor,"geometry");
        for(const auto& relation:s.document().timelineRecords.parentRelations)if(relation.parentId==donor.id){const auto child=territorialRef(relation.objectRef.id);p.affectedObjects.push_back(child);unlocked(unit(s,child));guard(p,s.document(),child,"relation");}
        for(const auto& extension:s.document().extensions)if(extension.status!="migrationArchive") {
            if(extension.jsonPointer=="/distributionEntries"||extension.jsonPointer=="/genericFeatures")p.rewrites.push_back({extension.jsonPointer,ReferenceRewriteOperation::ReplaceId,donor.id,in.target.id});
            else if(extension.jsonPointer=="/itemVisibility"||extension.jsonPointer=="/labelSettings")p.rewrites.push_back({extension.jsonPointer,ReferenceRewriteOperation::ReplaceId,donor.id,in.target.id});
        }
    }
    guard(p,s.document(),in.target,"geometry");requireRewritableGuards(p,s.document());
    std::sort(p.affectedObjects.begin(),p.affectedObjects.end());p.affectedObjects.erase(std::unique(p.affectedObjects.begin(),p.affectedObjects.end()),p.affectedObjects.end());
    p.impacts.push_back({"merge",in.target,"territorial.merge"});return p;
}
TerritorialMutationPlan planAnnex(const ProjectSnapshot& s,const AnnexTerritoryIntent& in) {
    if(in.donors.empty())throw std::invalid_argument("INVALID_TARGETS");GeometryStore preflight;preflight.insert({"annex-selection",1},in.selection);
    const auto& target=unit(s,in.target);unlocked(target);const auto targetRelation=parentRecord(s.document(),in.target);
    std::vector<ObjectRef> owners{in.target};
    for(const auto& donor:in.donors) {
        if(donor==in.target||std::find(owners.begin(),owners.end(),donor)!=owners.end())throw std::invalid_argument("INVALID_TARGETS");
        const auto& candidate=unit(s,donor);unlocked(candidate);if(candidate.kind!=target.kind)throw std::invalid_argument("VALIDATION_FAILED");
        const auto relation=parentRecord(s.document(),donor);if(target.kind==UnitKind::General&&targetRelation->parentId!=relation->parentId)throw std::invalid_argument("ADMINISTRATIVE_PARENT_MISMATCH");
        if(!geometrySignificantOverlap(*shape(s.document(),territorialRef(candidate.id)),in.selection)&&!geometryContains(*shape(s.document(),territorialRef(candidate.id)),in.selection))throw std::invalid_argument("SELECTION_OUTSIDE_DONOR");owners.push_back(donor);
    }
    auto p=initial(s,TerritorialMutationKind::AnnexTerritory,in);p.targets=owners;p.affectedObjects=owners;p.selectedAfter=in.target;p.requiresConfirmation=true;
    p.geometry.kind=GeometryRequirementKind::WorkerPatch;p.geometry.operation="annex";p.geometry.readOwners=owners;
    for(const auto& owner:owners)p.geometry.replacements.push_back({owner,owner});
    p.geometry.removableOwners=in.donors;
    for(const auto& candidate:s.document().units) {
        const auto ref=territorialRef(candidate.id);if(std::find(owners.begin(),owners.end(),ref)!=owners.end())continue;
        if(std::any_of(in.donors.begin(),in.donors.end(),[&](const auto& donor){return descendant(s.document(),ref,donor);})) {
            unlocked(candidate);p.geometry.readOwners.push_back(ref);p.geometry.replacements.push_back({ref,ref});p.geometry.removableOwners.push_back(ref);p.affectedObjects.push_back(ref);guard(p,s.document(),ref,"geometry");guard(p,s.document(),ref,"relation");
        }
    }
    for(const auto& owner:owners)guard(p,s.document(),owner,"geometry");
    requireRewritableGuards(p,s.document());p.impacts.push_back({"annex",in.target,"territorial.annex"});return p;
}
TerritorialMutationPlan planSplit(const ProjectSnapshot& s,const SplitTerritorialIntent& in) {
    const auto& source=unit(s,in.source);unlocked(source);if(source.kind!=UnitKind::General)throw std::invalid_argument("SPLIT_REQUIRES_GENERAL");
    if(in.createdId.empty()||trimWebText(in.createdName).empty())throw std::invalid_argument("INVALID_ARGUMENTS");
    {GeometryStore validation;validation.insert({"split-selection",1},in.selection);if(in.selection.type!="Polygon"&&in.selection.type!="MultiPolygon")throw std::invalid_argument("INVALID_GEOMETRY");}
    const auto created=territorialRef(in.createdId);if(created==in.source||s.index().objects.count(created))throw std::invalid_argument("DUPLICATE_ID");

    const auto& relation=staticParentRelation(s.document(),in.source.id);
    if(!relation.parentId.empty()) {const auto& parent=unit(s,territorialRef(relation.parentId));unlocked(parent);if(parent.kind!=UnitKind::General)throw std::invalid_argument("ADMINISTRATIVE_PARENT_MISMATCH");}
    auto p=initial(s,TerritorialMutationKind::SplitTerritorial,in);p.targets={in.source};p.affectedObjects={in.source};p.selectedAfter=created;p.requiresConfirmation=true;
    p.geometry.kind=GeometryRequirementKind::WorkerPatch;p.geometry.operation="split";p.geometry.readOwners={in.source};p.geometry.replacements={{in.source,in.source}};p.geometry.createOwners={created};
    guard(p,s.document(),in.source,"geometry");guard(p,s.document(),created,"add");
    for(const auto& candidate:s.document().units) {
        const auto ref=territorialRef(candidate.id);if(ref==in.source||candidate.kind!=UnitKind::General||!descendant(s.document(),ref,in.source))continue;
        p.geometry.readOwners.push_back(ref);
        bool carriedByAncestor=false;
        if(!relation.parentId.empty()) {
            auto parentId=staticParentRelation(s.document(),ref.id).parentId;
            for(std::size_t depth=0;depth<s.document().units.size()&&!parentId.empty()&&parentId!=in.source.id;++depth) {
                if(geometryContains(in.selection,*shape(s.document(),territorialRef(parentId)))){carriedByAncestor=true;break;}
                parentId=staticParentRelation(s.document(),parentId).parentId;
            }
        }
        const bool changing=!carriedByAncestor&&geometrySignificantOverlap(*shape(s.document(),ref),in.selection);
        // Child creation stops at a whole transferred ancestor. Descendants
        // carried with it are read-only: no mutable patch permission or lock
        // effect is granted for their unchanged geometry/immediate parent.
        if(relation.parentId.empty()||changing){p.geometry.replacements.push_back({ref,ref});p.geometry.removableOwners.push_back(ref);}
        if(changing) {
            unlocked(candidate);p.affectedObjects.push_back(ref);
            guard(p,s.document(),ref,"geometry");guard(p,s.document(),ref,"relation");guard(p,s.document(),ref,"delete");
        }
    }
    requireRewritableGuards(p,s.document());p.impacts.push_back({"split",in.source,"territorial.split"});return p;
}
TerritorialMutationPlan planSharedBoundary(const ProjectSnapshot& s,const SharedBoundaryIntent& in) {
    if(in.drafts.size()<2)throw std::invalid_argument("BOUNDARY_REQUIRES_TWO_OWNERS");
    const auto& document=s.document();const auto& first=unit(s,in.drafts.front().owner);
    if(first.kind!=UnitKind::General)throw std::invalid_argument("BOUNDARY_REQUIRES_GENERAL");
    const auto parentId=staticParentRelation(document,first.id).parentId;
    std::vector<ObjectRef> owners;
    for(const auto& draft:in.drafts) {
        GeometryStore check;check.insert({"boundary-draft",1},draft.geometry);
        if(draft.geometry.type!="Polygon"&&draft.geometry.type!="MultiPolygon")throw std::invalid_argument("INVALID_GEOMETRY");
        if(std::find(owners.begin(),owners.end(),draft.owner)!=owners.end())throw std::invalid_argument("DUPLICATE_OWNER");
        const auto& candidate=unit(s,draft.owner);unlocked(candidate);
        if(candidate.kind!=UnitKind::General)throw std::invalid_argument("BOUNDARY_REQUIRES_GENERAL");
        if(staticParentRelation(document,candidate.id).parentId!=parentId)throw std::invalid_argument("ADMINISTRATIVE_PARENT_MISMATCH");

        owners.push_back(draft.owner);
    }
    auto p=initial(s,TerritorialMutationKind::ReconcileSharedBoundary,in);p.targets=owners;p.affectedObjects=owners;p.selectedAfter=owners.front();p.requiresConfirmation=true;
    p.geometry.kind=GeometryRequirementKind::WorkerPatch;p.geometry.operation="boundary";p.geometry.readOwners=owners;
    for(const auto& owner:owners){p.geometry.replacements.push_back({owner,owner});guard(p,document,owner,"geometry");}
    // All descendants are immutable reads and bounded potential replacements.
    // Locks are checked against actual geometry, immediate-parent and inherited
    // root effects at prepare, not against this conservative read set.
    for(const auto& candidate:document.units) {
        const auto ref=territorialRef(candidate.id);
        if(candidate.kind!=UnitKind::General||std::find(owners.begin(),owners.end(),ref)!=owners.end())continue;
        if(std::any_of(owners.begin(),owners.end(),[&](const auto& owner){return descendant(document,ref,owner);})) {
            p.affectedObjects.push_back(ref);p.geometry.readOwners.push_back(ref);p.geometry.replacements.push_back({ref,ref});p.geometry.removableOwners.push_back(ref);
            guard(p,document,ref,"geometry");guard(p,document,ref,"relation");guard(p,document,ref,"delete");
        }
    }
    if(parentId.empty()) {
        // Gained overlap is checked against every root, including unselected roots.
        for(const auto& candidate:document.units)if(isRootGeneral(document,candidate)) {
            const auto ref=territorialRef(candidate.id);if(std::find(p.geometry.readOwners.begin(),p.geometry.readOwners.end(),ref)==p.geometry.readOwners.end())p.geometry.readOwners.push_back(ref);
        }
    } else {
        for(const auto& candidate:document.units)if(candidate.kind==UnitKind::General&&staticParentRelation(document,candidate.id).parentId==parentId) {
            const auto ref=territorialRef(candidate.id);if(std::find(p.geometry.readOwners.begin(),p.geometry.readOwners.end(),ref)==p.geometry.readOwners.end())p.geometry.readOwners.push_back(ref);
        }
        auto current=parentId;std::vector<std::string> seen;
        while(!current.empty()) {
            if(std::find(seen.begin(),seen.end(),current)!=seen.end())throw std::invalid_argument("PARENT_CYCLE");seen.push_back(current);
            const auto ref=territorialRef(current);const auto& ancestor=unit(s,ref);unlocked(ancestor);
            if(ancestor.kind!=UnitKind::General)throw std::invalid_argument("ADMINISTRATIVE_PARENT_MISMATCH");

            p.geometry.readOwners.push_back(ref);current=staticParentRelation(document,current).parentId;
        }
    }
    requireRewritableGuards(p,document);p.impacts.push_back({"boundary",owners.front(),"territorial.boundary.reconcile"});return p;
}
TerritorialMutationPlan planCoastline(const ProjectSnapshot& s,const CoastlineIntent& in) {
    GeometryStore check;check.insert({"coast-draft",1},in.draft);const auto& target=unit(s,in.target);unlocked(target);
    const auto root=administrativeRoot(s.document(),in.target);unlocked(unit(s,root));
    auto p=initial(s,TerritorialMutationKind::ReconcileCoastline,in);p.targets={in.target};p.affectedObjects={root};p.selectedAfter=in.target;p.requiresConfirmation=true;p.geometry.kind=GeometryRequirementKind::WorkerPatch;p.geometry.operation="coast";
    if(in.authority==CoastlineAuthority::Independent){p.geometry.readOwners={in.target};p.geometry.replacements={{in.target,in.target}};p.affectedObjects={in.target};guard(p,s.document(),in.target,"geometry");}
    else {p.geometry.readOwners={root};p.geometry.replacements={{root,root}};guard(p,s.document(),root,"geometry");for(const auto& candidate:s.document().units){const auto ref=territorialRef(candidate.id);if(candidate.kind==UnitKind::General&&descendant(s.document(),ref,root)){unlocked(candidate);p.affectedObjects.push_back(ref);p.geometry.readOwners.push_back(ref);p.geometry.replacements.push_back({ref,ref});p.geometry.removableOwners.push_back(ref);guard(p,s.document(),ref,"geometry");}}}
    requireRewritableGuards(p,s.document());p.impacts.push_back({"coast",root,"territorial.coast.reconcile"});return p;
}
}
