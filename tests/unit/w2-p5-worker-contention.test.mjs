import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// Controlled architecture experiment, NOT a hardware-speed benchmark.
// Only the test-loaded Worker source is instrumented; shipping JS is unchanged.
const originalUrl = new URL('../../shared/frontend/js/workers/country-shared-boundary-worker.js', import.meta.url);
const coreUrl = new URL('../../tools/load-spherical-core.mjs', import.meta.url).href;
const moduleRoot = new URL('../../shared/frontend/js/modules/', import.meta.url).href;
const original = readFileSync(originalUrl, 'utf8').replaceAll('\r\n', '\n');
const checkpointAnchor = '    let packet;\n    if (packetCacheHit) {';
const syntheticMs = 350;
const graceMs = 85;

function feature(id, west, east) {
  const geometry = {type:'Polygon',coordinates:[[[west,0],[east,0],[east,1],[west,1],[west,0]]]};
  return {type:'Feature',id,geometry,properties:{},boundaryRootId:id};
}
const initial = [feature('A',0,1),feature('B',1,2)];
const changed = [feature('A',0,1),feature('B',3,4)];

function spawn(mode) {
  assert.equal(original.split(checkpointAnchor).length,2,
    'The exact pre-packet checkpoint moved: re-audit cancellation semantics before testing.');
  assert.ok(['baseline','grace','plain'].includes(mode));
  const instrumentation = [
    '    // W2-P5 TEST ONLY; the C++/JS packet calculation remains untouched.',
    '    if (message.requestId === 1) {',
    '      self.postMessage({type:"w2p5-checkpoint",requestId:message.requestId,projectGeneration:message.projectGeneration});',
    mode === 'grace'
      ? '      await new Promise(resolve => setTimeout(resolve,' + graceMs + '));'
      : '',
    mode === 'grace'
      ? '      if (deferUnapplied(message)) return;'
      : '',
    '    }',
    '    // Synthetic synchronous packet work: it cannot receive a new onmessage.',
    '    if (!packetCacheHit) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ' + syntheticMs + ');',
  ].filter(Boolean).join('\n') + '\n';
  const source = original.replaceAll('../modules/',moduleRoot)
    .replace(checkpointAnchor,instrumentation+checkpointAnchor);
  const dataUrl = 'data:text/javascript,' + encodeURIComponent(source);
  const bootstrap = [
    'import {parentPort} from "node:worker_threads";',
    'globalThis.self={location:{href:' + JSON.stringify(originalUrl.href) +
      '},postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};',
    'await import(' + JSON.stringify(coreUrl) + ');',
    'await import(' + JSON.stringify(dataUrl) + ');',
    'parentPort.on("message",data=>self.onmessage({data}));'
  ].join('\n');
  const worker = new Worker(new URL('data:text/javascript,'+encodeURIComponent(bootstrap)));
  const events=[],pending=[];
  worker.on('message',message=>{
    events.push(message);
    if(message.type==='error') for(const wait of [...pending])wait.reject(new Error(message.message));
    for(const wait of [...pending]) if(wait.predicate(message))wait.resolve(message);
  });
  worker.on('error',error=>{for(const wait of [...pending])wait.reject(error);});
  worker.on('exit',code=>{
    if(code!==0)for(const wait of [...pending])wait.reject(new Error('Worker exited early '+code));
  });
  const waitFor=predicate=>{
    const found=events.find(predicate);
    if(found)return Promise.resolve(found);
    return new Promise((resolve,reject)=>{
      const waiter={predicate,
        resolve:v=>{clearTimeout(timer);pending.splice(pending.indexOf(waiter),1);resolve(v);},
        reject:e=>{clearTimeout(timer);pending.splice(pending.indexOf(waiter),1);reject(e)}};
      const timer=setTimeout(()=>waiter.reject(new Error('W2-P5 worker message timed out')),20000);
      pending.push(waiter);
    });
  };
  const send=(requestId,features)=>worker.postMessage({
    type:'replace',requestId,projectGeneration:requestId,geometryRevision:requestId,
    quality:'canonical',includeOutlines:true,cacheUrl:null,features,
  });
  return {worker,events,waitFor,send};
}

async function runCase(mode,variant) {
  const run=spawn(mode);
  try{
    const source=structuredClone(initial);
    const target=structuredClone(variant==='same'?initial:changed);
    run.send(1,source);
    await run.waitFor(msg=>msg.type==='w2p5-checkpoint'&&msg.requestId===1);
    const started=performance.now();
    const finished=run.waitFor(msg=>msg.type==='prepared'&&msg.requestId===2);
    run.send(2,target);
    const packet=await finished;
    const elapsedMs=performance.now()-started;
    assert.equal(packet.projectGeneration,2);
    assert.equal(packet.geometryRevision,2);
    assert.equal(packet.quality,'canonical');
    assert.equal(run.events.filter(m=>m.type==='prepared'&&m.requestId===1).length,0,
      'A superseded old generation must never publish its stale packet');
    assert.equal(run.events.filter(m=>m.type==='error').length,0);
    return {variant,mode,elapsedMs,cacheHit:packet.packetCacheHit,packet:packet.packet};
  }finally{await run.worker.terminate();}
}

async function referencePacket(features) {
  const run=spawn('plain');
  try{
    const waiting=run.waitFor(msg=>msg.type==='prepared'&&msg.requestId===2);
    run.send(2,structuredClone(features));
    const packet=await waiting;
    assert.equal(packet.packetCacheHit,false);
    return packet.packet;
  }finally{await run.worker.terminate();}
}

test('W2-P5 same-content cancellation loses a useful in-flight packet cache; never assert a speed win',async()=>{
  const expected=await referencePacket(initial);
  const a=await runCase('baseline','same');
  const b=await runCase('grace','same');
  const a2=await runCase('baseline','same');
  for(const row of [a,b,a2])assert.deepEqual(row.packet,expected);
  assert.equal(a.cacheHit,true,'baseline should finish old exact content then reuse the packet');
  assert.equal(a2.cacheHit,true);
  assert.equal(b.cacheHit,false,'grace cancels old work and must recompute the same packet for the new generation');
  console.log('W2P5_SAME_CONTENT '+JSON.stringify({
    syntheticWorkMs:syntheticMs,graceMs,
    runs:[a,b,a2].map(({mode,elapsedMs,cacheHit})=>({mode,elapsedMs,cacheHit})),
    conclusion:'canceling an identical in-flight computation discards a cache that the next generation needs',
    realGpuSpeedupClaim:false
  }));
});

test('W2-P5 pre-packet cooperative cancellation skips an obsolete generation with different content',async()=>{
  const expected=await referencePacket(changed);
  const a=await runCase('baseline','changed');
  const b=await runCase('grace','changed');
  const a2=await runCase('baseline','changed');
  for(const row of [a,b,a2])assert.deepEqual(row.packet,expected);
  for(const row of [a,b,a2])assert.equal(row.cacheHit,false);
  // The fixed synthetic 350ms miss makes the baseline do two missed packet
  // calculations whereas the grace gate avoids one. This is a protocol
  // experiment; do not carry any Node duration into Windows GPU predictions.
  assert.ok(a.elapsedMs>b.elapsedMs+100 &&
    a2.elapsedMs>b.elapsedMs+100,
    'Skipping genuinely obsolete work should avoid one fixed synthetic packet cost');
  console.log('W2P5_CHANGED_CONTENT '+JSON.stringify({
    syntheticWorkMs:syntheticMs,graceMs,
    runs:[a,b,a2].map(({mode,elapsedMs,cacheHit})=>({mode,elapsedMs,cacheHit})),
    conclusion:'skip only when request is superseded before synchronous packet computation',
    realGpuSpeedupClaim:false
  }));
});

test('W2-P5 grace mode still publishes initial boundaries if no new date is requested',async()=>{
  const run=spawn('grace');
  try{
    const first=run.waitFor(m=>m.type==='prepared'&&m.requestId===1);
    run.send(1,structuredClone(initial));
    const packet=await first;
    assert.equal(packet.projectGeneration,1);
    assert.equal(packet.packetCacheHit,false);
    assert.ok(packet.packet.segments.length>0);
    assert.equal(run.events.filter(m=>m.type==='error').length,0);
  }finally{await run.worker.terminate();}
});
