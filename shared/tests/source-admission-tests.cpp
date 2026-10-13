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
        auto identity=std::find_if(root.object.at("territorialEntities").array.begin(),root.object.at("territorialEntities").array.end(),[&](const auto& value){return value.object.at("id").string==row.id;});assert(identity!=root.object.at("territorialEntities").array.end());
        auto feature=*identity;feature.object["geometry"]=projectcodec::webGeometryValue(*session.project().document().geometries.get(row.geometryRef));
        auto& p=feature.object.at("properties");p.object["parentId"]=V::str(row.parentId);p.object["coverageMode"]=V::str(row.coverageMode);p.object["validFrom"]=V{};p.object["validTo"]=V{};
        features.array.push_back(std::move(feature));
    }
    DocumentSession preview(ports);const auto initialized=preview.documentInitialize(seed,"2026-10",false,features,{},0);
    assert(!initialized.dirty&&!initialized.canUndo&&!initialized.timelineEditsEnabled&&isStaticTimeline(preview.project().document()));
    auto emptyRoot=codecjson::parse(seed);
    for(const auto* key:{"territorialEntities","geometries","labels","hydroEdits","genericFeatures","distributionLayers","distributionEntries"})emptyRoot.object[key]=V::arr();
    emptyRoot.object["timelineRecords"]=codecjson::parse("{\"schemaVersion\":1,\"lifetimes\":[],\"geometryBindings\":[],\"parentRelations\":[]}");
    emptyRoot.object["labelSettings"]=V::obj();emptyRoot.object["itemVisibility"]=V::obj();emptyRoot.object.at("layerPresentation").object["objectStyles"]=V::obj();
    DocumentSession progressive(ports);progressive.documentLoad(emptyRoot.encode(),"2026-10");
    const auto promoted=progressive.documentInitialize("","2026-10",true,features,{},progressive.projectState().epoch);
    assert(promoted.dirtyTerritorialIds.empty()&&!promoted.dirty&&!promoted.canUndo);
    CommandArguments rename;rename.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Prepared"};
    const auto candidate=preview.prepareCommand("territorial.field",rename,{territorialRef("A")},initialized.epoch);assert(candidate.candidateId);
    assert(!preview.setTimelineCursor(initialized.timelineCursor,initialized.epoch));
    assert(preview.projectState().timelineEditsEnabled&&preview.projectState().epoch>initialized.epoch);
    assert(!preview.confirmCandidate(candidate.candidateId,preview.projectState().epoch).result.ok());
    // Native adoption retains prepared identity/checkpoints and one draft owner.
    auto nativeDocument=projectcodec::decodeWeb(seed,ports);nativeDocument.presentation.userLayers={{"native-layer","Native"}};
    for(const auto& unit:nativeDocument.units)nativeDocument.presentation.membership[territorialRef(unit.id)]="native-layer";
    Project native;native.replace(std::move(nativeDocument));native.setTimelineCursor("2026-10",false);
    const auto instance=native.instanceId();DocumentSession nativeSession(ports,DocumentSessionProfile::Native,{[&](const SelectionRef& ref){return ref==builtin;}});
    nativeSession.adoptPreparedProject(std::move(native));assert(nativeSession.project().instanceId()==instance&&nativeSession.selectionRefExists(builtin));
    Geometry draft;draft.type="Point";draft.points={{1,2}};nativeSession.installNativeDraft(draft,nativeSession.projectState().epoch);
    assert(nativeSession.draftActive()&&nativeSession.draft().geometry().points.at(0).x==1);
    auto create=features.array.at(0);create.object["id"]=V::str("Native-new");create.object.at("properties").object["parentId"]=V::str("");create.object.at("properties").object["coverageMode"]=V::str("explicit");
    auto createPayload=V::obj();createPayload.object["feature"]=create;
    request=readWebTerritorialCommand(nativeSession.project().snapshot(),"territorial.create",createPayload,ports);
    assert(nativeSession.executeCommand(request.commandId,request.args,request.targets,nativeSession.projectState().epoch).result.changed());
    assert(nativeSession.project().document().presentation.membership.at(territorialRef("Native-new"))=="native-layer");
    assert(!projectcodec::encode(nativeSession.project().snapshot(),ports).empty());
    assert(nativeSession.undo(nativeSession.projectState().epoch).result.changed());
    assert(!nativeSession.project().index().objects.count(territorialRef("Native-new")));
    ProjectDocument alphaDocument({Country{"A","A",{{{{0,0},{10,0},{10,10},{0,10},{0,0}}}},0x123456}},{{"countries","Countries"}});
    Geometry point;point.type="Point";point.points={{2,3}};alphaDocument.geometries.insert({"native-label",1},point);
    auto alphaLabel=session.project().document().labels.at(0);alphaLabel.id="Alpha";alphaLabel.geometry={"native-label",1};alphaLabel.territory=territorialRef("A");alphaLabel.source.details="{}";
    alphaDocument.labels.push_back(alphaLabel);Project alpha;alpha.replace(std::move(alphaDocument));
    NativeDocumentPorts nativeSelection{[](const SelectionRef&){return false;}};DocumentSession alphaSession(ports,DocumentSessionProfile::Native,nativeSelection);
    alphaSession.adoptPreparedProject(std::move(alpha));
    auto alphaRow=projectcodec::webContentValue(alphaSession.project().snapshot(),{"label","Alpha"});alphaRow.object["coordinates"]=codecjson::parse("[4,5]");
    CommandArguments alphaArgs;alphaArgs.action=projectcodec::readWebContentEdit(alphaSession.project().snapshot(),{"label","Alpha"},alphaRow,false);
    auto alphaRequest=CommandProcessor::makeRequest(alphaSession.project(),"label.edit",alphaArgs);alphaRequest.targets={{"label","Alpha"}};
    auto alphaPreview=alphaSession.prepareNativeCommand(alphaRequest,alphaSession.projectState().epoch);assert(alphaPreview.preview);
    const auto retained=alphaSession.adoptPreparedCommand(std::move(alphaPreview),alphaSession.projectState().epoch);assert(retained.candidateId);
    assert(alphaSession.confirmCandidate(retained.candidateId,alphaSession.projectState().epoch).result.changed());
    const auto alphaBytes=projectcodec::encode(alphaSession.project().snapshot(),ports);
    assert(projectcodec::decode(alphaBytes,ports).labels.at(0).id=="Alpha");
    assert(alphaSession.undo(alphaSession.projectState().epoch).result.changed());
    assert(alphaSession.project().document().geometries.get(alphaSession.project().document().labels.at(0).geometry)->points.at(0).x==2);
    auto visibleSeed=codecjson::parse(seed);auto& visibility=visibleSeed.object.at("itemVisibility").object.at("countries");
    visibility.object["A"]=V::boolean(true);visibility.object["ghost-true"]=V::boolean(true);visibility.object["ghost-false"]=V::boolean(false);
    DocumentSession visible(ports);visible.documentLoad(visibleSeed.encode(),"2026-10");
    assert(visible.project().document().presentation.webPresentation.itemVisibility.at("countries").at("A"));
    visible.presentationCatalogLoad({},visible.projectState().epoch);
    const auto& admittedVisibility=visible.project().document().presentation.webPresentation.itemVisibility.at("countries");
    assert(admittedVisibility.size()==1&&admittedVisibility.at("A")&&!visible.projectState().dirty);
    assert(visible.applyPresentation(WebControlVisibility{"labels",false},visible.projectState().epoch).result.changed());
    assert(codecjson::parse(visible.documentSnapshot()).object.at("itemVisibility").object.at("countries").object.at("A").raw=="true");
    // Known current platform format difference: native hiddenItems arrays have
    // no explicit-visible presence carrier. Preserve the existing conversion,
    // while the Web runtime/storage retains the true value above exactly.
    const auto visibleNative=projectcodec::decode(projectcodec::encode(visible.project().snapshot(),ports),ports);
    assert(!visibleNative.presentation.webPresentation.itemVisibility.at("countries").count("A"));
    auto padded=alphaSession.project().document();padded.presentation.objectStyles.at(territorialRef("A")).opacity=0.5;
    padded.labels.at(0).id=" Alpha ";DistributionLayer paddedLayer;paddedLayer.id=" Layer ";paddedLayer.name="Layer";
    padded.distributionLayers.push_back(paddedLayer);Project paddedProject;paddedProject.replace(std::move(padded));
    DocumentSession paddedSession(ports,DocumentSessionProfile::Native,nativeSelection);paddedSession.adoptPreparedProject(std::move(paddedProject));
    auto paddedLabel=projectcodec::webContentValue(paddedSession.project().snapshot(),{"label"," Alpha "});paddedLabel.object["name"]=V::str("Raw label name");
    auto paddedPayload=V::obj();paddedPayload.object["id"]=V::str(" Alpha ");paddedPayload.object["value"]=paddedLabel;paddedPayload.object["create"]=V::boolean(false);
    auto paddedRequest=readWebContentCommand(paddedSession.project().snapshot(),"label.edit",paddedPayload,ContentIdentityPolicy::NativeExact);
    const auto paddedResult=paddedSession.executeCommand(paddedRequest.commandId,paddedRequest.args,paddedRequest.targets,paddedSession.projectState().epoch);
    if(!paddedResult.result.changed())std::cerr<<"Native opacity edit: "<<paddedResult.result.detail<<'\n';
    assert(paddedRequest.targets.at(0).id==" Alpha "&&paddedResult.result.changed());
    paddedPayload=codecjson::parse("{\"id\":\" Layer \",\"field\":\"name\",\"value\":\" Changed layer \"}");
    paddedRequest=readWebContentCommand(paddedSession.project().snapshot(),"distribution.layer.metadata",paddedPayload,ContentIdentityPolicy::NativeExact);
    assert(paddedRequest.targets.at(0).id==" Layer "&&paddedSession.executeCommand(paddedRequest.commandId,paddedRequest.args,paddedRequest.targets,paddedSession.projectState().epoch).result.changed());
    const auto paddedWire=projectcodec::decode(projectcodec::encode(paddedSession.project().snapshot(),ports),ports);
    assert(paddedWire.labels.at(0).id==" Alpha "&&paddedWire.labels.at(0).name=="Raw label name"&&paddedWire.distributionLayers.at(0).id==" Layer "&&paddedWire.distributionLayers.at(0).name=="Changed layer");
    assert(paddedSession.undo(paddedSession.projectState().epoch).result.changed()&&paddedSession.project().document().distributionLayers.at(0).name=="Layer");
    visible.selectionCatalogLoad("hydroBuiltin",{{builtin,std::string("physical-source")}},visible.projectState().epoch);
    assert(visible.applyPresentation(WebObjectVisibility{{builtin},false},visible.projectState().epoch).result.changed());
    assert(codecjson::parse(visible.documentSnapshot()).object.at("physicalSettings").object.at("hiddenHydroIds").object.at("physical-source").raw=="true");
    assert(!visible.applyPresentation(WebObjectVisibility{{builtin},false},visible.projectState().epoch).result.changed());
    assert(visible.applyPresentation(WebObjectVisibility{{builtin},true},visible.projectState().epoch).result.changed());
    auto orphan=codecjson::parse(seed);orphan.object.at("labels").array.at(0).object["territorialUnitId"]=V::str("deleted-owner");
    DocumentSession orphanWeb(ports);orphanWeb.documentLoad(orphan.encode(),"2026-10");
    assert(codecjson::parse(orphanWeb.storageSnapshot()).object.at("labels").array.at(0).object.at("territorialUnitId").string=="deleted-owner");
    try{projectcodec::decodeWeb(orphan.encode(),ports);assert(false);}catch(const std::invalid_argument& error){assert(std::string(error.what())=="DANGLING_REF: content territory");}
    try{projectcodec::encode(orphanWeb.project().snapshot(),ports);assert(false);}catch(const std::invalid_argument& error){assert(std::string(error.what())=="DANGLING_REF: content territory");}
    std::cout<<"source admission, immutable replacement, native profile and stale mode checks passed\n";
}
