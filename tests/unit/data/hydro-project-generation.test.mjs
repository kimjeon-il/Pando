import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers';
import {createHydroService} from '../../../src/data/physical-layer-service.js';

const manifest={schema:'pandolab-water-shards-v5',version:'0.13.4'};
const response=()=>({ok:true,json:async()=>manifest});
const deferred=()=>{
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('default -> file -> default switch rejects old Hydro Worker data and starts a fresh scoped load',async()=>{
 const old=deferred(),admissions=[],failures=[];
 let generation=1,fetches=0,loadState='idle';
 const hydro=createHydroService({
  dataVersion:'0.13.4',manifestUrl:()=>new URL('https://example.test/hydro.json'),
  loadKey:()=>generation,isLoadCurrent:key=>key===generation,
  getLoadState:()=>loadState,onLoading:()=>{loadState='loading';},
  onRetry:()=>{},onFailure:error=>failures.push(error),
  fetchWithRetry:async()=>++fetches===1?old.promise:response(),
  acceptManifest:async(_,__,{key,isCurrent})=>{
   assert.equal(isCurrent(),true);
   admissions.push(key);loadState='ready';return true;
  },
 });
 const obsolete=hydro.load();
 await tick();assert.equal(fetches,1);
 generation=2; // user file: Hydro from the previous default world must not publish
 generation=3; // default-world reopening has a different accepted Core generation
 const reopened=hydro.load();
 assert.notStrictEqual(obsolete,reopened);
 old.resolve(response());
 assert.deepEqual(await Promise.all([obsolete,reopened]),[false,true]);
 assert.deepEqual(admissions,[3]);
 assert.deepEqual(failures,[]);
 assert.equal(fetches,2);
});

test('failed stale Hydro request cannot overwrite another project readiness',async()=>{
 const old=deferred(),admissions=[],failures=[];
 let generation=1,fetches=0,loadState='idle';
 const hydro=createHydroService({
  dataVersion:'0.13.4',manifestUrl:()=>new URL('https://example.test/hydro.json'),
  loadKey:()=>generation,isLoadCurrent:key=>key===generation,
  getLoadState:()=>loadState,onLoading:()=>{loadState='loading';},
  onRetry:()=>{},onFailure:error=>{failures.push(error.message);loadState='error';},
  fetchWithRetry:async()=>++fetches===1?old.promise:response(),
  acceptManifest:async(_,__,{key})=>{admissions.push(key);loadState='ready';return true;},
 });
 const obsolete=hydro.load();
 await tick();generation=2;
 const current=hydro.load();
 old.reject(Error('previous project offline'));
 assert.deepEqual(await Promise.all([obsolete,current]),[false,true]);
 assert.equal(loadState,'ready');
 assert.deepEqual(admissions,[2]);assert.deepEqual(failures,[]);
});
