#include <pandoeditor/projectcodec.h>
#include <pandoeditor/losslessjson.h>
#include <pandoeditor/project.h>
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
#include <type_traits>

using namespace pandoeditor;
using V=codecjson::Value;
namespace {
const projectcodec::PlatformPorts ports{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
const std::string labelId="22000000-0000-4000-8000-000000000001";
std::string seedBytes() {
    std::ifstream input(WEB_CONTENT_CODEC_FIXTURE,std::ios::binary);assert(input);
    return {std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>()};
}
void canonicalArchiveCollisionRetainsOriginalCarrier(const std::string& seed) {
    auto root=codecjson::parse(seed);
    root.object.at("labels").array[0].object["coordinates"]=codecjson::parse("[129,39]");
    ProjectDocument document;bool loaded=false;
    try { document=projectcodec::decodeWeb(root.encode(),ports);loaded=true; }
    catch(const std::invalid_argument& error) { std::cerr<<"Canonical archive must survive an independent inline shape: "<<error.what()<<'\n'; }
    assert(loaded);
    const GeometryRef original{"web-label:"+labelId,1},allocated{"web-label:"+labelId,2};
    assert(document.geometryProvenance.originalArchive.count(original));
    assert(document.geometries.get(original)->points[0].x==127);
    assert(document.geometries.get(original)->points[0].y==37);
    assert(document.labels[0].geometry==allocated);
    assert(document.geometries.get(allocated)->points[0].x==129);
    assert(document.geometries.get(allocated)->points[0].y==39);
    const auto& evidence=document.geometryProvenance.inlineAllocations.at(allocated);
    assert(evidence.createdFor==(ObjectRef{"label",labelId}));assert(!evidence.promoted);
    assert(evidence.geometrySha256=="8cbaaed6291ae4caa1c4da3feca77367c3ba215cdf0c6c3d50e3eb7f63f4441a");
    Project project;project.replace(document);
    const auto encoded=codecjson::parse(projectcodec::encodeWeb(project.snapshot(),ports));
    assert(encoded.object.at("geometries").array.size()==root.object.at("geometries").array.size());
    assert(encoded.object.at("labels").array[0].object.at("coordinates").encode()=="[129,39]");
    const auto restored=projectcodec::decodeWeb(encoded.encode(),ports);
    assert(restored.geometries.get(original)->points[0].x==127);
    assert(restored.labels[0].geometry==allocated);
}
void currentDtoReadersPreserveEveryFieldAndArrayOrder(const std::string& seed) {
    auto root=codecjson::parse(seed);
    root.object.at("labels").array[0].object["sourcePlaceId"]=V::str("builtin:place:source");
    root.object.at("hydroEdits").array[0].object.at("properties").object["sourceFeatureId"]=V::str("builtin-hydro-source");
    root.object.at("distributionLayers").array[0].object["groups"]=codecjson::parse("[\"first\",\"second\"]");
    Project project;project.replace(projectcodec::decodeWeb(root.encode(),ports));
    assert(codecjson::parse(projectcodec::encodeWeb(project.snapshot(),ports)).encode()==root.encode());
    for(const auto& domains:{std::pair{"label","labels"},std::pair{"hydro","hydroEdits"},
            std::pair{"generic","genericFeatures"},std::pair{"distributionLayer","distributionLayers"},
            std::pair{"distributionEntry","distributionEntries"}}) {
        auto edited=root.object.at(domains.second).array[0];
        const ObjectRef target{domains.first,edited.object.at("id").string};
        auto& properties=(target.domain=="hydro"||target.domain=="generic")?edited.object.at("properties"):edited;
        if(target.domain=="distributionEntry")properties.object["value"]=V::num(1001);
        else properties.object["name"]=V::str("changed name");
        const auto before=projectcodec::encodeWeb(project.snapshot(),ports);
        const auto edit=projectcodec::readWebContentEdit(project.snapshot(),target,edited,false);
        assert(edit.target==target&&!edit.create&&!edit.geometry&&!edit.inlineAllocation);
        assert(projectcodec::encodeWeb(project.snapshot(),ports)==before);
        auto candidate=project.document();
        std::visit([&](const auto& value) {
            using T=std::decay_t<decltype(value)>;
            if constexpr(std::is_same_v<T,PlaceLabel>)candidate.labels[0]=value;
            else if constexpr(std::is_same_v<T,HydroFeature>)candidate.hydro[0]=value;
            else if constexpr(std::is_same_v<T,GenericFeature>)candidate.genericFeatures[0]=value;
            else if constexpr(std::is_same_v<T,DistributionLayer>)candidate.distributionLayers[0]=value;
            else if constexpr(std::is_same_v<T,DistributionEntry>)candidate.distributionEntries[0]=value;
            else assert(false);
        },edit.value);
        Project result;result.replace(candidate);
        auto expected=root;expected.object.at(domains.second).array[0]=edited;
        assert(codecjson::parse(projectcodec::encodeWeb(result.snapshot(),ports)).encode()==expected.encode());
        const auto deleted=projectcodec::readWebContentEdit(project.snapshot(),target,V{},false);
        assert(std::holds_alternative<std::monostate>(deleted.value));
        assert(!deleted.geometry&&!deleted.inlineAllocation&&!deleted.create);
    }
}
void geometryProposalReusesCurrentAndOriginalReferences(const std::string& seed) {
    const auto root=codecjson::parse(seed);
    Project project;project.replace(projectcodec::decodeWeb(seed,ports));
    auto row=root.object.at("labels").array[0];const ObjectRef owner{"label",labelId};
    const auto unchanged=projectcodec::readWebContentEdit(project.snapshot(),owner,row,false);
    assert(std::get<PlaceLabel>(unchanged.value).geometry==project.document().labels[0].geometry);
    assert(!unchanged.geometry&&!unchanged.inlineAllocation);
    row.object["coordinates"]=codecjson::parse("[128,38]");
    const auto archived=projectcodec::readWebContentEdit(project.snapshot(),owner,row,false);
    assert(!archived.geometry&&!archived.inlineAllocation);
    assert(project.document().geometryProvenance.originalArchive.count(std::get<PlaceLabel>(archived.value).geometry));
    row.object["coordinates"]=codecjson::parse("[129,39]");
    const auto allocated=projectcodec::readWebContentEdit(project.snapshot(),owner,row,false);
    const GeometryRef next{"web-label:"+labelId,2};
    assert(allocated.geometry&&allocated.geometry->first==next);
    assert(std::get<PlaceLabel>(allocated.value).geometry==next);
    assert(allocated.inlineAllocation&&allocated.inlineAllocation->createdFor==owner&&!allocated.inlineAllocation->promoted);
    assert(allocated.inlineAllocation->geometrySha256=="8cbaaed6291ae4caa1c4da3feca77367c3ba215cdf0c6c3d50e3eb7f63f4441a");
    assert(projectcodec::geometrySha256(allocated.geometry->second)==allocated.inlineAllocation->geometrySha256);
    assert(!project.document().geometries.get(next));
    auto candidate=project.document();candidate.geometries.insert(allocated.geometry->first,allocated.geometry->second);
    candidate.labels[0]=std::get<PlaceLabel>(allocated.value);
    candidate.geometryProvenance.inlineAllocations.emplace(next,*allocated.inlineAllocation);
    Project currentPrivate;currentPrivate.replace(candidate);
    const auto samePrivate=projectcodec::readWebContentEdit(currentPrivate.snapshot(),owner,row,false);
    assert(std::get<PlaceLabel>(samePrivate.value).geometry==next&&!samePrivate.geometry&&!samePrivate.inlineAllocation);
    auto createdRow=row;const std::string createdId="22000000-0000-4000-8000-000000000009";
    createdRow.object["id"]=V::str(createdId);createdRow.object["coordinates"]=codecjson::parse("[131,41]");
    const auto created=projectcodec::readWebContentEdit(project.snapshot(),{"label",createdId},createdRow,true);
    assert(created.create&&created.geometry&&created.inlineAllocation);
    assert(created.geometry->first==(GeometryRef{"web-label:"+createdId,1}));
    assert(created.inlineAllocation->createdFor==(ObjectRef{"label",createdId}));
}
void identityAndCurrentSchemaAreRequired(const std::string& seed) {
    Project project;project.replace(projectcodec::decodeWeb(seed,ports));
    const auto root=codecjson::parse(seed);auto row=root.object.at("labels").array[0];
    const auto rejected=[&](const ObjectRef& target,const V& value,bool create){
        bool failed=false;try {projectcodec::readWebContentEdit(project.snapshot(),target,value,create);}
        catch(const std::invalid_argument&){failed=true;}assert(failed);
    };
    rejected({"territorial",labelId},row,false);
    rejected({"label","22000000-0000-4000-8000-000000000009"},row,false);
    rejected({"label","not-a-current-uuid"},row,false);
    rejected({"label",labelId},V{},true);
    row.object["legacyName"]=V::str("retired");rejected({"label",labelId},row,false);
    assert(projectcodec::isWebContentId(labelId));assert(!projectcodec::isWebContentId("not-a-current-uuid"));
    auto runtime=row;runtime.object.erase("legacyName");runtime.object["id"]=V::str("L");
    runtime.object["coordinates"]=codecjson::parse("[135,44]");
    const auto live=projectcodec::readWebContentEdit(project.snapshot(),{"label","L"},runtime,true);
    assert(std::get<PlaceLabel>(live.value).id=="L"&&live.inlineAllocation);
    auto invalidFile=root;invalidFile.object.at("labels").array[0].object["id"]=V::str("L");
    bool fileRejected=false;try {projectcodec::decodeWeb(invalidFile.encode(),ports);}
    catch(const std::invalid_argument& error){fileRejected=std::string(error.what()).find("INVALID_WEB_OBJECT_UUID")!=std::string::npos;}
    assert(fileRejected);
}
void onlySingleOwnerPrivateReferencesMayRenumber(const std::string& seed) {
    auto root=codecjson::parse(seed);root.object.at("labels").array[0].object["coordinates"]=codecjson::parse("[129,39]");
    auto document=projectcodec::decodeWeb(root.encode(),ports);
    const GeometryRef previous=document.labels[0].geometry,next{previous.id,previous.version+1};
    // Old private versions stay in the internal ledger; no external carrier can
    // identify the new version in the Web inline label DTO.
    const auto shape=*document.geometries.get(previous);document.geometries.insert(next,shape);
    document.labels[0].geometry=next;
    document.geometryProvenance.inlineAllocations.emplace(next,InlineGeometryAllocation{{"label",labelId},
        "8cbaaed6291ae4caa1c4da3feca77367c3ba215cdf0c6c3d50e3eb7f63f4441a",false});
    Project project;project.replace(document);
    const auto restored=projectcodec::decodeWeb(projectcodec::encodeWeb(project.snapshot(),ports),ports);
    assert(restored.labels[0].geometry==previous);
    assert(restored.geometryProvenance.originalArchive==document.geometryProvenance.originalArchive);
    assert(restored.geometries.get(previous)->points[0].x==129);
    assert(restored.geometries.get(previous)->points[0].y==39);

    document.genericFeatures[0].geometry=next;
    document.geometryProvenance.inlineAllocations.at(next).promoted=true;
    Project shared;shared.replace(document);
    const auto sharedRestored=projectcodec::decodeWeb(projectcodec::encodeWeb(shared.snapshot(),ports),ports);
    assert(sharedRestored.labels[0].geometry==next);
    assert(sharedRestored.genericFeatures[0].geometry==next);
    assert(sharedRestored.geometryProvenance.originalArchive.count(next));
    document.geometryProvenance.inlineAllocations.at(next).geometrySha256=std::string(64,'0');
    Project claimed;claimed.replace(document);bool claimedRejected=false;
    try {projectcodec::encodeWeb(claimed.snapshot(),ports);}catch(const std::invalid_argument& error) {
        claimedRejected=std::string(error.what()).find("geometry hash mismatch")!=std::string::npos;
    }
    assert(claimedRejected);

    auto external=projectcodec::decodeWeb(seed,ports);
    const GeometryRef externalRef{"external-label-carrier",7};
    external.geometries.insert(externalRef,*external.geometries.get(external.labels[0].geometry));
    external.geometryProvenance.originalArchive.insert(externalRef);external.labels[0].geometry=externalRef;
    Project carrier;carrier.replace(external);bool refused=false;
    try {projectcodec::encodeWeb(carrier.snapshot(),ports);}catch(const std::invalid_argument& error) {
        refused=std::string(error.what()).find("non-territorial geometry reference loss")!=std::string::npos;
    }
    assert(refused);
}
}
int main() {
    const auto seed=seedBytes();
    canonicalArchiveCollisionRetainsOriginalCarrier(seed);
    currentDtoReadersPreserveEveryFieldAndArrayOrder(seed);
    geometryProposalReusesCurrentAndOriginalReferences(seed);
    identityAndCurrentSchemaAreRequired(seed);
    onlySingleOwnerPrivateReferencesMayRenumber(seed);
    std::cout<<"Web content codec: current DTO fields/order, identity/deletion, immutable archive and private-only reload passed\n";
}
