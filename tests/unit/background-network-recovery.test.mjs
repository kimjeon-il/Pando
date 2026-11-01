import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchWithRetry} from '../../shared/frontend/js/modules/reliability-core.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function environment(){
  const env=new EventTarget();env.document=new EventTarget();env.document.visibilityState='visible';env.navigator={onLine:true};
  let id=0;const timers=new Map();env.setTimeout=callback=>{const key=++id;timers.set(key,()=>{timers.delete(key);callback();});return key;};env.clearTimeout=id=>timers.delete(id);
  return {env,timers,visibility(value){env.document.visibilityState=value;env.document.dispatchEvent(new Event('visibilitychange'));}};
}

test('network failures have typed retry metadata, but permanent HTTP errors remain responses',async t=>{
  const fetchFn=t.mock.fn(async()=>{throw new TypeError('Failed to fetch');});t.mock.method(globalThis,'fetch',fetchFn);
  await assert.rejects(fetchWithRetry('https://test.local',{}, {fetchFn,maxAttempts:1}),error=>error.retryable===true&&error.code==='PL-NETWORK-001');
  const response=new Response('',{status:404});
  t.mock.method(globalThis,'fetch',async()=>response);
  assert.equal(await fetchWithRetry('https://test.local',{}, {fetchFn:async()=>response,maxAttempts:1}),response);
});

test('fetch retry scope includes consuming the response body',async t=>{
  const fetchFn=async()=>new Response('map bytes');t.mock.method(globalThis,'fetch',fetchFn);
  const value=await fetchWithRetry('https://test.local',{}, {fetchFn,maxAttempts:1,consume:response=>response.text()});
  assert.equal(value,'map bytes');
});

test('hidden downloads do not consume retries before the page resumes',async t=>{
  const f=environment();f.visibility('hidden');let calls=0;
  const fetchFn=async()=>{calls++;return new Response('map');};t.mock.method(globalThis,'fetch',fetchFn);
  const pending=fetchWithRetry('https://test.local',{}, {fetchFn,environment:f.env,maxAttempts:1,consume:response=>response.text()});
  await tick();assert.equal(calls,0);f.visibility('visible');assert.equal(await pending,'map');assert.equal(calls,1);assert.equal(f.timers.size,0);
});

test('body stalls time out after resume; hidden time and stale callbacks cannot abort a live read',async t=>{
  const f=environment();let signal,consuming=false;
  const fetchFn=async(_url,options)=>{signal=options.signal;return new Response('map');};t.mock.method(globalThis,'fetch',fetchFn);
  const pending=fetchWithRetry('https://test.local',{}, {fetchFn,environment:f.env,maxAttempts:1,
    consume:()=>{consuming=true;return new Promise(()=>{});}});
  const rejection=assert.rejects(pending,error=>error.code==='PL-NETWORK-TIMEOUT'&&error.retryable===true);
  await tick();assert.equal(consuming,true);const old=[...f.timers.values()][0];assert.equal(typeof old,'function');
  f.visibility('hidden');old();assert.equal(signal.aborted,false);assert.equal(f.timers.size,0);
  f.visibility('visible');[...f.timers.values()][0]();await rejection;assert.equal(signal.aborted,true);assert.equal(f.timers.size,0);
});

test('progress renews an idle deadline and a late superseded timeout is ignored',async t=>{
  const f=environment();let finish,touch,signal;
  const fetchFn=async(_url,options)=>{signal=options.signal;return new Response('map');};t.mock.method(globalThis,'fetch',fetchFn);
  const pending=fetchWithRetry('https://test.local',{}, {fetchFn,environment:f.env,maxAttempts:1,
    consume:(_response,progress)=>{touch=progress.touch;return new Promise(resolve=>{finish=resolve;});}});
  await tick();const old=[...f.timers.values()][0];touch();old();assert.equal(signal.aborted,false);
  finish('complete');assert.equal(await pending,'complete');assert.equal(f.timers.size,0);
});

test('abort while waiting for foreground releases the request without fetching later',async t=>{
  const f=environment();f.visibility('hidden');const controller=new AbortController();let calls=0;
  const fetchFn=async()=>{calls++;return new Response('map');};t.mock.method(globalThis,'fetch',fetchFn);
  const pending=fetchWithRetry('https://test.local',{signal:controller.signal},{fetchFn,environment:f.env,maxAttempts:1});
  const rejection=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejection;f.visibility('visible');await tick();assert.equal(calls,0);
});

test('rollback failures, cancellation and document-worker timeouts are not treated as safe load retries',async()=>{
  const {isRecoverableLoadError}=await import('../../shared/frontend/js/modules/reliability-core.js');
  const error=Object.assign(new Error('network'),{code:'PL-NETWORK-001',retryable:true});
  assert.equal(isRecoverableLoadError(error),true);
  for(const extra of [{restoreError:new Error('rollback')},{cleanupError:new Error('cleanup')},{cancelled:true},{name:'AbortError'}])
    assert.equal(isRecoverableLoadError(Object.assign(new Error('network'),error,extra)),false);
  assert.equal(isRecoverableLoadError({code:'PL-WORKER-RPC-TIMEOUT',retryable:true}),false);
  assert.equal(isRecoverableLoadError(new TypeError('programming error')),false);
});
