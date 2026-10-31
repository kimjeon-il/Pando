import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createGpuUploadScope} from '../../shared/frontend/js/modules/gpu-resource-lifecycle.js';

// Execute the actual renderer's scheduler admission, not a copied implementation.
const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
const start=source.indexOf('      setUploadScheduler: scheduler => {');
const end=source.indexOf('      commitVisualFrame:',start);
assert.ok(start>0&&end>start);
const observerStart=source.indexOf('    function observeGpuRecoveryUploads(');
const observer=observerStart<0?'':source.slice(observerStart,source.indexOf('    function invalidateGpuFrame(',observerStart));
function fixture(active=true){
 const ticket={},jobs=[],progress=[],cancelled=[];let current=active?ticket:null;
 const raw={enqueueUpload:input=>{jobs.push(input);return new Promise(()=>{});},cancelKey:key=>cancelled.push(key),defer(){}};
 const owners={};
 const context=vm.createContext({Object,createGpuUploadScope,
  uploadScheduler:null,terrainUploadScheduler:null,hydroUploadScheduler:null,gl:null,
  strokeRenderer:{setUploadScheduler:s=>owners.stroke=s},polygonOverlayPass:{setUploadScheduler:s=>owners.polygon=s},
  gpuRecovery:{currentTicket:()=>current,isCurrent:t=>t===current&&current!==null,noteProgress:(t,value)=>{assert.equal(t,current);progress.push(value);}},
 });
 vm.runInContext(observer+'\nconst api={'+source.slice(start,end)+'};api.setUploadScheduler(inputScheduler);',vm.createContext({...context,inputScheduler:raw}));
 // Use one context so assignments to scoped owner references remain observable.
 context.inputScheduler=raw;
 vm.runInContext(observer+'\nconst api={'+source.slice(start,end)+'};api.setUploadScheduler(inputScheduler);',context);
 return{jobs,progress,cancelled,context,owners,ticket,supersede:()=>{current={};},dispose:()=>{current=null;}};
}

test('restored polygon, stroke, terrain and hydro uploads count real bytes; base staging is not counted twice',()=>{
 const f=fixture();
 for(const [owner,key,bytes]of [[f.owners.polygon,'land',64],[f.owners.stroke,'graticule',32],[f.context.terrainUploadScheduler,'terrain',16],[f.context.hydroUploadScheduler,'hydro',8],[f.context.uploadScheduler,'base',4]]){
  owner.enqueueUpload({key,step:()=>({bytes,done:true})});f.jobs.at(-1).step({byteBudget:256});
 }
 assert.deepEqual(f.progress.map(p=>p.bytes),[64,32,16,8]);
});
test('restoration scene uploads can progress during interaction while ordinary scheduling is unchanged',()=>{
 for(const active of [false,true]){
  const f=fixture(active);f.owners.polygon.enqueueUpload({key:'land',step:()=>({bytes:8})});
  assert.equal(f.jobs[0].allowDuringInteraction,active?true:undefined);
 }
});
test('superseded and disposed recovery tickets cannot refresh another recovery deadline',()=>{
 for(const close of ['supersede','dispose']){
  const f=fixture();f.owners.stroke.enqueueUpload({key:'grid',step:()=>({bytes:64})});f[close]();
  f.jobs[0].step({byteBudget:256});assert.equal(f.progress.length,0);
 }
});
test('allocation, zero work, invalid byte counts and failed steps do not count as progress',()=>{
 const f=fixture();
 for(const [i,value]of [{bytes:0},{done:true},{bytes:-4},{bytes:NaN},{bytes:Infinity}].entries()){
  f.owners.polygon.enqueueUpload({key:'zero'+i,step:()=>value});assert.equal(f.jobs.at(-1).step({byteBudget:256}),value);
 }
 assert.equal(f.progress.length,0);
 const failure=new Error('allocation failed');f.owners.polygon.enqueueUpload({key:'bad',step:()=>{throw failure;}});
 assert.throws(()=>f.jobs.at(-1).step({byteBudget:256}),error=>error===failure);assert.equal(f.progress.length,0);
});
test('owner cancellation and duplicate-job sharing remain scoped',()=>{
 const f=fixture();const input={key:'same',step:()=>({bytes:8})};
 const a=f.owners.stroke.enqueueUpload(input),b=f.owners.stroke.enqueueUpload(input);
 assert.equal(a,b);assert.equal(f.jobs.length,1);f.jobs[0].step({byteBudget:256});assert.equal(f.progress.length,1);
 f.owners.stroke.cancelKey('same');assert.deepEqual(f.cancelled,[f.jobs[0].key]);
});
