#include <pandoeditor/webstorage.h>
#include <pandoeditor/webterritorialcommands.h>
#include <algorithm>
#include <cassert>
#include <iostream>
#include <zlib.h>

using namespace pandoeditor;
using namespace pandoeditor::projectcodec;
using V=codecjson::Value;
namespace {
const PlatformPorts ports{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
V json(const std::string& bytes){return codecjson::parse(bytes);}
V feature(const std::string& id) {
    auto row=json(R"({"type":"Feature","id":"A","geometry":{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]},"properties":{"schemaVersion":6,"entityKind":"general","name":" A ","notes":"","parentId":"","coverageMode":"explicit","style":{"color":" #AbCdEf "},"locked":false,"metadata":{},"sourceFolderId":"","sourceEntityId":"","sourceGeometryVersion":"","validFrom":null,"validTo":null}})");
    row.object["id"]=V::str(id);return row;
}
V rows(std::initializer_list<V> values){auto result=V::arr();result.array=values;return result;}
V payload(const char* key,V value){auto result=V::obj();result.object[key]=std::move(value);return result;}
ProjectDocument document(const V& features) {
    ProjectDocument seed;seed.documentId="web-storage-fixture";Project empty;empty.replace(std::move(seed));
    WebTerritorialEdit edit;edit.operation=WebTerritorialOperation::Replace;
    for(const auto& value:features.array)edit.features.push_back(readWebTerritorialIdentityFeature(normalizeWebTerritorialResolvedFeature(value),ports));
    auto result=applyWebTerritorialEdit(empty.snapshot(),edit);result.exchangeMetadata=R"({"baseDataset":"builtin-v1"})";return result;
}
WebStorageBaseline baseline(const Project& p,const V& features) {
    auto input=payload("features",features);input.object["baseDataset"]=V::str("builtin-v1");
    input.object["fingerprint"]=V::str(webStorageFingerprint(features));return admitWebStorageBaseline(p.snapshot(),input,ports);
}
void apply(Project& p,const char* operation,const V& input) {
    auto result=CommandProcessor::prepare(p,readWebTerritorialCommand(p.snapshot(),operation,input,ports));
    if(!result.ok()){std::cerr<<operation<<": "<<result.detail<<'\n';assert(false);}
    if(result.preview)assert(CommandProcessor::confirm(p,*result.preview).changed());
}
template<class F>void rejects(F function,const std::string& code={}) {
    try{function();assert(false);}catch(const TimelineError& error){if(!code.empty())assert(error.code==code);}
    catch(const std::invalid_argument&){assert(code.empty());}
}
void golden(const V& features,const char* expected) {
    const auto actual=webStorageFingerprint(features);if(actual!=expected)std::cerr<<"Fingerprint expected "<<expected<<", actual "<<actual<<'\n';assert(actual==expected);
}
void originalFingerprintGoldens() {
    // Observed directly from admitted original Git blobs at 9300609. The
    // numeric input remains unrounded here to test JSON.parse Number semantics.
    auto basic=rows({feature("A")});
    golden(basic,"2104f4ae7c4c5ebf6c1f9119bf9bf3f7c7f891e7b9050c4812a616bc18f72b03");
    auto keys=basic;keys.array[0].object["properties"].object["metadata"]=json(R"({"10":"ten","2":"two","00":"zero","4294967294":"index","4294967295":"other","\ue000":1,"\ud83d\ude00":2,"\ud800":3,"\udc00":4})");
    golden(keys,"737c4c3486002f37fd50d6fffe9bc45b66fe2b9b920350d430cc31657e87d533");
    auto numbers=basic;numbers.array[0].object["properties"].object["metadata"]=json(R"({"n":[-0,1e-6,1e-7,1e20,1e21,9007199254740993,1000000000000000128,1.234567890123456789,5e-324,1e-400,1e400]})");
    golden(numbers,"43b844198213629f3f45bebd8672bb06e74788b77eedae2e1ce6cf618ca7df2c");
    auto text=rows({feature(json(R"("\ue000")").string),feature(json(R"("\ud83d\ude00")").string)});
    text.array[1].object["properties"].object["metadata"]=json(R"({"t":"x\ud800 y\udc00 \ud83d\ude00\u2028\u2029\b\n"})");
    golden(text,"3e8e21c378d490ef0a4712d05cbe8f4412d6d4692a40e6fda50822e2fe747ff4");
    auto reverse=text;std::reverse(reverse.array.begin(),reverse.array.end());assert(webStorageFingerprint(reverse)==webStorageFingerprint(text));
    auto annotated=basic;annotated.array[0].object["geometry"].object["source"]=V::str("exact geometry evidence");
    golden(annotated,"c65f1bf084dc3ee07fb3b7de9566de2b982ce1fa13e950d54b3c61e3852c466e");
    auto styled=basic;styled.array[0].object["properties"].object["style"]=json(R"({"color":"#abcdef","opacity":0.5,"custom":"retained"})");
    golden(styled,"c67fd491be1c93bc659ab7636b602664d3b6d7fd60d4465dd70446c37718eda2");
}
void immutableBaselineAdmission() {
    const auto base=rows({feature("A"),feature("B"),feature("C")});Project p;p.replace(document(base));
    const auto revision=p.revision(),checkpoint=p.historyCheckpoint();auto admitted=baseline(p,base);
    assert(admitted.baseDataset()=="builtin-v1"&&initialDirtyTerritorialIds(p.snapshot(),admitted).empty());
    assert(admitted.geometry("A")==p.document().geometries.get(staticGeometryBinding(p.document(),territorialRef("A")).geometryRef));
    assert(admitted.features().array[0].object.at("properties").object.at("style").object.at("color").string=="#AbCdEf");
    auto input=payload("features",base);input.object["baseDataset"]=V::str("builtin-v1");input.object["fingerprint"]=V::str(std::string(64,'0'));
    rejects([&]{admitWebStorageBaseline(p.snapshot(),input,ports);},"PL-SCHEMA-BASE");
    rejects([&]{admitWebStorageBaseline(p.snapshot(),input,PlatformPorts{});},"CODEC_PLATFORM_REQUIRED");
    auto duplicates=base;duplicates.array.push_back(base.array[0]);input.object["features"]=duplicates;
    rejects([&]{admitWebStorageBaseline(p.snapshot(),input,ports);});
    // The original fingerprint accepts extra evidence keys, but its geometry
    // version store rejects their admission. Retain both distinct contracts.
    auto annotated=rows({feature("A")});annotated.array[0].object["geometry"].object["source"]=V::str("exact geometry evidence");
    input.object["features"]=annotated;input.object["fingerprint"]=V::str("c65f1bf084dc3ee07fb3b7de9566de2b982ce1fa13e950d54b3c61e3852c466e");
    rejects([&]{admitWebStorageBaseline(p.snapshot(),input,ports);});
    assert(p.revision()==revision&&p.historyCheckpoint()==checkpoint&&!p.canUndo());
}
void deltaOrderHistoryAndExpansion() {
    const auto base=rows({feature("A"),feature("B"),feature("C")});Project p;p.replace(document(base));p.setTimelineCursor("2026-10",false);auto admitted=baseline(p,base);
    auto changedC=feature("C");changedC.object["properties"].object["notes"]=V::str("edited");
    apply(p,"territorial.patch",payload("features",rows({changedC,feature("N"),feature("M")})));
    apply(p,"territorial.remove",payload("ids",rows({V::str("B")})));
    auto initial=initialDirtyTerritorialIds(p.snapshot(),admitted);assert((initial==std::vector<std::string>{"B","C","N","M"}));
    WebStorageContext context;context.format="pandolab-autosave";context.version="test";context.savedAt="2026-10-13T00:00:00.000Z";
    // Core keeps insertion order of first touch, including currently unchanged A.
    const std::vector<std::string> dirty{"C","M","A","B","N"};
    const auto checkpoint=p.historyCheckpoint(),revision=p.revision();auto bytes=encodeWebStorage(p.snapshot(),ports,context,&admitted,dirty);auto saved=json(bytes);
    assert(saved.object.at("format").string=="pandolab-autosave-delta"&&!saved.object.count("territorialEntities"));
    const auto& delta=saved.object.at("entityDelta");const auto& changes=delta.object.at("changed").array;
    assert(changes.size()==4&&changes[0].object.at("id").string=="C"&&changes[1].object.at("id").string=="M"&&changes[2].object.at("id").string=="A"&&changes[3].object.at("id").string=="N");
    assert(delta.object.at("removedIds").array[0].string=="B");
    auto restored=decodeWebStorage(bytes,ports,&admitted);assert(restored.units.size()==4&&restored.units[0].id=="A"&&restored.units[1].id=="C"&&restored.units[2].id=="M"&&restored.units[3].id=="N");
    assert(restored.units[1].notes=="edited"&&restored.geometries.get(staticGeometryBinding(restored,territorialRef("C")).geometryRef));
    rejects([&]{encodeWebStorage(p.snapshot(),ports,context,&admitted,{"C"});},"CORE_STORAGE_DIRTY_IDS");
    assert(p.historyCheckpoint()==checkpoint&&p.revision()==revision);
    rejects([&]{decodeWebStorage(bytes,ports);},"PL-SCHEMA-BASE");
    auto wrong=saved;wrong.object["baseDataset"]=V::str("another");rejects([&]{decodeWebStorage(wrong.encode(),ports,&admitted);},"PL-SCHEMA-BASE");
    wrong=saved;wrong.object["baseDatasetFingerprint"]=V::str(std::string(64,'a'));rejects([&]{decodeWebStorage(wrong.encode(),ports,&admitted);},"PL-SCHEMA-BASE");
    wrong=saved;wrong.object.erase("baseDatasetFingerprint");rejects([&]{decodeWebStorage(wrong.encode(),ports,&admitted);},"PL-SCHEMA-BASE");
    wrong=saved;wrong.object["entityDelta"].object["removedIds"].array.push_back(V::str("B"));rejects([&]{decodeWebStorage(wrong.encode(),ports,&admitted);});
    wrong=saved;wrong.object["entityDelta"].object["removedIds"].array.push_back(V::str("A"));rejects([&]{decodeWebStorage(wrong.encode(),ports,&admitted);});
    wrong=saved;wrong.object["territorialEntities"]=V::arr();rejects([&]{decodeWebStorage(wrong.encode(),ports,&admitted);});
    // Current identity normalization supplies optional fields before full codec.
    auto& optional=saved.object["entityDelta"].object["changed"].array[0].object["properties"];
    for(const auto* field:{"name","style","metadata","locked","sourceFolderId","sourceEntityId","sourceGeometryVersion"})optional.object.erase(field);
    assert(decodeWebStorage(saved.encode(),ports,&admitted).units[1].notes=="edited");
}
void autosaveSelectionDoesNotInferMonthMode() {
    const auto base=rows({feature("A")});Project p;p.replace(document(base));auto admitted=baseline(p,base);
    WebStorageContext context;context.format="pandolab-autosave";
    p.setTimelineCursor("2026-10");assert(p.timelineEditsEnabled()&&isStaticTimeline(p.document()));
    assert(json(encodeWebStorage(p.snapshot(),ports,context,&admitted,{})).object.at("format").string=="pandolab-autosave-delta");
    auto full=json(encodeWebStorage(p.snapshot(),ports,context,nullptr,{}));
    assert(full.object.at("format").string=="pandolab-autosave-full"&&full.object.at("baseDataset").string=="external-territorial-entities");
    auto dated=p.document();dated.timelineRecords.lifetimes[0].validity.from="2020";dated.timelineRecords.geometryBindings[0].validity.from="2020";dated.timelineRecords.parentRelations[0].validity.from="2020";p.replace(std::move(dated));
    full=json(encodeWebStorage(p.snapshot(),ports,context,&admitted,{}));assert(full.object.at("format").string=="pandolab-autosave-full");
    context.format="pandolab-project-state";full=json(encodeWebStorage(p.snapshot(),ports,context,&admitted,{}));
    // Original app-map-settings readSnapshot marks dated records fullAutosave,
    // and buildProject uses external-territorial-entities for the file header.
    assert(full.object.at("format").string=="pandolab-project-state"&&full.object.at("baseDataset").string=="external-territorial-entities");
    auto optional=full;optional.object["territorialEntities"].array[0].object["properties"].object.erase("notes");
    assert(decodeWebStorage(optional.encode(),ports,&admitted).units[0].notes.empty());
    full.object["baseDatasetFingerprint"]=V::str(admitted.fingerprint());rejects([&]{decodeWebStorage(full.encode(),ports,&admitted);});
}
void geometryOnlyChangesStillCarryIdentityAndArchive() {
    const auto base=rows({feature("A")});Project p;p.replace(document(base));auto admitted=baseline(p,base);const auto pristine=admitted.geometry("A");
    auto changed=feature("A").object.at("geometry");changed.object["coordinates"]=json("[[[0,0],[3,0],[3,2],[0,0]]]");
    auto request=payload("geometry",changed);request.object["id"]=V::str("A");apply(p,"territorial.geometry",request);
    assert((initialDirtyTerritorialIds(p.snapshot(),admitted)==std::vector<std::string>{"A"}));
    assert(admitted.geometry("A")==pristine&&!sameGeometryValue(*pristine,*p.document().geometries.get(staticGeometryBinding(p.document(),territorialRef("A")).geometryRef)));
    WebStorageContext context;context.format="pandolab-autosave";const auto bytes=encodeWebStorage(p.snapshot(),ports,context,&admitted,{"A"});
    const auto saved=json(bytes);assert(saved.object.at("entityDelta").object.at("changed").array.size()==1&&saved.object.at("geometries").array.size()==2);
    const auto restored=decodeWebStorage(bytes,ports,&admitted);assert(restored.geometries.versions().size()==2&&sameGeometryValue(*restored.geometries.get(staticGeometryBinding(restored,territorialRef("A")).geometryRef),*p.document().geometries.get(staticGeometryBinding(p.document(),territorialRef("A")).geometryRef)));
    assert(p.undo()&&initialDirtyTerritorialIds(p.snapshot(),admitted).empty());
}
std::vector<std::uint8_t> gzip(const std::string& bytes) {
    z_stream stream{};assert(deflateInit2(&stream,6,Z_DEFLATED,MAX_WBITS+16,8,Z_DEFAULT_STRATEGY)==Z_OK);
    std::vector<std::uint8_t> result(deflateBound(&stream,uLong(bytes.size())));stream.next_in=const_cast<Bytef*>(reinterpret_cast<const Bytef*>(bytes.data()));stream.avail_in=uInt(bytes.size());
    stream.next_out=result.data();stream.avail_out=uInt(result.size());assert(deflate(&stream,Z_FINISH)==Z_STREAM_END);result.resize(stream.total_out);assert(deflateEnd(&stream)==Z_OK);return result;
}
void pin(WebStorageAssetSource& source) {
    source.compressedBytes=source.sourceBytes.size();source.fingerprint=sha256Bytes(std::string(reinterpret_cast<const char*>(source.sourceBytes.data()),source.sourceBytes.size()));
}
void storedGzipPinAndFullInactiveCatalog() {
    Project p;auto value=document(rows({feature("A"),feature("B")}));
    value.timelineRecords.lifetimes[1].validity.to="2019";value.timelineRecords.geometryBindings[1].validity.to="2019";value.timelineRecords.parentRelations[1].validity.to="2019";
    p.replace(std::move(value));p.setTimelineCursor("2026-10",false);
    const auto bytes=encodeWeb(p.snapshot(),ports);WebStorageAssetSource input;input.sourceBytes=gzip(bytes);pin(input);input.decodedBytes=bytes.size();input.baseDataset="builtin-v1";input.sourceMonth="2026-10";
    const auto revision=p.revision(),checkpoint=p.historyCheckpoint();auto accepted=admitWebStorageAssetBaseline(p.snapshot(),input,ports);
    assert(accepted.kind()==WebStorageBaselineKind::Builtin&&accepted.sourceMonth()=="2026-10"&&accepted.fingerprint()==input.fingerprint);
    assert(accepted.sourceDocument()&&accepted.sourceDocument()->units.size()==2&&accepted.storedIdentities().array.size()==2&&accepted.features().array.empty());
    assert(initialDirtyTerritorialIds(p.snapshot(),accepted).empty()&&initialDirtyTerritorialIds(p.document(),accepted).empty());
    const auto ref=p.document().timelineRecords.geometryBindings[0].geometryRef;
    assert(accepted.geometry("A")==p.document().geometries.get(ref)&&accepted.sourceDocument()->geometries.get(ref)==p.document().geometries.get(ref));
    assert(!accepted.geometry("B")&&accepted.sourceDocument()->geometries.versions().size()==2);
    auto delta=json(bytes);delta.object.erase("territorialEntities");delta.object["format"]=V::str("pandolab-autosave-delta");delta.object["baseDatasetFingerprint"]=V::str(input.fingerprint);
    delta.object["entityDelta"]=json(R"({"changed":[],"removedIds":[]})");
    const auto restored=decodeWebStorage(delta.encode(),ports,&accepted);assert(restored.units.size()==2&&restored.units[1].id=="B"&&restored.timelineRecords.lifetimes[1].validity.to=="2019");
    auto wrong=input;wrong.fingerprint=sha256Bytes(bytes);rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;++wrong.compressedBytes;rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;++wrong.decodedBytes;rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;--wrong.decodedBytes;rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;wrong.decodedBytes=64ull*1024*1024+1;rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;wrong.encoding="identity";rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;wrong.sourceBytes[wrong.sourceBytes.size()-8]^=1;pin(wrong);rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;wrong.sourceBytes.pop_back();pin(wrong);rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;wrong.sourceBytes.push_back(0);pin(wrong);rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;wrong.sourceMonth="2026";rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    wrong=input;wrong.sourceBytes.assign(bytes.begin(),bytes.end());pin(wrong);rejects([&]{admitWebStorageAssetBaseline(p.snapshot(),wrong,ports);},"PL-SCHEMA-BASE");
    auto members=input;members.sourceBytes=gzip(bytes.substr(0,bytes.size()/2));auto second=gzip(bytes.substr(bytes.size()/2));members.sourceBytes.insert(members.sourceBytes.end(),second.begin(),second.end());pin(members);
    assert(admitWebStorageAssetBaseline(p.snapshot(),members,ports).sourceDocument()->units.size()==2);
    auto external=admitWebStorageDocumentBaseline(p.snapshot(),ports);assert(external.kind()==WebStorageBaselineKind::External&&external.fingerprint().empty()&&initialDirtyTerritorialIds(p.document(),external).empty());
    rejects([&]{decodeWebStorage(delta.encode(),ports,&external);},"PL-SCHEMA-BASE");
    WebStorageContext context;context.format="pandolab-autosave";assert(json(encodeWebStorage(p.snapshot(),ports,context,&external,{})).object.at("format").string=="pandolab-autosave-full");
    assert(p.revision()==revision&&p.historyCheckpoint()==checkpoint&&!p.canUndo());
}
}
void storageValidatesTheCanonicalExportOnce() {
    auto row=feature("A");row.object["properties"].object["metadata"].object["flagDataUrl"]=V::str("data:image/png;base64,AA==");
    row.object["geometry"].object["coordinates"]=json("[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[0.5,0.5],[0.5,1],[1,1],[1,0.5],[0.5,0.5]]]");
    const auto base=rows({row});Project p;p.replace(document(base));auto admitted=baseline(p,base);
    unsigned calls=0;auto counted=ports;counted.validateFlagDataUrl=[&](const std::string&){++calls;};
    (void)encodeWeb(p.snapshot(),counted);const auto exportCalls=calls;assert(exportCalls>0);
    for(const auto* format:{"pandolab-project-state","pandolab-autosave-full","pandolab-autosave"}) {
        WebStorageContext context;context.format=format;calls=0;
        const auto bytes=encodeWebStorage(p.snapshot(),counted,context,&admitted,{});
        assert(calls==exportCalls);
        const auto restored=decodeWebStorage(bytes,ports,&admitted);
        assert(restored.units.size()==1&&restored.units[0].id=="A");
        assert(restored.symbols.at(territorialRef("A")).embeddedDataUrl=="data:image/png;base64,AA==");
        assert(sameGeometryValue(*restored.geometries.get(staticGeometryBinding(restored,territorialRef("A")).geometryRef),
            *p.document().geometries.get(staticGeometryBinding(p.document(),territorialRef("A")).geometryRef)));
    }
}
int main(){originalFingerprintGoldens();immutableBaselineAdmission();deltaOrderHistoryAndExpansion();autosaveSelectionDoesNotInferMonthMode();geometryOnlyChangesStillCarryIdentityAndArchive();storedGzipPinAndFullInactiveCatalog();storageValidatesTheCanonicalExportOnce();std::cout<<"Web storage tests passed\n";}
