import test from 'node:test';
import assert from 'node:assert/strict';
import {adjacentViewerYears,createViewerAdjacentPrefetch} from '../../apps/viewer/js/modules/viewer-adjacent-prefetch.js';
import {createBuiltinSession} from '../../shared/frontend/js/modules/builtin-session.js';

function idleClock(){
  let sequence=0;const callbacks=new Map();
  return {
    requestIdle(callback){const id=++sequence;callbacks.set(id,callback);return id;},
    cancelIdle(id){callbacks.delete(id);},
    step(){const next=callbacks.entries().next().value;if(!next)return false;
      callbacks.delete(next[0]);next[1]();return true;},
    count(){return callbacks.size;},
  };
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('P4-1 annual and month queries obey timeline and present-day bounds',()=>{
  const now=new Date(2026,9,31);
  assert.deepEqual(adjacentViewerYears('1953-07',{mode:'year',now}),['1952-12','1954-12']);
  assert.deepEqual(adjacentViewerYears('1953-07',{mode:'month',now}),['1952-07','1954-07']);
  assert.deepEqual(adjacentViewerYears('2025-12',{mode:'year',now}),['2024-12','2026-10']);
  assert.deepEqual(adjacentViewerYears('2026-10',{mode:'year',now}),['2025-12']);
  assert.deepEqual(adjacentViewerYears('1801-12',{mode:'year',now}),['1802-12']);
});

test('P4-1 source work starts only when idle after accepted presentation',async()=>{
  const clock=idleClock(),calls=[];
  const owner=createViewerAdjacentPrefetch({requestIdle:clock.requestIdle,cancelIdle:clock.cancelIdle,
    now:()=>new Date(2026,9,31),prepareSource:async(month,options)=>{calls.push([month,options.background]);}});
  assert.equal(clock.count(),0);owner.afterPresented('1953-12');
  assert.deepEqual(calls,[]);assert.equal(clock.count(),1);
  clock.step();await settle();
  assert.deepEqual(calls,[['1952-12',true]]);assert.equal(clock.count(),1);
  clock.step();await settle();
  assert.deepEqual(calls,[['1952-12',true],['1954-12',true]]);
  assert.equal(clock.count(),0);owner.dispose();
});

test('P4-1 opening a real target cancels queued and already running speculation',async()=>{
  const clock=idleClock(),calls=[];let finish;
  const owner=createViewerAdjacentPrefetch({requestIdle:clock.requestIdle,cancelIdle:clock.cancelIdle,
    now:()=>new Date(2026,9,31),prepareSource:(month,options)=>{
      calls.push([month,options]);return new Promise(resolve=>{finish=resolve;});
    }});
  owner.afterPresented('1953-12');owner.interrupt();
  assert.equal(clock.count(),0);assert.equal(calls.length,0);
  owner.afterPresented('1953-12');clock.step();await settle();
  assert.equal(calls.length,1);const valid=calls[0][1].isCurrent;
  owner.interrupt();assert.equal(valid(),false);finish(true);await settle();
  assert.equal(clock.count(),0);assert.deepEqual(calls.map(row=>row[0]),['1952-12']);
  owner.dispose();
});

test('P4-1 an ineligible or hidden project cannot start speculation',async()=>{
  const clock=idleClock(),calls=[];let eligible=false;
  const owner=createViewerAdjacentPrefetch({requestIdle:clock.requestIdle,cancelIdle:clock.cancelIdle,
    now:()=>new Date(2026,9,31),isEligible:()=>eligible,prepareSource:async month=>{calls.push(month);}});
  owner.afterPresented('1953-12');assert.equal(clock.count(),0);
  eligible=true;owner.afterPresented('1953-12');eligible=false;
  clock.step();await settle();assert.deepEqual(calls,[]);assert.equal(clock.count(),0);
  owner.dispose();
});

test('P4-1 source-only background preparation never admits Core or changes active state',async()=>{
  const calls=[],admissions=[],document={documentId:'active',timelineCursor:'1953-12',dirty:true};
  const before=structuredClone(document);
  const owner=createBuiltinSession({
    buildMeta:{dataRevision:'fixture',builtinWorld:{sha256:'a'.repeat(64)}},
    builtinWorldLoader:{loadProject:async(month,options)=>{
      calls.push({month,concurrency:options.concurrency,idling:typeof options.waitForIdle});
      return {project:{projectSetup:{initialMonth:month},geometries:[],territorialEntities:[]}};
    }},
  });
  owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'},
    domains:{projectDomain:{getGeneration:()=>3,state:()=>document,
      admitStorageBaseline:async()=>{admissions.push('unexpected');}}}});
  const candidate=await owner.prepareProjectSource('1952-12',{background:true,waitForIdle:async()=>{}});
  assert.deepEqual(calls,[{month:'1952-12',concurrency:1,idling:'function'}]);
  assert.equal(candidate.sourceMonth,'1952-12');assert.equal(owner.projectBaseline,null);
  assert.deepEqual(document,before);assert.deepEqual(admissions,[]);
  assert.equal(owner.sourceCacheStats().entries,1);
  owner.dispose();
});
