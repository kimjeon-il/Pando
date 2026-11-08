import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as loader from '../../../src/runtime/core-wasm-loader.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=m=>({sourceSha256:m.sourceSha256,abiVersion:m.abiVersion,compilerVersion:m.compiler.version,
  jsSha256:m.assets.js.sha256,wasmSha256:m.assets.wasm.sha256});
async function fixture(wasm=Uint8Array.from([0,97,115,109,1,0,0,0])){
 const js=new TextEncoder().encode('export default verifiedFactory;');
 const manifest={schema:'pandoeditor-core-wasm',abiVersion:1,sourceSha256:'a'.repeat(64),compiler:{name:'emscripten',version:'6.0.3'},assets:{
  js:{file:'pandoeditor-core.js',sha256:hash(js)},wasm:{file:'pandoeditor-core.wasm',sha256:hash(wasm)}}};
 const fetched=[],instances=[],factories=[];
 const options={baseUrl:new URL('https://test.invalid/assets/wasm/'),cacheStorage:null,
  fetchAsset:async url=>{fetched.push(String(url));return new Response(String(url).endsWith('manifest.json')?JSON.stringify(manifest):String(url).includes('.wasm')?wasm:js);},
  createModuleUrl:()=> 'blob:verified',revokeModuleUrl(){},
  importModule:async()=>({default:async input=>{
    factories.push(input);assert.equal(typeof input.instantiateWasm,'function');
    await new Promise(resolve=>input.instantiateWasm({},instance=>{assert.ok(instance instanceof WebAssembly.Instance);instances.push(instance);resolve();}));
    return {coreAbiVersion:1,coreSourceSha256:manifest.sourceSha256,coreCompilerVersion:'6.0.3'};
  }})};
 return {options,manifest,fetched,instances,factories};
}
class FakeWorker extends EventTarget{
 constructor(url){super();this.url=String(url);this.sent=[];this.terminated=false;}
 postMessage(message,transfer){assert.equal(transfer,undefined,'compiled code is cloned, never transferred/detached');this.sent.push(message);}
 terminate(){this.terminated=true;}
 request(manifest){this.dispatchEvent(new MessageEvent('message',{data:{type:'pando-core-module-request',requestId:'fixture',identity:identity(manifest)}}));}
}
test('verified code is shared while each worker creates a distinct native instance',async()=>{
 const main=await fixture();await loader.loadVerifiedCore(main.options);
 assert.equal(typeof loader.createVerifiedCoreWorker,'function');
 const worker=loader.createVerifiedCoreWorker('https://test.invalid/worker.js',{}, {WorkerClass:FakeWorker});
 assert.ok(new URL(worker.url).searchParams.has('shareCore'));
 worker.request(main.manifest);assert.equal(worker.sent.length,1);
 const sharedCore=worker.sent[0].package;
 assert.ok(sharedCore.module instanceof WebAssembly.Module);
 const child=await fixture();await loader.loadVerifiedCore({...child.options,sharedCore});
 assert.deepEqual(child.fetched,['https://test.invalid/assets/wasm/pandoeditor-core.manifest.json']);
 assert.notEqual(main.instances[0],child.instances[0]);
 assert.equal(child.factories[0].wasmBinary,undefined,'no duplicate WASM byte array is passed to worker');
 worker.terminate();worker.request(main.manifest);assert.equal(worker.sent.length,1);
});
test('worker cannot receive a module from a different code/data publication',async()=>{
 const f=await fixture();await loader.loadVerifiedCore(f.options);
 const worker=loader.createVerifiedCoreWorker('https://test.invalid/worker.js',{}, {WorkerClass:FakeWorker});
 const wrong=structuredClone(f.manifest);wrong.assets.wasm.sha256='f'.repeat(64);
 worker.request(wrong);assert.equal(worker.sent[0].error.code,'PL-CORE-WASM-SHARED');
 assert.equal(worker.sent[0].package,undefined);worker.terminate();
});
test('invalid verified-byte compilation rejects instead of hanging Emscripten initialization',{timeout:5000},async()=>{
 const f=await fixture(new TextEncoder().encode('invalid wasm but accurately hashed'));
 await assert.rejects(loader.loadVerifiedCore(f.options),/WebAssembly|wasm|magic|compil/i);
});
