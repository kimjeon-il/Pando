#include <pandoeditor/webcontentcommands.h>
#include <pandoeditor/document-session.h>
#include <cassert>
#include <iostream>

using namespace pandoeditor;
using V=codecjson::Value;
namespace {
V json(const char* value){return codecjson::parse(value);}
ProjectDocument fixture() {
    ProjectDocument d;d.documentId="web-writer-runtime";
    Geometry line;line.type="LineString";line.lines={{{1.125,2.25},{3.5,4.75}}};
    const GeometryRef ref{"hydro-runtime-H",1};d.geometries.insert(ref,line);
    HydroFeature hydro;hydro.id="H";hydro.name="H";d.hydro.push_back(hydro);addStaticObjectRecords(d,{"hydro",hydro.id},ref);
    // The current default setup is opaque metadata, admitted through its owner.
    const auto beforeSetup=d;
    GeometryProvenanceCodecAccess::admitProjectSetupMetadata(beforeSetup,d);
    return d;
}
CommandResult apply(Project& project,const char* operation,const V& payload) {
    const auto request=readWebContentCommand(project.snapshot(),operation,payload);
    assert(request.commandId==operation&&request.projectInstanceId==project.instanceId());
    assert(request.documentId==project.document().documentId&&request.revision==project.revision());
    auto prepared=CommandProcessor::prepare(project,request);
    if(!prepared.ok()){std::cerr<<operation<<": "<<commandErrorCode(prepared.error)<<" "<<prepared.detail<<'\n';assert(false);}
    if(!prepared.preview)return prepared;
    return CommandProcessor::confirm(project,*prepared.preview);
}
void expectCode(Project& project,const char* operation,const char* payload,const char* code) {
    const auto checkpoint=project.historyCheckpoint(),revision=project.revision();
    try {readWebContentCommand(project.snapshot(),operation,json(payload));assert(false);}
    catch(const TimelineError& error){assert(error.code==code);}
    assert(project.historyCheckpoint()==checkpoint&&project.revision()==revision);
}
void originalWriterTraceKeepsRuntimeIdsAndHistory() {
    // Frozen 9300609 21-row writer trace: G/L/E/H are intentional live-service
    // IDs. Saved-project UUID admission is an independent codec contract.
    Project p;p.replace(fixture());std::vector<std::uint64_t> clocks{p.historyCheckpoint()};
    const auto step=[&](const char* operation,const char* payload,bool changed){
        const auto request=readWebContentCommand(p.snapshot(),operation,json(payload));
        assert(advancesWebStateRevision(request)==(std::string(operation).rfind("generic.",0)==0||
            std::string(operation).rfind("distribution.",0)==0||std::string(operation)=="hydro.metadata"));
        assert(apply(p,operation,json(payload)).changed()==changed);clocks.push_back(p.historyCheckpoint());
    };
    step("generic.create",R"({"feature":{"type":"Feature","id":"G","geometry":{"type":"Point","coordinates":[1.125,2.25]},"properties":{"schemaVersion":2,"name":"G","notes":"","color":"#8c68d8","locked":false,"source":{"kind":"drawn","license":"","details":{}}}}})",true);
    assert(p.document().genericFeatures[0].id=="G");
    assert(p.document().genericFeatures[0].source.kind=="unsupported");
    assert(codecjson::parse(p.document().genericFeatures[0].source.details).object.at("unmappedSourceFields").object.at("license").string.empty());
    step("generic.metadata",R"({"id":"G","field":"name","value":" G "})",false);
    step("generic.metadata",R"({"id":"G","field":"notes","value":"  kept  "})",true);
    assert(p.document().genericFeatures[0].notes=="kept");
    expectCode(p,"generic.metadata",R"({"id":"missing","field":"notes","value":"x"})","not-found");clocks.push_back(p.historyCheckpoint());
    try {readWebContentCommand(p.snapshot(),"generic.metadata",json(R"({"id":"G","field":"unsupported","value":"x"})"));assert(false);}
    catch(const TimelineError& error){assert(error.code=="unsupported-field"&&std::string(error.what()).find("지원하지 않는 필드 unsupported")!=std::string::npos);}clocks.push_back(p.historyCheckpoint());
    step("generic.import",R"({"features":[]})",true);
    step("generic.remove",R"({"id":"G"})",true);
    expectCode(p,"generic.remove",R"({"id":"G"})","not-found");clocks.push_back(p.historyCheckpoint());
    step("distribution.layer.create",R"({"options":{"id":"L","name":"L"}})",true);
    step("distribution.layer.metadata",R"({"id":"L","field":"name","value":" L "})",false);
    step("distribution.entry.create",R"({"options":{"id":"E","layerId":"L","mode":"geometry","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"value":"2.125"}})",true);
    assert(p.document().distributionEntries[0].value==2.125);
    step("distribution.entry.value",R"({"id":"E","value":" 2.125 "})",false);
    step("distribution.entry.value",R"({"id":"E","value":"3.25"})",true);
    step("distribution.import",R"({})",true);
    step("distribution.layer.remove",R"({"id":"L"})",true);
    assert(p.document().distributionLayers.empty()&&p.document().distributionEntries.empty());
    assert(p.undo());clocks.push_back(p.historyCheckpoint());
    assert(p.document().distributionLayers[0].id=="L"&&p.document().distributionEntries[0].id=="E");
    assert(p.redo());clocks.push_back(p.historyCheckpoint());
    step("hydro.metadata",R"({"id":"H","field":"name","value":"H"})",false);
    step("hydro.metadata",R"({"id":"H","field":"name","value":"  raw H  "})",true);
    assert(p.document().hydro[0].name=="  raw H  ");
    step("hydro.edit",R"({"domain":"hydro","id":"H","value":null,"create":false})",true);
    assert(p.document().hydro.empty());
    assert(clocks==(std::vector<std::uint64_t>{0,1,1,2,2,2,3,4,4,5,5,6,6,7,8,9,8,9,9,10,11}));
}
void importsKeepInputOrderAndValidateOneCandidate() {
    Project p;p.replace(fixture());
    const auto payload=json(R"({"layers":[{"schemaVersion":3,"id":"child","parentId":"parent"},{"schemaVersion":3,"id":"parent"}],"entries":[{"schemaVersion":3,"id":"entry","layerId":"child","mode":"geometry","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"value":"0x10"}]})");
    auto request=readWebContentCommand(p.snapshot(),"distribution.import",payload);
    const auto& batch=std::get<ContentBatchEdit>(request.args.action);
    assert(batch.edits.size()==3&&batch.edits[0].target.id=="child"&&batch.edits[1].target.id=="parent"&&batch.edits[2].target.id=="entry");
    assert(apply(p,"distribution.import",payload).changed());
    assert(p.document().distributionLayers[0].id=="child"&&p.document().distributionLayers[1].id=="parent");
    assert(p.document().distributionLayers[0].parentId==std::optional<std::string>{"parent"});
    assert(p.document().distributionEntries[0].value==16);
    assert(p.undo()&&p.document().distributionLayers.empty()&&p.document().distributionEntries.empty());
    assert(p.redo()&&p.document().distributionEntries[0].value==16);
    const auto checkpoint=p.historyCheckpoint(),revision=p.revision();
    const auto invalid=json(R"({"layers":[{"schemaVersion":3,"id":"unowned","parentId":"missing"}],"entries":[]})");
    const auto rejected=CommandProcessor::prepare(p,readWebContentCommand(p.snapshot(),"distribution.import",invalid));
    assert(!rejected.ok()&&p.historyCheckpoint()==checkpoint&&p.revision()==revision&&p.document().distributionLayers.size()==2);
    try {readWebContentCommand(p.snapshot(),"distribution.import",payload);assert(false);}catch(const std::invalid_argument&){}
}
void defaultsMetadataAndFailureCodes() {
    Project p;p.replace(fixture());
    apply(p,"distribution.layer.create",json(R"({"options":{"id":"L","name":" ","groups":[" b ","a","b","",12],"validFrom":" 2026-01 ","valueScale":{"mode":"manual","min":"0b10","max":"0o10"},"metadata":{"raw":1.2300}}})"));
    const auto& layer=p.document().distributionLayers[0];
    assert(layer.name=="L"&&layer.groups==(std::vector<std::string>{"b","a","12"}));
    assert(layer.valueScale.manual&&layer.valueScale.min==2&&layer.valueScale.max==8);
    assert(layer.validity.from==std::optional<std::string>{"2026-01"});
    assert(codecjson::parse(layer.metadata).object.at("raw").raw=="1.2300");
    apply(p,"distribution.entry.create",json(R"({"options":{"id":"numeric","layerId":"L","mode":"geometry","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"value":" +.125e1 "}})"));
    assert(p.document().distributionEntries[0].value==1.25);
    apply(p,"distribution.entry.value",json(R"({"id":"numeric","value":"1e-9999"})"));
    assert(p.document().distributionEntries[0].value==0);
    expectCode(p,"distribution.entry.value",R"({"id":"numeric","value":"1e9999"})","invalid");
    expectCode(p,"distribution.entry.value",R"({"id":"numeric","value":true})","invalid");
    expectCode(p,"distribution.entry.create",R"({"options":{"id":"E","layerId":"missing"}})","layer-not-found");
    expectCode(p,"distribution.entry.create",R"({"options":{"id":"E","layerId":"L","mode":"territorial","territorialUnitId":"missing","value":1}})","territorial-unit-not-found");
    expectCode(p,"distribution.entry.create",R"({"options":{"id":"E","layerId":"L","mode":"geometry","geometry":{},"value":1}})","invalid");
    expectCode(p,"distribution.entry.value",R"({"id":"missing","value":1})","not-found");
    expectCode(p,"distribution.layer.metadata",R"({"id":"L","field":"valueScale","value":{"mode":"manual","min":5,"max":3}})","invalid");
    expectCode(p,"distribution.layer.metadata",R"({"id":"L","field":"valueScale","value":{"mode":" auto "}})","invalid");
    expectCode(p,"distribution.layer.metadata",R"({"id":"L","field":"valueScale","value":{"mode":["auto"]}})","invalid");
    apply(p,"distribution.layer.metadata",json(R"({"id":"L","field":"locked","value":true})"));
    expectCode(p,"distribution.layer.metadata",R"({"id":"L","field":"name","value":"x"})","locked");
    expectCode(p,"distribution.layer.remove",R"({"id":"L"})","locked");
    expectCode(p,"distribution.entry.create",R"({"options":{"id":"E","layerId":"L"}})","locked");
    apply(p,"distribution.layer.metadata",json(R"({"id":"L","field":"locked","value":false})"));
    apply(p,"generic.create",json(R"({"feature":{"type":"Feature","id":"other","geometry":{"type":"Point","coordinates":[9,10]},"properties":{"schemaVersion":2,"name":["x",null,2],"notes":true,"source":{"dataset":"  dataset  ","details":{"opaque":1.2500},"license":"CC0"}}}})"));
    const auto geometry=p.document().genericFeatures[0].geometry;
    assert(p.document().genericFeatures[0].name=="x,,2"&&p.document().genericFeatures[0].notes=="true");
    assert(p.document().genericFeatures[0].source.dataset=="dataset");
    apply(p,"generic.metadata",json(R"({"id":"other","field":"notes","value":"updated"})"));
    assert(p.document().genericFeatures[0].geometry==geometry);
    assert(codecjson::parse(p.document().genericFeatures[0].source.details).object.at("opaque").raw=="1.2500");
    apply(p,"generic.create",json(R"({"feature":{"type":"Feature","id":" padded ","geometry":{"type":"Point","coordinates":[11,12]},"properties":{"schemaVersion":2}}})"));
    assert(p.document().genericFeatures[1].id==" padded ");
    apply(p,"generic.metadata",json(R"({"id":"padded","field":"name","value":"kept ID"})"));
    assert(p.document().genericFeatures[1].id==" padded "&&p.document().genericFeatures[1].name=="kept ID");
    try {readWebContentCommand(p.snapshot(),"generic.create",json(R"({"feature":{"type":"Feature","id":"padded","geometry":{"type":"Point","coordinates":[11,12]},"properties":{"schemaVersion":2}}})"));assert(false);}
    catch(const std::invalid_argument&){}
}
void currentRawHydroAndLabelAnnotationsKeepPresence() {
    Project p;p.replace(fixture());
    const auto river=json(R"({"type":"Feature","id":"new-river","geometry":{"type":"LineString","coordinates":[[3,4],[5,6]]},"properties":{"category":"lake","name":"  raw river  ","notes":42,"editorColor":"invalid","visible":false,"color":"#ABCDEF","unknown":{"sourceRef":"kept"}}})");
    auto command=V::obj();command.object["domain"]=V::str("hydro");command.object["id"]=V::str("new-river");
    command.object["value"]=river;command.object["create"]=V::boolean(true);
    apply(p,"hydro.edit",command);
    auto expected=river;auto& props=expected.object["properties"];props.object.erase("visible");
    props.object["category"]=V::str("river");props.object["notes"]=V::str("42");props.object["editorColor"]=V::str("#3b82c4");
    props.object["pandolab_domain"]=V::str("hydro");props.object["pandolab_schema_version"]=V::num(1);props.object["pandolab_id"]=V::str("new-river");
    const auto row=projectcodec::webContentValue(p.snapshot(),{"hydro","new-river"});assert(row.encode()==expected.encode());
    assert(!row.object.at("properties").object.count("source")&&!row.object.at("properties").object.count("locked"));
    assert(p.undo()&&p.redo());assert(projectcodec::webContentValue(p.snapshot(),{"hydro","new-river"}).encode()==expected.encode());
    const auto label=json(R"({"id":"label-with-metadata","name":"converted label","kind":"custom","coordinates":[9,10],"notes":"kept","metadata":{"compatibilitySource":{"geometryRef":{"id":"source","version":1},"color":"#ABCDEF","extra":[1,null]}}})");
    command.object["domain"]=V::str("label");command.object["id"]=V::str("label-with-metadata");command.object["value"]=label;
    apply(p,"label.edit",command);assert(projectcodec::webContentValue(p.snapshot(),{"label","label-with-metadata"}).encode()==label.encode());
    assert(p.document().labels.back().metadata&&p.document().presentation.webPresentation.labelSettings.count({"label","label-with-metadata"}));
    assert(p.undo()&&p.redo());assert(projectcodec::webContentValue(p.snapshot(),{"label","label-with-metadata"}).encode()==label.encode());
}
}
int main() {
    originalWriterTraceKeepsRuntimeIdsAndHistory();
    importsKeepInputOrderAndValidateOneCandidate();
    defaultsMetadataAndFailureCodes();
    currentRawHydroAndLabelAnnotationsKeepPresence();
    std::cout<<"Web content commands: literal runtime IDs, 21 history checkpoints, constructor defaults, atomic ordered imports and domain failures passed\n";
}
