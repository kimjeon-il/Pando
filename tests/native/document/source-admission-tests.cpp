#include "territorial-document-fixture.h"
#include <pandoeditor/document-session.h>
#include <pandoeditor/webcontentcommands.h>
#include <pandoeditor/webterritorialcommands.h>
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
using namespace pandoeditor;
using V=codecjson::Value;
int main() {
    std::ifstream file(SOURCE_ADMISSION_FIXTURE,std::ios::binary);assert(file);
    const std::string seed{std::istreambuf_iterator<char>(file),std::istreambuf_iterator<char>()};
    const projectcodec::PlatformPorts ports{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
    DocumentSession session(ports);session.documentLoad(seed,"2026-10");
    const auto generic=session.project().document().genericFeatures.at(0).id;
    auto payload=codecjson::parse("{\"field\":\"name\",\"value\":\"Changed generic\"}");payload.object["id"]=V::str(generic);
    auto request=readWebContentCommand(session.project().snapshot(),"generic.metadata",payload);
    assert(session.executeCommand(request.commandId,request.args,request.targets,session.projectState().epoch).result.changed());
    assert(session.applyPresentation(WebControlVisibility{"labels",false},session.projectState().epoch).result.changed());
    const SelectionRef selection{"generic","polygon",generic},builtin{"hydroBuiltin","river","external"};
    session.selectionCatalogLoad("hydroBuiltin",{{builtin,std::string("external-logical")}},session.projectState().epoch);session.selection().replace(selection,"scope");session.selection().setHover(builtin,"map");
    session.startDraft("line",{{1,2},{3,4}},"refine");session.draft().append({5,6});
    const auto captured=session.projectState();const auto original=session.documentSnapshot();
    const auto replacement=session.captureReplacement(captured.epoch);
    session.documentLoad(seed,"2026-10");assert(!session.projectState().canUndo);
    const auto restored=session.rollbackReplacement(replacement,session.projectState().epoch);
    assert(restored.epoch>captured.epoch&&restored.stateRevision==captured.stateRevision);
    assert(restored.documentDirty&&restored.presentationDirty&&restored.canUndo);
    assert(session.documentSnapshot()==original&&session.selection().primary()==std::optional<SelectionRef>{selection});
    assert(session.selection().hover()==std::optional<SelectionRef>{builtin}&&session.draftActive()&&session.draft().coordinates().size()==3);
    assert(!session.releaseReplacement(replacement));
    auto baseline=codecjson::parse(seed);baseline.object.at("territorialEntities").array.at(0).object.at("properties").object["name"]=V::str("Baseline name");
    const auto oldHeader=session.project().document().exchangeMetadata;
    const auto admitted=session.documentInitialize(seed,"2026-10",true,{},baseline.encode(),restored.epoch);
    assert(admitted.documentDirty&&admitted.presentationDirty&&admitted.checkpoint==captured.checkpoint);
    assert(admitted.presentationCheckpoint==captured.presentationCheckpoint&&admitted.stateRevision==captured.stateRevision);
    assert(session.project().document().units.at(0).name=="Baseline name"&&session.project().document().genericFeatures.at(0).name=="Changed generic");
    assert(session.project().document().exchangeMetadata==oldHeader&&!groupVisible(session.project().document().presentation.webPresentation,"labels"));
    assert(session.undo(admitted.epoch).result.changed());
    assert(session.project().document().units.at(0).name=="Baseline name"&&!session.projectState().documentDirty&&session.projectState().presentationDirty);
    assert(session.redo(session.projectState().epoch).result.changed()&&session.project().document().genericFeatures.at(0).name=="Changed generic");
    // Initial static preview uses the same typed territorial reader/allocator.
    auto features=V::arr();const auto root=codecjson::parse(seed);const auto world=session.resolveWorld(session.projectState().timelineCursor);
    for(const auto& row:world.entities) {
        if(row.objectRef.domain!="territorial")continue;
        auto identity=std::find_if(root.object.at("territorialEntities").array.begin(),root.object.at("territorialEntities").array.end(),[&](const auto& value){return value.object.at("id").string==row.objectRef.id;});assert(identity!=root.object.at("territorialEntities").array.end());
        auto feature=*identity;feature.object["geometry"]=projectcodec::webGeometryValue(*session.project().document().geometries.get(row.geometryRef));
        auto& p=feature.object.at("properties");p.object["parentId"]=V::str(row.parentId);p.object["coverageMode"]=V::str(row.coverageMode);p.object["validFrom"]=V{};p.object["validTo"]=V{};
        features.array.push_back(std::move(feature));
    }
    assert(features.array.size()==root.object.at("territorialEntities").array.size());
    DocumentSession preview(ports);const auto initialized=preview.documentInitialize(seed,"2026-10",false,features,{},0);
    assert(!initialized.dirty&&!initialized.canUndo&&!initialized.timelineEditsEnabled&&isStaticTimeline(preview.project().document()));
    auto emptyRoot=codecjson::parse(seed);
    for(const auto* key:{"territorialEntities","geometries","labels","hydroEdits","genericFeatures","distributionLayers","distributionEntries"})emptyRoot.object[key]=V::arr();
    emptyRoot.object["timelineRecords"]=codecjson::parse("{\"schemaVersion\":3,\"lifetimes\":[],\"geometryBindings\":[],\"parentRelations\":[],\"propertyBindings\":[]}");
    emptyRoot.object["labelSettings"]=V::obj();emptyRoot.object.at("distributionSettings").object["activeLayerId"]=V::str("");emptyRoot.object.at("layerPresentation").object["objectStyles"]=V::obj();emptyRoot.object.at("layerPresentation").object["objectOrder"]=V::arr();
    DocumentSession progressive(ports);progressive.documentLoad(emptyRoot.encode(),"2026-10");
    const auto promoted=progressive.documentInitialize("","2026-10",true,features,{},progressive.projectState().epoch);
    assert(promoted.dirtyTerritorialIds.empty()&&!promoted.dirty&&!promoted.canUndo);
    CommandArguments rename;rename.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Prepared"};
    const auto candidate=preview.prepareCommand("territorial.field",rename,{territorialRef("A")},initialized.epoch);assert(candidate.candidateId);
    assert(!preview.setTimelineCursor(initialized.timelineCursor,initialized.epoch));
    assert(preview.projectState().timelineEditsEnabled&&preview.projectState().epoch>initialized.epoch);
    assert(!preview.confirmCandidate(candidate.candidateId,preview.projectState().epoch).result.ok());
    // Detached Web adoption keeps one canonical Project and retains its identity.
    auto adoptedDocument=projectcodec::decodeWeb(seed,ports);
    Project adoptedProject;adoptedProject.replace(std::move(adoptedDocument));adoptedProject.setTimelineCursor("2026-10",false);
    const auto adoptedInstance=adoptedProject.instanceId();
    DocumentSession adoptedSession(ports);adoptedSession.adoptPreparedProject(std::move(adoptedProject));
    assert(adoptedSession.project().instanceId()==adoptedInstance);
    auto incoming=features.array.at(0);incoming.object["id"]=V::str("Adopted-new");
    incoming.object.at("properties").object["parentId"]=V::str("");
    incoming.object.at("properties").object["coverageMode"]=V::str("explicit");
    auto adoptedPayload=V::obj();adoptedPayload.object["feature"]=incoming;
    request=readWebTerritorialCommand(adoptedSession.project().snapshot(),"territorial.create",adoptedPayload,ports);
    assert(adoptedSession.executeCommand(request.commandId,request.args,request.targets,adoptedSession.projectState().epoch).result.changed());
    assert(adoptedSession.project().index().objects.count(territorialRef("Adopted-new")));
    assert(adoptedSession.undo(adoptedSession.projectState().epoch).result.changed());
    assert(!adoptedSession.project().index().objects.count(territorialRef("Adopted-new")));
    DocumentSession visible(ports);visible.documentLoad(seed,"2026-10");
    PresentationCatalog physicalCatalog;physicalCatalog.hydroLayers={{"physical-source","river"}};
    visible.presentationCatalogLoad(std::move(physicalCatalog),visible.projectState().epoch);
    visible.selectionCatalogLoad("hydroBuiltin",{{builtin,std::string("physical-source")}},visible.projectState().epoch);
    assert(visible.applyPresentation(WebObjectVisibility{{builtin},false},visible.projectState().epoch).result.changed());
    assert(!codecjson::parse(visible.storageSnapshot()).object.count("itemVisibility"));
    assert(!visible.applyPresentation(WebObjectVisibility{{builtin},false},visible.projectState().epoch).result.changed());
    assert(visible.applyPresentation(WebObjectVisibility{{builtin},true},visible.projectState().epoch).result.changed());
    auto orphan=codecjson::parse(seed);orphan.object.at("labels").array.at(0).object["territorialUnitId"]=V::str("deleted-owner");
    DocumentSession orphanWeb(ports);orphanWeb.documentLoad(orphan.encode(),"2026-10");
    assert(codecjson::parse(orphanWeb.storageSnapshot()).object.at("labels").array.at(0).object.at("territorialUnitId").string=="deleted-owner");
    std::cout<<"source admission, immutable replacement and stale mode checks passed\n";
}
