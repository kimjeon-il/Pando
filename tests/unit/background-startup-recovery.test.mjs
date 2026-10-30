import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplicationLifecycle} from '../../shared/frontend/js/modules/application-lifecycle.js';
import {createDocumentSessionRuntime} from '../../shared/frontend/js/modules/core-document-runtime.js';
import {createCoreWorkerRuntime} from '../../shared/frontend/js/modules/core-worker-runtime.js';

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
