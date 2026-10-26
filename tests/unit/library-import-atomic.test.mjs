import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGisCoreFixture} from '../helpers/gis-core-fixture.mjs';
import {createTerritorialFeature,TERRITORIAL_COVERAGE_MODES} from "../../shared/frontend/js/modules/territorial-units.js";
import {createLibraryAssembly} from "../../apps/editor/frontend/js/modules/app-library-assembly.js";
import {createTerritorialLibraryService} from "../../apps/editor/frontend/js/modules/territorial-library-service.js";
import {TERRITORIAL_LIBRARY_SCHEMA_VERSION,normalizeTerritorialLibraryEntity} from "../../apps/editor/frontend/js/modules/territorial-library.js";
import {createTerritorialEntityLoader} from "../../apps/editor/frontend/js/modules/territorial-entity-loader.js";
import * as libraryOwnership from "../../apps/editor/frontend/js/modules/library-ownership.js";

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

async function libraryAssemblyHarness(t,finite,{impacts=false,entities,water=false}={}) {
  const h=await harness(t,{entities}),previousDocument=globalThis.document;
  globalThis.document={querySelector:()=>null};t.after(()=>{globalThis.document=previousDocument;});
  const entityId='state:fixture',sourceGeometry={type:'Polygon',coordinates:[[[2,0],[2,1],[3,1],[3,0],[2,0]]]};
  const entity=normalizeTerritorialLibraryEntity({entityId,lineageId:'fixture',entityKind:water?'lake':'general',names:{en:'Fixture'},schemaVersion:2,
    lifetime:{validFrom:finite?'1900':null,validTo:finite?'1991-12':null},metadata:{defaultFlagDataUrl:'data:image/svg+xml;base64,ZmxhZw==',fixtureProvenance:'immutable-source'},
    sourceInfo:{title:'Fixture source',license:'test'},geometryVersions:[{versionId:'fixture:1',geometry:sourceGeometry,
      validFrom:finite?'1900':null,validTo:finite?'1991-12':null}]});
  const stored=gzipSync(Buffer.from(JSON.stringify(entity)));
  const entry={...entity,validFrom:entity.lifetime.validFrom,validTo:entity.lifetime.validTo,bbox:[2,0,3,1],
    geometryVersions:entity.geometryVersions.map(({geometry,...version})=>version),file:'state-fixture.json.gz',geometryVersionCount:1,
    compressedBytes:stored.length,decodedBytes:Buffer.byteLength(JSON.stringify(entity)),sha256:createHash('sha256').update(stored).digest('hex')};
  const index=Buffer.from(JSON.stringify({schemaVersion:TERRITORIAL_LIBRARY_SCHEMA_VERSION,snapshots:[],entities:[entry],
    lineages:[{lineageId:'fixture',names:{en:'Fixture'},entityRefs:[entityId],relations:[]}]}));
  globalThis.window.PANDOLAB_BUILD_META={dataRevision:'unit-test',territorialIndex:{encoding:'identity',compressedBytes:index.length,
    decodedBytes:index.length,sha256:createHash('sha256').update(index).digest('hex')}};
  t.mock.method(globalThis,'fetch',async url=>new Response(String(url).includes('state-fixture.json.gz')?stored:index));
  let allocated=0,controllerOptions;const operations=[],fakeElement={querySelector:()=>null};
  const assembly=createLibraryAssembly();assembly.connect({projectState:{state:h.state},countries:{get countryLandRevision(){return h.client.state().revision;}},
    domains:{projectDomain:h.project,renderingDomain:{invalidateProject:()=>operations.push('render')}},
    territorialModel:{entityRepository:h.repository,TERRITORIAL_COVERAGE_MODES},
    libraryServices:{...libraryOwnership,ensureTerritorialLibraryRuntime:noop,territorialEntityLoaderModule:{createTerritorialEntityLoader},
      territorialLibraryServiceModule:{createTerritorialLibraryService},territorialLibraryControllerModule:{createTerritorialLibraryController:options=>{controllerOptions=options;return {connect:noop};}}},
    gisRuntime:{gisWorkflow:{ensure:noop},getGisImportCommitter:async()=>h.committer},applicationServicesA:{ensureModalRuntime:noop},
    platform:{$:()=>fakeElement},platformConfigurationA:{TERRITORIAL_LIBRARY_INDEX_URL:'https://fixture/index.json'},platformConfigurationB:{},propertyEditingB:{},
    territorialServicesA:{createTerritorialFeature},objectPresentation:{territorialEntityName:entity=>entity.properties.name},
    surfaces:{uid:()=>`generated-${++allocated}`},workspaceUiA:{},workspaceUiB:{},feedback:{},
    spatialQuery:{mapEditClient:{sourcesCurrent:revision=>revision===h.client.state().epoch,execute:async(operation,{payload})=>{
      assert.equal(operation,'territorial-library-batch');return {sourceRevision:h.client.state().epoch,result:{features:payload.countries,removedIds:[],precisionDiscards:[],
        affectedIds:payload.countries.map(row=>row.id),donorIds:[],transfers:[],deleted:0,impacts:impacts?[{name:'A',area:1,deleted:false}]:[]}};}}},
    objectDisplay:{invalidateObjectPresentation:()=>operations.push('layers')},spatialRecords:{scheduleMapObjectSpatialIndexRebuild:()=>operations.push('index')},
    projectSession:{saveState:{markNewProject:()=>operations.push('new-project')}},
  });
  assembly.initializeTerritorialLibraryService();const api=globalThis.window.PANDOLAB_TERRITORIAL_LIBRARY;await api.load();
  return {...h,api,operations,entityId,geometry:sourceGeometry,source:structuredClone(await api.get(entityId)),controller:()=>controllerOptions};
}

test('finite source imports as static geometry with original dates and actual reversible archive',async t=>{
  const h=await libraryAssemblyHarness(t,true),before=snapshot(h),checkpoint=h.client.state().checkpoint;
  await h.api.instantiate(h.entityId,'1914');const added=rows(h).find(item=>item.properties.sourceEntityId===h.entityId);
  assert.notEqual(added.id,h.entityId);assert.equal(added.properties.validFrom,null);assert.equal(added.properties.validTo,null);
  assert.deepEqual(added.properties.metadata.sourceLifetime,{validFrom:'1900',validTo:'1991-12'});
  assert.equal(added.properties.metadata.sourceReferenceDate,'1914');assert.deepEqual(added.geometry,h.geometry);assert.equal(h.client.state().checkpoint,checkpoint+1);
  const after=snapshot(h);await h.project.undo();assert.deepEqual(snapshot(h),before);await h.project.redo();assert.deepEqual(snapshot(h),after);
  assert.deepEqual(await h.api.get(h.entityId),h.source);
});

test('static library merge preserves source metadata, flag, geometry version and one Core history entry',async t=>{
  const h=await libraryAssemblyHarness(t,false),initial=rows(h),before=snapshot(h),generation=h.project.getGeneration(),checkpoint=h.client.state().checkpoint;
  assert.equal(h.controller().getProjectGeneration(),generation);const result=await h.api.instantiate(h.entityId,'2026-10-06');
  assert.equal(result.added,1);assert.notEqual(rows(h),initial);assert.equal(h.controller().getProjectGeneration(),generation);
  const added=rows(h).find(item=>item.properties.sourceEntityId===h.entityId);
  assert.equal(added.properties.sourceGeometryVersion,'fixture:1');assert.equal(added.properties.metadata.flagDataUrl,'data:image/svg+xml;base64,ZmxhZw==');
  assert.equal(added.properties.metadata.fixtureProvenance,'immutable-source');assert.deepEqual(added.geometry,h.geometry);
  assert.equal(added.properties.validFrom,null);assert.equal(added.properties.validTo,null);assert.equal(h.client.state().checkpoint,checkpoint+1);
  assert.equal(h.state.sourceInfo.imports[0].sourceId,h.entityId);assert.equal(h.state.sourceInfo.imports[0].geometryVersionId,'fixture:1');
  assert.equal(h.state.sourceInfo.imports[0].license,'test');await h.project.undo();assert.deepEqual(snapshot(h),before);assert.deepEqual(await h.api.get(h.entityId),h.source);
});

test('source-equal project identity and edited earlier copy survive repeated import and Undo',async t=>{
  const unrelated=feature('state:fixture',{name:'Unrelated',geometry:{type:'Polygon',coordinates:[[[10,0],[10,1],[11,1],[11,0],[10,0]]]}});
  const h=await libraryAssemblyHarness(t,false,{entities:[feature('A'),unrelated]});await h.api.instantiate(h.entityId,'2026');
  const first=rows(h).find(row=>row.properties.sourceEntityId===h.entityId);
  const edited={...first,geometry:{type:'Polygon',coordinates:[[[4,0],[4,1],[5,1],[5,0],[4,0]]]},properties:{...first.properties,name:'Edited copy'}};
  const edit=await h.project.executeCommand({commandId:'territorial.patch',targets:[{domain:'territorial',id:first.id}],payload:{features:[edited]}});assert.equal(edit.ok,true);
  const before=snapshot(h),checkpoint=h.client.state().checkpoint;await h.api.instantiate(h.entityId,'2026');
  const copies=rows(h).filter(row=>row.properties.sourceEntityId===h.entityId);assert.equal(copies.length,2);assert.notEqual(copies[0].id,copies[1].id);
  assert.equal(copies[0].properties.name,'Edited copy');assert.deepEqual(copies[1].geometry,h.geometry);assert.notDeepEqual(copies[0].geometry,copies[1].geometry);
  assert.ok(copies.every(row=>row.id!==h.entityId));assert.equal(h.repository.get(h.entityId).properties.name,'Unrelated');assert.equal(h.client.state().checkpoint,checkpoint+1);
  await h.project.undo();assert.deepEqual(snapshot(h),before);await h.project.redo();assert.equal(rows(h).filter(row=>row.properties.sourceEntityId===h.entityId).length,2);
  assert.deepEqual(await h.api.get(h.entityId),h.source);
});

test('out-of-lifetime library import preserves complete Core session and never reaches commit',async t=>{
  const h=await libraryAssemblyHarness(t,true),before=snapshot(h),state=h.client.state();
  await assert.rejects(h.api.instantiate(h.entityId,'2000'),/경계|시점/);assert.deepEqual(snapshot(h),before);
  assert.equal(h.client.state().checkpoint,state.checkpoint);assert.equal(h.client.state().epoch,state.epoch);assert.equal(h.project.canUndo(),false);
  assert.deepEqual(h.events,[]);assert.deepEqual(h.operations,[]);
});

test('original library impact approval leaves the project unchanged until explicit confirmation',async t=>{
  const h=await libraryAssemblyHarness(t,false,{impacts:true}),before=snapshot(h),checkpoint=h.client.state().checkpoint;
  const options=h.controller(),pending=await options.instantiate([h.entityId],'2026','none');
  assert.equal(pending.confirmationRequired,true);assert.ok(pending.impactKey);assert.deepEqual(snapshot(h),before);assert.equal(h.project.canUndo(),false);assert.deepEqual(h.operations,[]);
  const result=await options.instantiate([h.entityId],'2026','none',{confirmedImpact:pending.impactKey});
  assert.equal(result.added,1);assert.equal(h.client.state().checkpoint,checkpoint+1);await h.project.undo();assert.deepEqual(snapshot(h),before);
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

test('water library import uses one common Core batch, preserves country identities and Undo/Redo',async t=>{
 const h=await libraryAssemblyHarness(t,true,{water:true}),before=snapshot(h),checkpoint=h.client.state().checkpoint;
 const result=await h.api.instantiate(h.entityId,'1923-01');assert.equal(result.added,1);
 assert.deepEqual(h.documentModel.snapshot().territorialEntities,before.territorialEntities);
 const water=h.documentModel.snapshot().hydroEdits.at(-1);assert.equal(water.properties.category,'lake');assert.equal(water.geometry,null);
 assert.equal(h.documentModel.snapshot().timelineRecords.parentRelations.some(row=>row.objectRef.domain==='hydro'),false);
 assert.equal(h.client.state().checkpoint,checkpoint+1);
 const after=snapshot(h);await h.project.undo();assert.deepEqual(snapshot(h),before);await h.project.redo();assert.deepEqual(snapshot(h),after);
});
