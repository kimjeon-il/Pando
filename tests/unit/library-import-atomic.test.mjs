import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGisCoreFixture} from '../helpers/gis-core-fixture.mjs';
import {createTerritorialFeature,TERRITORIAL_COVERAGE_MODES} from "../../shared/frontend/js/modules/territorial-units.js";


import {TERRITORIAL_LIBRARY_SCHEMA_VERSION,normalizeTerritorialLibraryEntity} from "../../tools/gis/territorial-library.js";



const noop=()=>{};
const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]};
const feature=(id,properties={})=>createTerritorialFeature({id,entityKind:'general',name:id,geometry,...properties});
const collection=features=>({type:'FeatureCollection',features});
const snapshot=h=>structuredClone(h.documentModel.snapshot());
const rows=h=>h.store.snapshot();
const importEnvelope=(features,removedIds=[])=>({commandId:'territorial.library-import',targets:[],payload:{
  operations:[{commandId:'territorial.patch',
    targets:[...new Set([...features.map(feature=>String(feature.id)),...removedIds.map(String)])].map(id=>({domain:'territorial',id})),
    payload:{features,removedIds}}],
  sourceInfo:{next:{imports:[{kind:'library',sourceId:'state:fixture',license:'test'}]},mergedAt:'2026-10-06T00:00:00.000Z'},
}});

async function harness(t,{invalidChild=false,failTransfer=false,failPresentation=false,entities=[feature('A')],validateCalls=null}={}) {
  const previousWindow=globalThis.window,platformEvents=[];
  t.after(()=>{globalThis.window=previousWindow;});
  const runtime={createGisImportError:(message,details)=>Object.assign(new Error(message),details),
    RELIABILITY_ERROR_CATEGORIES:{GEOMETRY:'geometry'}};
  if(validateCalls)runtime.validateGisCountryCollection=async (_collection,affected,options)=>{validateCalls.push({affected,options});return {overlapAreaKm2:0};};
  if(failTransfer)runtime.planTransferLandDependents=()=>{throw new Error('dependent geometry failed');};
  if(failPresentation)runtime.markCountryGeometriesChanged=()=>{throw new Error('accepted platform failed');};
  const h=await createGisCoreFixture(entities,{fields:{sourceInfo:null},runtime});
  Object.defineProperty(h.state,'projectReplacing',{get:h.project.isReplacing});
  const imported=feature('NEW'),child=feature('CHILD',{parentId:invalidChild?'missing':'NEW'});
  const result={countriesData:collection([imported]),preparedTerritorialUnits:[child],
    landTransfers:invalidChild?[]:[{targetId:'NEW',geometry,donorIds:['A']}],
    sourceInfo:{imports:[{kind:'library',sourceId:'state:fixture',license:'test'}]}};
  const plan={countriesData:collection([imported]),affectedIds:['A','NEW'],counts:{added:2}};
  return {...h,platformEvents,result,plan,run:()=>h.committer.commitGisMerge(result,plan)};
}

test('country transfer and library children commit one actual Core Undo with source metadata',async t=>{
  const h=await harness(t),before=snapshot(h),checkpoint=h.client.state().checkpoint;
  const outcome=await h.run();assert.equal(outcome.added,2);
  assert.deepEqual(rows(h).map(row=>row.id),['NEW','CHILD']);assert.equal(h.repository.get('CHILD').properties.parentId,'NEW');
  assert.equal(h.client.state().checkpoint,checkpoint+1);assert.equal(h.client.state().stateRevision,1);
  assert.equal(h.project.canUndo(),true);assert.deepEqual(h.events,['history','save']);
  assert.deepEqual(h.state.sourceInfo.imports,[{kind:'library',sourceId:'state:fixture',license:'test'}]);
  const after=snapshot(h);await h.project.undo();assert.deepEqual(snapshot(h),before);await h.project.redo();assert.deepEqual(snapshot(h),after);
});

test('actual invalid child relation leaves countries, children, source and Core history unchanged',async t=>{
  const h=await harness(t,{invalidChild:true}),before=snapshot(h),state=h.client.state();
  await assert.rejects(h.run(),/parent|missing|관계/i);assert.deepEqual(snapshot(h),before);assert.equal(h.project.canUndo(),false);
  assert.equal(h.client.state().checkpoint,state.checkpoint);assert.equal(h.client.state().stateRevision,state.stateRevision);assert.deepEqual(h.events,[]);
});

test('dependent geometry failure before approval cannot mutate the readonly document or Core history',async t=>{
  const h=await harness(t,{failTransfer:true}),before=snapshot(h),state=h.client.state();
  await assert.rejects(h.run(),/dependent geometry failed/);assert.deepEqual(snapshot(h),before);assert.equal(h.project.canUndo(),false);
  assert.equal(h.client.state().epoch,state.epoch);assert.deepEqual(h.events,[]);assert.equal(Object.isFrozen(h.state.distributionEntries),true);
});

test('cancelled request cannot commit after asynchronous geometry validation',async t=>{
  const h=await harness(t),before=snapshot(h);h.result.assertCurrent=()=>{throw new Error('cancelled');};
  await assert.rejects(h.run(),/cancelled/);assert.deepEqual(snapshot(h),before);assert.equal(h.project.canUndo(),false);assert.deepEqual(h.events,[]);
});

test('retained library preview changes nothing until approval and cancellation consumes the candidate',async t=>{
  const h=await harness(t),before=snapshot(h),state=h.client.state();
  const prepared=await h.project.prepareCommand(importEnvelope([feature('NEW'),feature('CHILD',{parentId:'NEW'})],['A']));
  assert.equal(prepared.ok,true);assert.equal(prepared.changed,true);assert.ok(prepared.candidateId);
  assert.deepEqual(prepared.preview.territorialViews.map(row=>row.id),['NEW','CHILD']);assert.deepEqual(snapshot(h),before);
  assert.equal(h.client.state().checkpoint,state.checkpoint);assert.equal(h.project.canUndo(),false);
  await h.project.cancelCandidate(prepared.candidateId);
  await assert.rejects(h.project.confirmCandidate(prepared.candidateId,prepared.state.epoch),error=>error.code==='PL-CORE-STALE');
  assert.deepEqual(snapshot(h),before);assert.deepEqual(h.events,[]);
  const accepted=await h.project.prepareCommand(importEnvelope([feature('NEW')],['A']));
  assert.equal((await h.project.confirmCandidate(accepted.candidateId,accepted.state.epoch)).changed,true);
  assert.deepEqual(rows(h).map(row=>row.id),['NEW']);assert.equal(h.client.state().checkpoint,state.checkpoint+1);
  await h.project.undo();assert.deepEqual(snapshot(h),before);
});

test('post-confirm platform failure rolls back actual document, selection, draft and history',async t=>{
  const h=await harness(t,{failPresentation:true});
  await h.client.selectionApply({action:'replace',ref:{domain:'territorial',type:'entity',id:'A'}});
  await h.client.draftApply({action:'start',shape:'line',coords:[[0,0],[1,1]],inputPhase:'draw'});
  const before=snapshot(h),state=h.client.state(),selection=await h.client.selectionSnapshot(),draft=await h.client.draftSnapshot();
  await assert.rejects(h.run(),/accepted platform failed/);assert.deepEqual(snapshot(h),before);
  assert.equal(h.client.state().checkpoint,state.checkpoint);assert.equal(h.client.state().stateRevision,state.stateRevision);assert.equal(h.project.canUndo(),false);
  assert.deepEqual(await h.client.selectionSnapshot(),selection);assert.deepEqual(await h.client.draftSnapshot(),draft);assert.deepEqual(h.events,[]);
});













test('GIS library commit limits pair checks to growing roots without dropping donor shape validation',async t=>{
  const calls=[];
  const h=await harness(t,{entities:[feature('A')] , validateCalls:calls});
  h.plan.overlapAffectedIds=['NEW'];
  await h.run();
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].affected,['A','NEW']);
  assert.deepEqual(calls[0].options,{overlapAffectedIds:['NEW']});
});
