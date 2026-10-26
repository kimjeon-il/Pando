#include <pandoeditor/webobjectcommands.h>
#include <pandoeditor/projectcodec.h>
#include <pandoeditor/document-session.h>
#include <cassert>
#include <iostream>

using namespace pandoeditor;
using V=codecjson::Value;
namespace {
V json(const char* bytes){return codecjson::parse(bytes);}
Geometry shape(const char* bytes){return projectcodec::readWebGeometry(json(bytes));}
const char* polygon=R"({"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]})";
const char* line=R"({"type":"LineString","coordinates":[[0,0],[1,1]]})";
GeometryRef geometry(ProjectDocument& d,const std::string& id,const char* bytes) {
    GeometryRef ref{id,1};d.geometries.insert(ref,shape(bytes));d.geometryProvenance.originalArchive.insert(ref);return ref;
}
void unit(ProjectDocument& d,const std::string& id,const std::string& parent="",UnitKind kind=UnitKind::General) {
    TerritorialUnit value;value.id=id;value.name=id;value.kind=kind;d.units.push_back(value);
    addStaticTerritorialRecords(d,id,geometry(d,"territorial-geometry:"+id,polygon),parent);
    d.presentation.objectStyles[territorialRef(id)]={0,1,false};
}
ProjectDocument fixture() {
    ProjectDocument d;d.documentId="web-object-removal";unit(d,"A");unit(d,"B");
    d.exchangeMetadata=R"({"physicalSettings":{"hiddenHydroIds":{"source":true,"other":true},"annotation":{"keep":1.2500}}})";
    PlaceLabel p;p.id="P";p.name="selected label";p.territory=territorialRef("A");p.geometry=geometry(d,"point:P",R"({"type":"Point","coordinates":[1,1]})");d.labels.push_back(p);
    p.id="Q";p.name="retained label";p.geometry=geometry(d,"point:Q",R"({"type":"Point","coordinates":[1,1]})");d.labels.push_back(p);
    GenericFeature g;g.id="G";g.name="generic";g.geometry=geometry(d,"shape:G",polygon);d.genericFeatures.push_back(g);
    HydroFeature h;h.id="H1";h.name="river 1";h.sourceFeatureId="source";d.hydro.push_back(h);addStaticObjectRecords(d,{"hydro",h.id},geometry(d,"line:H1",line));
    h.id="H2";d.hydro.push_back(h);addStaticObjectRecords(d,{"hydro",h.id},geometry(d,"line:H2",line));
    DistributionLayer l;l.id="M";l.name="other layer";d.distributionLayers.push_back(l);
    l.id="L";l.name="selected layer";d.distributionLayers.push_back(l);
    l.id="C";l.name="locked child";l.locked=true;l.parentId="L";d.distributionLayers.push_back(l);
    DistributionEntry e;e.id="E";e.layerId="L";e.territory=territorialRef("B");d.distributionEntries.push_back(e);
    e.id="T";e.layerId="M";e.territory=territorialRef("A");d.distributionEntries.push_back(e);
    e.id="U";e.territory=territorialRef("B");d.distributionEntries.push_back(e);
    auto& presentation=d.presentation.webPresentation;
    presentation.labelSettings[territorialRef("A")]={};presentation.labelSettings[{"label","P"}]={};presentation.labelSettings[{"label","Q"}]={};
    presentation.itemVisibility["objects"]={{"A",false},{"B",true}};
    presentation.itemVisibility["objectLabels"]={{"A",false},{"B",true}};
    presentation.itemVisibility["genericFeatures"]["G"]=false;presentation.itemVisibility["hydro"]["H1"]=false;
    presentation.itemVisibility["labels"]["P"]=false;presentation.itemVisibility["distributions"]["L"]=false;
    presentation.objectStyles[territorialPresentationKey("A")].opacity=0.5;
    auto catalog=std::make_shared<PresentationCatalog>();catalog->countryLabelIds={"A","B"};catalog->hydroLayers["source"]="river";d.presentation.catalog=catalog;
    return d;
}
V payload(const std::vector<ObjectRef>& refs) {
    auto result=V::obj(),rows=V::arr();for(const auto& ref:refs) {
        auto row=V::obj();row.object["domain"]=V::str(ref.domain);row.object["id"]=V::str(ref.id);rows.array.push_back(std::move(row));
    }result.object["refs"]=std::move(rows);return result;
}
CommandResult apply(Project& p,const std::vector<ObjectRef>& refs) {
    auto request=readWebObjectRemoval(p.snapshot(),payload(refs));assert(request.commandId=="objects.remove"&&request.targets==refs);
    auto prepared=CommandProcessor::prepare(p,request);
    if(!prepared.ok()){std::cerr<<prepared.detail<<'\n';assert(false);}
    return prepared.preview?CommandProcessor::confirm(p,*prepared.preview):CommandResult(prepared);
}
void reject(Project& p,const std::vector<ObjectRef>& refs,const char* code) {
    const auto before=p.snapshot();const auto checkpoint=p.historyCheckpoint();
    try {auto request=readWebObjectRemoval(p.snapshot(),payload(refs));auto prepared=CommandProcessor::prepare(p,request);
        assert(!prepared.ok()&&prepared.operationErrorCode==code);
    }catch(const TimelineError& error){assert(error.code==code);}
    assert(p.revision()==before.revision()&&p.historyCheckpoint()==checkpoint&&semanticallyEqual(p.document(),before.document()));
}
void fiveDomainsAtomicHistoryAndOriginalCleanup() {
    auto seed=fixture();
    for(const auto* id:{"E","T","U"}) {
        seed.presentation.objectStyles[{"distributionEntry",id}]={0x123456,0.5,true};
    }
    Project p;p.replace(std::move(seed));p.setTimelineCursor("2026-10",false);const auto before=p.snapshot();
    const std::vector<ObjectRef> refs={{"territorial","A"},{"distributionLayer","L"},{"generic","G"},{"hydro","H1"},{"label","P"}};
    const auto request=readWebObjectRemoval(p.snapshot(),payload(refs));assert(advancesWebStateRevision(request));
    assert(apply(p,refs).changed()&&p.canUndo()&&p.revision()==1);
    const auto& d=p.document();assert(d.units.size()==1&&d.units[0].id=="B"&&d.genericFeatures.empty()&&d.labels.size()==1);
    assert(d.labels[0].id=="Q"&&d.labels[0].territory==territorialRef("A")); // Original saved non-owning annotation.
    assert(d.distributionLayers.size()==2&&d.distributionLayers[0].id=="M"&&d.distributionLayers[1].id=="C"&&!d.distributionLayers[1].parentId&&d.distributionLayers[1].locked);
    assert(d.distributionEntries.size()==1&&d.distributionEntries[0].id=="U");
    for(const auto* id:{"E","T"})assert(!d.presentation.objectStyles.count({"distributionEntry",id}));
    assert(d.presentation.objectStyles.count({"distributionEntry","U"}));
    assert(d.hydro.size()==1&&d.hydro[0].id=="H2"&&codecjson::parse(d.exchangeMetadata).object.at("physicalSettings").object.at("hiddenHydroIds").object.count("source"));
    const auto& view=d.presentation.webPresentation;
    assert(!view.labelSettings.count(territorialRef("A"))&&!view.labelSettings.count({"label","P"})&&view.labelSettings.count({"label","Q"}));
    assert(!view.itemVisibility.at("objects").count("A")&&!view.itemVisibility.at("objectLabels").count("A")&&view.itemVisibility.at("objects").at("B"));
    assert(!view.objectStyles.count(territorialPresentationKey("A")));
    // Original UI leaves these content hidden rows stored, even with a catalog.
    for(const auto& [group,id]:std::vector<std::pair<std::string,std::string>>{{"genericFeatures","G"},{"hydro","H1"},{"labels","P"},{"distributions","L"}})assert(!view.itemVisibility.at(group).at(id));
    assert(d.geometries.versions().size()==before.document().geometries.versions().size());
    for(const auto& [ref,shape]:before.document().geometries.versions())assert(d.geometries.get(ref)==shape);
    assert(p.undo());
    // Unchanged physical settings must retain the original raw header bytes,
    // including noncanonical JSON member order and numeric spelling.
    assert(p.document().exchangeMetadata==before.document().exchangeMetadata);
    assert(semanticallyEqual(p.document(),before.document()));
    assert(p.redo()&&p.document().labels[0].territory==territorialRef("A"));
}
void duplicatesAndLastHydroSource() {
    Project p;p.replace(fixture());p.setTimelineCursor("2026-10",false);
    const auto request=readWebObjectRemoval(p.snapshot(),payload({{"hydro","H1"},{"hydro","H1"},{"hydro","H2"}}));
    const std::vector<ObjectRef> unique={{"hydro","H1"},{"hydro","H2"}};assert(request.targets==unique&&std::get<WebObjectRemoval>(request.args.action).refs==unique);
    auto prepared=CommandProcessor::prepare(p,request);assert(prepared.preview&&CommandProcessor::confirm(p,*prepared.preview).changed());
    const auto settings=codecjson::parse(p.document().exchangeMetadata).object.at("physicalSettings");assert(p.document().hydro.empty()&&!settings.object.at("hiddenHydroIds").object.count("source"));
    assert(settings.object.at("hiddenHydroIds").object.at("other").raw=="true"&&settings.object.at("annotation").object.at("keep").raw=="1.2500");
    const auto viewedMetadata=p.document().exchangeMetadata;
    assert(p.undo()&&p.document().hydro.size()==2);
    // Copied-hydro source visibility is a live view setting, not history data.
    assert(p.document().exchangeMetadata==viewedMetadata);
    assert(p.redo()&&p.document().hydro.empty());
}
void admissionIsAtomicAndChildrenCannotBeBundledAway() {
    Project p;auto d=fixture();unit(d,"child","A");p.replace(std::move(d));p.setTimelineCursor("2026-10",false);
    reject(p,{{"generic","G"},{"territorial","A"}},"has-children");reject(p,{{"territorial","A"},{"territorial","child"}},"has-children");
    reject(p,{{"generic","G"},{"label","missing"}},"not-found");
    for(const auto& domain:{"distributionEntry","placeBuiltin","hydroBuiltin","userLayer"})reject(p,{{domain,"E"}},"unsupported");
    d=fixture();d.genericFeatures[0].locked=true;p.replace(std::move(d));reject(p,{{"hydro","H1"},{"generic","G"}},"locked");
    d=fixture();d.distributionLayers[1].locked=true;p.replace(std::move(d));reject(p,{{"distributionLayer","L"}},"locked");
    d=fixture();d.hydro[0].locked=true;p.replace(std::move(d));reject(p,{{"hydro","H1"}},"locked");
    d=fixture();d.units[0].locked=true;p.replace(std::move(d));reject(p,{{"territorial","A"}},"locked");
    reject(p,{},"CORE_COMMAND_PAYLOAD");
}
void registeredDisplayIdentityAndCollision() {
    const std::string id="d34b00a1-9b13-8000-8000-000000484b47";auto d=fixture();unit(d,id,"B");d.units.back().metadata=R"({"builtinSubunit":{"sourceCountryId":"HKG"}})";
    auto catalog=std::make_shared<PresentationCatalog>(*d.presentation.catalog);catalog->builtinSubunitSources[id]="HKG";catalog->countryLabelIds.push_back("HKG");catalog->countryLabelIds.push_back("territorial:entity:"+id);d.presentation.catalog=catalog;
    d.presentation.webPresentation.itemVisibility["objectLabels"]["HKG"]=false;d.presentation.webPresentation.itemVisibility["objectLabels"]["territorial:entity:"+id]=false;
    Project p;p.replace(d);p.setTimelineCursor("2026-10",false);assert(apply(p,{{"territorial",id}}).changed());
    assert(!p.document().presentation.webPresentation.itemVisibility.at("objectLabels").count("HKG")&&p.document().presentation.webPresentation.itemVisibility.at("objectLabels").count("territorial:entity:"+id));
    unit(d,"HKG");p.replace(d);assert(apply(p,{{"territorial",id}}).changed());
    assert(p.document().presentation.webPresentation.itemVisibility.at("objectLabels").count("HKG")&&!p.document().presentation.webPresentation.itemVisibility.at("objectLabels").count("territorial:entity:"+id));
    d.units[2].metadata=R"({"builtinSubunit":{"sourceCountryId":"spoof"}})";p.replace(d);assert(apply(p,{{"territorial",id}}).changed());
    assert(p.document().presentation.webPresentation.itemVisibility.at("objectLabels").count("HKG"));
}
void datedRemovalTruncatesWithoutDroppingIdentityOrArchive() {
    auto d=fixture();for(auto& row:d.timelineRecords.lifetimes)row.validity.from="2020";
    for(auto& row:d.timelineRecords.geometryBindings)row.validity.from="2020";for(auto& row:d.timelineRecords.parentRelations)row.validity.from="2020";
    Project p;p.replace(std::move(d));p.setTimelineCursor("2026-10",false);const auto before=p.snapshot();
    assert(apply(p,{{"territorial","A"}}).changed());assert(p.document().units.size()==2&&p.document().timelineRecords.lifetimes[0].validity.to=="2026-09");
    assert(!p.resolveWorld("2026-10").find(territorialRef("A"))&&p.resolveWorld("2026-09").find(territorialRef("A"))&&p.document().geometries.versions().size()==before.document().geometries.versions().size());
    reject(p,{{"territorial","A"}},"not-found");assert(p.undo()&&p.resolveWorld("2026-10").find(territorialRef("A")));
}
void physicalViewRebaseRejectsUnrelatedMetadataChanges() {
    const auto original=fixture();
    auto allowed=original;
    auto view=codecjson::parse(allowed.exchangeMetadata);
    view.object.at("physicalSettings").object.at("hiddenHydroIds").object.erase("source");
    allowed.exchangeMetadata=view.encode();
    GeometryProvenanceCodecAccess::admitPhysicalViewMetadata(original,allowed);
    assert(allowed.geometryProvenance.opaqueBaseline.count("/exchangeMetadata"));

    auto rejected=original;
    auto changed=codecjson::parse(rejected.exchangeMetadata);
    changed.object.at("physicalSettings").object.at("annotation").object["keep"]=V::num(2);
    rejected.exchangeMetadata=changed.encode();
    bool failed=false;
    try { GeometryProvenanceCodecAccess::admitPhysicalViewMetadata(original,rejected); }
    catch(const std::invalid_argument& error) {
        failed=std::string(error.what()).find("unrelated physical metadata changed")!=std::string::npos;
    }
    assert(failed);
}
}
int main(){physicalViewRebaseRejectsUnrelatedMetadataChanges();fiveDomainsAtomicHistoryAndOriginalCleanup();duplicatesAndLastHydroSource();admissionIsAtomicAndChildrenCannotBeBundledAway();registeredDisplayIdentityAndCollision();datedRemovalTruncatesWithoutDroppingIdentityOrArchive();std::cout<<"Web object removal tests passed\n";}
