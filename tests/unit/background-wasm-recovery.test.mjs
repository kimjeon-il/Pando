import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadVerifiedCore} from '../../shared/frontend/js/modules/core-wasm-loader.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const js=Buffer.from('export default factory;'),wasm=Buffer.from('verified wasm');
  const manifest={schema:'pandoeditor-core-wasm',abiVersion:1,sourceSha256:'a'.repeat(64),compiler:{name:'emscripten',version:'4.0.20'},assets:{
    js:{file:'pandoeditor-core.js',sha256:hash(js)},wasm:{file:'pandoeditor-core.wasm',sha256:hash(wasm)}}};
  let calls=0,factories=0,imports=0,revoked=0,failures=0,corrupt=false,missing=false;
  const options={baseUrl:new URL('https://test.local/wasm/'),
    fetchAsset:async url=>{calls++;if(failures-->0)throw new TypeError('Failed to fetch');
      if(url.includes('manifest.json'))return new Response(JSON.stringify(manifest));
      if(missing&&url.includes('.wasm'))return new Response('',{status:404});
      return new Response(corrupt?'wrong bytes':url.includes('.wasm')?wasm:js);},
    createModuleUrl:()=>{imports++;return 'blob:verified';},revokeModuleUrl:()=>revoked++,
    importModule:async()=>({default:async()=>{factories++;return {coreAbiVersion:1,coreSourceSha256:manifest.sourceSha256,coreCompilerVersion:'4.0.20'};}})};
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
