#include <pandoeditor/document-session.h>
#include <pandoeditor/webstorage.h>
#include <pandoeditor/webterritorialcommands.h>
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

using namespace pandoeditor;
using namespace pandoeditor::projectcodec;
namespace {
const PlatformPorts ports{[](const std::string&){},true,codecjson::ParsedTextPolicy::PreserveUtf16};
constexpr const char* pin="1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
using V=codecjson::Value;

std::string readSeed() {
    std::ifstream file(TEMPORAL_ADOPT_FIXTURE,std::ios::binary);assert(file);
    return {std::istreambuf_iterator<char>(file),std::istreambuf_iterator<char>()};
}
WebStorageAssetSource bytesFor(const Project& project,const std::string& month) {
    const auto bytes=encodeWeb(project.snapshot(),ports);
    WebStorageAssetSource result;
    result.sourceBytes.assign(bytes.begin(),bytes.end());
    result.encoding="identity";
    result.compressedBytes=bytes.size();
    result.decodedBytes=bytes.size();
    result.fingerprint=sha256Bytes(bytes);
    result.baseDataset="builtin-fixture";result.sourceMonth=month;
    return result;
}
V setup(const std::string& month) {
    auto value=codecjson::parse(R"({"initialMonth":"2026-10","timelineRange":null,"initialMapBounds":null,"sourceMode":"builtin"})");
    value.object["initialMonth"]=V::str(month);
    return value;
}
template<class Fn>void rejects(Fn fn,const std::string& code) {
    try {fn();assert(false);}
    catch(const TimelineError& error){assert(error.code==code);}
}
void sameState(const DocumentSession& session,const DocumentSessionState& before,
    const std::string& stored,const std::optional<SelectionRef>& selected,
    const std::optional<SelectionRef>& hovered,std::size_t draftPoints) {
    const auto now=session.projectState();
    assert(now.epoch==before.epoch&&now.stateRevision==before.stateRevision);
    assert(now.revision==before.revision&&now.checkpoint==before.checkpoint);
    assert(now.presentationRevision==before.presentationRevision&&now.presentationCheckpoint==before.presentationCheckpoint);
    assert(now.timelineCursor==before.timelineCursor&&now.storageBaselineId==before.storageBaselineId);
    assert(now.dirty==before.dirty&&now.documentDirty==before.documentDirty);
    assert(now.presentationDirty==before.presentationDirty&&now.canUndo==before.canUndo&&now.canRedo==before.canRedo);
    assert(session.storageSnapshot()==stored);
    assert(session.selection().primary()==selected&&session.selection().hover()==hovered);
    assert(session.draftActive()&&session.draft().coordinates().size()==draftPoints);
}
void seedUserWork(DocumentSession& owner) {
    CommandArguments edit;
    edit.action=TerritorialFieldEdit{territorialRef("A"),TerritorialField::Name,"Unsaved edit"};
    assert(owner.executeCommand("territorial.field",edit,{territorialRef("A")},owner.projectState().epoch).result.changed());
    assert(owner.applyPresentation(WebControlVisibility{"labels",false},owner.projectState().epoch).result.changed());
    owner.selection().replace({"territorial","entity","A"},"test");
    owner.selection().setHover({"territorial","entity","B"},"map");
    owner.startDraft("line",{{1,2},{3,4}},"refine");
    owner.draft().append({5,6});
}
void capsuleRollbackAndInvalidRequests(const std::string& seed) {
    DocumentSession owner(ports);owner.documentLoad(seed,"2026-10");
    seedUserWork(owner);
    const auto before=owner.projectState();
    const auto stored=owner.storageSnapshot();
    const auto selected=owner.selection().primary();
    const auto hovered=owner.selection().hover();
    const auto draftPoints=owner.draft().coordinates().size();
    const auto input=bytesFor(owner.project(),"2025-12");
    const auto source=owner.temporalSourcePrepare(input,"p5-4-data",pin,before.epoch);
    const auto config=setup("2025-12");
    auto receipt=owner.temporalCandidatePrepare(source.sourceId,"2025-12",input.fingerprint,before.epoch,config,"dated-project");
    assert(receipt.candidateId&&!receipt.reused);
    const auto view=owner.temporalCandidateInspect(receipt.candidateId,before.epoch);
    assert(view);
    sameState(owner,before,stored,selected,hovered,draftPoints);
    rejects([&]{owner.temporalCandidateAdopt(receipt.candidateId,source.sourceId,"2025-12",input.fingerprint,
        receipt.worldSha256,9,before.epoch);},"CORE_TEMPORAL_CANDIDATE_CAPSULE");
    const auto capsule=owner.captureReplacement(before.epoch);
    rejects([&]{owner.temporalCandidateAdopt(receipt.candidateId,source.sourceId,"2025-12",input.fingerprint,
        receipt.worldSha256,capsule+1,before.epoch);},"CORE_TEMPORAL_CANDIDATE_CAPSULE");
    rejects([&]{owner.temporalCandidateAdopt(receipt.candidateId+1,source.sourceId,"2025-12",input.fingerprint,
        receipt.worldSha256,capsule,before.epoch);},"CORE_TEMPORAL_CANDIDATE_STALE");
    rejects([&]{owner.temporalCandidateAdopt(receipt.candidateId,source.sourceId,"2025-12",
        std::string(64,'0'),receipt.worldSha256,capsule,before.epoch);},"CORE_TEMPORAL_CANDIDATE_PIN");
    rejects([&]{owner.temporalCandidateAdopt(receipt.candidateId,source.sourceId,"2025-12",
        input.fingerprint,std::string(64,'0'),capsule,before.epoch);},"CORE_TEMPORAL_CANDIDATE_PIN");
    sameState(owner,before,stored,selected,hovered,draftPoints);

    // The proposed commit path must match full Core baseline admission,
    // including project setup, documentId, selection reset and empty history.
    DocumentSession legacy(ports);legacy.documentLoad(seed,"2026-10");
    const auto baseline=legacy.storageBaselineLoad(input,legacy.projectState().epoch);
    legacy.documentLoadBaseline(baseline.storageBaselineId,config,"dated-project");
    const auto accepted=owner.temporalCandidateAdopt(receipt.candidateId,source.sourceId,"2025-12",
        input.fingerprint,receipt.worldSha256,capsule,before.epoch);
    assert(accepted.epoch>before.epoch&&accepted.storageBaselineId>0);
    assert(accepted.timelineCursor=="2025-12"&&!accepted.dirty&&!accepted.canUndo&&!accepted.canRedo);
    assert(!owner.selection().primary()&&!owner.selection().hover()&&!owner.draftActive());
    assert(owner.documentSnapshot()==legacy.documentSnapshot());
    assert(owner.storageSnapshot()==legacy.storageSnapshot());
    assert(owner.resolveWorld("2025-12").entities.size()==legacy.resolveWorld("2025-12").entities.size());
    assert(owner.temporalSourceStats().entries==0);
    assert(!owner.temporalCandidateInspect(receipt.candidateId,accepted.epoch));
    assert(!owner.temporalCandidateDiscard(receipt.candidateId,accepted.epoch));
    rejects([&]{owner.temporalCandidateAdopt(receipt.candidateId,source.sourceId,"2025-12",
        input.fingerprint,receipt.worldSha256,capsule,accepted.epoch);},"CORE_TEMPORAL_CANDIDATE_STALE");

    // Inject a failure in a *later* renderer/platform step: the existing
    // exact Core capsule restores all edit, selection and baseline owners.
    const auto restored=owner.rollbackReplacement(capsule,accepted.epoch);
    assert(restored.epoch>accepted.epoch);
    assert(restored.storageBaselineId==before.storageBaselineId);
    assert(restored.checkpoint==before.checkpoint&&restored.stateRevision==before.stateRevision);
    assert(restored.canUndo==before.canUndo&&restored.documentDirty==before.documentDirty);
    assert(owner.storageSnapshot()==stored);
    assert(owner.selection().primary()==selected&&owner.selection().hover()==hovered);
    assert(owner.draftActive()&&owner.draft().coordinates().size()==draftPoints);
    assert(!owner.releaseReplacement(capsule));
    assert(owner.temporalSourceStats().entries==0);
    assert(owner.undo(restored.epoch).result.changed());
    assert(owner.redo(owner.projectState().epoch).result.changed());
}
void discardedStaleAndAccepted(const std::string& seed) {
    DocumentSession owner(ports);owner.documentLoad(seed,"2026-10");
    const auto original=owner.projectState(),stored=owner.storageSnapshot();
    const auto first=bytesFor(owner.project(),"2025-12"),second=bytesFor(owner.project(),"2026-10");
    const auto a=owner.temporalSourcePrepare(first,"p5-4-data",pin,original.epoch);
    const auto b=owner.temporalSourcePrepare(second,"p5-4-data",pin,original.epoch);
    // The detached candidate is linked to a documentId and a validated
    // setup. Different IDs/setup versions cannot claim the same candidate.
    const auto older=owner.temporalCandidatePrepare(a.sourceId,"2025-12",first.fingerprint,
        original.epoch,setup("2025-12"),"A");
    const auto replacement=owner.temporalCandidatePrepare(b.sourceId,"2026-10",second.fingerprint,
        original.epoch,setup("2026-10"),"B");
    const auto newest=owner.temporalCandidatePrepare(a.sourceId,"2025-12",first.fingerprint,
        original.epoch,setup("2025-12"),"A");
    assert(older.candidateId<replacement.candidateId&&replacement.candidateId<newest.candidateId);
    assert(!owner.temporalCandidateInspect(older.candidateId,original.epoch));
    assert(!owner.temporalCandidateInspect(replacement.candidateId,original.epoch));
    assert(owner.temporalCandidateInspect(newest.candidateId,original.epoch));
    assert(owner.temporalCandidateDiscard(newest.candidateId,original.epoch));
    assert(!owner.temporalCandidateDiscard(newest.candidateId,original.epoch));
    assert(owner.temporalSourceStats().entries==2);
    const auto same=owner.temporalCandidatePrepare(a.sourceId,"2025-12",first.fingerprint,
        original.epoch,setup("2025-12"),"A");
    const auto reused=owner.temporalCandidatePrepare(a.sourceId,"2025-12",first.fingerprint,
        original.epoch,setup("2025-12"),"A");
    assert(reused.reused&&reused.candidateId==same.candidateId);
    const auto changedId=owner.temporalCandidatePrepare(a.sourceId,"2025-12",first.fingerprint,
        original.epoch,setup("2025-12"),"A-renamed");
    assert(!changedId.reused&&changedId.candidateId>same.candidateId);
    rejects([&]{owner.temporalCandidatePrepare(a.sourceId,"2025-12",first.fingerprint,
        original.epoch,setup("2026-10"),"Bad");},"CORE_TEMPORAL_CANDIDATE_SETUP");
    rejects([&]{owner.temporalCandidatePrepare(a.sourceId,"2025-12",first.fingerprint,
        original.epoch,setup("2025-12"),"");},"CORE_TEMPORAL_CANDIDATE_SETUP");
    assert(owner.temporalCandidateInspect(changedId.candidateId,original.epoch));
    const auto checkpoint=owner.captureReplacement(original.epoch);
    assert(owner.releaseReplacement(checkpoint));
    rejects([&]{owner.temporalCandidateAdopt(changedId.candidateId,a.sourceId,"2025-12",
        first.fingerprint,changedId.worldSha256,checkpoint,original.epoch);},"CORE_TEMPORAL_CANDIDATE_CAPSULE");
    assert(owner.storageSnapshot()==stored&&owner.projectState().epoch==original.epoch);
    const auto liveCapsule=owner.captureReplacement(original.epoch);
    const auto committed=owner.temporalCandidateAdopt(changedId.candidateId,a.sourceId,"2025-12",
        first.fingerprint,changedId.worldSha256,liveCapsule,original.epoch);
    assert(committed.timelineCursor=="2025-12");
    assert(owner.project().document().documentId=="A-renamed");
    assert(owner.releaseReplacement(liveCapsule));
    assert(!owner.releaseReplacement(liveCapsule));
    assert(!owner.temporalCandidateInspect(changedId.candidateId,committed.epoch));
    // File-open supersedes a still uncommitted candidate; no stale adoption.
    auto nextSource=owner.temporalSourcePrepare(bytesFor(owner.project(),"2025-12"),
        "p5-4-data",pin,committed.epoch);
    auto unfinished=owner.temporalCandidatePrepare(nextSource.sourceId,"2025-12",
        owner.temporalSourceLookup(nextSource.sourceId,committed.epoch)->fingerprint(),
        committed.epoch,setup("2025-12"),"uncommitted");
    owner.documentLoad(seed,"2026-10");
    assert(!owner.temporalCandidateInspect(unfinished.candidateId,owner.projectState().epoch));
    assert(owner.project().document().documentId!="uncommitted");
}
}
int main(){
    const auto seed=readSeed();
    capsuleRollbackAndInvalidRequests(seed);
    discardedStaleAndAccepted(seed);
    std::cout<<"P5-4 temporal commit, discard and capsule rollback passed\n";
}
