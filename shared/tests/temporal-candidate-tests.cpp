#include <pandoeditor/document-session.h>
#include <pandoeditor/webstorage.h>
#include <pandoeditor/timeline-view.h>
#include <algorithm>
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>

using namespace pandoeditor;
using namespace pandoeditor::projectcodec;
namespace {
const PlatformPorts ports{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
constexpr const char* manifest="1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const std::string dataRevision="2026-10-library";
std::string seedBytes(){
    std::ifstream f(TEMPORAL_CANDIDATE_FIXTURE,std::ios::binary);
    assert(f);
    return {std::istreambuf_iterator<char>(f),std::istreambuf_iterator<char>()};
}
WebStorageAssetSource sourceFor(const Project& project,const std::string& month){
    auto bytes=encodeWeb(project.snapshot(),ports);
    WebStorageAssetSource result;
    result.sourceBytes.assign(bytes.begin(),bytes.end());
    result.encoding="identity";result.compressedBytes=bytes.size();result.decodedBytes=bytes.size();
    result.fingerprint=sha256Bytes(bytes);
    result.baseDataset="builtin-fixture";result.sourceMonth=month;
    return result;
}
Project historical(const ProjectDocument& input){
    auto document=input;
    const auto ref=territorialRef("B");
    for(auto& life:document.timelineRecords.lifetimes)
        if(life.objectRef==ref)life.validity.from="2026-10-15";
    for(auto& binding:document.timelineRecords.geometryBindings)if(binding.objectRef==ref) {
        binding.validity.from="2026-10-15";
        binding.validity.to="2026-10-19";
    }
    for(auto& parent:document.timelineRecords.parentRelations)if(parent.objectRef==ref) {
        parent.validity.from="2026-10-15";
        parent.validity.to="2026-10-19";
    }
    TimelineGeometryBinding nextGeometry{};
    for(const auto& binding:document.timelineRecords.geometryBindings)
        if(binding.objectRef==ref)nextGeometry=binding;
    nextGeometry.id="shape:B:second";
    nextGeometry.validity.from="2026-10-20";nextGeometry.validity.to={};
    nextGeometry.geometryRef.version=2;
    document.timelineRecords.geometryBindings.push_back(nextGeometry);
    TimelineParentRelation nextParent{};
    for(const auto& row:document.timelineRecords.parentRelations)if(row.objectRef==ref)nextParent=row;
    nextParent.id="parent:B:root";nextParent.validity.from="2026-10-20";nextParent.validity.to={};
    nextParent.parentId="";nextParent.coverageMode="explicit";
    document.timelineRecords.parentRelations.push_back(nextParent);
    document.timelineRecords.propertyBindings.push_back({"name:B:2026-10-20",ref,{"2026-10-20",{}},"name",
        R"({"name":"B successor","nameExplicit":true})"});
    document.timelineRecords.propertyBindings.push_back({"color:B:2026-10-20",ref,{"2026-10-20",{}},"color",
        R"({"color":4478310,"explicitColor":true})"});
    document.timelineRecords.propertyBindings.push_back({"flag:B:2026-10-20",ref,{"2026-10-20",{}},"flag",
        R"({"policy":"none","embeddedDataUrl":"","defaultCountryId":"","defaultFlagDataUrl":null})"});
    Project staged;
    staged.replace(std::move(document));
    staged.setTimelineCursor("2026-10",true);
    return staged;
}
void sameWorld(const ResolvedWorld& left,const ResolvedWorld& right){
    assert(left.month==right.month&&left.entities.size()==right.entities.size());
    for(std::size_t i=0;i<left.entities.size();++i){
        const auto& a=left.entities[i],&b=right.entities[i];
        assert(a.objectRef==b.objectRef&&a.geometryRef==b.geometryRef);
        assert(a.rendering==b.rendering&&a.parentId==b.parentId&&a.coverageMode==b.coverageMode);
        assert(a.rootId==b.rootId&&a.ancestors==b.ancestors);
        assert(a.validity.from==b.validity.from&&a.validity.to==b.validity.to);
        assert(a.properties==b.properties);
    }
}
void unchanged(const DocumentSession& owner,const DocumentSessionState& original,
    const std::string& originalBytes,const std::optional<SelectionRef>& primary){
    const auto now=owner.projectState();
    assert(now.epoch==original.epoch&&now.stateRevision==original.stateRevision);
    assert(now.revision==original.revision&&now.checkpoint==original.checkpoint);
    assert(now.timelineCursor==original.timelineCursor&&now.storageBaselineId==original.storageBaselineId);
    assert(now.dirty==original.dirty&&now.canUndo==original.canUndo&&now.canRedo==original.canRedo);
    assert(now.documentDirty==original.documentDirty&&now.presentationDirty==original.presentationDirty);
    assert(now.presentationRevision==original.presentationRevision&&now.presentationCheckpoint==original.presentationCheckpoint);
    assert(owner.selection().primary()==primary);
    assert(owner.storageSnapshot()==originalBytes);
}
template<class F>void errorCode(F&& call,const std::string& expected){
    try {call();assert(false);}
    catch(const TimelineError& error){assert(error.code==expected);}
}
void exercise(const std::string& seed){
    DocumentSession owner(ports);owner.documentLoad(seed,"2026-10");
    owner.selection().replace({"territorial","entity","A"},"native");
    const auto original=owner.projectState();
    const auto bytes=owner.storageSnapshot(),selected=owner.selection().primary();
    Project worldSource=historical(owner.project().document());
    auto october=sourceFor(worldSource,"2026-10"),september=sourceFor(worldSource,"2026-09");
    // P5-2 source validation is still required and unchanged.
    auto octoberSource=owner.temporalSourcePrepare(october,dataRevision,manifest,original.epoch);
    auto septemberSource=owner.temporalSourcePrepare(september,dataRevision,manifest,original.epoch);
    assert(octoberSource.sourceId!=septemberSource.sourceId);
    unchanged(owner,original,bytes,selected);
    auto first=owner.temporalCandidatePrepare(octoberSource.sourceId,"2026-10",october.fingerprint,original.epoch);
    assert(first.candidateId>0&&first.sourceId==octoberSource.sourceId);
    assert(first.targetMonth=="2026-10"&&first.sourceFingerprint==october.fingerprint);
    assert(first.expectedEpoch==original.epoch&&first.worldSha256.size()==64);
    assert(first.resolvedEntityCount>=3&&!first.reused);
    auto actual=owner.temporalCandidateInspect(first.candidateId,original.epoch);
    assert(actual);
    // Independent Core oracle: the same verified typed source through the
    // original full-project replace + temporal resolver path.
    auto immutable=owner.temporalSourceLookup(octoberSource.sourceId,original.epoch);
    assert(immutable&&immutable->sourceDocument());
    Project oracle;oracle.replace(*immutable->sourceDocument());
    auto oracleWorld=oracle.resolveWorld("2026-10");
    oracle.setTimelineCursor("2026-10",true,&oracleWorld);
    sameWorld(actual->world,oracleWorld);
    assert(actual->projectedJson==webSnapshot(oracle.snapshotForView()));
    auto successor=actual->world.find(territorialRef("B"));
    assert(successor&&successor->geometryRef.version==2);
    assert(successor->parentId.empty()&&successor->coverageMode=="explicit");
    assert(successor->validity.from==std::optional<std::string>{"2026-10-15"});
    const auto projected=codecjson::parse(actual->projectedJson);
    const auto& entities=projected.object.at("territorialEntities").array;
    const auto b=std::find_if(entities.begin(),entities.end(),[](const auto& row){
        return row.object.at("id").string=="B";
    });
    assert(b!=entities.end());
    assert(b->object.at("properties").object.at("name").string=="B successor");
    unchanged(owner,original,bytes,selected);

    const auto repeat=owner.temporalCandidatePrepare(octoberSource.sourceId,"2026-10",october.fingerprint,original.epoch);
    assert(repeat.reused&&repeat.candidateId==first.candidateId&&repeat.worldSha256==first.worldSha256);
    errorCode([&]{owner.temporalCandidatePrepare(octoberSource.sourceId,"2026-09",october.fingerprint,original.epoch);},
        "CORE_TEMPORAL_CANDIDATE_MONTH");
    errorCode([&]{owner.temporalCandidatePrepare(octoberSource.sourceId,"2026-10",std::string(64,'0'),original.epoch);},
        "CORE_TEMPORAL_CANDIDATE_PIN");
    errorCode([&]{owner.temporalCandidatePrepare(1234567,"2026-10",october.fingerprint,original.epoch);},
        "CORE_TEMPORAL_CANDIDATE_SOURCE");
    assert(owner.temporalCandidateInspect(first.candidateId,original.epoch));
    const auto beforeNext=first.worldSha256;
    auto earlier=owner.temporalCandidatePrepare(septemberSource.sourceId,"2026-09",september.fingerprint,original.epoch);
    assert(earlier.candidateId>first.candidateId&&!earlier.reused);
    assert(earlier.worldSha256!=beforeNext);
    assert(!owner.temporalCandidateInspect(first.candidateId,original.epoch));
    auto sepView=owner.temporalCandidateInspect(earlier.candidateId,original.epoch);
    assert(sepView);
    auto sepSource=owner.temporalSourceLookup(septemberSource.sourceId,original.epoch);
    Project prior;prior.replace(*sepSource->sourceDocument());
    auto priorWorld=prior.resolveWorld("2026-09");prior.setTimelineCursor("2026-09",true,&priorWorld);
    sameWorld(sepView->world,priorWorld);
    assert(sepView->projectedJson==webSnapshot(prior.snapshotForView()));
    assert(!sepView->world.find(territorialRef("B"))); // The October 15 birth has not occurred.
    unchanged(owner,original,bytes,selected);

    assert(owner.temporalSourceRelease(septemberSource.sourceId,original.epoch));
    assert(!owner.temporalCandidateInspect(earlier.candidateId,original.epoch));
    auto again=owner.temporalCandidatePrepare(octoberSource.sourceId,"2026-10",october.fingerprint,original.epoch);
    assert(again.candidateId>earlier.candidateId);
    // Source registry eviction also invalidates dependent, unadopted candidates.
    auto thirdSource=owner.temporalSourcePrepare(sourceFor(worldSource,"2026-08"),
        dataRevision,manifest,original.epoch);
    auto fourthSource=owner.temporalSourcePrepare(sourceFor(worldSource,"2026-07"),
        dataRevision,manifest,original.epoch);
    assert(thirdSource.sourceId!=fourthSource.sourceId);
    assert(!owner.temporalCandidateInspect(again.candidateId,original.epoch));
    unchanged(owner,original,bytes,selected);
    auto septemberReadded=owner.temporalSourcePrepare(september,dataRevision,manifest,original.epoch);
    auto latest=owner.temporalCandidatePrepare(septemberReadded.sourceId,"2026-09",september.fingerprint,original.epoch);
    owner.documentLoad(seed,"2026-10");
    assert(!owner.temporalCandidateInspect(latest.candidateId,owner.projectState().epoch));
    assert(owner.temporalSourceStats().entries==0);
}
} // namespace
int main(){
    exercise(seedBytes());
    std::cout<<"P5-3 detached native temporal candidates passed\n";
}
