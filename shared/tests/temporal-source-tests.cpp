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
std::string readSeed() {
    std::ifstream input(TEMPORAL_SOURCE_FIXTURE,std::ios::binary);
    assert(input);return {std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>()};
}
WebStorageAssetSource source(const DocumentSession& session,const std::string& month="2026-10") {
    const auto bytes=encodeWeb(session.project().snapshot(),ports);
    WebStorageAssetSource value;
    value.sourceBytes.assign(bytes.begin(),bytes.end());
    value.encoding="identity";
    value.compressedBytes=bytes.size();
    value.decodedBytes=bytes.size();
    value.fingerprint=sha256Bytes(bytes);
    value.baseDataset="builtin-fixture";
    value.sourceMonth=month;
    return value;
}
template<class F>void rejects(F run,const std::string& code) {
    try {run(); assert(false);}
    catch(const TimelineError& error) {assert(error.code==code);}
}
void sameState(const DocumentSession& session,const DocumentSessionState& state,
    const std::string& serialized,const std::optional<SelectionRef>& primary) {
    const auto actual=session.projectState();
    assert(actual.epoch==state.epoch&&actual.stateRevision==state.stateRevision);
    assert(actual.revision==state.revision&&actual.checkpoint==state.checkpoint);
    assert(actual.presentationRevision==state.presentationRevision&&actual.presentationCheckpoint==state.presentationCheckpoint);
    assert(actual.timelineCursor==state.timelineCursor&&actual.dirty==state.dirty);
    assert(actual.canUndo==state.canUndo&&actual.canRedo==state.canRedo);
    assert(actual.documentDirty==state.documentDirty&&actual.presentationDirty==state.presentationDirty);
    assert(actual.storageBaselineId==state.storageBaselineId);
    assert(session.storageSnapshot()==serialized);
    assert(session.selection().primary()==primary);
}
void preparationAndPinValidation(const std::string& seed) {
    DocumentSession session(ports);session.documentLoad(seed,"2026-10");
    const SelectionRef selected{"territorial","entity","A"};
    // A live selection and a dirty history remain intact across prefetch.
    session.selection().replace(selected,"test");
    const auto before=session.projectState();
    const auto serialized=session.storageSnapshot();
    const auto primary=session.selection().primary();
    const auto input=source(session);
    auto first=session.temporalSourcePrepare(input,"2026-10-library",pin,before.epoch);
    assert(first.sourceId>0&&!first.reused&&first.fingerprint==input.fingerprint&&first.sourceMonth=="2026-10");
    assert(session.temporalSourceStats().entries==1&&session.temporalSourceStats().declaredDecodedBytes==input.decodedBytes);
    const auto stored=session.temporalSourceLookup(first.sourceId,before.epoch);
    assert(stored&&stored->sourceDocument()&&stored->sourceMonth()=="2026-10");
    assert(stored->sourceDocument()->units.size()==session.project().document().units.size());
    sameState(session,before,serialized,primary);
    auto duplicate=session.temporalSourcePrepare(input,"2026-10-library",pin,before.epoch);
    assert(duplicate.reused&&duplicate.sourceId==first.sourceId);
    assert(session.temporalSourceStats().hits==1&&session.temporalSourceStats().entries==1);
    assert(session.temporalSourceLookup(duplicate.sourceId,before.epoch)->sourceDocument()==stored->sourceDocument());
    sameState(session,before,serialized,primary);

    auto invalid=input;invalid.sourceBytes[0]^=1;
    rejects([&]{(void)session.temporalSourcePrepare(invalid,"2026-10-library",pin,before.epoch);},"PL-SCHEMA-BASE");
    invalid=input;invalid.fingerprint=std::string(64,'0');
    rejects([&]{(void)session.temporalSourcePrepare(invalid,"2026-10-library",pin,before.epoch);},"PL-SCHEMA-BASE");
    rejects([&]{(void)session.temporalSourcePrepare(input,"",pin,before.epoch);},"CORE_TEMPORAL_SOURCE_PIN");
    rejects([&]{(void)session.temporalSourcePrepare(input,"2026-10-library","invalid",before.epoch);},"CORE_TEMPORAL_SOURCE_PIN");
    invalid=input;invalid.sourceMonth="2026";
    rejects([&]{(void)session.temporalSourcePrepare(invalid,"2026-10-library",pin,before.epoch);},"PL-SCHEMA-BASE");
    invalid=input;invalid.decodedBytes=TEMPORAL_SOURCE_MAX_DECODED_BYTES+1;
    rejects([&]{(void)session.temporalSourcePrepare(invalid,"2026-10-library",pin,before.epoch);},"CORE_TEMPORAL_SOURCE_BUDGET");
    assert(session.temporalSourceStats().entries==1);
    sameState(session,before,serialized,primary);

    // Same exact geometry bytes at a different month/dataset/pin are distinct.
    auto second=session.temporalSourcePrepare(source(session,"2025-12"),"2026-10-library",pin,before.epoch);
    assert(second.sourceId!=first.sourceId&&session.temporalSourceStats().entries==2);
    auto again=session.temporalSourcePrepare(input,"2026-10-library",pin,before.epoch);
    assert(again.reused&&again.sourceId==first.sourceId);
    auto third=session.temporalSourcePrepare(input,"2026-11-library",pin,before.epoch);
    assert(!third.reused&&third.sourceId!=first.sourceId);
    assert(session.temporalSourceStats().entries==2&&session.temporalSourceStats().evictions>=1);
    assert(!session.temporalSourceLookup(second.sourceId,before.epoch));
    assert(session.temporalSourceLookup(first.sourceId,before.epoch));
    assert(session.temporalSourceRelease(first.sourceId,before.epoch));
    assert(!session.temporalSourceRelease(first.sourceId,before.epoch));
    assert(session.temporalSourceStats().entries==1);
    // The borrowed typed source is a ref-counted immutable value even after
    // an independent registry slot is evicted/released.
    assert(stored->sourceDocument()&&stored->sourceDocument()->units.size()>0);
    sameState(session,before,serialized,primary);

    try { (void)session.temporalSourcePrepare(input,"2026-10-library",pin,before.epoch+1); assert(false); }
    catch(const std::invalid_argument& error) {
        assert(std::string(error.what()).find("STALE_REVISION")!=std::string::npos);
    }
    sameState(session,before,serialized,primary);
}
void sessionInvalidation(const std::string& seed) {
    DocumentSession session(ports);session.documentLoad(seed,"2026-10");
    const auto before=session.projectState();
    const auto one=session.temporalSourcePrepare(source(session),"revision",pin,before.epoch);
    assert(session.temporalSourceStats().entries==1);
    session.documentLoad(seed,"2026-10");
    assert(session.temporalSourceStats().entries==0);
    assert(!session.temporalSourceLookup(one.sourceId,session.projectState().epoch));
    auto again=session.temporalSourcePrepare(source(session),"revision",pin,session.projectState().epoch);
    assert(again.sourceId>one.sourceId);
    const auto replacement=session.captureReplacement(session.projectState().epoch);
    session.documentLoad(seed,"2026-10");
    session.rollbackReplacement(replacement,session.projectState().epoch);
    assert(session.temporalSourceStats().entries==0);
    assert(!session.temporalSourceLookup(again.sourceId,session.projectState().epoch));
    assert(session.temporalSourceStats().declaredDecodedBytes==0);
}
}
int main(){
    const auto seed=readSeed();
    preparationAndPinValidation(seed);
    sessionInvalidation(seed);
    std::cout<<"P5-2 temporal immutable source tests passed\n";
}
