#include <pandoeditor/document-session.h>
#include <pandoeditor/timeline-storage.h>
#include "../geometry/fixtures/clipped-positive-rings.h"
#include <limits>
#include <cmath>
#include <pandoeditor/webcommands.h>
#include <pandoeditor/timeline-edit.h>
#include <pandoeditor/webcontentcommands.h>
#include <pandoeditor/webterritorialcommands.h>
#include <algorithm>
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>

using namespace pandoeditor;
void ownedCommandBoundaries(const std::string& seed) {
    using V=codecjson::Value;
    const projectcodec::PlatformPorts ports{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
    DocumentSession session(ports);session.documentLoad(seed,"2026-10");
    const auto epoch=session.projectState().epoch;CommandArguments edit;edit.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Held name"};
    const auto held=session.prepareCommand("territorial.field",edit,{territorialRef("A")},epoch);assert(held.candidateId);
    assert(session.applyPresentation(WebControlVisibility{"labels",false},epoch).result.changed());
    PresentationCatalog catalog;assert(session.presentationCatalogLoad(catalog,session.projectState().epoch).result.changed());
    const auto confirmed=session.confirmCandidate(held.candidateId,epoch);assert(confirmed.result.changed());
    assert(!groupVisible(session.project().document().presentation.webPresentation,"labels"));
    assert(session.undo(session.projectState().epoch).result.changed());assert(!groupVisible(session.project().document().presentation.webPresentation,"labels"));
    session.documentLoad(seed,"2026-10");const auto inspectedBefore=session.documentSnapshot();const auto inspectedEpoch=session.projectState().epoch;
    const auto inspected=session.inspectImport(seed,{},"2026-10");
    assert(inspected.world.entities.size()==5);
    for(const auto* id:{"A","B","C","R"})assert(inspected.world.find(territorialRef(id)));
    assert(inspected.world.find({"hydro",session.project().document().hydro.at(0).id}));
    assert(session.documentSnapshot()==inspectedBefore&&session.projectState().epoch==inspectedEpoch&&!session.projectState().canUndo);
    const auto label=session.project().document().labels.at(0).id,original=session.storageSnapshot();
    const auto begin=session.labelGestureApply("begin",label,{},session.projectState().epoch);assert(begin.result.changed());
    const auto checkpoint=session.projectState().checkpoint;assert(session.projectState().stateRevision==0);
    assert(session.labelGestureApply("move",label,Point{128.125,38.25},session.projectState().epoch).result.changed());
    assert(session.labelGestureApply("move",label,Point{129.5,39.75},session.projectState().epoch).result.changed());
    assert(session.labelGestureApply("finish",label,{},session.projectState().epoch).result.changed());
    assert(session.projectState().checkpoint==checkpoint&&!session.projectState().presentationDirty&&session.projectState().stateRevision==0);
    const auto& settings=session.project().document().presentation.webPresentation.labelSettings.at({"label",label});
    assert(settings.pinned&&settings.manualPosition&&settings.manualPosition->x==129.5&&settings.manualPosition->y==39.75);
    assert(session.undo(session.projectState().epoch).result.changed());assert(session.storageSnapshot()==original&&!session.projectState().canUndo);
    assert(session.redo(session.projectState().epoch).result.changed());assert(session.projectState().checkpoint==checkpoint);
    assert(!session.labelGestureApply("move",label,Point{1,2},session.projectState().epoch).result.ok());
    session.documentLoad(seed,"2026-10");assert(session.labelGestureApply("begin",label,{},session.projectState().epoch).result.changed());
    assert(session.labelGestureApply("finish",label,{},session.projectState().epoch).result.changed());
    assert(session.undo(session.projectState().epoch).result.changed()&&!session.projectState().canUndo);
    session.documentLoad(seed,"2026-10");
    const auto hydro=session.project().document().hydro.at(0).id,generic=session.project().document().genericFeatures.at(0).id;
    auto payload=V::obj(),refs=V::arr();for(const auto& ref:std::vector<ObjectRef>{territorialRef("A"),{"hydro",hydro},{"generic",generic}}) {
        auto row=V::obj();row.object["domain"]=V::str(ref.domain);row.object["id"]=V::str(ref.id);refs.array.push_back(row);
    }
    payload.object["refs"]=refs;payload.object["color"]=V::str("#123456");
    auto request=readWebObjectEditCommand(session.project().snapshot(),"objects.color",payload);
    const auto colorResult=session.executeCommand(request.commandId,request.args,request.targets,session.projectState().epoch);assert(colorResult.result.changed());
    assert(session.projectState().stateRevision==0&&session.projectState().checkpoint==1);
    assert(codecjson::parse(session.project().document().hydro.at(0).annotations).object.at("color").string=="#123456");
    assert(session.undo(session.projectState().epoch).result.changed());assert(session.storageSnapshot()==original);
    payload.object.erase("color");payload.object["locked"]=V::boolean(true);request=readWebObjectEditCommand(session.project().snapshot(),"objects.lock",payload);
    assert(session.executeCommand(request.commandId,request.args,request.targets,session.projectState().epoch).result.changed());assert(session.projectState().stateRevision==1);
    payload.object["locked"]=V::boolean(false);request=readWebObjectEditCommand(session.project().snapshot(),"objects.lock",payload);
    assert(session.executeCommand(request.commandId,request.args,request.targets,session.projectState().epoch).result.changed());
    auto reset=V::obj();reset.object["id"]=V::str(generic);request=readWebContentCommand(session.project().snapshot(),"generic.color-reset",reset);
    const auto clock=session.projectState().stateRevision;assert(session.executeCommand(request.commandId,request.args,request.targets,session.projectState().epoch).result.changed());
    assert(session.projectState().stateRevision==clock&&codecjson::parse(session.storageSnapshot()).object.at("genericFeatures").array.at(0).object.at("properties").object.at("color").string.empty());
    auto linked=codecjson::parse(seed);auto& entry=linked.object.at("distributionEntries").array.at(0);
    entry.object["mode"]=V::str("territorial");entry.object["territorialUnitId"]=V::str("R");entry.object["geometry"]=V{};
    session.documentLoad(linked.encode(),"2026-10");const auto linkedBefore=session.storageSnapshot();
    const auto entryId=session.project().document().distributionEntries.at(0).id;
    const auto builder=[&](const ProjectSnapshot& current,std::size_t index) {
        if(index==0)return readWebTerritorialCommand(current,"territorial.remove",codecjson::parse("{\"ids\":[\"R\"]}"),ports);
        auto value=projectcodec::webContentValue(current,{"distributionEntry",entryId});value.object["territorialUnitId"]=V::str("A");
        CommandArguments args;args.action=projectcodec::readWebContentEdit(current,{"distributionEntry",entryId},value,false);
        return CommandRequest{"content.edit",current.instanceId(),current.document().documentId,current.revision(),{{"distributionEntry",entryId}},std::move(args)};
    };
    const auto failed=session.prepareBatch(2,builder,session.projectState().epoch);assert(!failed.result.ok()&&session.storageSnapshot()==linkedBefore);
    const auto valid=session.prepareBatch(2,builder,session.projectState().epoch,"territorial.merge");
    if(!valid.result.ok())std::cerr<<"semantic batch: "<<valid.result.detail<<'\n';assert(valid.candidateId);
    assert(session.confirmCandidate(valid.candidateId,session.projectState().epoch).result.changed());assert(session.projectState().stateRevision==1&&session.projectState().checkpoint==1);
    assert(session.project().document().distributionEntries.at(0).territory==std::optional<ObjectRef>{territorialRef("A")});
    assert(session.undo(session.projectState().epoch).result.changed());assert(session.storageSnapshot()==linkedBefore);
    assert(!session.prepareBatch(1,builder,session.projectState().epoch,"territorial.merge").result.ok());
    session.documentLoad(seed,"2026-10");for(int i=1;i<=35;++i) {
        edit.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Name "+std::to_string(i)};
        assert(session.executeCommand("territorial.field",edit,{territorialRef("A")},session.projectState().epoch).result.changed());
    }
    int steps=0;while(session.undo(session.projectState().epoch).result.changed())++steps;
    assert(steps==30&&session.project().document().units.at(0).name=="Name 5"&&session.projectState().documentDirty);
    for(const bool moved:{false,true}) {
        auto raw=codecjson::parse(seed);raw.object.at("labelSettings").object["label:"+label]=codecjson::parse("{\"fontSize\":15,\"visible\":true,\"minZoom\":2,\"maxZoom\":19,\"manualPosition\":null,\"pinned\":false}");
        session.documentLoad(raw.encode(),"2026-10");const auto initial=session.storageSnapshot();
        assert(session.labelGestureApply("begin",label,{},session.projectState().epoch).result.changed());
        if(moved)assert(session.labelGestureApply("move",label,Point{15.125,10.25},session.projectState().epoch).result.changed());
        assert(session.labelGestureApply("finish",label,{},session.projectState().epoch).result.changed());
        const auto finish=codecjson::parse(session.storageSnapshot()).object.at("labelSettings").object.at("label:"+label);
        assert(!finish.object.count("fontSize")&&!finish.object.count("visible")&&finish.object.at("priority").kind==V::Null&&finish.object.at("collisionGroup").string=="map");
        assert(session.undo(session.projectState().epoch).result.changed());
        if(moved)assert(session.storageSnapshot()==initial);
        else assert(codecjson::parse(session.storageSnapshot()).object.at("labelSettings").object.at("label:"+label).encode()==finish.encode());
    }
    // External source catalogs register session identities; they do not author
    // project background settings or rewrite the saved default view.
    session.documentLoad(seed,"2026-10");const auto aliasBefore=session.projectState();
    const auto catalogStorage=session.storageSnapshot();
    const auto alias=session.selectionCatalogLoad("hydroBuiltin",{{{"hydroBuiltin","river","river-fid"},std::string("logical-river"),{"source","other"}}},aliasBefore.epoch);
    assert(alias.result.ok()&&!alias.result.changed());
    assert(session.selectionRefExists({"hydroBuiltin","river","river-fid"}));
    assert(session.storageSnapshot()==catalogStorage);
    assert(session.projectState().epoch==aliasBefore.epoch&&session.projectState().revision==aliasBefore.revision&&session.projectState().presentationRevision==aliasBefore.presentationRevision&&!session.projectState().dirty&&!session.projectState().canUndo);
    Project adoptedProject;adoptedProject.replace(projectcodec::decodeWeb(seed,ports));adoptedProject.setTimelineCursor("2026-10",false);
    DocumentSession adopted(ports);adopted.adoptPreparedProject(std::move(adoptedProject));
    const auto adoptedEpoch=adopted.projectState().epoch;
    edit.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Adopted held"};
    auto adoptedRequest=CommandProcessor::makeRequest(adopted.project(),"territorial.field",edit);adoptedRequest.targets={territorialRef("A")};
    auto adoptedPrepared=CommandProcessor::prepare(adopted.project().snapshot(),adoptedRequest);assert(adoptedPrepared.preview);
    assert(adopted.applyPresentation(SetPresentationVisibility{"labels",false},adoptedEpoch).result.changed());
    const auto adoptedHeld=adopted.adoptPreparedCommand(std::move(adoptedPrepared),adoptedEpoch);assert(adoptedHeld.candidateId);
    assert(adopted.confirmCandidate(adoptedHeld.candidateId,adoptedEpoch).result.changed()&&!groupVisible(adopted.project().document().presentation.webPresentation,"labels"));
    const auto adoptedOldEpoch=adopted.projectState().epoch;
    adoptedRequest=CommandProcessor::makeRequest(adopted.project(),"territorial.field",edit);adoptedRequest.targets={territorialRef("A")};
    adoptedRequest.args.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Late name"};
    adoptedPrepared=CommandProcessor::prepare(adopted.project().snapshot(),adoptedRequest);assert(adoptedPrepared.preview);
    edit.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Notes,"Other command"};
    assert(adopted.executeCommand("territorial.field",edit,{territorialRef("A")},adoptedOldEpoch).result.changed());
    assert(!adopted.adoptPreparedCommand(std::move(adoptedPrepared),adoptedOldEpoch).result.ok());
}
void pureTimelineContracts() {
    const TimelineValidationContext context{{{territorialRef("root"),"general"},{territorialRef("child"),"general"}},[](const ObjectRef&,const GeometryRef& ref){return ref.id=="shape"&&(ref.version==1||ref.version==2);}};
    TimelineRecords records;
    records.lifetimes={{"life:r",territorialRef("root"),{}},{"life:c",territorialRef("child"),{{"1900"},{"1920"}}}};
    records.geometryBindings={{"shape:r",territorialRef("root"),{}, {"shape",1}},{"shape:c",territorialRef("child"),{{"1900"},{"1920"}}, {"shape",1}}};
    records.parentRelations={{"parent:r",territorialRef("root"),{},"","explicit"},{"parent:c",territorialRef("child"),{{"1900"},{"1920"}},"root","partition"}};
    records=normalizeTimelineRecords(records,context);
    assert(initialTimelineMonth(records,"2026-10")=="1900-01");
    assert(resolveWorld(records,context,"1910-01").find(territorialRef("child"))->rootId=="root");
    assert(resolveWorld(records,context,"1899-12").entities.size()==1);
    auto invalid=records;invalid.geometryBindings.at(1).geometryRef={"missing",1};
    try{normalizeTimelineRecords(invalid,context);assert(false);}catch(const TimelineError& error){assert(error.code=="TIMELINE_GEOMETRY");}
    const auto edited=replaceGeometryBindingAtMonth(records,territorialRef("child"),"1914-07",{"shape",2});
    assert(resolveWorld(edited,context,"1914-06").find(territorialRef("child"))->geometryRef.version==1);
    assert(resolveWorld(edited,context,"1914-07").find(territorialRef("child"))->geometryRef.version==2);
    assert(resolveWorld(records,context,"1914-07").find(territorialRef("child"))->geometryRef.version==1);
}

namespace {
Geometry clippedPolygon(const Ring& ring) {
    Geometry geometry;geometry.type="Polygon";geometry.polygons={{ring}};return geometry;
}
Geometry ordinaryAndCurrentClipped() {
    Geometry geometry;geometry.polygons={{{{-10,0},{-9,0},{-9,1},{-10,1},{-10,0}}}};
    for(const auto& ring:currentClippedPositiveRings())geometry.polygons.push_back({ring});
    assert(geometry.polygons.size()==15);return geometry;
}
template<class Action> void rejectsGeometry(Action action,const std::string& code="INVALID_GEOMETRY") {
    bool rejected=false;
    try{action();}catch(const std::invalid_argument& error){
        rejected=true;assert(std::string(error.what()).find(code)!=std::string::npos);
    }
    assert(rejected);
}
std::vector<Geometry> invalidCanonicalGeometries() {
    std::vector<Geometry> result{
        clippedPolygon({{0,0},{1,0},{2,0},{0,0}}), // exact zero
        clippedPolygon({{0,0},{4,3},{0,3},{3,0},{0,0}}), // crossing, nonzero signed area
        clippedPolygon({{0,0},{3,0},{3,3},{3,0},{0,3},{0,0}}), // retraced edge
        clippedPolygon({{0,0},{0,0},{0,0},{0,0}}), // no nonzero boundary
        clippedPolygon({{0,0},{3,0},{0,3},{1,1}}) // open
    };
    auto invalid=clippedPolygon({{0,0},{3,0},{0,3},{0,0}});
    invalid.polygons[0][0][1].x=181;result.push_back(invalid);
    invalid.polygons[0][0][1].x=std::numeric_limits<double>::quiet_NaN();result.push_back(invalid);
    invalid=clippedPolygon({{0,0},{3,0},{0,3},{0,0}});invalid.points={{1,1}};result.push_back(invalid);
    invalid.type="GeometryCollection";result.push_back(invalid);
    return result;
}
void canonicalGeometryStoreContracts() {
    const auto repeated=clippedPolygon({{0,0},{0,0},{0,3},{3,3},{3,3},{3,0},{0,0},{0,0}});
    GeometryStore zeroEdges;zeroEdges.insertCanonical({"zero-edges",1},repeated);
    assert(sameGeometryValue(*zeroEdges.get({"zero-edges",1}),repeated));

    const auto rings=currentClippedPositiveRings();assert(rings.size()==14);
    // Positions correspond to captured componentIndex 3,6,9,24,26,40.
    const std::vector<std::size_t> oldSourceRejected{1,2,5,8,9,11};
    GeometryStore store;
    for(std::size_t i=0;i<rings.size();++i) {
        const auto geometry=clippedPolygon(rings[i]);const auto before=geometry;
        const GeometryRef ref{"clipped-"+std::to_string(i),1};
        store.insertCanonical(ref,geometry);
        assert(sameGeometryValue(*store.get(ref),before)&&sameGeometryValue(geometry,before));
        auto reversed=geometry;std::reverse(reversed.polygons[0][0].begin(),reversed.polygons[0][0].end());
        store.insertCanonical({ref.id,2},reversed);assert(sameGeometryValue(*store.get({ref.id,2}),reversed));
        if(std::find(oldSourceRejected.begin(),oldSourceRejected.end(),i)!=oldSourceRejected.end()) {
            GeometryStore strict;
            rejectsGeometry([&]{strict.insert(ref,geometry);});assert(strict.versions().empty());
        }
    }
    const auto mixed=ordinaryAndCurrentClipped(),before=mixed;
    const GeometryRef mixedRef{"mixed",1};store.insertCanonical(mixedRef,mixed);
    assert(sameGeometryValue(mixed,before)&&sameGeometryValue(*store.get(mixedRef),before));
    GeometryStore strict;strict.insert({"ordinary",1},clippedPolygon(mixed.polygons.front().front()));
    assert(strict.versions().size()==1);
    GeometryStore retained;const auto allocation=std::make_shared<const Geometry>(mixed);
    retained.retain(mixedRef,allocation);assert(retained.get(mixedRef)==allocation);
    rejectsGeometry([&]{retained.retain({"null",1},nullptr);});
    rejectsGeometry([&]{retained.insertCanonical({"",1},mixed);});
    rejectsGeometry([&]{retained.insertCanonical({"version",0},mixed);});
    rejectsGeometry([&]{retained.retain(mixedRef,allocation);},"DUPLICATE_ID");
    rejectsGeometry([&]{retained.insertCanonical(mixedRef,mixed);},"DUPLICATE_ID");
    for(const auto& invalid:invalidCanonicalGeometries()) {
        const auto count=retained.versions().size();
        rejectsGeometry([&]{retained.insertCanonical({"invalid",1},invalid);});
        rejectsGeometry([&]{retained.retain({"invalid",1},std::make_shared<const Geometry>(invalid));});
        assert(retained.versions().size()==count&&retained.get(mixedRef)==allocation);
    }
    const auto snapshot=snapshotTimelineStorage({},store,{});
    const auto restored=restoreTimelineStorage(snapshot,{});
    assert(restored.geometries.versions().size()==store.versions().size());
    for(const auto& [ref,geometry]:store.versions())assert(sameGeometryValue(*restored.geometries.get(ref),*geometry));
    // Restoration copies an externally owned allocation, rather than trusting its pointer.
    auto mutableGeometry=std::make_shared<Geometry>(mixed);auto external=snapshot;
    external.geometries.push_back({{"external",1},mutableGeometry});
    const auto independent=restoreTimelineStorage(external,{});
    mutableGeometry->polygons[0][0][0].x=-20;
    assert(sameGeometryValue(*independent.geometries.get({"external",1}),mixed));
    auto invalidSnapshot=snapshot;
    invalidSnapshot.geometries.push_back({{"invalid",1},std::make_shared<const Geometry>(invalidCanonicalGeometries().front())});
    rejectsGeometry([&]{restoreTimelineStorage(invalidSnapshot,{});});
    assert(sameGeometryValue(*store.get(mixedRef),before));
}
codecjson::Value canonicalStoredInput(const std::string& seed,const Geometry& geometry) {
    using V=codecjson::Value;auto root=codecjson::parse(seed);
    root.object.at("territorialEntities").array.resize(1);
    assert(root.object.at("territorialEntities").array.front().object.at("id").string=="A");
    for(const auto* key:{"labels","hydroEdits","genericFeatures","distributionLayers","distributionEntries"})root.object[key]=V::arr();
    root.object["labelSettings"]=V::obj();
    root.object["distributionSettings"]=codecjson::parse(R"({"renderMode":"single","activeLayerId":"","boundaryVisible":false})");
    root.object["projectSetup"]=codecjson::parse(R"({"initialMonth":"2000-01","timelineRange":null,"initialMapBounds":null,"sourceMode":"empty"})");
    root.object["timelineRecords"]=codecjson::parse(R"({"schemaVersion":3,"lifetimes":[{"id":"life:A","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null}],"geometryBindings":[{"id":"shape:A","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null,"geometryRef":{"id":"clipped","version":1}}],"parentRelations":[{"id":"parent:A","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null,"parentId":"","coverageMode":"explicit"}],"propertyBindings":[]})");
    auto row=V::obj();row.object["id"]=V::str("clipped");row.object["version"]=V::num(1);row.object["geojson"]=projectcodec::webGeometryValue(geometry);
    root.object["geometries"]=V::arr();root.object["geometries"].array.push_back(row);return root;
}
void canonicalStoredSessionContracts(const std::string& seed) {
    using V=codecjson::Value;
    const projectcodec::PlatformPorts ports{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
    auto mixed=ordinaryAndCurrentClipped();
    mixed.polygons.front().front().insert(mixed.polygons.front().front().begin()+1,mixed.polygons.front().front().front());auto root=canonicalStoredInput(seed,mixed);
    // A distinct inline geometry forces the real project codec's retain boundary.
    auto inlineGeometry=mixed;for(auto& polygon:inlineGeometry.polygons)for(auto& ring:polygon)std::reverse(ring.begin(),ring.end());
    auto generic=codecjson::parse(R"({"type":"Feature","id":"22000000-0000-4000-8000-000000000019","properties":{"schemaVersion":2,"name":"Canonical inline","notes":"","color":"#8c68d8","locked":false,"source":{}}})");
    // A persisted row uses the same canonical provenance owner as web content creation.
    generic.object.at("properties").object["source"]=projectcodec::normalizeWebSourceProvenance(codecjson::parse(R"({"kind":"user"})"));
    generic.object["geometry"]=projectcodec::webGeometryValue(inlineGeometry);root.object["genericFeatures"].array.push_back(generic);
    const auto original=root.encode();const GeometryRef ref{"clipped",1};
    const auto decoded=projectcodec::decodeWeb(original,ports);
    assert(sameGeometryValue(*decoded.geometries.get(ref),mixed));
    assert(sameGeometryValue(*decoded.geometries.get(decoded.genericFeatures.front().geometry),inlineGeometry));
    DocumentSession session(ports);session.documentLoad(original,"2000-01");
    const auto read=projectcodec::readWebSnapshot(session.documentSnapshot(),ports);
    assert(sameGeometryValue(*read.geometries.get(ref),mixed));
    const auto saved=session.storageSnapshot();DocumentSession reopened(ports);reopened.documentLoad(saved,"2000-01");
    assert(sameGeometryValue(*reopened.project().document().geometries.get(ref),mixed));
    assert(sameGeometryValue(*reopened.project().document().geometries.get(reopened.project().document().genericFeatures.front().geometry),inlineGeometry));
    assert(reopened.storageSnapshot()==saved&&root.encode()==original);
    for(const auto& invalid:invalidCanonicalGeometries()) {
        // Nonfinite values and malformed native containers are covered at the store boundary.
        if(!std::isfinite(invalid.polygons[0][0][1].x)||!invalid.points.empty())continue;
        auto poisoned=root;poisoned.object.at("geometries").array[0].object["geojson"]=projectcodec::webGeometryValue(invalid);
        const auto before=session.documentSnapshot();const auto epoch=session.projectState().epoch;
        rejectsGeometry([&]{session.documentLoad(poisoned.encode(),"2000-01");});
        assert(session.documentSnapshot()==before&&session.projectState().epoch==epoch);
    }
    const auto ordinary=clippedPolygon(mixed.polygons.front().front());auto lazy=canonicalStoredInput(seed,ordinary);
    lazy.object.at("projectSetup").object["sourceMode"]=V::str("builtin");
    auto& bindings=lazy.object.at("timelineRecords").object.at("geometryBindings").array;
    auto later=bindings.front();bindings.front().object["validTo"]=V::str("2009");
    later.object["id"]=V::str("shape:later");later.object["validFrom"]=V::str("2010");later.object.at("geometryRef").object["version"]=V::num(2);bindings.push_back(later);
    const std::vector<Geometry> shapes{ordinary,mixed};std::vector<std::string> payloads;
    lazy.object["geometries"]=V::arr();lazy.object["geometryResources"]=V::arr();
    for(std::size_t i=0;i<shapes.size();++i) {
        payloads.push_back(projectcodec::webGeometryValue(shapes[i]).encode()+"\n");
        auto descriptor=V::obj();descriptor.object["id"]=V::str("clipped");descriptor.object["version"]=V::num(i+1);
        descriptor.object["type"]=V::str(shapes[i].type);descriptor.object["contentSha256"]=V::str(projectcodec::sha256Bytes(payloads.back()));descriptor.object["decodedBytes"]=V::num(payloads.back().size());
        lazy.object["geometryResources"].array.push_back(descriptor);
        if(i==0){auto row=V::obj();row.object["id"]=V::str("clipped");row.object["version"]=V::num(1);row.object["source"]=V::str(payloads.back());lazy.object["geometries"].array.push_back(row);}
    }
    const auto lazyBytes=lazy.encode();projectcodec::WebStorageAssetSource asset;
    asset.sourceBytes.assign(lazyBytes.begin(),lazyBytes.end());asset.encoding="identity";asset.compressedBytes=asset.decodedBytes=lazyBytes.size();
    asset.baseDataset=lazy.object.at("baseDataset").string;asset.sourceMonth="2000-01";asset.fingerprint=projectcodec::sha256Bytes(lazyBytes);
    DocumentSession resources(ports);resources.documentLoad(canonicalStoredInput(seed,ordinary).encode(),"2000-01");
    const auto admitted=resources.storageBaselineLoad(asset,resources.projectState().epoch);
    resources.documentLoadBaseline(admitted.storageBaselineId,lazy.object.at("projectSetup"),"clipped-offline");
    const GeometryRef future{"clipped",2};assert(resources.geometryRequirements("2015-01",resources.projectState().epoch)==std::vector<GeometryRef>{future});
    const auto before=resources.documentSnapshot();const auto state=resources.projectState();
    rejectsGeometry([&]{resources.admitGeometryResources({{future,payloads[1]+" "}},state.epoch);},"INVALID_GEOMETRY_RESOURCE");
    assert(resources.documentSnapshot()==before&&!resources.project().document().geometries.get(future));
    resources.admitGeometryResources({{future,payloads[1]}},state.epoch);
    assert(resources.projectState().epoch==state.epoch&&resources.projectState().checkpoint==state.checkpoint&&!resources.projectState().dirty&&!resources.projectState().canUndo);
    assert(sameGeometryValue(*resources.project().document().geometries.get(future),mixed));
    const auto resourceRead=projectcodec::readWebSnapshot(resources.documentSnapshot(),ports);
    assert(sameGeometryValue(*resourceRead.geometries.get(future),mixed));
    const auto offline=resources.storageSnapshot();DocumentSession offlineSession(ports);offlineSession.documentLoad(offline,"2000-01");
    assert(offlineSession.geometryRequirements("2015-01",offlineSession.projectState().epoch).empty());
    assert(sameGeometryValue(*offlineSession.project().document().geometries.get(future),mixed));
    assert(lazy.encode()==lazyBytes&&root.encode()==original);
}
} // namespace

int main() {
    canonicalGeometryStoreContracts();
    pureTimelineContracts();
    std::ifstream file(DOCUMENT_SESSION_FIXTURE,std::ios::binary);assert(file);
    const std::string rawSeed{std::istreambuf_iterator<char>(file),std::istreambuf_iterator<char>()};
    auto canonicalSeed=codecjson::parse(rawSeed);
    auto& geometries=canonicalSeed.object.at("geometries").array;
    std::sort(geometries.begin(),geometries.end(),[](const auto& a,const auto& b){
        const auto& left=a.object.at("id").string;const auto& right=b.object.at("id").string;
        return left==right?codecjson::finiteNumber(a.object.at("version"))<codecjson::finiteNumber(b.object.at("version")):left<right;
    });
    // Older v14 input omitted this optional field; canonical snapshots explicitly
    // represent the unbound project identity as null without changing content.
    canonicalSeed.object["mapProjectIdentity"]=codecjson::Value{};
    const auto seed=canonicalSeed.encode();
    ownedCommandBoundaries(seed);
    canonicalStoredSessionContracts(seed);
    auto blank=codecjson::parse(seed);for(auto& row:blank.object.at("territorialEntities").array) {
        auto& properties=row.object.at("properties");properties.object["name"]=codecjson::Value::str("");
        properties.object["metadata"]=codecjson::Value::obj();
    }
    DocumentSession exact({[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16});
    exact.documentLoad(blank.encode(),"2026-10");const auto exactBefore=exact.storageSnapshot();
    CommandArguments exactArgs;exactArgs.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Notes,"changed"};
    assert(exact.executeCommand("territorial.field",exactArgs,{territorialRef("A")},exact.projectState().epoch).result.changed());
    assert(exact.undo(exact.projectState().epoch).result.changed());assert(exact.storageSnapshot()==exactBefore);
    DocumentSession session({[](const std::string& value){if(value.empty())throw std::invalid_argument("invalid-flag");},
        true,codecjson::ParsedTextPolicy::PreserveUtf16});
    auto loaded=session.documentLoad(seed,"2026-10");
    auto stylePayload=codecjson::parse("{\"ids\":[\"missing\"],\"locked\":true}");
    try {readWebTerritorialStyleCommand(session.project().snapshot(),"territorial.lock",stylePayload);assert(false);}
    catch(const TimelineError& error){assert(error.code=="not-found");}
    stylePayload=codecjson::parse("{\"ids\":[\"A\",\"R\"],\"color\":\"#123456\"}");
    auto styleRequest=readWebTerritorialStyleCommand(session.project().snapshot(),"territorial.color",stylePayload);
    assert(styleRequest.commandId=="territorial.service-color");
    assert(session.executeCommand(styleRequest.commandId,styleRequest.args,styleRequest.targets,session.projectState().epoch).result.changed());
    assert(session.project().document().presentation.objectStyles.at(territorialRef("A")).color==0x123456&&session.project().document().presentation.objectStyles.at(territorialRef("R")).color==0x123456);
    styleRequest=readWebTerritorialStyleCommand(session.project().snapshot(),"territorial.color",stylePayload);
    assert(!session.executeCommand(styleRequest.commandId,styleRequest.args,styleRequest.targets,session.projectState().epoch).result.changed());
    assert(session.undo(session.projectState().epoch).result.changed());
    loaded=session.documentLoad(seed,"2026-10");
    const auto original=session.storageSnapshot();
    assert(codecjson::parse(original).encode()==codecjson::parse(seed).encode());
    assert(!loaded.dirty&&!loaded.canUndo&&loaded.stateRevision==0);
    const auto hydro=session.project().document().hydro.at(0).id;
    assert(effectiveMapVisibility(session.project().document(),{"hydro",hydro}));
    auto invalidMonth=codecjson::parse(seed);invalidMonth.object.at("projectSetup").object["initialMonth"]=codecjson::Value::str("bad month");
    try { session.documentLoad(invalidMonth.encode(),"2026-10");assert(false); }
    catch(const std::exception&) {}
    assert(session.projectState().epoch==loaded.epoch&&session.storageSnapshot()==original);
    CommandArguments args;args.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Beta"};
    const auto prepared=session.prepareCommand("territorial.field",args,{territorialRef("A")},loaded.epoch);
    assert(prepared.candidateId&&session.storageSnapshot()==original);
    assert(session.cancelCandidate(prepared.candidateId));
    assert(!session.confirmCandidate(prepared.candidateId,loaded.epoch).result.ok());
    const auto changed=session.executeCommand("territorial.field",args,{territorialRef("A")},loaded.epoch);
    assert(changed.result.changed()&&!changed.delta.empty());
    assert(codecjson::parse(changed.delta).object.at("objects").array.size()==1);
    assert(codecjson::parse(changed.delta).object.at("geometries").array.empty());
    assert(codecjson::parse(changed.delta).object.at("provenance").kind==codecjson::Value::Null);
    assert(session.projectState().dirty&&session.projectState().stateRevision==1);
    assert((session.projectState().dirtyTerritorialIds==std::vector<std::string>{"A"}));
    assert(session.project().document().units.at(0).name=="Beta");
    auto expected=codecjson::parse(original);expected.object.at("territorialEntities").array.at(0)
        .object.at("properties").object.at("name")=codecjson::Value::str("Beta");
    assert(codecjson::parse(session.storageSnapshot()).encode()==expected.encode());
    const auto state=session.projectState();
    assert(!session.executeCommand("territorial.field",args,{territorialRef("A")},state.epoch).result.changed());
    assert(session.projectState().epoch==state.epoch);
    const auto stale=session.executeCommand("territorial.field",args,{territorialRef("A")},loaded.epoch);
    assert(stale.result.error==CommandError::StaleRevision);
    const auto undone=session.undo(state.epoch);assert(undone.result.changed());
    assert(session.storageSnapshot()==original&&!session.projectState().dirty&&session.projectState().stateRevision==1);
    assert(session.projectState().dirtyTerritorialIds.empty());
    const auto redone=session.redo(session.projectState().epoch);assert(redone.result.changed());
    assert(session.project().document().units.at(0).name=="Beta"&&session.projectState().stateRevision==1);
    assert((session.projectState().dirtyTerritorialIds==std::vector<std::string>{"A"}));
    try { session.setTimelineCursor("2026-09",loaded.epoch);assert(false); }
    catch(const std::invalid_argument&) {}
    const auto saved=session.markSaved(session.projectState().epoch);assert(!saved.dirty);
    const auto labelId=session.project().document().labels.at(0).id;
    const SelectionRef capital{"label","capital",labelId},city{"label","city",labelId};
    const SelectionRef place{"placeBuiltin","city","built-in-place"},river{"hydroBuiltin","river","built-in-hydro"};
    session.selectionCatalogLoad("placeBuiltin",{{place,{}}},session.projectState().epoch);
    session.selectionCatalogLoad("hydroBuiltin",{{river,std::string("physical-river")}},session.projectState().epoch);
    assert(session.selectionRefExists(place)&&session.selectionRefExists(river));
    auto& selection=session.selection();selection.setMany({capital,city,place,river},capital);
    assert(selection.items().size()==4&&selection.primary()==std::optional<SelectionRef>{capital});
    assert(selection.setHover(river,"map"));const auto hoverRevision=selection.hoverRevision();
    assert(!selection.setHover({},"layer"));assert(selection.hoverRevision()==hoverRevision);
    assert(selection.setHover(river,"layer"));assert(selection.hoverRevision()==hoverRevision);
    assert(!selection.setHover({},"map"));assert(!selection.setHover({},"layer","wrong-key"));
    auto label=session.project().document().labels.at(0);label.kind="town";
    CommandArguments labelArgs;labelArgs.action=ContentEdit{{"label",labelId},label,{},false};
    const auto labelChanged=session.executeCommand("content.edit",labelArgs,{{"label",labelId}},saved.epoch);
    assert(labelChanged.result.changed()&&selection.items().at(0)==capital&&selection.items().at(1)==city);
    assert(selection.has(place)&&selection.has(river));
    session.selectionCatalogLoad("placeBuiltin",{},session.projectState().epoch);
    assert(!session.selectionRefExists(place)&&session.selectionRefExists(river)&&selection.hover()==std::optional<SelectionRef>{river});
    const auto historySelection=session.undo(session.projectState().epoch);
    assert(historySelection.result.changed()&&selection.items().empty()&&selection.hover()==std::optional<SelectionRef>{river});
    assert(selection.hoverRevision()==hoverRevision);
    selection.replace(capital,"empty-anchor");selection.toggle(capital,"empty-anchor");selection.clear();selection.resetProject();
    assert(selection.rangeAnchor("empty-anchor")==std::optional<SelectionRef>{capital});
    assert(selectionRefKey({"label","city",u8"A /한국"})=="label:city:A%20%2F%ED%95%9C%EA%B5%AD");
    auto rawFlagSeed=codecjson::parse(seed);rawFlagSeed.object.at("territorialEntities").array.at(0)
        .object.at("properties").object.at("metadata").object["flagDataUrl"]=codecjson::Value::num(42);
    auto& annotations=rawFlagSeed.object.at("territorialEntities").array.at(0).object.at("properties").object.at("metadata");
    annotations.object["capital"]=codecjson::parse("{\"raw\":null,\"name\":[1,2],\"geometryLike\":{\"id\":\"kept capital annotation\"}}");
    annotations.object["sourceRef"]=codecjson::parse("{\"geometryRef\":{\"id\":\"opaque shape\",\"version\":1}}");
    session.documentLoad(rawFlagSeed.encode(),"2026-10");
    CommandArguments flagArgs;flagArgs.action=ContentEdit{territorialRef("A"),
        TerritorialSymbolStyle{FlagPolicy::Embedded,"next flag"},{},false};
    assert(session.executeCommand("content.edit",flagArgs,{territorialRef("A")},session.projectState().epoch).result.changed());
    const auto flagStored=codecjson::parse(session.storageSnapshot());
    assert(flagStored.object.at("territorialEntities").array.at(0).object.at("properties").object.at("metadata")
        .object.at("flagDataUrl").string=="next flag");
    annotations.object["flagDataUrl"]=codecjson::Value::str("next flag");
    assert(flagStored.encode()==rawFlagSeed.encode());
    auto opaqueBefore=session.project().document(),opaqueCandidate=opaqueBefore;
    auto opaqueMetadata=codecjson::parse(opaqueCandidate.units.at(0).metadata);
    opaqueMetadata.object.at("sourceRef").object.at("geometryRef").object.at("id")=codecjson::Value::str("changed opaque ref");
    opaqueCandidate.units.at(0).metadata=opaqueMetadata.encode();
    reconcileGeometryProvenance(opaqueBefore,opaqueCandidate);assert(opaqueCandidate.geometryProvenance.opaqueUncertain);
    Project uncertain;uncertain.replace(opaqueCandidate);
    const projectcodec::PlatformPorts webPorts{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
    assert(!projectcodec::encodeWeb(uncertain.snapshot(),webPorts).empty());
    auto unsafe=opaqueCandidate;
    const auto privateLabel=unsafe.labels.at(0);const auto shape=*unsafe.geometries.get(privateLabel.geometry);
    const GeometryRef privateRef{"web-label:"+privateLabel.id,2};
    unsafe.geometries.insert(privateRef,shape);unsafe.labels.at(0).geometry=privateRef;
    unsafe.geometryProvenance.inlineAllocations.emplace(privateRef,InlineGeometryAllocation{
        {"label",privateLabel.id},projectcodec::geometrySha256(shape),false});
    Project unsafeProject;unsafeProject.replace(unsafe);
    try { projectcodec::encodeWeb(unsafeProject.snapshot(),webPorts);assert(false); }
    catch(const std::invalid_argument& error){assert(std::string(error.what())=="UNSUPPORTED_WEB_EXPORT: opaque geometry dependencies");}
    session.documentLoad(seed,"2026-10");
    const auto batchEpoch=session.projectState().epoch;
    const auto batch=session.prepareBatch(2,[&](const ProjectSnapshot& candidate,std::size_t index) {
        CommandArguments action;
        action.action=TerritorialFieldEdit{territorialRef("A"),index?TerritorialField::Notes:TerritorialField::Name,index?"batch notes":"Batch"};
        return CommandRequest{"territorial.field",candidate.instanceId(),candidate.document().documentId,candidate.revision(),{territorialRef("A")},action};
    },batchEpoch);
    assert(batch.candidateId&&session.storageSnapshot()==original);
    assert(session.confirmCandidate(batch.candidateId,batchEpoch).result.changed());
    assert(session.projectState().stateRevision==1&&session.project().document().units.at(0).name=="Batch");
    assert(session.undo(session.projectState().epoch).result.changed());
    assert(session.storageSnapshot()==original&&!session.projectState().canUndo);
    const auto failed=session.prepareBatch(2,[&](const ProjectSnapshot& candidate,std::size_t index) {
        const auto target=territorialRef(index?"missing":"A");CommandArguments action;
        action.action=TerritorialFieldEdit{target,TerritorialField::Name,"Uncommitted"};
        return CommandRequest{"territorial.field",candidate.instanceId(),candidate.document().documentId,candidate.revision(),{target},action};
    },session.projectState().epoch);
    assert(!failed.result.ok()&&!failed.candidateId&&session.storageSnapshot()==original);
    for(const auto& id:{"A","R"}) {
        session.documentLoad(seed,"2026-10");CommandArguments notes;
        notes.action=TerritorialFieldEdit{territorialRef(id),TerritorialField::Notes,"  kept whitespace\r\n  "};
        assert(session.executeCommand("territorial.field",notes,{territorialRef(id)},session.projectState().epoch).result.changed());
        assert(session.project().document().units.at(session.project().index().objects.at(territorialRef(id))).notes=="kept whitespace");
        assert(session.executeCommand("territorial.field",notes,{territorialRef(id)},session.projectState().epoch).result.changed());
        assert(session.projectState().stateRevision==2);
        notes.action=TerritorialFieldEdit{territorialRef(id),TerritorialField::Notes,"kept whitespace"};
        assert(!session.executeCommand("territorial.field",notes,{territorialRef(id)},session.projectState().epoch).result.changed());
    }
    session.documentLoad(seed,"2026-10");CommandArguments emptyName;
    emptyName.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,""};
    assert(session.executeCommand("territorial.field",emptyName,{territorialRef("A")},session.projectState().epoch).result.changed());
    assert(!session.executeCommand("territorial.field",emptyName,{territorialRef("A")},session.projectState().epoch).result.changed());
    auto opaqueFlagSeed=rawFlagSeed;opaqueFlagSeed.object.at("territorialEntities").array.at(0)
        .object.at("properties").object.at("metadata").object["flagDataUrl"]=codecjson::Value::num(42);
    const std::vector<codecjson::Value> flagValues{codecjson::Value::str("  new flag  "),codecjson::Value{},codecjson::Value{}};
    for(std::size_t index=0;index<flagValues.size();++index) {
        session.documentLoad(opaqueFlagSeed.encode(),"2026-10");
        auto payload=codecjson::parse("{\"id\":\"A\",\"field\":\"flagDataUrl\",\"valuePresent\":true,\"value\":null}");
        payload.object["value"]=flagValues.at(index);payload.object["valuePresent"]=codecjson::Value::boolean(index<2);
        auto request=readWebMetadataCommand(session.project().snapshot(),payload,webPorts);
        assert(session.executeCommand(request.commandId,request.args,request.targets,session.projectState().epoch).result.changed());
        request=readWebMetadataCommand(session.project().snapshot(),payload,webPorts);
        assert(!session.executeCommand(request.commandId,request.args,request.targets,session.projectState().epoch).result.changed());
        assert(session.undo(session.projectState().epoch).result.changed());
        assert(codecjson::parse(session.storageSnapshot()).encode()==opaqueFlagSeed.encode());
    }
    session.documentLoad(seed,"2026-10");const auto presentationBefore=session.projectState();
    DocumentSession pulse({[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16});
    auto pulseSeed=codecjson::parse(seed);pulseSeed.object.at("territorialEntities").array.at(0).object.at("properties").object["notes"]=codecjson::Value::str("kept whitespace");
    pulse.documentLoad(pulseSeed.encode(),"2026-10");CommandArguments pulseArgs;pulseArgs.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Notes,"  kept whitespace\r\n  "};
    assert(pulse.executeCommand("territorial.field",pulseArgs,{territorialRef("A")},pulse.projectState().epoch).result.changed());
    assert(pulse.projectState().dirtyTerritorialIds.empty()&&pulse.projectState().stateRevision==1);
    auto viewPreview=PresentationCommandProcessor::prepare(session.project().snapshot(),SetPresentationVisibility{"labels",false});
    assert(viewPreview.preview&&session.storageSnapshot()==original);
    const auto hidden=session.applyPresentation(SetPresentationVisibility{"labels",false},presentationBefore.epoch);
    assert(hidden.result.changed()&&!session.projectState().documentDirty&&session.projectState().presentationDirty);
    assert(session.projectState().checkpoint==presentationBefore.checkpoint&&session.projectState().presentationCheckpoint==1);
    assert(session.projectState().stateRevision==0&&!session.projectState().canUndo);
    assert(!session.applyPresentation(SetPresentationVisibility{"labels",false},session.projectState().epoch).result.changed());
    assert(session.applyPresentation(SetPresentationVisibility{"labels",true},session.projectState().epoch).result.changed());
    assert(session.projectState().presentationCheckpoint==2&&session.projectState().presentationDirty);
    assert(codecjson::parse(session.storageSnapshot()).encode()==codecjson::parse(original).encode());
    assert(session.executeCommand("territorial.field",args,{territorialRef("A")},session.projectState().epoch).result.changed());
    assert(session.projectState().documentDirty&&session.projectState().presentationDirty);
    assert(session.undo(session.projectState().epoch).result.changed());
    assert(!session.projectState().documentDirty&&session.projectState().presentationDirty);
    assert(!session.markSaved(session.projectState().epoch).dirty);
    // Run the independent cursor test after all original document/storage assertions.
    // The cursor's single resolved world is shared with the static projection
    // and the Worker envelope, without changing the document checkpoint.
    {
        DocumentSession cursorSession({[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16});
        const auto initial=cursorSession.documentLoad(seed,"2026-10");
        const auto checkpoint=cursorSession.project().historyCheckpoint();
        ResolvedWorld result;
        assert(cursorSession.setTimelineCursor("2026-09",initial.epoch,&result));
        const auto projected=cursorSession.resolveWorld("2026-09");
        assert(result.month=="2026-09"&&result.month==projected.month);
        assert(result.entities.size()==projected.entities.size());
        for(std::size_t i=0;i<result.entities.size();++i) {
            assert(result.entities[i].objectRef==projected.entities[i].objectRef);
            assert(result.entities[i].geometryRef==projected.entities[i].geometryRef);
            assert(result.entities[i].parentId==projected.entities[i].parentId);
        }
        const auto advanced=cursorSession.projectState();
        assert(advanced.epoch==initial.epoch+1&&advanced.revision==initial.revision);
        assert(cursorSession.project().historyCheckpoint()==checkpoint&&!advanced.dirty&&!advanced.canUndo);
        ResolvedWorld unchanged;
        assert(!cursorSession.setTimelineCursor("2026-09",advanced.epoch,&unchanged));
        assert(unchanged.month=="2026-09"&&unchanged.entities.size()==result.entities.size());
        assert(cursorSession.projectState().epoch==advanced.epoch);
    }
    std::cout<<"DocumentSession: all-domain storage, metadata flags, atomic batch, draft separation, saved checkpoints and Project history passed\n";
}
