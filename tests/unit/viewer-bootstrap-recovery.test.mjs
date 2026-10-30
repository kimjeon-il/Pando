import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {isRecoverableLoadError} from '../../shared/frontend/js/modules/reliability-core.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element extends EventTarget {
  constructor(){super();this.dataset={};this.children=[];this.hidden=false;}
  set textContent(value){this.text=value;this.children=[];}
  get textContent(){return this.text;}
  setAttribute(name,value){this[name]=value;}
  appendChild(value){this.children.push(value);}
}
function fixture({failures=0,hold=false,fatal=false}={}){
  const status=new Element(),document=new EventTarget(),window=new EventTarget();
  document.visibilityState='visible';document.getElementById=()=>status;document.createElement=()=>new Element();
  window.navigator={onLine:true};window.document=document;
  let reads=0,imports=0,compositions=0,release,signal;
  const core={verified:true},errors=[];
  const context=vm.createContext({window,document,navigator:window.navigator,AbortController,URL,
    console:{error:(...args)=>errors.push(args),warn:(...args)=>errors.push(args)},
    PANDOLAB_BUILD_META:{appVersion:'fixture'},isRecoverableLoadError,
    loadVerifiedCore:async options=>{reads++;signal=options.signal;
      if(fatal)throw Object.assign(new Error('bad engine digest'),{code:'PL-CORE-WASM-INTEGRITY'});
      if(failures-->0)throw Object.assign(new Error('offline'),{code:'PL-NETWORK-001',retryable:true});
      if(hold)await new Promise(resolve=>{release=resolve;});return core;},
    composeViewer:async()=>{compositions++;},
    importViewer:async()=>{imports++;assert.equal(context.PandoLabSphericalCore,core,'engine must be ready before evaluating the application graph');return {composeViewer:async()=>{compositions++;}};},
  });
  // Replace only module loading boundaries; execute the actual entry behavior.
  const source=readFileSync(new URL('../../apps/viewer/js/viewer.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?$/gm,'')
    .replaceAll('import.meta.url',JSON.stringify('https://test.local/assets/js/viewer.js'))
    .replace("import('./modules/viewer-composition.js')",'importViewer()');
  vm.runInContext(source,context);
  return {status,document,window,errors,release:()=>release(),signal:()=>signal,
    stats:()=>({reads,imports,compositions}),wake:()=>window.dispatchEvent(new Event('focus'))};
}

test('viewer verifies the engine before loading the application module graph',async()=>{
  const f=fixture();await tick();assert.deepEqual(f.stats(),{reads:1,imports:1,compositions:1});f.wake();await tick();assert.equal(f.stats().compositions,1);
});
test('pre-composition network failure recovers on wake without refresh or duplicate composition',async()=>{
  const f=fixture({failures:1});await tick();assert.deepEqual(f.stats(),{reads:1,imports:0,compositions:0});
  assert.equal(f.status.children[0].textContent,'다시 시도');f.wake();f.window.dispatchEvent(new Event('online'));await tick();
  assert.deepEqual(f.stats(),{reads:2,imports:1,compositions:1});
});
test('pre-composition failure exposes a retry action even when no new wake event arrives',async()=>{
  const f=fixture({failures:1});await tick();assert.equal(f.status.children.length,1);
  f.status.children[0].dispatchEvent(new Event('click'));await tick();assert.equal(f.stats().compositions,1);
});
test('engine integrity failures are not retried on focus',async()=>{
  const f=fixture({fatal:true});await tick();f.wake();await tick();assert.deepEqual(f.stats(),{reads:1,imports:0,compositions:0});assert.equal(f.status.role,'alert');
});
test('actual page exit cancels preflight and rejects late completion; BFCache does not',async()=>{
  const f=fixture({hold:true});await tick();
  f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));assert.equal(f.signal().aborted,false);
  f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:false}));assert.equal(f.signal().aborted,true);
  f.release();await tick();assert.equal(f.stats().compositions,0);assert.equal(f.stats().imports,0);
});
