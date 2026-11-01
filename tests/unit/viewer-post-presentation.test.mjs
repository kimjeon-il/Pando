import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewerPostPresentation} from '../../apps/viewer/js/modules/viewer-post-presentation.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('post work starts after map open, never owns map readiness and waits only for search hydration',async()=>{
 let release,rendered=0,extras=0;
 const gate=new Promise(resolve=>{release=resolve;});
 let ready=true;
 const owner=createViewerPostPresentation({hydrate:()=>gate,
   refresh:()=>{rendered++;},afterMap:[()=>{extras++;}]});
 owner.schedule(()=>ready);
 assert.equal(extras,0,'nonessential work must not run in the synchronous map path');
 await tick();assert.equal(extras,1);assert.equal(rendered,0);
 release();await tick();assert.equal(rendered,1);
 ready=false;owner.dispose();
});

test('old hydration resolution never refreshes a newer project or republishes an old search',async()=>{
 const gates=[],render=[],errors=[];
 const owner=createViewerPostPresentation({
   hydrate:()=>new Promise(resolve=>gates.push(resolve)),
   refresh:()=>render.push('current'),
   onError:(error)=>errors.push(error),
 });
 owner.schedule(()=>true);await tick();assert.equal(gates.length,1);
 owner.invalidate();
 owner.schedule(()=>true);await tick();assert.equal(gates.length,2);
 gates[0]();await tick();assert.deepEqual(render,[]);
 gates[1]();await tick();assert.deepEqual(render,['current']);
 assert.deepEqual(errors,[]);owner.dispose();
});

test('a failed post-hydration stage reports independently without rejecting the next map',async()=>{
 const failures=[],render=[];
 let failed=true;
 const owner=createViewerPostPresentation({
   hydrate:()=>{if(failed){failed=false;throw Error('search unavailable');}},
   refresh:()=>render.push('rendered'),
   onError:(error,stage)=>failures.push([stage,error.message]),
 });
 owner.schedule(()=>true);await tick();
 assert.deepEqual(failures,[['hydrate','search unavailable']]);
 assert.deepEqual(render,[]);
 owner.schedule(()=>true);await tick();
 assert.deepEqual(render,['rendered']);owner.dispose();
});

test('optional surface and resource work failures are isolated from subsequent search rendering',async()=>{
 const errors=[],calls=[];
 const owner=createViewerPostPresentation({
   afterMap:[
     ()=>{throw Error('resource failed');},
     async()=>{throw Error('surface failed');},
     ()=>calls.push('selection synchronized'),
   ],
   hydrate:async()=>{calls.push('hydrated');},
   refresh:()=>calls.push('search rendered'),
   onError:(error,stage)=>errors.push([stage,error.message]),
 });
 owner.schedule(()=>true);await tick();
 assert.deepEqual(calls,['selection synchronized','hydrated','search rendered']);
 assert.deepEqual(errors,[['auxiliary','resource failed'],['auxiliary','surface failed']]);
 owner.dispose();
});

test('no late refresh or error after disposal or supersession',async()=>{
 let release,reject;const rendered=[],errors=[];
 const owner=createViewerPostPresentation({
   hydrate:()=>new Promise((resolve,failed)=>{release=resolve;reject=failed;}),
   refresh:()=>rendered.push(1),
   onError:e=>errors.push(e.message),
 });
 owner.schedule(()=>true);await tick();owner.dispose();reject(Error('late'));
 await tick();assert.deepEqual(rendered,[]);assert.deepEqual(errors,[]);
 assert.throws(()=>owner.schedule(null),/current project/);
 release();await tick();
});

test('stale caller predicate blocks pending work before any layer mutation',async()=>{
 let current=false,calls=0;
 const owner=createViewerPostPresentation({hydrate:()=>{calls++;},refresh:()=>{calls++;},
   afterMap:[()=>{calls++;}]});
 owner.schedule(()=>current);await tick();assert.equal(calls,0);
 current=true;owner.schedule(()=>current);await tick();assert.equal(calls,3);owner.dispose();
});
