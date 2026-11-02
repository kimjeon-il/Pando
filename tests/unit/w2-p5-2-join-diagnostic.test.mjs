import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{instrument}from'../../tools/w2-p5-2-join-instrument.mjs';
const path='shared/frontend/js/modules/gpu-worker-channels.js',source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-worker-channels.js',import.meta.url),'utf8');
const {createGpuWorkerChannels}=await import('data:text/javascript;base64,'+Buffer.from(instrument(path,source)).toString('base64'));
class FakeWorker{static instances=[];constructor(){this.sent=[];FakeWorker.instances.push(this);}postMessage(data){this.sent.push(structuredClone(data));}terminate(){}emit(data){this.onmessage?.({data});}}
const feature=()=>({id:'A',boundaryRootId:'A',properties:{parentId:''},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}});
const request=(id,changes={})=>({type:'replace',requestId:id,projectGeneration:id,geometryRevision:id,quality:'canonical',includeOutlines:true,features:[feature()],...changes});
const oldResult=()=>({type:'prepared',requestId:1,projectGeneration:1,geometryRevision:1,quality:'canonical',packet:{segments:[{a:1}]},packetCacheHit:false});
const setup=()=>{performance.clearMarks();FakeWorker.instances=[];let current={requestId:2,generation:2,geometryRevision:2,quality:'canonical'};globalThis.__w2Readiness=()=>current;const channels=createGpuWorkerChannels({WorkerClass:FakeWorker}),channel=channels.create('country-shared-boundary-worker.js',{}),worker=FakeWorker.instances[0],received=[];channel.onmessage=e=>received.push(e.data);return{channel,worker,received,channels,setCurrent:x=>{current=x;}};};
const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out waiting for diagnostic join');};
const marked=stage=>performance.getEntriesByType('mark').some(m=>m.name.includes(`"stage":"${stage}"`));

test('exact identical in-flight work is adopted only with the current generation certificate',async()=>{
 const x=setup();try{x.channel.postMessage(request(1));x.channel.postMessage(request(2));x.worker.emit(oldResult());await wait(()=>x.received.some(r=>r.__w5Joined));assert.equal(x.worker.sent.length,1);assert.deepEqual(x.received.map(r=>[r.requestId,r.projectGeneration]),[[1,1],[2,2]]);assert.deepEqual(x.received[1].packet,oldResult().packet);}finally{x.channels.dispose();}
});
for(const [label,changes]of [['geometry',{features:[{...feature(),geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,1],[0,0]]]}}]}],['owner',{features:[{...feature(),boundaryRootId:'B'}]}],['quality',{quality:'preview'}],['outlines',{includeOutlines:false}]])test(`changed ${label} is sent natively and never joined`,async()=>{
 const x=setup();try{x.channel.postMessage(request(1));x.channel.postMessage(request(2,changes));x.worker.emit(oldResult());await wait(()=>x.worker.sent.length===2);assert.equal(x.worker.sent[1].requestId,2);assert.equal(x.received.some(r=>r.__w5Joined),false);assert.ok(marked('join-fallback'));}finally{x.channels.dispose();}
});
test('a superseding generation cannot receive an old joined response',async()=>{
 const x=setup();try{x.channel.postMessage(request(1));x.channel.postMessage(request(2));x.setCurrent({requestId:3,generation:3,geometryRevision:3,quality:'canonical'});x.worker.emit(oldResult());await wait(()=>marked('join-stale'));assert.equal(x.received.some(r=>r.__w5Joined),false);}finally{x.channels.dispose();}
});
test('an unavailable readiness certificate falls back to native delivery',async()=>{
 const x=setup();try{x.channel.postMessage(request(1));x.channel.postMessage(request(2));x.setCurrent(null);x.worker.emit(oldResult());await wait(()=>x.worker.sent.length===2);assert.equal(x.worker.sent[1].requestId,2);assert.equal(x.received.some(r=>r.__w5Joined),false);}finally{x.channels.dispose();}
});
test('a third request supersedes the held second request without admitting stale output',async()=>{
 const x=setup();try{x.channel.postMessage(request(1));x.channel.postMessage(request(2));x.channel.postMessage(request(3));await wait(()=>x.worker.sent.length===2);assert.deepEqual(x.worker.sent.map(r=>r.requestId),[1,3]);assert.equal(x.received.some(r=>r.__w5Joined),false);}finally{x.channels.dispose();}
});
test('an old Worker error causes the newer request to be sent normally',async()=>{
 const x=setup();try{x.channel.postMessage(request(1));x.channel.postMessage(request(2));x.worker.emit({type:'error',requestId:1,projectGeneration:1,geometryRevision:1,quality:'canonical',message:'controlled'});assert.deepEqual(x.worker.sent.map(r=>r.requestId),[1,2]);assert.equal(x.received.some(r=>r.__w5Joined),false);}finally{x.channels.dispose();}
});
test('a same-generation patch flushes the pending replacement before the patch',async()=>{
 const x=setup();try{x.channel.postMessage(request(1));x.channel.postMessage(request(2));x.channel.postMessage({...request(2),type:'patch',requestId:3});assert.deepEqual(x.worker.sent.map(r=>[r.type,r.requestId]),[['replace',1],['replace',2],['patch',3]]);assert.equal(x.received.some(r=>r.__w5Joined),false);}finally{x.channels.dispose();}
});
test('an asynchronous native fallback failure reaches the channel error handler',async()=>{
 const x=setup(),errors=[];try{x.channel.onerror=e=>errors.push(e);x.channel.postMessage(request(1));x.worker.postMessage=()=>{throw Error('controlled send failure');};x.channel.postMessage(request(2,{quality:'preview'}));await wait(()=>errors.length>0);assert.match(String(errors[0].error),/controlled send failure/);}finally{x.channels.dispose();}
});
