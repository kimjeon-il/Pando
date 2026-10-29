#include <pandoeditor/webterritorialcommands.h>
#include <pandoeditor/projectcodec.h>
#include <cassert>
#include <iostream>

using namespace pandoeditor;
using V=codecjson::Value;
namespace {
const projectcodec::PlatformPorts ports{[](const std::string& value){if(value.empty())throw TimelineError("invalid-flag","Empty media.");},true,codecjson::ParsedTextPolicy::PreserveUtf16};
V json(const char* bytes){return codecjson::parse(bytes);}
const char* shape=R"({"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]})";
V feature(const std::string& id,const std::string& parent="",const std::string& kind="general") {
    auto row=json(R"({"type":"Feature","id":"","geometry":null,"properties":{"schemaVersion":6,"entityKind":"general","name":"","notes":"","parentId":"","coverageMode":"explicit","style":{},"locked":false,"metadata":{},"sourceFolderId":"","sourceEntityId":"","sourceGeometryVersion":"","validFrom":null,"validTo":null}})");
    row.object["id"]=V::str(id);row.object["geometry"]=json(shape);
    auto& p=row.object.at("properties");p.object["entityKind"]=V::str(kind);p.object["parentId"]=V::str(parent);
    p.object["coverageMode"]=V::str(parent.empty()?"explicit":"partition");return row;
}
V payload(const char* key,V value){auto result=V::obj();result.object[key]=std::move(value);return result;}
ProjectDocument fixture(bool collision=false) {
    ProjectDocument d;d.documentId="web-territorial-runtime";
    TerritorialUnit unit;unit.id="A";unit.name="A";unit.kind=UnitKind::General;d.units.push_back(unit);
    const GeometryRef ref{"territorial-geometry:A",1};d.geometries.insert(ref,projectcodec::readWebGeometry(json(shape)));
    d.geometryProvenance.originalArchive.insert(ref);addStaticTerritorialRecords(d,"A",ref);
    d.presentation.objectStyles[territorialRef("A")]={0,1,false};
    if(collision) {
        const GeometryRef archived{"territorial-geometry:N",7};d.geometries.insert(archived,projectcodec::readWebGeometry(json(shape)));
        d.geometryProvenance.originalArchive.insert(archived);
        d.timelineRecords.lifetimes[0].id="lifetime:N";d.timelineRecords.geometryBindings[0].id="geometry:N";d.timelineRecords.parentRelations[0].id="parent:N";
    }
    return d;
}
CommandResult apply(Project& p,const char* operation,const V& input) {
    const auto request=readWebTerritorialCommand(p.snapshot(),operation,input,ports);
    assert(request.commandId==operation&&request.projectInstanceId==p.instanceId()&&request.revision==p.revision());
    auto prepared=CommandProcessor::prepare(p,request);
    if(!prepared.ok()){std::cerr<<operation<<": "<<commandErrorCode(prepared.error)<<" "<<prepared.detail<<'\n';assert(false);}
    return prepared.preview?CommandProcessor::confirm(p,*prepared.preview):CommandResult(prepared);
}
V records(const Project& p) {return codecjson::parse(projectcodec::encodeWeb(p.snapshot(),ports)).object.at("timelineRecords");}
const TimelineGeometryBinding& binding(const Project& p,const std::string& id) {
    for(const auto& row:p.document().timelineRecords.geometryBindings)if(row.objectRef.id==id&&(!row.validity.to||*row.validity.to!="2026-09"))return row;
    assert(false);return p.document().timelineRecords.geometryBindings[0];
}
void expectCode(Project& p,const char* operation,const V& input,const char* code) {
    const auto checkpoint=p.historyCheckpoint(),revision=p.revision();
    try {readWebTerritorialCommand(p.snapshot(),operation,input,ports);assert(false);}
    catch(const TimelineError& error){assert(error.code==code);}
    assert(p.historyCheckpoint()==checkpoint&&p.revision()==revision);
}
void resolvedFeatureReaderKeepsCurrentIdentityAndMetadataOwner() {
    Project p;p.replace(fixture());p.setTimelineCursor("2026-10",false);
    auto row=feature(" N ");auto& values=row.object.at("properties");
    values.object["schemaVersion"]=V::str("6");values.object["entityKind"]=V::str(" GENERAL ");values.object["name"]=V::str(" ");
    values.object["notes"]=V::str(" note ");values.object["locked"]=V::boolean(true);
    values.object["sourceFolderId"]=V::str(" folder ");values.object["sourceEntityId"]=V::str(" src ");values.object["sourceGeometryVersion"]=V::str(" v7 ");
    values.object["style"]=json(R"({"color":" #123456 "})");
    values.object["metadata"]=json(R"({"tag":1.2500,"capital":"  Capital  ","flagDataUrl":null})");
    const auto request=readWebTerritorialCommand(p.snapshot(),"territorial.create",payload("feature",row),ports);
    const auto& action=std::get<WebTerritorialEdit>(request.args.action);assert(action.operation==WebTerritorialOperation::Create&&action.features.size()==1);
    const auto& value=action.features[0];assert(value.identity.id=="N"&&value.identity.kind==UnitKind::General&&value.identity.name.empty());
    assert(value.identity.notes=="note"&&value.identity.locked&&value.identity.sourceFolderId=="folder"&&value.identity.sourceEntityId=="src"&&value.identity.sourceGeometryVersion=="v7");
    assert(value.parentId.empty()&&value.coverageMode=="explicit"&&!value.validity.from&&!value.validity.to);
    assert(value.style.explicitColor&&value.style.color==0x123456);
    assert(value.countryDetails&&value.countryDetails->capital=="  Capital  "&&value.symbol&&value.symbol->policy==FlagPolicy::None);
    const auto metadata=codecjson::parse(value.identity.metadata);
    assert(metadata.object.at("tag").raw=="1.2500"&&!metadata.object.count("capital")&&!metadata.object.count("flagDataUrl"));
    assert(request.targets==(std::vector<ObjectRef>{territorialRef("N")}));
    auto invalid=row;invalid.object.at("properties").object.erase("coverageMode");expectCode(p,"territorial.create",payload("feature",invalid),"CORE_COMMAND_PAYLOAD");
    invalid=row;invalid.object.at("properties").object["schemaVersion"]=V::num(5);expectCode(p,"territorial.create",payload("feature",invalid),"CORE_COMMAND_PAYLOAD");
    invalid=row;invalid.object.at("properties").object["metadata"]=json("[1]");expectCode(p,"territorial.create",payload("feature",invalid),"CORE_COMMAND_PAYLOAD");
    expectCode(p,"territorial.geometry",json(R"({"id":"A","geometry":{"type":"Point","coordinates":[0,0]}})"),"CORE_COMMAND_PAYLOAD");
}
void frozenStaticAndMonthCollisionGoldens() {
    // Preserve the admitted allocation behavior in the current v2 record format,
    // including blank-name creation, archived v7 and colliding record IDs.
    const auto staticGolden=json(R"({"schemaVersion":3,"lifetimes":[{"id":"lifetime:N","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null},{"id":"lifetime:N:1","objectRef":{"domain":"territorial","id":"N"},"validFrom":null,"validTo":null}],"geometryBindings":[{"id":"geometry:N","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null,"geometryRef":{"id":"territorial-geometry:A","version":1}},{"id":"geometry:N:1","objectRef":{"domain":"territorial","id":"N"},"validFrom":null,"validTo":null,"geometryRef":{"id":"territorial-geometry:N","version":8}}],"parentRelations":[{"id":"parent:N","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null,"parentId":"","coverageMode":"explicit"},{"id":"parent:N:1","objectRef":{"domain":"territorial","id":"N"},"validFrom":null,"validTo":null,"parentId":"","coverageMode":"explicit"}],"propertyBindings":[]})");
    const auto monthGolden=json(R"({"schemaVersion":3,"lifetimes":[{"id":"lifetime:N","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null},{"id":"lifetime:N:1","objectRef":{"domain":"territorial","id":"N"},"validFrom":"2026-10","validTo":null}],"geometryBindings":[{"id":"geometry:N","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null,"geometryRef":{"id":"territorial-geometry:A","version":1}},{"id":"geometry:N:1","objectRef":{"domain":"territorial","id":"N"},"validFrom":"2026-10","validTo":null,"geometryRef":{"id":"territorial-geometry:N:1","version":1}}],"parentRelations":[{"id":"parent:N","objectRef":{"domain":"territorial","id":"A"},"validFrom":null,"validTo":null,"parentId":"","coverageMode":"explicit"},{"id":"parent:N:1","objectRef":{"domain":"territorial","id":"N"},"validFrom":"2026-10","validTo":null,"parentId":"","coverageMode":"explicit"}],"propertyBindings":[]})");
    for(bool month:{false,true}) {
        Project p;p.replace(fixture(true));p.setTimelineCursor("2026-10",false);const auto original=p.snapshot();
        assert(!original.timelineEditsEnabled());if(month)p.setTimelineCursor("2026-10");
        assert(p.snapshot().timelineEditsEnabled()==month&&!original.timelineEditsEnabled());
        auto row=feature(" N ");auto& values=row.object.at("properties");values.object["locked"]=V::boolean(true);values.object["notes"]=V::str(" note ");
        values.object["metadata"]=json(R"({"tag":1})");values.object["sourceFolderId"]=V::str(" folder ");values.object["sourceEntityId"]=V::str(" src ");values.object["sourceGeometryVersion"]=V::str(" v7 ");
        assert(apply(p,"territorial.create",payload("feature",row)).changed());
        assert(records(p).encode()==(month?monthGolden:staticGolden).encode());
        assert(p.document().units.size()==2&&p.document().units[1].id=="N"&&p.document().units[1].name.empty()&&p.document().units[1].notes=="note");
        assert(p.document().geometries.versions().size()==3&&p.document().geometries.get({"territorial-geometry:N",7}));
        const auto created=binding(p,"N").geometryRef;
        assert(created==(month?GeometryRef{"territorial-geometry:N:1",1}:GeometryRef{"territorial-geometry:N",8}));
        assert(p.undo()&&p.document().units.size()==1&&p.document().geometries.versions().size()==2);
        assert(p.redo()&&binding(p,"N").geometryRef==created&&records(p).encode()==(month?monthGolden:staticGolden).encode());
    }
}
void boundedParentClipsCurrentMonthChildLifetime() {
    auto d=fixture();const Validity bounded{std::string("2026-10-01"),std::string("2026-10-31")};
    d.timelineRecords.lifetimes[0].validity=bounded;
    d.timelineRecords.geometryBindings[0].validity=bounded;
    d.timelineRecords.parentRelations[0].validity=bounded;
    Project p;p.replace(d);p.setTimelineCursor("2026-10",false);p.setTimelineCursor("2026-10");
    assert(apply(p,"territorial.create",payload("feature",feature("B","A"))).changed());
    const auto& timeline=p.document().timelineRecords;
    const auto clipped=Validity{std::string("2026-10"),std::string("2026-10-31")};
    assert(timeline.lifetimes.back().objectRef.id=="B"&&timeline.lifetimes.back().validity.from==clipped.from&&timeline.lifetimes.back().validity.to==clipped.to);
    assert(timeline.geometryBindings.back().objectRef.id=="B"&&timeline.geometryBindings.back().validity.from==clipped.from&&timeline.geometryBindings.back().validity.to==clipped.to);
    assert(timeline.parentRelations.back().objectRef.id=="B"&&timeline.parentRelations.back().validity.from==clipped.from&&timeline.parentRelations.back().validity.to==clipped.to);
    assert(p.resolveWorld("2026-10").find(territorialRef("B"))&&!p.resolveWorld("2026-11").find(territorialRef("B")));
    assert(p.undo()&&!p.resolveWorld("2026-10").find(territorialRef("B")));
    assert(p.redo()&&p.resolveWorld("2026-10").find(territorialRef("B"))&&!p.resolveWorld("2026-11").find(territorialRef("B")));
}
void patchOrderReplacementAndExactRemovalAreAtomic() {
    Project p;p.replace(fixture());p.setTimelineCursor("2026-10",false);
    auto incoming=V::arr();incoming.array={feature("C","D"),feature("D"),feature("A")};
    incoming.array[2].object.at("properties").object["notes"]=V::str(" replacement ");
    assert(apply(p,"territorial.patch",payload("features",incoming)).changed());
    assert(p.document().units.size()==3&&p.document().units[0].id=="A"&&p.document().units[1].id=="C"&&p.document().units[2].id=="D");
    assert(p.document().units[0].notes=="replacement"&&staticParentRelation(p.document(),"C").parentId=="D");
    auto reordered=V::arr();reordered.array={feature("D"),feature("C","D"),feature("A")};
    assert(apply(p,"territorial.replace",payload("features",reordered)).changed());
    assert(p.document().units[0].id=="D"&&p.document().units[1].id=="C"&&p.document().units[2].id=="A");
    const auto checkpoint=p.historyCheckpoint(),revision=p.revision(),count=p.document().geometries.versions().size();const auto before=records(p).encode();
    auto invalid=V::arr();invalid.array={feature("E","missing")};
    auto rejected=CommandProcessor::prepare(p,readWebTerritorialCommand(p.snapshot(),"territorial.patch",payload("features",invalid),ports));
    assert(!rejected.ok()&&p.historyCheckpoint()==checkpoint&&p.revision()==revision&&p.document().geometries.versions().size()==count&&records(p).encode()==before);
    // Removing a parent alone must fail, leaving its child present. No native
    // subtree cascade or reference rewrite is silently introduced by the DTO.
    rejected=CommandProcessor::prepare(p,readWebTerritorialCommand(p.snapshot(),"territorial.remove",json(R"({"ids":["D"]})"),ports));
    assert(!rejected.ok()&&p.document().units.size()==3&&p.historyCheckpoint()==checkpoint);
    assert(!apply(p,"territorial.remove",json(R"({"ids":["missing","", "missing"]})")).changed());
    assert(p.historyCheckpoint()==checkpoint);
    expectCode(p,"territorial.patch",json(R"({"features":[{"id":"A","geometry":{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]},"properties":{"schemaVersion":6,"entityKind":"general","coverageMode":"explicit"}}],"removedIds":["A"]})"),"CORE_COMMAND_PAYLOAD");
    assert(apply(p,"territorial.remove",json(R"({"ids":["C","D"]})")).changed());
    assert(p.document().units.size()==1&&p.document().units[0].id=="A"&&p.document().geometries.versions().size()==count);
    assert(p.undo()&&p.document().units.size()==3);
}
void parentAndCopyUseFrozenServiceAdmission() {
    auto d=fixture();d.units[0].locked=true;d.units[0].notes="source notes";d.units[0].metadata=R"({"opaque":"source"})";
    d.units[0].sourceEntityId="source-id";Project p;p.replace(d);p.setTimelineCursor("2026-10",false);
    const auto copy=json(R"({"sourceId":" A ","id":" R ","name":" ","color":" #123456 "})");
    const auto request=readWebTerritorialCommand(p.snapshot(),"territorial.copy-region",copy,ports);
    assert(request.targets==(std::vector<ObjectRef>{territorialRef("A"),territorialRef("R")}));
    assert(advancesWebStateRevision(request));assert(apply(p,"territorial.copy-region",copy).changed());
    const auto& region=p.document().units[1];assert(region.id=="R"&&region.kind==UnitKind::Regional&&region.name.empty()&&!region.locked&&region.notes.empty()&&region.metadata=="{}"&&region.sourceEntityId.empty());
    assert(staticParentRelation(p.document(),"R").parentId.empty()&&staticParentRelation(p.document(),"R").coverageMode=="explicit");
    assert(p.document().presentation.objectStyles.at(territorialRef("R")).color==0x123456);
    assert(apply(p,"territorial.copy-region",json(R"({"sourceId":"A","id":"automatic"})")).changed());
    assert(!p.document().presentation.objectStyles.at(territorialRef("automatic")).explicitColor);
    expectCode(p,"territorial.parent",json(R"({"id":"A","parentId":""})"),"locked");
    expectCode(p,"territorial.parent",json(R"({"id":"R","parentId":"A"})"),"unsupported-parent-type");
    expectCode(p,"territorial.parent",json(R"({"id":"missing","parentId":"A"})"),"not-found");
    expectCode(p,"territorial.copy-region",json(R"({"sourceId":"R","id":"other"})"),"invalid-source");
    Project q;q.replace(fixture());q.setTimelineCursor("2026-10",false);
    auto rows=V::arr();rows.array={feature("B","A"),feature("D")};apply(q,"territorial.patch",payload("features",rows));
    assert(!apply(q,"territorial.parent",json(R"({"id":"B","parentId":"A"})")).changed());
    assert(apply(q,"territorial.parent",json(R"({"id":"B","parentId":"D"})")).changed());
    assert(staticParentRelation(q.document(),"B").coverageMode=="partition");
    assert(apply(q,"territorial.parent",json(R"({"id":"B","parentId":""})")).changed());
    assert(staticParentRelation(q.document(),"B").parentId.empty()&&staticParentRelation(q.document(),"B").coverageMode=="explicit");
    auto protectedRows=V::arr();protectedRows.array={feature("B","A"),feature("locked-child","B")};
    protectedRows.array[1].object.at("properties").object["locked"]=V::boolean(true);
    apply(q,"territorial.patch",payload("features",protectedRows));
    const auto checkpoint=q.historyCheckpoint();
    try {applyWebTerritorialEdit(q.snapshot(),std::get<WebTerritorialEdit>(readWebTerritorialCommand(q.snapshot(),"territorial.parent",json(R"({"id":"B","parentId":"D"})"),ports).args.action));assert(false);}
    catch(const TimelineError& error){assert(error.code=="invalid-parent");}
    assert(q.historyCheckpoint()==checkpoint&&staticParentRelation(q.document(),"B").parentId=="A");
}
void geometryVersionUsesArchivedHighWaterAndMonthSplit() {
    for(bool month:{false,true}) {
        auto d=fixture();d.geometries.insert({"territorial-geometry:A",7},projectcodec::readWebGeometry(json(shape)));
        d.geometryProvenance.originalArchive.insert({"territorial-geometry:A",7});Project p;p.replace(d);p.setTimelineCursor("2026-10",false);
        if(month)p.setTimelineCursor("2026-10");
        assert(!apply(p,"territorial.geometry",json(R"({"id":"A","geometry":{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]}})")).changed());
        assert(apply(p,"territorial.geometry",json(R"({"id":"A","geometry":{"type":"Polygon","coordinates":[[[0,0],[3,0],[3,3],[0,0]]]}})")).changed());
        assert(binding(p,"A").geometryRef==(GeometryRef{"territorial-geometry:A",8}));
        assert(p.document().geometries.versions().size()==3);
        if(month) {
            const auto& rows=p.document().timelineRecords.geometryBindings;assert(rows.size()==2);
            assert(rows[0].id=="geometry:territorial:A"&&rows[0].validity.to==std::optional<std::string>{"2026-09"});
            assert(rows[1].id=="geometry:territorial:A:2026-10"&&rows[1].validity.from==std::optional<std::string>{"2026-10"});
        } else assert(p.document().timelineRecords.geometryBindings.size()==1);
        assert(p.undo()&&p.document().timelineRecords.geometryBindings.size()==1&&binding(p,"A").geometryRef.version==1);
    }
}
void monthCatalogOrderDateGuardsAndSplitCollisionMatchOriginal() {
    Project p;p.replace(fixture());p.setTimelineCursor("2026-10",false);p.setTimelineCursor("2026-10");
    auto added=V::arr();added.array={feature("C","D"),feature("D")};apply(p,"territorial.patch",payload("features",added));
    auto reordered=V::arr();reordered.array={feature("D"),feature("C","D"),feature("A")};
    reordered.array[0].object.at("properties").object["validFrom"]=V::str("2026-10");
    reordered.array[1].object.at("properties").object["validFrom"]=V::str("2026-10");
    reordered.array[2].object.at("properties").object["name"]=V::str("A");
    // The original dated candidate keeps metadata Map insertion order, unlike
    // the static replace golden above. Reordering alone is therefore a NoOp.
    assert(!apply(p,"territorial.replace",payload("features",reordered)).changed());
    assert(p.document().units[0].id=="A"&&p.document().units[1].id=="C"&&p.document().units[2].id=="D");
    apply(p,"territorial.remove",json(R"({"ids":["A"]})"));
    assert(p.document().units.size()==3&&!p.resolveWorld("2026-10").find(territorialRef("A"))&&p.resolveWorld("2026-09").find(territorialRef("A")));
    const auto reuse=readWebTerritorialCommand(p.snapshot(),"territorial.create",payload("feature",feature("A")),ports);
    try {applyWebTerritorialEdit(p.snapshot(),std::get<WebTerritorialEdit>(reuse.args.action));assert(false);}
    catch(const TimelineError& error){assert(error.code=="TIMELINE_ACTIVATION");}
    Project collision;collision.replace(fixture());collision.setTimelineCursor("2026-10",false);collision.setTimelineCursor("2026-10");
    auto rows=V::arr();rows.array={feature("A"),feature("territorial:A:2026-10")};
    rows.array[0].object["geometry"]=json(R"({"type":"Polygon","coordinates":[[[0,0],[3,0],[3,3],[0,0]]]})");
    const auto action=readWebTerritorialCommand(collision.snapshot(),"territorial.patch",payload("features",rows),ports);
    try {applyWebTerritorialEdit(collision.snapshot(),std::get<WebTerritorialEdit>(action.args.action));assert(false);}
    catch(const TimelineError& error){assert(error.code=="TIMELINE_ID"&&std::string(error.what()).find("geometry:territorial:A:2026-10")!=std::string::npos);}
    assert(collision.historyCheckpoint()==0&&collision.document().units.size()==1&&collision.document().geometries.versions().size()==1);
}
}
int main() {
    resolvedFeatureReaderKeepsCurrentIdentityAndMetadataOwner();
    frozenStaticAndMonthCollisionGoldens();
    boundedParentClipsCurrentMonthChildLifetime();
    patchOrderReplacementAndExactRemovalAreAtomic();
    parentAndCopyUseFrozenServiceAdmission();
    geometryVersionUsesArchivedHighWaterAndMonthSplit();
    monthCatalogOrderDateGuardsAndSplitCollisionMatchOriginal();
    std::cout<<"Web territorial commands: frozen static/month allocation goldens, full identity, exact order/removal, atomicity, parent/copy admission and immutable history passed\n";
}
