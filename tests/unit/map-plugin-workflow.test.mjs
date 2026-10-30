import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateReferenceImage as calculate} from '../../plugins/pando-map-tools/lib/analysis/core.mjs';
import * as jobs from '../../plugins/pando-map-tools/lib/jobs.mjs';
import * as engine from '../../plugins/pando-map-tools/lib/engine.mjs';

const chain=(id,points,semanticBits=1,confidence=.7)=>({id,points,semanticBits,confidence,touchesImageEdge:false});
const graph=chains=>({ok:true,width:200,height:200,chains,faces:[],unresolved:[],nextChainId:Math.max(-1,...chains.map(c=>c.id))+1,nextFaceId:0});
const edit=(g,command)=>calculate('editBoundaryGraph',{graph:g,command});

test('vector replacement preserves unrelated fractional geometry, semantics, confidence and identity',()=>{
  const untouched=chain(90,[[110.25,110.75],[125.125,130.625],[150.5,150.25]],2,.372);
  const input=graph([chain(20,[[10.25,10.5],[45.5,20.25]]),untouched]);
  const result=edit(input,{type:'replace',chainId:20,points:[[10.25,10.5],[25.25,18.125],[45.5,20.25]]});
  assert.deepEqual(result.chains.find(c=>c.id===90),untouched);
  assert.deepEqual(result.chains.find(c=>c.id===20).points,[[10.25,10.5],[25.25,18.125],[45.5,20.25]]);
  assert.deepEqual(result.changeSet.modified,[20]);
  assert.deepEqual(result.changeSet.removed,[]);
  assert.deepEqual(input.chains[1],untouched);
});

test('manual add nodes only intersected paths and retired chain identities never return',()=>{
  const untouched=chain(90,[[110.25,110.75],[150.5,150.25]],2,.372);
  const input=graph([chain(20,[[10.25,20.5],[50.25,20.5]]),untouched]);
  const added=edit(input,{type:'add',points:[[30.25,10.5],[30.25,40.5]],semanticBits:1,reason:'Source stroke reviewed'});
  assert.deepEqual(added.chains.find(c=>c.id===90),untouched);
  assert.equal(added.chains.filter(c=>c.points.some(p=>p[0]===30.25&&p[1]===20.5)).length,4);
  assert(added.changeSet.removed.includes(20));
  const newest=Math.max(...added.chains.map(c=>c.id));
  const excluded=edit(added,{type:'exclude',chainId:newest});
  const again=edit(excluded,{type:'add',points:[[160,20],[180,20]],semanticBits:2,reason:'Reviewed other stroke'});
  assert(again.changeSet.created.every(id=>id>newest));
  assert.equal(again.chains.some(c=>c.id===20),false);
});

test('vector graph constructs two adjacent faces without closing a cut or changing unrelated lines',()=>{
  const g=graph([chain(0,[[10,10],[90,10],[90,90],[10,90],[10,10]])]);
  const divided=edit(g,{type:'add',semanticBits:1,reason:'Source divider',points:[[50,10],[50,90]]});
  assert.equal(divided.faces.length,2);
  const shared=divided.faces[0].chainIds.filter(id=>divided.faces[1].chainIds.includes(id));
  assert.equal(shared.length,1);
  const cut=edit(divided,{type:'cut',chainId:shared[0],point:[50,50]});
  assert.equal(cut.faces.length,1);
  assert(cut.unresolved.some(v=>v.reason==='open-boundary'));
});

test('current schema and one selection resolver reject stale or invalid reviewed candidates',()=>{
  let job=jobs.createJob({path:'map.png',sha256:'a'.repeat(64),width:200,height:200},{dataRevision:'test'});
  assert.equal(job.schemaVersion,3);
  assert.throws(()=>jobs.assertJob(jobs.sealJob({...job,schemaVersion:2})),/schema/i);
  assert.equal(typeof jobs.selectedJobGeometry,'function');
  job=jobs.sealJob({...job,status:'needs-review',graph:graph([chain(1,[[10,10],[90,10]])])});
  assert.throws(()=>jobs.selectedJobGeometry(job),/review/i);
});

test('one current selection resolves line and hole-bearing face for both previews and GeoJSON',()=>{
  let job=jobs.createJob({path:'map.png',sha256:'a'.repeat(64),width:200,height:200},{dataRevision:'test'});
  const ring=[[10,30],[90,30],[90,90],[10,90],[10,30]],hole=[[40,45],[60,45],[60,60],[40,60],[40,45]];
  job=jobs.sealJob({...job,status:'needs-georeference',graph:{...graph([chain(2,ring),chain(3,hole),chain(17,[[110,30],[150,90]]),chain(42,[[110,100],[150,150]])]),
    faces:[{id:5,ring,holes:[hole],chainIds:[2,3],touchesImageEdge:false}]}});
  job=jobs.reviseJob(job,{type:'control-points',mode:'affine',points:[{id:'a',image:[0,0],coordinate:[0,20]},{id:'b',image:[1,0],coordinate:[20,20]},{id:'c',image:[0,1],coordinate:[0,0]}]});
  assert.throws(()=>jobs.reviseJob(job,{type:'review',georeference:true,boundaries:true,selectedIds:['line:999']}),/selection/i);
  job=jobs.reviseJob(job,{type:'review',georeference:true,boundaries:true,selectedIds:['face:5','line:17']});
  const selection=jobs.selectedJobGeometry(job),features=jobs.jobFeatures(job).features;
  assert.deepEqual(selection.map(v=>v.id),['face:5','line:17']);
  assert.deepEqual(selection[0].pixelGeometry.coordinates,[ring,hole]);
  assert.equal(features[0].geometry.coordinates.length,2);
  assert.deepEqual(features.map(v=>v.geometry),selection.map(v=>v.geometry));
  selection[0].pixelGeometry.coordinates[0][0][0]=123;
  assert.equal(job.graph.faces[0].ring[0][0],10);
  assert.throws(()=>jobs.selectedJobGeometry(jobs.sealJob({...job,revision:job.revision+1})),/review/i);
});

test('joining two open paths allocates one merged identity and preserves unrelated decimal vertices',()=>{
  const untouched=chain(88,[[100.1,100.2],[110.3,120.4]],2,.372);
  const joined=edit(graph([chain(5,[[10,10],[20,10]]),chain(7,[[30,10],[40,10]]),untouched]),
    {type:'join',from:{chainId:5,end:'end'},to:{chainId:7,end:'start'}});
  assert.equal(joined.chains.length,2);
  assert.deepEqual(joined.chains.find(c=>c.id===88),untouched);
  assert.deepEqual(joined.changeSet.removed,[5,7]);
  assert.equal(joined.changeSet.created.length,1);
  assert.deepEqual(joined.chains.find(c=>c.id!==88).points,[[10,10],[20,10],[30,10],[40,10]]);
});

test('cutting at the closing vertex opens a ring without moving any surviving source vertex',()=>{
  const ring=[[10.25,10.5],[50.25,10.5],[50.25,60.5],[10.25,60.5],[10.25,10.5]];
  const cut=edit(graph([chain(4,ring)]),{type:'cut',chainId:4,point:ring[0]});
  assert.equal(cut.faces.length,0);
  assert.equal(cut.chains.length,1);
  assert.deepEqual(cut.chains[0].points,[[11.75,10.5],[50.25,10.5],[50.25,60.5],[10.25,60.5],[10.25,12]]);
  assert.deepEqual(cut.changeSet.removed,[4]);
});

test('face change sets retire disappeared faces and never reuse their identities',()=>{
  const ring=[[10,10],[90,10],[90,90],[10,90],[10,10]];
  const first=edit(graph([]),{type:'add',points:ring,semanticBits:1,reason:'Reviewed closed source boundary'});
  assert.equal(first.changeSet.faces.created.length,1);
  const id=first.faces[0].id;
  const empty=edit(first,{type:'exclude',chainId:first.chains[0].id});
  assert.deepEqual(empty.changeSet.faces.removed,[id]);
  const again=edit(empty,{type:'add',points:ring,semanticBits:1,reason:'Explicitly restored source boundary'});
  assert(again.faces[0].id>id);
});

test('overlapping source paths are refused without merging semantic evidence',()=>{
  const g=graph([chain(3,[[10,10],[90,10]],1,.31)]);
  assert.throws(()=>edit(g,{type:'add',points:[[30,10],[70,10]],semanticBits:2,reason:'Ambiguous overlap'}),/overlap/i);
  assert.deepEqual(g.chains[0],chain(3,[[10,10],[90,10]],1,.31));
});

test('a reanalyzed region allocates identities beyond its predecessor and restores exact original pixels',()=>{
  assert.equal(typeof engine.originalGraph,'function');
  const raw=graph([chain(0,[[0,0],[60,50]])]);
  raw.width=61;raw.height=51;
  const image={width:61,height:51,originalWidth:200,originalHeight:200,mapping:{rect:{x:10,y:20,width:121,height:101}}};
  const previous={...graph([chain(90,[[20,20],[30,30]])]),nextChainId:100,nextFaceId:200};
  const restored=engine.originalGraph(raw,image,previous);
  assert(restored.chains.every(c=>c.id>=100));
  assert.deepEqual(restored.chains[0].points,[[10,20],[130,120]]);
  assert.equal(restored.nextFaceId,200);
  assert.deepEqual(raw.chains[0].points,[[0,0],[60,50]]);
});

test('an unselected extrapolated line cannot block a valid reviewed crop selection',()=>{
  const source={path:'map.png',sha256:'a'.repeat(64),width:200,height:200,mapping:{rect:{x:0,y:0,width:100,height:100}}};
  let job=jobs.sealJob({...jobs.createJob(source,{dataRevision:'test'}),status:'needs-georeference',graph:graph([
    chain(1,[[10,10],[80,10]]),chain(2,[[10,180],[80,180]])])});
  job=jobs.reviseJob(job,{type:'control-points',mode:'affine',points:[{id:'a',image:[0,0],coordinate:[0,80]},
    {id:'b',image:[1,0],coordinate:[20,80]},{id:'c',image:[0,.5],coordinate:[0,-20]}]});
  assert.equal(job.quality.invalidDomain,false);
  job=jobs.reviseJob(job,{type:'review',georeference:true,boundaries:true,selectedIds:['line:1']});
  assert.deepEqual(jobs.selectedJobGeometry(job).map(v=>v.id),['line:1']);
  assert.equal(jobs.jobFeatures(job).features.length,1);
});
