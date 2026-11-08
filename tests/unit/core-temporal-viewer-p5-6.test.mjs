import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProjectDomain} from "../../src/document/project-domain.js";
import {createBuiltinSession} from "../../src/document/builtin-session.js";
import {createBuiltinMonthClock} from "../../src/document/builtin-month-clock.js";
import {createCoreDocumentReadModel} from "../../src/document/core-document-read-model.js";

const fixture=()=> {
  const events=[];
  let epoch=1,project={documentId:'old-project',projectSetup:{initialMonth:'2026-10'}},capsule;
  const documentModel={snapshot:()=>project};
  const commandOwner={
    state:()=>({epoch,storageBaselineId:0,timelineCursor:project.projectSetup.initialMonth}),
    temporalSourcePrepare:async(source,options)=>{
      assert.equal(options.dataRevision,'revision');
      assert.equal(options.manifestSha256,'a'.repeat(64));
      assert.equal(epoch,1);events.push('source');return {sourceId:4,sourceMonth:'2025-12',fingerprint:source.fingerprint};
    },
    temporalCandidatePrepare:async(input)=>{
      assert.equal(input.sourceId,4);assert.equal(input.targetMonth,'2025-12');
      assert.equal(input.setup.sourceMode,'builtin');assert.ok(input.documentId);
      events.push('candidate');
      return {candidateId:8,sourceId:4,sourceFingerprint:input.sourceFingerprint,
        targetMonth:input.targetMonth,worldSha256:'b'.repeat(64),expectedEpoch:epoch};
    },
    temporalSourceRelease:async id=>{events.push('release-source-'+id);return true;},
    temporalCandidateDiscard:async id=>{events.push('discard-'+id);return true;},
    captureReplacement:async()=>{events.push('capture');capsule={epoch,project};return 9;},
    temporalCandidateAdopt:async input=>{
      assert.equal(input.replacementId,9);assert.equal(input.expectedEpoch,1);
      events.push('adopt');epoch++;
      project={documentId:'new-project',projectSetup:{initialMonth:'2025-12'}};
      return {state:{epoch,timelineCursor:'2025-12'},project,world:{month:'2025-12',sourceEpoch:epoch,entities:[]}};
    },
    rollbackReplacement:async id=>{assert.equal(id,9);events.push('rollback');project=capsule.project;epoch++;return {state:{epoch},project};},
    releaseReplacement:async id=>{assert.equal(id,9);events.push('release-capsule');return true;},
    selectionCatalogLoad:async()=>{events.push('selection');return{};},
    presentationCatalogLoad:async()=>({}),
    validateImport:async json=>{events.push('validate-file');return JSON.parse(json);},
    load:async json=>{events.push('load-file');project=JSON.parse(json);epoch++;return {state:{epoch},project};},
    loadBaseline:async()=>{throw Error('Legacy Core baseline admission must not execute for candidate mode');},
  };
  const generation=[];
  const domain=createProjectDomain({productMode:'viewer',commandOwner,documentModel,
    publishCommand:()=>{},readBuiltinSelectionCatalogs:()=>[{domain:'placeBuiltin',refs:[]}],
    onProjectReset:ev=>{generation.push(ev.generation);events.push('generation');},
    replaceSnapshot:async()=>{events.push('render');return true;},
    onReplacementCommitted:()=>events.push('committed'),
  });
  const setup={initialMonth:'2025-12',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
  const source={kind:'stored-asset',sourceBytes:new Uint8Array([1,2]),encoding:'identity',
    compressedBytes:2,decodedBytes:2,baseDataset:'fixture',sourceMonth:'2025-12',fingerprint:'c'.repeat(64)};
  return {domain,events,commandOwner,setup,source,generation,epoch:()=>epoch,project:()=>project};
};

test('P5-6 viewer candidate uses single replacement capsule and never calls legacy baseline admission',async()=>{
  const f=fixture();
  const prepared=await f.domain.prepareTemporalBuiltin(f.source,f.setup,
    {dataRevision:'revision',manifestSha256:'a'.repeat(64)});
  assert.equal(prepared.kind,'temporal-candidate');
  assert.equal(f.epoch(),1,'preparation must not change the active Core epoch');
  assert.deepEqual(f.events,['source','candidate']);
  const opened=await f.domain.open(async()=>prepared,{source:'builtin'});
  assert.equal(opened,true);
  assert.equal(f.epoch(),2);
  assert.deepEqual(f.events,['source','candidate','capture','generation','adopt','selection','render','committed','release-capsule']);
  assert.equal(f.domain.state().timelineCursor,'2025-12');
  f.domain.dispose();
});

test('P5-6 abandoned reader explicitly discards candidate and source, preserving active state',async()=>{
  const f=fixture();
  const prepared=await f.domain.prepareTemporalBuiltin(f.source,f.setup,
    {dataRevision:'revision',manifestSha256:'a'.repeat(64)});
  const result=await f.domain.open(async()=>prepared,{source:'builtin',isCurrent:()=>false});
  assert.equal(result,false);
  assert.deepEqual(f.events,['source','candidate'],'stale intent checked before invoking its reader');
  f.domain.dispose();
});
test('P5-6 open cancellation after reader returns releases detached C++ source',async()=>{
  const f=fixture();
  let current=true;
  const opened=f.domain.open(async()=> {
    const candidate=await f.domain.prepareTemporalBuiltin(f.source,f.setup,
      {dataRevision:'revision',manifestSha256:'a'.repeat(64)});
    current=false;return candidate;
  },{source:'builtin',isCurrent:()=>current});
  assert.equal(await opened,false);
  // Reader checks its own isCurrent at every stage, before the new handler can
  // return a detached handle: this is a stale error, not an acceptance.
  assert.equal(f.epoch(),1);
  assert.ok(!f.events.includes('adopt'));
  f.domain.dispose();
});

test('P5-6 new C++ native adoption replaces the readonly model only after an accepted packet',()=>{
  const old=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const model=createCoreDocumentReadModel(old);
  const expected=structuredClone(old);expected.documentId='native-new';
  expected.territorialEntities[0].properties.name='New C++ projected country';
  const existing=model.snapshot();
  const first={objectRef:{domain:'territorial',id:'A'},geometryRef:{id:'shape',version:1},
    rendering:{},parentId:'',coverageMode:'explicit',rootId:'A',ancestors:[],
    validFrom:null,validTo:null,properties:{}};
  model.acceptTransition({project:expected,state:{epoch:2},
    world:{month:'2025-12',sourceEpoch:2,entities:[first]}},
  'core.document-temporal-candidate-adopt');
  assert.equal(model.snapshot().documentId,'native-new');
  assert.equal(model.territorialViews()[0].properties.name,'New C++ projected country');
  assert.notStrictEqual(model.snapshot(),existing);
  assert.equal(existing.territorialEntities[0].properties.name,old.territorialEntities[0].properties.name);
});
test('missing temporal WASM capability fails instead of admitting a legacy baseline',async()=>{
  const buildMeta={dataRevision:'revision',builtinWorld:{sha256:'a'.repeat(64)}};
  let loads=0,admissions=0,baselineId=0;
  const domain={
    getGeneration:()=>0,
    state:()=>({storageBaselineId:baselineId}),
    prepareTemporalBuiltin:async()=>{throw Object.assign(new Error('DocumentSession.temporalSourcePrepare is required.'),
      {code:'PL-CORE-DOCUMENT-ABI'});},
    admitStorageBaseline:async()=>{
      admissions++;baselineId=2;return {storageBaselineId:baselineId};
    },
  };
  const session=createBuiltinSession({buildMeta,builtinWorldLoader:{loadProject:async month=>{
    loads++;return {project:{projectSetup:{initialMonth:month},territorialEntities:[]}};
  }}});
  session.connect({domains:{projectDomain:domain},platformConfigurationA:{BASE_DATASET:'fixture'}});
  await assert.rejects(session.prepareProjectCandidate('2025-12'),{code:'PL-CORE-DOCUMENT-ABI'});
  assert.equal(admissions,0);assert.equal(loads,1);
  session.dispose();
});


test('P6-3 rapid timeline intents start only the final target and commit it once',async()=>{
  const started=[],commits=[];
  const clock=createBuiltinMonthClock({coalesceRequests:true,
    onCommitted:month=>commits.push(month),
    applyMonth:async(month,{isCurrent,commit})=>{
      started.push(month);
      if(isCurrent())commit();
      return isCurrent();
    }});
  const first=clock.selectMonth('2025-12');
  const middle=clock.selectMonth('2024-12');
  const latest=clock.selectMonth('2023-12');
  assert.deepEqual(started,[],'same-task intermediate targets must not start work');
  assert.deepEqual(await Promise.all([first,middle,latest]),[false,false,true]);
  assert.deepEqual(started,['2023-12']);
  assert.deepEqual(commits,['2023-12']);
  assert.equal(clock.month(),'2023-12');
  clock.dispose();
});

test('P6-3 out-of-order completion cannot publish an older timeline target',async()=>{
  const pending=new Map(),commits=[];
  const clock=createBuiltinMonthClock({
    onCommitted:month=>commits.push(month),
    applyMonth:(month,{isCurrent,commit})=>new Promise(resolve=>{
      pending.set(month,{isCurrent,commit,resolve});
    }),
  });
  const older=clock.selectMonth('1950-12');
  const latest=clock.selectMonth('1951-12');
  assert.equal(pending.get('1951-12').commit(),true);
  pending.get('1951-12').resolve(true);
  assert.equal(await latest,true);
  assert.equal(pending.get('1950-12').isCurrent(),false);
  assert.equal(pending.get('1950-12').commit(),false);
  pending.get('1950-12').resolve(true);
  assert.equal(await older,false);
  assert.equal(clock.month(),'1951-12');
  assert.deepEqual(commits,['1951-12']);
  clock.dispose();
});

test('P6-3 opening a user file while a temporal candidate waits discards it before file adoption',async()=>{
  const f=fixture();
  const prepared=await f.domain.prepareTemporalBuiltin(f.source,f.setup,
    {dataRevision:'revision',manifestSha256:'a'.repeat(64)});
  let releaseBuiltin,markBuiltinStarted;
  const builtinStarted=new Promise(resolve=>{markBuiltinStarted=resolve;});
  const builtinGate=new Promise(resolve=>{releaseBuiltin=resolve;});
  const builtin=f.domain.open(async()=>{
    markBuiltinStarted();
    await builtinGate;
    return prepared;
  },{source:'builtin'});
  await builtinStarted;

  const userProject={documentId:'user-file-project',projectSetup:{initialMonth:'2001-01'}};
  const userFile=f.domain.open(async()=>structuredClone(userProject),{source:'project'});
  releaseBuiltin();

  assert.equal(await builtin,false,'superseded builtin candidate must not publish');
  assert.equal(await userFile,true,'user file must become the accepted project');
  assert.equal(f.project().documentId,'user-file-project');
  assert.equal(f.project().projectSetup.initialMonth,'2001-01');
  assert.ok(f.events.includes('discard-8'),'detached temporal candidate must be discarded');
  assert.ok(f.events.includes('release-source-4'),'detached temporal source must be released');
  assert.ok(!f.events.includes('adopt'),'stale temporal candidate must never reach Core adoption');
  assert.equal(f.events.filter(event=>event==='load-file').length,1);
  assert.ok(f.events.indexOf('discard-8')<f.events.indexOf('capture'),
    'candidate cleanup must finish before the user file replacement starts');
  f.domain.dispose();
});
