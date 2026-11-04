// Content-keyed cache for CI-built WASM only. Never install SDKs or edit source.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,readdirSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {appendFileSync} from 'node:fs';
import {sharedSourceManifest} from '../tools/package-shared-core-assets.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const filenames=['pandoeditor-core.js','pandoeditor-core.wasm'];
const inputs=['CMakeLists.txt','CMakePresets.json','config/toolchain-versions.json',
  'tools/package-shared-core-assets.mjs','scripts/remote-only-wasm-cache.mjs'];
export function wasmCacheIdentity(repository=root) {
  const shared=sharedSourceManifest(repository);
  const pins=JSON.parse(readFileSync(join(repository,'config/toolchain-versions.json'),'utf8'));
  assert.equal(pins.emscripten,'6.0.3','Unknown pinned Emscripten compiler');
  const members=inputs.map(path=>({path,sha256:sha256(readFileSync(join(repository,path)))}));
  const fingerprint=sha256(Buffer.from(JSON.stringify({
    schema:'pando-wasm-cache-v1',sourceSha256:shared.sourceSha256,pins:{
      emscripten:pins.emscripten,emsdkCommit:pins.emsdkCommit,cmake:pins.cmake},members
  })));
  return {schema:'pando-wasm-cache-v1',sourceSha256:shared.sourceSha256,
    compiler:pins.emscripten,key:'pando-remote-wasm-v1-'+fingerprint};
}
function plain(directory){
  for(const name of readdirSync(directory)){
    const file=join(directory,name),stats=lstatSync(file);
    if(stats.isSymbolicLink()||!stats.isFile())throw Error('Unsafe cached WASM entry');
  }
}
export async function verifyWasmCache({repository=root,directory=join(repository,'build-native/remote-only-wasm-cache'),
  instantiate=async(js,wasm)=>{
    const url=pathToFileURL(js);url.searchParams.set('cache',sha256(readFileSync(js)));
    const {default:create}=await import(url.href);
    return create({wasmBinary:wasm});
  }}={}) {
  const identity=wasmCacheIdentity(repository);
  if(!existsSync(directory))throw Error('Missing remote WASM cache directory');
  plain(directory);
  const found=readdirSync(directory).sort();
  assert.deepEqual(found,[...filenames,'cache-identity.json'].sort(),'WASM cache contains unowned files');
  const marker=JSON.parse(readFileSync(join(directory,'cache-identity.json'),'utf8'));
  assert.equal(marker.schema,identity.schema);
  assert.equal(marker.key,identity.key,'WASM build inputs changed');
  assert.equal(marker.sourceSha256,identity.sourceSha256,'WASM source changed');
  assert.equal(marker.compiler,identity.compiler);
  assert.deepEqual(Object.keys(marker.files).sort(),filenames.slice().sort());
  for(const file of filenames) {
    const bytes=readFileSync(join(directory,file));
    assert.equal(sha256(bytes),marker.files[file],'WASM cache byte hash differs: '+file);
  }
  const wasm=readFileSync(join(directory,'pandoeditor-core.wasm'));
  assert.ok(wasm.length>=8&&wasm.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])),'Invalid cached WebAssembly header');
  const core=await instantiate(join(directory,'pandoeditor-core.js'),wasm);
  assert.equal(core.coreAbiVersion,1,'WASM cached ABI changed');
  assert.equal(core.coreCompilerVersion,identity.compiler,'WASM compiler changed');
  assert.equal(core.coreSourceSha256,identity.sourceSha256,'WASM compiled source identity changed');
  return marker;
}
export async function recordWasmCache({repository=root,
  build=join(repository,'build-native/p1/pando-wasm/shared/wasm'),
  directory=join(repository,'build-native/remote-only-wasm-cache'),instantiate}={}) {
  if(existsSync(directory))throw Error('Cache destination already exists; preserve its bytes');
  const identity=wasmCacheIdentity(repository);
  const files=Object.fromEntries(filenames.map(name=>{
    const bytes=readFileSync(join(build,name));return [name,sha256(bytes)];
  }));
  mkdirSync(directory,{recursive:true});
  for(const name of filenames)copyFileSync(join(build,name),join(directory,name));
  writeFileSync(join(directory,'cache-identity.json'),JSON.stringify({...identity,files})+'\n',{flag:'wx'});
  return verifyWasmCache({repository,directory,instantiate});
}
export async function restoreWasmCache({repository=root,
  directory=join(repository,'build-native/remote-only-wasm-cache'),
  build=join(repository,'build-native/p1/pando-wasm/shared/wasm'),instantiate}={}) {
  const marker=await verifyWasmCache({repository,directory,instantiate});
  mkdirSync(build,{recursive:true});
  for(const name of filenames){
    const output=join(build,name),bytes=readFileSync(join(directory,name));
    if(existsSync(output)){
      assert.equal(sha256(readFileSync(output)),marker.files[name],'Conflicting existing WASM build output');
    }else writeFileSync(output,bytes,{flag:'wx'});
  }
  return marker;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2];
  const identity=wasmCacheIdentity();
  if(mode==='--identity'){
    if(process.argv.includes('--github-output')){
      if(!process.env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT required');
      appendFileSync(process.env.GITHUB_OUTPUT,'cache_key='+identity.key+'\n');
    }
    console.log(JSON.stringify(identity));
  }else{
    if(process.env.GITHUB_ACTIONS!=='true')throw Error('WASM cache mutation or verification belongs to GitHub Actions');
    const result=mode==='--verify'?await verifyWasmCache():
      mode==='--record'?await recordWasmCache():
      mode==='--restore'?await restoreWasmCache():null;
    if(!result)throw Error('Expected --identity|--verify|--record|--restore');
    console.log(JSON.stringify({mode,key:result.key,sourceSha256:result.sourceSha256}));
  }
}
