import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep2 from "../../shared/frontend/js/modules/application-lifecycle.js";
import * as __dep3 from "../../shared/frontend/js/modules/core-document-runtime.js";
import * as __dep4 from "../../shared/frontend/js/modules/core-worker-runtime.js";
import * as __dep5 from "node:crypto";
import * as __dep6 from "../../shared/frontend/js/modules/stored-asset-loader.js";
import * as __dep7 from "../../shared/frontend/js/modules/reliability-core.js";
import * as __dep8 from "../../shared/frontend/js/modules/core-wasm-loader.js";
contractSuite("background-startup-recovery", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { createApplicationLifecycle } = __dep2;
const { createDocumentSessionRuntime } = __dep3;
const { createCoreWorkerRuntime } = __dep4;

const tick = () => new Promise(resolve => setImmediate(resolve));
const transient = () => Object.assign(new Error('network unavailable'), {retryable:true, code:'PL-NETWORK-001'});
const context = {throwIfCancelled(){}};
function engine() {
  const counts = {constructed:0, deleted:0, loads:0};
  class DocumentSession {
    constructor(){ counts.constructed++; }
    documentLoad(){ counts.loads++; return this.projectState(); }
    projectState(){ return {epoch:1,timelineCursor:'1953-07'}; }
    documentSnapshot(){ return {documentId:'retained'}; }
    selectionSnapshot(){ return {}; }
    draftSnapshot(){ return {}; }
    resolveWorld(){ return {entities:[]}; }
    executeCommand(){ throw new Error('invalid command'); }
    delete(){ counts.deleted++; }
  }
  return {module:{DocumentSession}, counts};
}
function browser() {
  const window = new EventTarget();
  const document = new EventTarget(); document.visibilityState = 'visible';
  window.document = document; window.navigator = {onLine:true}; window.CustomEvent = CustomEvent;
  return {window, document, wake(type='focus'){window.dispatchEvent(new Event(type));}};
}

for (const kind of ['document','worker']) {
  test(`${kind} initialization retries after a rejected module without poisoning the session`, async()=>{
    const e=engine(); let reads=0;
    const options={loadModule:async()=>{if(++reads===1)throw transient();return e.module;},validateFlagDataUrl:()=>true};
    const runtime=kind==='worker'?createCoreWorkerRuntime(options):createDocumentSessionRuntime(options);
    const load=()=>kind==='worker'?runtime.dispatch('core.document-load',{storageJson:'{}'},context):runtime.load({storageJson:'{}'},context);
    await assert.rejects(load(),{code:'PL-NETWORK-001'});
    assert.equal((await load()).project.documentId,'retained');
    await load(); assert.equal(reads,2); assert.equal(e.counts.constructed,1);
    await runtime.dispose(); assert.equal(e.counts.deleted,1);
  });
  test(`${kind} disposal after failed initialization does not rethrow the old network error`,async()=>{
    const options={loadModule:async()=>{throw transient();},validateFlagDataUrl:()=>true};
    const runtime=kind==='worker'?createCoreWorkerRuntime(options):createDocumentSessionRuntime(options);
    const pending=kind==='worker'?runtime.dispatch('core.document-load',{storageJson:'{}'},context):runtime.load({storageJson:'{}'},context);
    await assert.rejects(pending); await runtime.dispose();
  });
}

test('an established document survives a command failure without reloading its engine',async()=>{
  const e=engine(); let reads=0;
  const runtime=createDocumentSessionRuntime({loadModule:async()=>{reads++;return e.module;},validateFlagDataUrl:()=>true});
  await runtime.load({storageJson:'{}'},context);
  await assert.rejects(runtime.execute({},context),/invalid command/);
  assert.equal((await runtime.state({},context)).timelineCursor,'1953-07');
  assert.equal(reads,1); assert.equal(e.counts.constructed,1); await runtime.dispose();
});

test('recoverable startup keeps resources and coalesces wake events without rerunning composition',async()=>{
  const b=browser(); let attempts=0,compositions=0,released=0,ready=0; const errors=[];
  b.window.addEventListener('pandolab:ready',()=>ready++);
  const lifecycle=createApplicationLifecycle({...b,compose:[()=>compositions++],
    startup:async()=>{if(++attempts===1)throw transient();},
    shouldRetryStartup:error=>error.retryable===true,onRecoverableError:error=>errors.push(error),
    getDisposables:()=>[{dispose:()=>released++}]});
  assert.equal(await lifecycle.start(),false); assert.equal(released,0); assert.equal(errors.length,1);
  b.wake();b.wake('online');b.document.dispatchEvent(new Event('visibilitychange'));b.wake('pageshow');
  await tick(); assert.equal(attempts,2);assert.equal(compositions,1);assert.equal(ready,1);
  b.wake();await tick();assert.equal(attempts,2);
  lifecycle.dispose();b.wake();await tick();assert.equal(released,1);assert.equal(attempts,2);
});

test('hidden or offline wake cannot start a retry; manual start retries only the failed startup',async()=>{
  const b=browser();let attempts=0;
  const lifecycle=createApplicationLifecycle({...b,startup:async()=>{if(++attempts===1)throw transient();},shouldRetryStartup:()=>true});
  await lifecycle.start(); b.document.visibilityState='hidden';b.wake('online');await tick();assert.equal(attempts,1);
  b.document.visibilityState='visible';b.window.navigator.onLine=false;b.wake();await tick();assert.equal(attempts,1);
  b.window.navigator.onLine=true;const a=lifecycle.start(),c=lifecycle.start();assert.equal(a,c);
  assert.equal(await a,true);assert.equal(attempts,2);lifecycle.dispose();
});

test('fatal composition and readiness errors do not become startup retries',async()=>{
  for(const stage of ['compose','onReady','startup']){
    const b=browser();let released=0,errors=0;
    const options={...b,startup:async()=>{},shouldRetryStartup:error=>error.retryable===true,
      onError:()=>errors++,getDisposables:()=>[{dispose:()=>released++}]};
    if(stage==='compose')options.compose=[()=>{throw transient();}];
    else options[stage]=()=>{throw stage==='startup'?new Error('schema mismatch'):transient();};
    const lifecycle=createApplicationLifecycle(options);
    assert.equal(await lifecycle.start(),false);assert.equal(errors,1);assert.equal(released,1);
    b.wake();await tick();assert.equal(await lifecycle.start(),false);assert.equal(released,1);
  }
});

test('BFCache keeps startup recoverable but actual page exit disposes and ignores late failures',async()=>{
  const b=browser();let reject,released=0,errors=0;
  const lifecycle=createApplicationLifecycle({...b,startup:()=>new Promise((_resolve,fail)=>{reject=fail;}),
    shouldRetryStartup:()=>true,onRecoverableError:()=>errors++,getDisposables:()=>[{dispose:()=>released++}]});
  const pending=lifecycle.start();await tick();
  b.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));assert.equal(released,0);
  b.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:false}));assert.equal(released,1);
  reject(transient());assert.equal(await pending,false);b.wake();await tick();assert.equal(errors,0);
});

test('only an explicitly safe failed composition step can retry; accepted predecessors are not replayed',async()=>{
  const b=browser();const calls=[];let attempts=0,released=0;
  const lifecycle=createApplicationLifecycle({...b,
    compose:[()=>calls.push('allocate'),()=>{calls.push('engine');if(++attempts===1)throw transient();},()=>calls.push('map')],
    startup:()=>calls.push('startup'),shouldRetryCompose:(error,index)=>index===1&&error.retryable===true,
    getDisposables:()=>[{dispose:()=>released++}]});
  assert.equal(await lifecycle.start(),false);assert.deepEqual(calls,['allocate','engine']);assert.equal(released,0);
  b.wake();await tick();assert.deepEqual(calls,['allocate','engine','engine','map','startup']);lifecycle.dispose();
});

test('a wake arriving before a failed request settles is not lost',async()=>{
  const b=browser();let reject,attempts=0;
  const lifecycle=createApplicationLifecycle({...b,shouldRetryStartup:()=>true,
    startup:()=>++attempts===1?new Promise((_resolve,fail)=>{reject=fail;}):true});
  const first=lifecycle.start();await tick();b.wake();reject(transient());await first;await tick();assert.equal(attempts,2);lifecycle.dispose();
});

test('a superseded startup does not announce a ready map or replay the date choice',async()=>{
  const b=browser();let ready=0,attempts=0;b.window.addEventListener('pandolab:ready',()=>ready++);
  const lifecycle=createApplicationLifecycle({...b,startup:()=>{attempts++;return false;},shouldRetryStartup:()=>true});
  assert.equal(await lifecycle.start(),false);b.wake();await tick();assert.equal(ready,0);assert.equal(attempts,1);lifecycle.dispose();
});

test('non-recovering editor lifecycle retains its existing readiness contract for a false startup result',async()=>{
  const b=browser();let ready=0;
  const lifecycle=createApplicationLifecycle({...b,startup:()=>false,onReady:()=>ready++});
  assert.equal(await lifecycle.start(),true);assert.equal(ready,1);lifecycle.dispose();
});
});
contractSuite("background-asset-recovery", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { createHash } = __dep5;
const { createStoredAssetLoader } = __dep6;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bytes=Buffer.from('{"map":true}');
const spec={url:'https://test.local/map',encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
const parse=buffer=>JSON.parse(new TextDecoder().decode(buffer));
const fixture=options=>createStoredAssetLoader({dataRevision:'test',cacheStorage:null,resolveUrl:spec=>spec.url,...options});
const load=(loader,signal)=>loader.loadAsset(spec,'geometry','map','지도',parse,signal);

test('stored asset transport exhaustion preserves its recoverable network classification',async()=>{
  let calls=0;const loader=fixture({fetchFn:async()=>{calls++;throw new TypeError('Failed to fetch');}});
  await assert.rejects(load(loader),error=>error.retryable===true&&error.code==='PL-NETWORK-001');assert.equal(calls,3);
});

test('stalled body is cancelled and retried rather than retaining the only pending transport',async t=>{
  let serial=0,calls=0,cancellations=0;const timers=new Map(),bodies=[];const controller=new AbortController();
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const id=++serial;timers.set(id,{delay,run:()=>{timers.delete(id);callback();}});return id;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  t.after(()=>{controller.abort();for(const body of bodies)body.error(new DOMException('test cleanup','AbortError'));});
  const loader=fixture({fetchFn:async()=>{calls++;if(calls>1)return new Response(bytes);return new Response(new ReadableStream({start(c){bodies.push(c);},cancel(){cancellations++;}}));}});
  const pending=load(loader,controller.signal);pending.catch(()=>{});await tick();
  assert.equal(timers.size,1,'the stalled body must have an active deadline');
  [...timers.values()][0].run();await tick();assert.equal(cancellations,1);
  const backoff=[...timers.values()][0];assert.equal(backoff.delay,500);backoff.run();
  assert.deepEqual((await pending).value,{map:true});assert.equal(calls,2);assert.equal(timers.size,0);
});

test('already aborted loads do not use even a valid cache or delete it',async()=>{
  let matches=0,deletions=0,fetches=0;const controller=new AbortController();controller.abort();
  const cacheStorage={open:async()=>({match:async()=>{matches++;return new Response(bytes);},delete:async()=>deletions++})};
  const loader=fixture({cacheStorage,fetchFn:async()=>{fetches++;return new Response(bytes);}});
  await assert.rejects(load(loader,controller.signal),{name:'AbortError'});assert.equal(matches,0);assert.equal(deletions,0);assert.equal(fetches,0);
});

test('verified stored bytes still serve later loads without another network request',async()=>{
  let calls=0;const values=new Map();const cacheStorage={open:async()=>({match:async url=>values.get(url)?.clone(),
    put:async(url,response)=>values.set(url,response.clone()),delete:async url=>values.delete(url)})};
  const loader=fixture({cacheStorage,fetchFn:async()=>{calls++;return new Response(bytes);}});
  assert.equal((await load(loader)).cacheHit,false);assert.equal((await load(loader)).cacheHit,true);assert.equal(calls,1);
});
});
contractSuite("background-network-recovery", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { fetchWithRetry } = __dep7;
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
});
contractSuite("background-wasm-recovery", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { createHash } = __dep5;
const { loadVerifiedCore } = __dep8;
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const js=Buffer.from('export default factory;'),wasm=Buffer.from('verified wasm');
  const manifest={schema:'pandoeditor-core-wasm',abiVersion:1,sourceSha256:'a'.repeat(64),compiler:{name:'emscripten',version:'6.0.3'},assets:{
    js:{file:'pandoeditor-core.js',sha256:hash(js)},wasm:{file:'pandoeditor-core.wasm',sha256:hash(wasm)}}};
  let calls=0,factories=0,imports=0,revoked=0,failures=0,corrupt=false,missing=false;
  const options={baseUrl:new URL('https://test.local/wasm/'),
    fetchAsset:async url=>{calls++;if(failures-->0)throw new TypeError('Failed to fetch');
      if(url.includes('manifest.json'))return new Response(JSON.stringify(manifest));
      if(missing&&url.includes('.wasm'))return new Response('',{status:404});
      return new Response(corrupt?'wrong bytes':url.includes('.wasm')?wasm:js);},
    createModuleUrl:()=>{imports++;return 'blob:verified';},revokeModuleUrl:()=>revoked++,
    importModule:async()=>({default:async()=>{factories++;return {coreAbiVersion:1,coreSourceSha256:manifest.sourceSha256,coreCompilerVersion:'6.0.3'};}})};
  return {options,manifest,fail:()=>failures=1,corrupt:()=>corrupt=true,missing:()=>missing=true,stats:()=>({calls,factories,imports,revoked})};
}
test('temporary engine download failure is retried before any module is executed',async()=>{
  const f=fixture();f.fail();await loadVerifiedCore(f.options);
  assert.deepEqual(f.stats(),{calls:4,factories:1,imports:1,revoked:1});
});
test('invalid engine bytes never become a recoverable network error',async()=>{
  const f=fixture();f.corrupt();await assert.rejects(loadVerifiedCore(f.options),error=>error.code==='PL-CORE-WASM-INTEGRITY'&&!error.retryable);
  assert.deepEqual(f.stats(),{calls:3,factories:0,imports:0,revoked:0});
});
test('missing or invalid engine publication is not retried or admitted',async()=>{
  const f=fixture();f.missing();await assert.rejects(loadVerifiedCore(f.options),{code:'PL-CORE-WASM-UNAVAILABLE'});assert.equal(f.stats().calls,3);assert.equal(f.stats().factories,0);
  const g=fixture();g.manifest.abiVersion=2;await assert.rejects(loadVerifiedCore(g.options),{code:'PL-CORE-WASM-MANIFEST'});assert.equal(g.stats().calls,1);
});
});
