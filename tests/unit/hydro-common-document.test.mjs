import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import {createTerritorialFeature,normalizeTerritorialIdentity,TERRITORIAL_SCHEMA_VERSION} from '../../shared/frontend/js/modules/territorial-units.js';

const id='33000000-0000-4000-8000-000000000031';
const objectRef={domain:'hydro',id};
const polygon=n=>({type:'Polygon',coordinates:[[[0,0],[0,n],[n,n],[n,0],[0,0]]]});
function seed() {
  const project=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url)));
  for(const name of ['territorialEntities','labels','genericFeatures','distributionLayers','distributionEntries'])project[name]=[];
  project.labelSettings={};project.sourceInfo=null;
  project.layerPresentation={schemaVersion:5,styles:{},objectStyles:{},objectOrder:[]};
  project.projectSetup={initialMonth:'1923-01',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
  project.hydroEdits=[{type:'Feature',id,geometry:null,properties:{pandolab_schema_version:1,pandolab_domain:'hydro',pandolab_id:id,
    category:'lake',name:'Same lake',notes:'',editorColor:'#3388cc',locked:false}}];
  project.geometries=[{id:'lake',version:1,geojson:polygon(2)},{id:'lake',version:2,geojson:polygon(3)}];
  project.timelineRecords={schemaVersion:3,lifetimes:[{id:'life',objectRef,validFrom:null,validTo:null}],parentRelations:[],propertyBindings:[],
    geometryBindings:[{id:'before',objectRef,validFrom:null,validTo:'1922-12-29',geometryRef:{id:'lake',version:1}},
      {id:'restored',objectRef,validFrom:'1922-12-30',validTo:'1925-05-12',geometryRef:{id:'lake',version:2}},
      {id:'after',objectRef,validFrom:'1925-05-13',validTo:null,geometryRef:{id:'lake',version:1}}]};
  return project;
}

test('water document uses common month projection, preserves all geometry versions and roundtrips',async t=>{
  const owner=await createNodeCoreProject(seed());t.after(()=>owner.dispose());
  const before=owner.documentModel.snapshot();
  assert.deepEqual(owner.documentModel.get(objectRef).geometry,polygon(3));
  await owner.client.setTimelineCursor('1925-06');
  assert.deepEqual(owner.documentModel.get(objectRef).geometry,polygon(2));
  assert.deepEqual(owner.documentModel.snapshot(),before,'date selection cannot mutate stored water history');
  const saved=JSON.parse(await owner.client.storageSnapshot());
  assert.equal(saved.hydroEdits[0].geometry,null);
  assert.equal(saved.timelineRecords.geometryBindings.length,3);
  const reopened=await createNodeCoreProject(saved);t.after(()=>reopened.dispose());
  await reopened.client.setTimelineCursor('1923-01');
  assert.deepEqual(reopened.documentModel.get(objectRef).geometry,polygon(3));
});

test('water shape edit splits the common binding and Undo/Redo restore the same object history',async t=>{
  const owner=await createNodeCoreProject(seed());t.after(()=>owner.dispose());
  await owner.client.setTimelineCursor('1924-01');
  const before=owner.documentModel.snapshot();
  const result=await owner.project.executeCommand({commandId:'hydro.geometry',targets:[objectRef],payload:{id,geometry:polygon(4)}});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  assert.deepEqual(owner.documentModel.get(objectRef).geometry,polygon(4));
  await owner.client.setTimelineCursor('1923-01');
  assert.deepEqual(owner.documentModel.get(objectRef).geometry,polygon(3));
  await owner.client.setTimelineCursor('1924-01');
  assert.equal(await owner.project.undo(),true);
  assert.deepEqual(owner.documentModel.snapshot(),before);
  assert.equal(await owner.project.redo(),true);
  assert.deepEqual(owner.documentModel.get(objectRef).geometry,polygon(4));
});

test('river widths and connectivity follow the selected geometry binding across dates and storage',async t=>{
  const project=seed();project.hydroEdits[0].properties.category='river';
  project.geometries=[{id:'lake',version:1,geojson:{type:'LineString',coordinates:[[0,0],[1,1]]}},{id:'lake',version:2,geojson:{type:'LineString',coordinates:[[0,0],[1,2],[2,3]]}}];
  for(const binding of project.timelineRecords.geometryBindings)binding.rendering=binding.geometryRef.version===1?{stroke_widths:[[1,2]],connectivity:{node:'modern'}}:{stroke_widths:[[2,3,4]],connectivity:{node:'restored'}};
  const owner=await createNodeCoreProject(project);t.after(()=>owner.dispose());
  assert.deepEqual(owner.documentModel.get(objectRef).properties.stroke_widths,[[2,3,4]]);
  const first=owner.documentModel.list('hydro');
  await owner.client.setTimelineCursor('1924-01');
  assert.equal(owner.documentModel.list('hydro'),first,'unchanged effective geometry has one reusable projection');
  await owner.client.setTimelineCursor('1925-06');
  assert.deepEqual(owner.documentModel.get(objectRef).properties.stroke_widths,[[1,2]]);
  assert.equal(owner.documentModel.get(objectRef).properties.connectivity.node,'modern');
  assert.equal(Object.hasOwn(owner.documentModel.snapshot().hydroEdits[0].properties,'stroke_widths'),false);
  const saved=JSON.parse(await owner.client.storageSnapshot());
  assert.deepEqual(saved.timelineRecords.geometryBindings[1].rendering.stroke_widths,[[2,3,4]]);
});

test('bulk water deletion truncates the same timeline and Undo restores the earlier identity',async t=>{
 const owner=await createNodeCoreProject(seed());t.after(()=>owner.dispose());
 const before=owner.documentModel.snapshot();
 const removed=await owner.project.executeCommand({commandId:'objects.remove',targets:[objectRef],payload:{refs:[objectRef]}});
 assert.equal(removed.ok,true,JSON.stringify(removed.error));
 assert.equal(owner.documentModel.get(objectRef),null);
 await owner.client.setTimelineCursor('1922-12');assert.ok(owner.documentModel.get(objectRef));
 await owner.client.setTimelineCursor('1923-01');assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),before);
 assert.equal(await owner.project.redo(),true);assert.equal(owner.documentModel.get(objectRef),null);
});

function withCountry(project,countryId=id) {
  const ref={domain:'territorial',id:countryId};
  project.territorialEntities=[normalizeTerritorialIdentity({type:'Feature',id:countryId,geometry:null,
    properties:{schemaVersion:TERRITORIAL_SCHEMA_VERSION,entityKind:'general',name:'Country'}})];
  project.geometries.push({id:'country-shape',version:1,geojson:polygon(5)});
  project.timelineRecords.lifetimes.push({id:'country-life',objectRef:ref,validFrom:null,validTo:null});
  project.timelineRecords.geometryBindings.push({id:'country-binding',objectRef:ref,validFrom:null,validTo:null,geometryRef:{id:'country-shape',version:1}});
  project.timelineRecords.parentRelations.push({id:'country-parent',objectRef:ref,validFrom:null,validTo:null,parentId:'',coverageMode:'explicit'});
  return ref;
}

test('territorial edits preserve a dated river sharing the same string identity and Undo history',async t=>{
  const project=seed();project.hydroEdits[0].properties.category='river';
  for(const row of project.geometries)row.geojson={type:'LineString',coordinates:[[0,0],[row.version,row.version]]};
  const country=withCountry(project),owner=await createNodeCoreProject(project);t.after(()=>owner.dispose());
  const before=owner.documentModel.snapshot(),river=owner.documentModel.get(objectRef);
  const feature=createTerritorialFeature({id:country.id,entityKind:'general',geometry:polygon(6)});
  const result=await owner.project.executeCommand({commandId:'territorial.patch',targets:[country],payload:{features:[feature]}});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  assert.deepEqual(owner.documentModel.territorialViews().find(row=>row.id===country.id).geometry,polygon(6));
  assert.deepEqual(owner.documentModel.get(objectRef),river);
  assert.deepEqual(owner.documentModel.snapshot().timelineRecords.geometryBindings.filter(row=>row.objectRef.domain==='hydro'),before.timelineRecords.geometryBindings.filter(row=>row.objectRef.domain==='hydro'));
  assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),before);
  assert.equal(await owner.project.redo(),true);assert.deepEqual(owner.documentModel.get(objectRef),river);
});

test('static territorial replacement preserves water records for shared and distinct string identities',async t=>{
  for(const countryId of [id,'country']) {
    const project=seed();project.timelineRecords.geometryBindings=[{id:'water-static',objectRef,validFrom:null,validTo:null,geometryRef:{id:'lake',version:1}}];
    const country=withCountry(project,countryId),owner=await createNodeCoreProject(project);t.after(()=>owner.dispose());
    const before=owner.documentModel.snapshot(),water=owner.documentModel.get(objectRef);
    const result=await owner.project.executeCommand({commandId:'territorial.replace',targets:[country],payload:{features:[createTerritorialFeature({id:country.id,entityKind:'general',geometry:polygon(6)})]}});
    assert.equal(result.ok,true,JSON.stringify(result.error));
    assert.deepEqual(owner.documentModel.territorialViews().find(row=>row.id===country.id).geometry,polygon(6));
    assert.deepEqual(owner.documentModel.get(objectRef),water);
    assert.deepEqual(owner.documentModel.snapshot().timelineRecords.geometryBindings.filter(row=>row.objectRef.domain==='hydro'),before.timelineRecords.geometryBindings.filter(row=>row.objectRef.domain==='hydro'));
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),before);
  }
});

test('multi-period water identity edits and locks retain geometry history through Undo and Redo',async t=>{
  for(const command of [
    {commandId:'hydro.metadata',targets:[objectRef],payload:{id,field:'notes',value:'Reviewed note'}},
    {commandId:'objects.lock',targets:[objectRef],payload:{refs:[objectRef],locked:true}},
  ]) {
    const owner=await createNodeCoreProject(seed());t.after(()=>owner.dispose());
    const before=owner.documentModel.snapshot(),geometry=owner.documentModel.get(objectRef).geometry;
    const result=await owner.project.executeCommand(command);
    assert.equal(result.ok,true,JSON.stringify(result.error));
    assert.deepEqual(owner.documentModel.get(objectRef).geometry,geometry);
    assert.deepEqual(owner.documentModel.snapshot().timelineRecords,before.timelineRecords);
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),before);
    assert.equal(await owner.project.redo(),true);
    assert.equal(owner.documentModel.get(objectRef).properties[command.commandId==='objects.lock'?'locked':'notes'],command.commandId==='objects.lock'?true:'Reviewed note');
  }
});
