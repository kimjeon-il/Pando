import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

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
