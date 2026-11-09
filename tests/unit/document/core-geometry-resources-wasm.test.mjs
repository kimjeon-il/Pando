import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createNodeCoreDocument} from '../../helpers/core-session.mjs';
import {startupDocument} from '../../helpers/core-startup.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Core retains all eras, admits verified missing geometry without edits, and saves offline',async t=>{
 const source=JSON.parse(readFileSync(new URL('../../fixtures/timeline-exchange/complex.json',import.meta.url)));
 source.territorialEntities=source.territorialEntities.slice(0,1);
 for(const key of ['labels','hydroEdits','genericFeatures','distributionLayers','distributionEntries'])source[key]=[];
 source.distributionSettings={renderMode:'single',activeLayerId:'',boundaryVisible:false};
 source.projectSetup={initialMonth:'2000-01',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
 const owner={domain:'territorial',id:source.territorialEntities[0].id};
 const shapes=[0,2,4].map(x=>({type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]}));
 const payloads=shapes.map((shape,i)=>({id:'lazy-shape',version:i+1,source:JSON.stringify(shape)+'\n'}));
 source.geometryResources=payloads.map(row=>({id:row.id,version:row.version,type:'Polygon',contentSha256:hash(row.source),decodedBytes:Buffer.byteLength(row.source)}));
 source.geometries=[payloads[0]];
 source.timelineRecords={schemaVersion:3,lifetimes:[{id:'life',objectRef:owner,validFrom:null,validTo:null}],
  geometryBindings:payloads.map((row,i)=>({id:'binding-'+i,objectRef:owner,validFrom:[null,'2010','2020'][i],validTo:['2009','2019',null][i],geometryRef:{id:row.id,version:row.version}})),
  parentRelations:[{id:'parent',objectRef:owner,validFrom:null,validTo:null,parentId:'',coverageMode:'explicit'}],propertyBindings:[]};
 const client=createNodeCoreDocument();t.after(()=>client.dispose());
 await client.load(JSON.stringify(startupDocument([])));
 const bytes=Buffer.from(JSON.stringify(source));
 const admitted=await client.storageBaselineLoad({kind:'stored-asset',encoding:'identity',sourceBytes:new Uint8Array(bytes),compressedBytes:bytes.length,decodedBytes:bytes.length,
  sourceMonth:'2000-01',baseDataset:source.baseDataset,fingerprint:hash(bytes)});
 await client.loadBaseline(admitted.state.storageBaselineId,source.projectSetup);
 const point={type:'Feature',id:'22000000-0000-4000-8000-000000000019',geometry:{type:'Point',coordinates:[1.125,2.25]},
  properties:{schemaVersion:2,name:'Created',notes:'',color:'#8c68d8',locked:false,source:{kind:'drawn',license:'',details:{}}}};
 assert.equal((await client.execute({commandId:'generic.create',targets:[{domain:'generic',id:point.id}],payload:{feature:point}})).changed,true,
  'creating a point must not dereference unrelated unloaded polygon allocations');
 const before=client.state(),needed=await client.geometryRequirements('2015-01');
 assert.deepEqual(needed.resources.map(row=>row.version),[2]);
 await assert.rejects(client.resolveWorld('2015-01'),error=>error.code==='GEOMETRY_UNLOADED'&&error.missingGeometryRefs[0].version===2);
 await assert.rejects(client.admitGeometryResources([{...payloads[1],source:payloads[1].source+' '}]),/integrity/);
 assert.deepEqual(client.state(),before);
 const preview=await client.prepare({commandId:'territorial.field',targets:[owner],payload:{id:owner.id,field:'name',value:'Lazy renamed'}});
 assert.equal(preview.ok,true);
 await client.admitGeometryResources([payloads[1]]);
 assert.deepEqual(client.state(),before,'payload readiness must not change dirty state, epochs, revisions or history');
 assert.equal((await client.resolveWorld('2015-01')).entities[0].geometryRef.version,2);
 assert.equal((await client.confirm(preview.candidateId,client.state().epoch)).changed,true);
 assert.deepEqual((await client.geometryRequirements('2015-01')).resources,[],'confirming a held preview must retain admitted shapes');
 await client.undo();assert.deepEqual((await client.geometryRequirements('2015-01')).resources,[]);
 await client.redo();assert.deepEqual((await client.geometryRequirements('2015-01')).resources,[]);
 const loaded=[];client.setGeometryLoader(async requirements=>{loaded.push(...requirements.map(row=>row.version));return requirements.map(row=>payloads[row.version-1]);});
 await client.setTimelineCursor('2015-01');
 assert.equal(client.state().documentDirty,true,'the name edit, rather than downloading geometry, owns dirty state');
 const output=await client.exportSnapshot({version:'fixture',savedAt:'2026-11-08T00:00:00.000Z',format:'pandolab-project-state'});
 assert.deepEqual(loaded,[3],'saving must include the future shape, not only the selected era');
 const saved=JSON.parse(output.storageJson);
 assert.equal(Object.hasOwn(saved,'geometryResources'),false);
 assert.deepEqual(saved.geometries.filter(row=>row.id==='lazy-shape').map(row=>row.geojson),shapes);
 assert.deepEqual(saved.genericFeatures[0].geometry,point.geometry);
 for(const key of ['lifetimes','geometryBindings','parentRelations'])assert.deepEqual(saved.timelineRecords[key],source.timelineRecords[key]);
 assert.ok(saved.timelineRecords.propertyBindings.some(row=>row.property==='name'&&row.value.name==='Lazy renamed'));
 client.setGeometryLoader(async()=>{throw Error('offline');});
 await client.load(output.storageJson);await client.setTimelineCursor('2025-01');
 assert.equal((await client.resolveWorld('2025-01')).entities[0].geometryRef.version,3);
});


const clippedFixture=JSON.parse(readFileSync(new URL('../../fixtures/clipped-positive-current-rings.json',import.meta.url)));
const ordinaryClippedCompanion={type:'Polygon',coordinates:[[[-10,0],[-9,0],[-9,1],[-10,1],[-10,0]]]};
function clippedResourceInput(shapes) {
 const source=JSON.parse(readFileSync(new URL('../../fixtures/timeline-exchange/complex.json',import.meta.url)));
 source.territorialEntities=source.territorialEntities.slice(0,1);
 for(const key of ['labels','hydroEdits','genericFeatures','distributionLayers','distributionEntries'])source[key]=[];
 source.labelSettings={};source.distributionSettings={renderMode:'single',activeLayerId:'',boundaryVisible:false};
 source.projectSetup={initialMonth:'2000-01',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
 const owner={domain:'territorial',id:source.territorialEntities[0].id};
 const payloads=shapes.map((shape,i)=>({id:'exact-clipped',version:i+1,source:JSON.stringify(shape)+'\n'}));
 source.geometryResources=payloads.map((row,i)=>({id:row.id,version:row.version,type:shapes[i].type,
  contentSha256:hash(row.source),decodedBytes:Buffer.byteLength(row.source)}));
 source.geometries=[payloads[0]];
 source.timelineRecords={schemaVersion:3,lifetimes:[{id:'life',objectRef:owner,validFrom:null,validTo:null}],
  geometryBindings:payloads.map((row,i)=>({id:'shape-'+i,objectRef:owner,validFrom:i===0?null:String(2009+i),
   validTo:i===payloads.length-1?null:String(2009+i),geometryRef:{id:row.id,version:row.version}})),
  parentRelations:[{id:'parent',objectRef:owner,validFrom:null,validTo:null,parentId:'',coverageMode:'explicit'}],propertyBindings:[]};
 return {source,payloads};
}
async function loadClippedResourceBaseline(client,source) {
 await client.load(JSON.stringify(startupDocument([])));
 const bytes=Buffer.from(JSON.stringify(source));
 const admitted=await client.storageBaselineLoad({kind:'stored-asset',encoding:'identity',sourceBytes:new Uint8Array(bytes),
  compressedBytes:bytes.length,decodedBytes:bytes.length,sourceMonth:'2000-01',baseDataset:source.baseDataset,fingerprint:hash(bytes)});
 await client.loadBaseline(admitted.state.storageBaselineId,source.projectSetup);
}

test('canonical clipped resources preserve all current14 coordinates through lazy admission, save and offline reopen',async t=>{
 assert.equal(clippedFixture.fragments.length,14);
 const fragments=clippedFixture.fragments.map(row=>({type:'Polygon',coordinates:structuredClone(row.polygon)}));
 const mixed={type:'MultiPolygon',coordinates:[structuredClone(ordinaryClippedCompanion.coordinates),...fragments.map(shape=>structuredClone(shape.coordinates))]};
 const shapes=[structuredClone(ordinaryClippedCompanion),...fragments,mixed];
 const {source,payloads}=clippedResourceInput(shapes);
 const sourceBefore=structuredClone(source),shapesBefore=structuredClone(shapes),fixtureBefore=structuredClone(clippedFixture);
 const client=createNodeCoreDocument();t.after(()=>client.dispose());
 await loadClippedResourceBaseline(client,source);
 const last=payloads.at(-1),month='2024-01',before=client.state();
 assert.deepEqual((await client.geometryRequirements(month)).resources.map(row=>row.version),[16]);
 await assert.rejects(client.resolveWorld(month),error=>error.code==='GEOMETRY_UNLOADED');
 await assert.rejects(client.admitGeometryResources([{...last,source:last.source+' '}]),/integrity/);
 assert.deepEqual(client.state(),before);
 assert.deepEqual((await client.geometryRequirements(month)).resources.map(row=>row.version),[16]);
 const admission=await client.admitGeometryResources([last]);
 assert.deepEqual(admission.delta.geometries.find(row=>row.id===last.id&&row.version===last.version).geojson,mixed,
  'the native resource-admission read projection must preserve exact coordinates');
 assert.deepEqual(client.state(),before,'making a canonical payload ready must not create an edit or history entry');
 assert.equal((await client.resolveWorld(month)).entities[0].geometryRef.version,16);
 const loaded=[];client.setGeometryLoader(async requirements=>{
  loaded.push(...requirements.map(row=>row.version));return requirements.map(row=>payloads[row.version-1]);
 });
 const output=await client.exportSnapshot({version:'fixture',savedAt:'2026-11-09T00:00:00.000Z',format:'pandolab-project-state'});
 assert.deepEqual(loaded,[2,3,4,5,6,7,8,9,10,11,12,13,14,15],'save must admit every unloaded exact polygon, including inactive eras');
 const saved=JSON.parse(output.storageJson);
 assert.equal(Object.hasOwn(saved,'geometryResources'),false);
 const rows=saved.geometries.filter(row=>row.id==='exact-clipped').sort((a,b)=>a.version-b.version);
 assert.deepEqual(rows.map(row=>row.version),payloads.map(row=>row.version));
 assert.deepEqual(rows.map(row=>row.geojson),shapesBefore,'no component, coordinate, winding or vertex order may change');
 assert.deepEqual(saved.timelineRecords,source.timelineRecords);
 assert.deepEqual(client.state(),before,'save and payload downloads must not mark the document dirty');
 client.setGeometryLoader(async()=>{throw Error('offline: no resource may be fetched after reopening the saved file');});
 await client.load(output.storageJson);
 for(let i=0;i<shapes.length;i++) {
  const selected=i===0?'2000-01':String(2009+i)+'-01';
  await client.setTimelineCursor(selected);
  assert.equal((await client.resolveWorld(selected)).entities[0].geometryRef.version,i+1);
  assert.deepEqual((await client.geometryRequirements(selected)).resources,[]);
 }
 const reopened=JSON.parse(await client.storageSnapshot());
 assert.deepEqual(reopened.geometries.filter(row=>row.id==='exact-clipped').sort((a,b)=>a.version-b.version).map(row=>row.geojson),shapesBefore);
 assert.deepEqual(source,sourceBefore);assert.deepEqual(shapes,shapesBefore);assert.deepEqual(clippedFixture,fixtureBefore);
});

test('canonical clipped resource admission rejects correctly hashed invalid rings atomically',async t=>{
 const invalidRings=[
  ['exact zero',[[0,0],[1,0],[2,0],[0,0]]],
  ['nonzero-area self-crossing',[[0,0],[4,3],[0,3],[3,0],[0,0]]],
  ['retraced edge',[[0,0],[3,0],[3,3],[3,0],[0,3],[0,0]]],
  ['adjacent duplicate',[[0,0],[3,0],[3,0],[0,3],[0,0]]],
  ['open ring',[[0,0],[3,0],[0,3],[1,1]]],
  ['out-of-range coordinate',[[0,0],[181,0],[0,3],[0,0]]],
 ];
 for(const [name,ring] of invalidRings)await t.test(name,async t=>{
  const good={type:'Polygon',coordinates:[[[3,0],[4,0],[4,1],[3,0]]]};
  const invalid={type:'Polygon',coordinates:[ring]};
  const {source,payloads}=clippedResourceInput([ordinaryClippedCompanion,good,invalid]);
  const beforeInput=structuredClone(source);
  const client=createNodeCoreDocument();t.after(()=>client.dispose());await loadClippedResourceBaseline(client,source);
  const before=client.state();
  const needed=(await client.geometryRequirements()).resources.map(row=>row.version);assert.deepEqual(needed,[2,3]);
  await assert.rejects(client.admitGeometryResources(payloads.slice(1)),/INVALID_GEOMETRY/);
  assert.deepEqual(client.state(),before);
  assert.deepEqual((await client.geometryRequirements()).resources.map(row=>row.version),needed,
   'a valid earlier payload in the rejected batch must not become visible');
  await assert.rejects(client.resolveWorld('2010-01'),error=>error.code==='GEOMETRY_UNLOADED');
  const stored=structuredClone(source);delete stored.geometryResources;
  stored.geometries=payloads.map(row=>({id:row.id,version:row.version,geojson:JSON.parse(row.source)}));
  await assert.rejects(client.load(JSON.stringify(stored)),/INVALID_GEOMETRY/);
  assert.deepEqual(client.state(),before,'invalid full-file restoration must be atomic too');
  assert.deepEqual(source,beforeInput);
 });
});
