import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCountryFeature } from "../../shared/frontend/js/modules/country-feature.js";
import { normalizePlace } from "../../shared/frontend/js/modules/place-contract.js";
import { createObjectCommands } from "../../apps/editor/frontend/js/modules/app-object-commands.js";
import { createGenericCommands } from "../../apps/editor/frontend/js/modules/app-generic-commands.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { readFileSync } from 'node:fs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import {initializeTestTerritorialState,testCoreProject,executeTerritorialTestCommand,executeTestCommand,staticAutosaveProject} from '../helpers/timeline-project.mjs';
import {loadWebOracle} from '../helpers/web-oracle.mjs';
import {normalizeLayerPresentation} from "../../shared/frontend/js/modules/layer-presentation.js";
import {BUILTIN_SUBUNITS} from "../../shared/frontend/js/modules/builtin-subunits.js";
const {fingerprintProjectBaseline}=await loadWebOracle('assets/js/modules/project-serializer.js');
const source=normalizePlace({source:'synthetic',sourceId:'1',name:'서울',kind:'capital',coordinates:[127,37]});
const polygon=(east=1)=>({type:'Polygon',coordinates:[[[0,0],[0,1],[east,1],[0,0]]]});
const country=id=>normalizeCountryFeature({type:'Feature',id,properties:{name:id},geometry:polygon()});
const fullSeed=()=>JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
async function fixture(features=[country('KOR')],fields={}) {
  const state={territorialEntities:features,...fields};
  const {itemVisibility:workspaceItems,...authored}=fields;
  await initializeTestTerritorialState(state,null,{project:{...staticAutosaveProject(authored,features),baseDataset:'fixture'}});
  if(workspaceItems)testCoreProject(state).viewing.session.setViewingPresentation({itemVisibility:{...testCoreProject(state).viewing.session.state.itemVisibility,...workspaceItems}});
  return {state,...testCoreProject(state)};
}
const view=(state,payload)=>executeTestCommand(state,{commandId:'presentation.apply',targets:[],payload});
const createLabel=(state,id='22000000-0000-4000-8000-000000000019',settings)=>executeTestCommand(state,{
  commandId:'label.edit',targets:[{domain:'label',id}],payload:{domain:'label',id,create:true,value:{...fullSeed().labels[0],id,
    territorialUnitId:'',source:{...fullSeed().labels[0].source,details:{}}},...(settings?{labelSettings:settings}:{})}});

test('real Core history restores shared, unused and past archive entries after static geometry edit and Undo/Redo',async()=>{
  const input=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/static.json',import.meta.url),'utf8')),
    expected=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/static.expected.json',import.meta.url),'utf8'));
  const f=await fixture([]);await f.project.admit(input);const before=structuredClone(f.project.snapshot());
  const geometry={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]]]};
  await executeTerritorialTestCommand(f.state,'territorial.geometry',{id:'C',geometry});const after=f.project.snapshot();
  assert.deepEqual(after.territorialEntities,expected.territorialEntities);
  assert.deepEqual(after.timelineRecords.lifetimes,expected.timelineRecords.lifetimes);
  assert.deepEqual(after.timelineRecords.parentRelations,expected.timelineRecords.parentRelations);
  assert.equal(after.geometries.length,expected.geometries.length+1);
  for(const entry of expected.geometries)assert.deepEqual(after.geometries.find(row=>row.id===entry.id&&row.version===entry.version),entry);
  assert.deepEqual(f.entityRepository.get('C').geometry,geometry);
  assert.deepEqual(f.entityRepository.get('B').geometry,expected.geometries.find(row=>row.id==='shape'&&row.version===1).geojson);
  assert.equal(await f.project.undo(),true);assert.deepEqual(f.project.snapshot(),before);
  assert.equal(await f.project.redo(),true);assert.deepEqual(f.project.snapshot(),after);
});

test('label-only history keeps dirty country geometry while actual geometry Undo reports its changed owner',async()=>{
  const f=await fixture(),packets=[];f.client.subscribeTransitions((reply,operation)=>{if(operation==='core.document-undo')packets.push(reply);});
  await executeTerritorialTestCommand(f.state,'territorial.metadata',{id:'KOR',field:'name',valuePresent:true,value:'edited'});
  const shape=f.entityRepository.get('KOR').geometry;await createLabel(f.state);assert.equal(await f.project.undo(),true);
  assert.equal(f.entityRepository.get('KOR').geometry,shape);assert.deepEqual([...f.state.historyDirtyEntityIds],['KOR']);
  assert.deepEqual(packets[0].delta.impact.geometryDomains,['label']);assert.deepEqual(packets[0].delta.geometries,[]);
  await executeTerritorialTestCommand(f.state,'territorial.geometry',{id:'KOR',geometry:polygon(3)});
  assert.equal(await f.project.undo(),true);assert.deepEqual(f.entityRepository.get('KOR').geometry,shape);
  assert.ok(packets[1].delta.impact.geometryDomains.includes('territorial'));
});

test('dated editing stays guarded while records, source baseline and delta survive real Undo/Redo',async()=>{
  const features=[country('KOR')],f=await fixture(features),pristine=f.project.snapshot();
  const fingerprint=await fingerprintProjectBaseline(features);
  await f.client.storageBaselineLoad({kind:'static-features',baseDataset:'fixture',fingerprint,features});
  await assert.rejects(()=>executeTerritorialTestCommand(f.state,'territorial.metadata',
    {id:'KOR',field:'validFrom',valuePresent:true,value:'1900'}),{code:'TIMELINE_ACTIVATION'});
  await executeTerritorialTestCommand(f.state,'territorial.metadata',{id:'KOR',field:'name',valuePresent:true,value:'changed name'});
  assert.deepEqual([...f.state.historyDirtyEntityIds],['KOR']);
  assert.deepEqual(f.project.snapshot().timelineRecords,pristine.timelineRecords);
  const output=await f.client.exportSnapshot({format:'pandolab-autosave',version:'fixture',savedAt:'2026-10-04T00:00:00.000Z'}),saved=JSON.parse(output.storageJson);
  assert.equal(saved.format,'pandolab-autosave-delta');assert.equal(saved.entityDelta.changed[0].properties.name,'changed name');
  assert.equal(Object.hasOwn(saved.entityDelta.changed[0].properties,'validFrom'),false);
  assert.equal(await f.project.undo(),true);assert.equal(f.entityRepository.get('KOR').properties.name,'KOR');
  assert.equal(await f.project.redo(),true);assert.equal(f.entityRepository.get('KOR').properties.name,'changed name');
});

test('pure Core validation rejects invalid project references before changing content, presentation or selection',async()=>{
  const f=await fixture(),before=f.project.snapshot(),clock=f.client.state();
  await f.client.selectionApply({action:'replace',ref:{domain:'territorial',type:'entity',id:'KOR'}});
  const selection=await f.client.selectionSnapshot(),broken=structuredClone(before);
  broken.territorialEntities[0].properties.name='invalid candidate';
  broken.distributionEntries=[{...fullSeed().distributionEntries[0],layerId:'missing',territorialUnitId:'KOR'}];
  await assert.rejects(()=>f.project.prepareImport(broken));
  assert.equal(f.project.snapshot(),before);assert.equal(f.client.state().checkpoint,clock.checkpoint);
  assert.deepEqual(await f.client.selectionSnapshot(),selection);
});

test('label history restores changed user settings and preserves unrelated presentation',async()=>{
  const f=await fixture(),id='22000000-0000-4000-8000-000000000019';
  await view(f.state,{action:'labelSettings',ref:{domain:'territorial',id:'KOR'},settings:{pinned:true}});
  await createLabel(f.state,id,{pinned:true,manualPosition:[127,37]});
  await view(f.state,{action:'labelSettings',ref:{domain:'territorial',id:'KOR'},settings:{pinned:false}});
  const unrelated=f.project.snapshot().labelSettings['territorial:KOR'];
  assert.equal(await f.project.undo(),true);assert.equal(f.project.snapshot().labels.length,0);
  assert.equal(Object.hasOwn(f.project.snapshot().labelSettings,`label:${id}`),false);
  assert.deepEqual(f.project.snapshot().labelSettings['territorial:KOR'],unrelated);
  assert.equal(await f.project.redo(),true);assert.equal(f.project.snapshot().labels.length,1);
  assert.equal(f.project.snapshot().labelSettings[`label:${id}`].pinned,true);
  assert.deepEqual(f.project.snapshot().labelSettings[`label:${id}`].manualPosition,[127,37]);
  assert.deepEqual(f.project.snapshot().labelSettings['territorial:KOR'],unrelated);
});

test('unchanged static views stay out of delta and cursor movement changes only the session month',async()=>{
  const features=[country('KOR')],f=await fixture(features);
  await f.client.storageBaselineLoad({kind:'static-features',baseDataset:'fixture',fingerprint:await fingerprintProjectBaseline(features),features});
  const before=f.project.snapshot(),clock=f.client.state();
  await f.entityStore.setTimelineCursor('1914-06');await f.entityStore.setTimelineCursor('1914-07');
  assert.equal(f.project.snapshot(),before);assert.equal(f.client.state().checkpoint,clock.checkpoint);
  assert.deepEqual([...f.state.historyDirtyEntityIds],[]);
  const saved=JSON.parse((await f.client.exportSnapshot({format:'pandolab-autosave',version:'fixture',savedAt:'2026-10-04T00:00:00.000Z'})).storageJson);
  assert.equal(saved.format,'pandolab-autosave-delta');assert.deepEqual(saved.entityDelta,{changed:[],removedIds:[]});
});

for(const removedId of ['removed','__proto__'])test(`Core history restores ${removedId} appearance while preserving survivor view edits`,async()=>{
  const features=['root',removedId,'kept'].map(id=>createTerritorialFeature({id,name:id,entityKind:'general',parentId:id==='root'?'':'root',geometry:polygon()}));
  const styleKey=`territorial:entity:${removedId}`,f=await fixture(features,{itemVisibility:{objects:{[removedId]:false,kept:false,root:false}},
    layerPresentation:normalizeLayerPresentation({objectStyles:{[styleKey]:{opacity:0.5},'territorial:entity:kept':{opacity:0.6}}})});
  await f.project.admitPresentationCatalog({hydroLayers:{},countryLabelIds:['root'],
    builtinSubunitSources:Object.fromEntries(BUILTIN_SUBUNITS.map(row=>[row.id,row.sourceCountryId]))});
  const refs=[{domain:'territorial',id:removedId}];
  await executeTestCommand(f.state,{commandId:'objects.remove',targets:refs,payload:{refs}});
  await view(f.state,{action:'objectVisibility',refs:[{domain:'territorial',type:'entity',id:'kept'},{domain:'territorial',type:'entity',id:'root'}],visible:true});
  await view(f.state,{action:'objectStyle',ref:{domain:'territorial',id:'kept'},patch:{opacity:0.9}});
  const survivor=f.project.snapshot().layerPresentation.objectStyles['territorial:entity:kept'];
  assert.equal(await f.project.undo(),true);assert.ok(f.entityRepository.get(removedId));
  assert.equal(f.state.itemVisibility.objects[removedId],false);assert.equal(f.state.layerPresentation.objectStyles[styleKey].opacity,0.5);
  assert.equal(f.state.itemVisibility.objects.kept,undefined);assert.equal(f.state.itemVisibility.objects.root,undefined);
  assert.deepEqual(f.state.layerPresentation.objectStyles['territorial:entity:kept'],survivor);
  assert.equal(await f.project.redo(),true);assert.equal(f.entityRepository.get(removedId),null);
  assert.equal(f.state.itemVisibility.objects[removedId],false,'document history does not own workspace overrides');
  assert.equal(Object.hasOwn(f.state.layerPresentation.objectStyles,styleKey),false);
  assert.deepEqual(f.state.layerPresentation.objectStyles['territorial:entity:kept'],survivor);
});
test('canonical object lookup resolves builtin labels in the existing domain with readonly capabilities',()=>{
  const owner=createObjectCommands();owner.connect({selectionServices:{normalizeObjectRef},projectState:{state:{labels:[]}},propertyEditingA:{distributionLayerById:()=>null},labelPresentation:{labelById:id=>id===source.id?source:null}});
  const ref=owner.layerItemObjectRef('labels',source.id);
  assert.equal(ref.domain,'label');assert.equal(ref.type,'capital');assert.equal(owner.objectRefExists(ref),true);assert.ok(Object.isFrozen(source));
  assert.equal(owner.objectDisplayInfo(ref).name,'서울');
});
test('copy creates an independent immutable user label and linked pinned settings in one C++ history entry',async ()=>{
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  seed.labels=[];seed.labelSettings={};
  const core=await createNodeCoreProject(seed),id='22000000-0000-4000-8000-000000000012',events=[];
  const state={selected:{domain:'label',id:source.id}};
  const owner=createGenericCommands();owner.connect({projectState:{state},labelPresentation:{labelById:()=>source},surfaces:{uid:()=>id},
    domains:{projectDomain:core.project,renderingDomain:{invalidateLabels:()=>events.push('render')}},
    objectDisplay:{invalidateObjectPresentation:()=>events.push('tree')},propertyEditingA:{applyLabelSelectionIntent:async ()=>events.push('select')},feedback:{setActionStatus:()=>{}}});
  try {
    const copy=await owner.copySelectedPlaceForEditing();assert.equal(copy.id,id);assert.equal(copy.sourcePlaceId,source.id);assert.deepEqual(copy.coordinates,source.coordinates);
    assert.throws(()=>{copy.coordinates[0]=128;},TypeError);assert.equal(source.coordinates[0],127);assert.equal(source.name,'서울');
    assert.equal(core.documentModel.list('label').length,1);
    const settings=core.documentModel.snapshot().labelSettings[`label:${id}`];
    assert.deepEqual(settings,{ priority: 90,minZoom: 0,maxZoom: Infinity,manualPosition: source.coordinates,pinned: true,collisionGroup: 'place' });
    assert.equal(core.client.state().stateRevision,0);assert.equal(core.client.state().presentationDirty,false);
    assert.ok(events.includes('select'));assert.equal(await core.project.undo(),true);assert.deepEqual(JSON.parse(await core.client.storageSnapshot()),seed);
    assert.equal(core.client.state().canUndo,false);assert.equal(await core.project.redo(),true);
    assert.equal(core.documentModel.list('label')[0].sourcePlaceId,source.id);
    assert.equal(core.documentModel.snapshot().labelSettings[`label:${id}`].maxZoom,Infinity);
  } finally { core.dispose(); }
});
