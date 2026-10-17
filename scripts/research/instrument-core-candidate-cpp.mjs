// Disposable CI-only C++ attribution. NEVER ship these modified C++ files.
// All measurements are written to stderr by the instrumented WASM module.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
assert.equal(process.env.PANDO_CORE_CANDIDATE_DIAGNOSTIC_ISOLATED,'1',
  'C++ stage probes must run in an isolated disposable checkout');

const replacements = [
  {
    path:'shared/core/src/commandbatch.cpp',
    from:'#include <set>',
    to:`#include <set>
#include <chrono>
#include <cstdio>
using Obj097Clock = std::chrono::steady_clock;
static void obj097BatchStage(const char* name, Obj097Clock::time_point begin) {
  const auto ms = std::chrono::duration<double,std::milli>(Obj097Clock::now()-begin).count();
  std::fprintf(stderr,"OBJ097_CXX_STAGE batch.%s %.3f\\n",name,ms);
  std::fflush(stderr);
}`,
  },
  {
    path:'shared/core/src/commandbatch.cpp',
    from:'    for(std::size_t index=0;index<count;++index) {\n        const auto request=build(current,index);\n        auto prepared=prepareRequest(current,request,{},operation=="document.batch"?std::string{}:operation);',
    to:`    for(std::size_t index=0;index<count;++index) {
        const auto decodeAt=Obj097Clock::now();
        const auto request=build(current,index);
        if(operation=="territorial.edit")obj097BatchStage("typedRequest",decodeAt);
        const auto prepareAt=Obj097Clock::now();
        auto prepared=prepareRequest(current,request,{},operation=="document.batch"?std::string{}:operation);
        if(operation=="territorial.edit")obj097BatchStage("prepareRequest",prepareAt);`,
  },
  {
    path:'shared/core/src/commandbatch.cpp',
    from:'    if(!checkpoint&&semanticallyEqual(original.document(),current.document())) {',
    to:`    const auto semanticAt=Obj097Clock::now();
    const auto semanticallySame=!checkpoint&&semanticallyEqual(original.document(),current.document());
    if(operation=="territorial.edit")obj097BatchStage("batchSemanticEqual",semanticAt);
    if(semanticallySame) {`,
  },
  {
    path:'shared/core/src/commandbatch.cpp',
    from:'    if(operation!="document.batch")try {finalState=std::make_shared<const detail::DocumentState>(current.document());}',
    to:`    if(operation!="document.batch")try {
        const auto validateAt=Obj097Clock::now();
        finalState=std::make_shared<const detail::DocumentState>(current.document());
        if(operation=="territorial.edit")obj097BatchStage("finalValidatedDocument",validateAt);
    }`,
  },
  {
    path:'shared/core/src/commandbatch.cpp',
    from:'    change->impact_=calculateChangeImpact(change->before(),change->after(),change->request_.targets,original.timelineMonth());',
    to:`    const auto impactAt=Obj097Clock::now();
    change->impact_=calculateChangeImpact(change->before(),change->after(),change->request_.targets,original.timelineMonth());
    if(operation=="territorial.edit")obj097BatchStage("finalChangeImpact",impactAt);`,
  },
  {
    path:'shared/core/src/commands.cpp',
    from:'#include <utility>',
    to:`#include <utility>
#include <chrono>
#include <cstdio>
using Obj097CoreClock = std::chrono::steady_clock;
static void obj097RequestStage(const char* name, Obj097CoreClock::time_point begin) {
  const auto ms = std::chrono::duration<double,std::milli>(Obj097CoreClock::now()-begin).count();
  std::fprintf(stderr,"OBJ097_CXX_STAGE request.%s %.3f\\n",name,ms);
  std::fflush(stderr);
}`,
  },
  {
    path:'shared/core/src/commands.cpp',
    from:`        if(const auto* edit=std::get_if<WebTerritorialEdit>(&request.args.action)) {
            validateRequest(project,request);
            auto candidate=applyWebTerritorialEdit(project,*edit,workflow=="territorial.library-import"?TerritorialEditContext::LibraryImport:TerritorialEditContext::UserCommand);`,
    to:`        if(const auto* edit=std::get_if<WebTerritorialEdit>(&request.args.action)) {
            const auto checkAt=Obj097CoreClock::now();
            validateRequest(project,request);
            if(workflow=="territorial.edit")obj097RequestStage("validateRequest",checkAt);
            const auto applyAt=Obj097CoreClock::now();
            auto candidate=applyWebTerritorialEdit(project,*edit,workflow=="territorial.library-import"?TerritorialEditContext::LibraryImport:TerritorialEditContext::UserCommand);
            if(workflow=="territorial.edit")obj097RequestStage("applyWebTerritorialEdit",applyAt);`,
  },
  {
    path:'shared/core/src/commands.cpp',
    from:`            if(semanticallyEqual(project.document(),candidate)){result.status=CommandStatus::NoOp;return result;}
            reconcileGeometryProvenance(project.document(),candidate);
            std::set<ObjectRef> created;for(const auto& unit:candidate.units)`,
    to:`            const auto sameAt=Obj097CoreClock::now();
            const auto sameCandidate=semanticallyEqual(project.document(),candidate);
            if(workflow=="territorial.edit")obj097RequestStage("semanticEqual",sameAt);
            if(sameCandidate){result.status=CommandStatus::NoOp;return result;}
            const auto provenanceAt=Obj097CoreClock::now();
            reconcileGeometryProvenance(project.document(),candidate);
            if(workflow=="territorial.edit")obj097RequestStage("reconcileProvenance",provenanceAt);
            std::set<ObjectRef> created;for(const auto& unit:candidate.units)`,
  },
  {
    path:'shared/core/src/commands.cpp',
    from:`            GeometryProvenanceCodecAccess::admitCreatedOpaqueBaseline(project.document(),candidate,created);
            auto after=candidateState(std::move(candidate));
            auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));`,
    to:`            GeometryProvenanceCodecAccess::admitCreatedOpaqueBaseline(project.document(),candidate,created);
            const auto stateAt=Obj097CoreClock::now();
            auto after=candidateState(std::move(candidate));
            if(workflow=="territorial.edit")obj097RequestStage("validatedCandidateState",stateAt);
            auto change=std::unique_ptr<ChangeSet>(new ChangeSet(project.state_,std::move(after),request));`,
  },
  {
    path:'shared/wasm/session-bindings.cpp',
    from:'#include <algorithm>',
    to:`#include <algorithm>
#include <chrono>
#include <cstdio>
using Obj097BindingClock=std::chrono::steady_clock;
static void obj097BindingStage(const char* name,Obj097BindingClock::time_point begin) {
  const auto ms=std::chrono::duration<double,std::milli>(Obj097BindingClock::now()-begin).count();
  std::fprintf(stderr,"OBJ097_CXX_STAGE binding.%s %.3f\\n",name,ms);
  std::fflush(stderr);
}`,
  },
  {
    path:'shared/wasm/session-bindings.cpp',
    from:`                auto outcome=session_.prepareBatch(count+(appendSource?1:0),[&](const ProjectSnapshot& candidate,std::size_t index){
                    if(index<count)return typedRequest(candidate,operations[static_cast<unsigned>(index)],ports_);`,
    to:`                const auto prepareAt=Obj097BindingClock::now();
                auto outcome=session_.prepareBatch(count+(appendSource?1:0),[&](const ProjectSnapshot& candidate,std::size_t index){
                    if(index<count) {
                        const auto decodeAt=Obj097BindingClock::now();
                        auto request=typedRequest(candidate,operations[static_cast<unsigned>(index)],ports_);
                        if(commandId=="territorial.edit")obj097BindingStage("decodeJsTerritorialRequest",decodeAt);
                        return request;
                    }`,
  },
  {
    path:'shared/wasm/session-bindings.cpp',
    from:`                },epoch,commandId);
                if(execute&&outcome.candidateId)outcome=session_.confirmCandidate(outcome.candidateId,epoch);
                return commandOutcome(outcome,session_);`,
    to:`                },epoch,commandId);
                if(commandId=="territorial.edit")obj097BindingStage("prepareBatchTotal",prepareAt);
                if(execute&&outcome.candidateId)outcome=session_.confirmCandidate(outcome.candidateId,epoch);
                const auto emitAt=Obj097BindingClock::now();
                auto webResult=commandOutcome(outcome,session_);
                if(commandId=="territorial.edit")obj097BindingStage("encodeOutcome",emitAt);
                return webResult;`,
  },
];

const checked=new Set();
for (const [index,{path,from,to}] of replacements.entries()) {
  const source=await readFile(path,'utf8');
  const matches = source.split(from).length - 1;
  // The impact assignment appears again in the optional copy-region branch.
  // Measure the primary territorial.edit impact calculation, not that branch.
  assert.equal(matches,index === 4 ? 2 : 1,'Unsafe C++ source anchor #'+index+' in '+path);
  if(!checked.has(path)) {
    assert.ok(!source.includes('OBJ097_CXX_STAGE'),'C++ source is already instrumented: '+path);
    checked.add(path);
  }
  await writeFile(path,source.replace(from,to));
  console.log('OBJ097_CXX_INSTRUMENTED',path,index);
}
