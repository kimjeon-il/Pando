import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateReferenceImage as calculate} from '../../plugins/pando-map-tools/lib/analysis/core.mjs';
import * as jobs from '../../plugins/pando-map-tools/lib/jobs.mjs';

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
