import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {frontendWasmRoot} from '../scripts/lib/frontend-layout.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sharedSourceManifest(root) {
  const base=join(root,'shared'),paths=[];
  function scan(folder,prefix='shared/') {
    for(const entry of readdirSync(folder,{withFileTypes:true})) {
      const name=prefix+entry.name;
      if(entry.isDirectory())scan(join(folder,entry.name),name+'/');
      else if(entry.isFile()&&(/\.(cpp|h|hpp)(\.in)?$|\.cmake$/.test(name)||entry.name==='CMakeLists.txt'))paths.push(name);
    }
  }
  scan(base);
  const inputs=paths.sort().map(path=>({path,sha256:sha256(Buffer.from(
    new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(join(root,path))).replace(/\r\n/g,'\n')))}));
  return {inputs,sourceSha256:sha256(inputs.map(row=>`${row.path}\n${row.sha256}\n`).join(''))};
}

export async function packageSharedCoreAssets(rootInput,buildInput,{check=false,skipChecks=false}={}) {
  if(check&&skipChecks)throw Error('Cannot combine --check and --skip-checks');
  const root=resolve(rootInput),build=resolve(buildInput);
  // Git commits this generated module with LF endings; hash the published bytes.
  const js=Buffer.from(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true})
    .decode(readFileSync(join(build,'pandoeditor-core.js'))).replace(/\r\n/g,'\n'));
  const wasm=readFileSync(join(build,'pandoeditor-core.wasm'));
  assert.ok(wasm.length>=8&&wasm.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])),'invalid WASM artifact');
  const identity=sharedSourceManifest(root);
  if(!skipChecks){
    const url=pathToFileURL(join(build,'pandoeditor-core.js'));url.searchParams.set('verify',sha256(js));
    const {default:createCore}=await import(url.href);
    const module=await createCore({wasmBinary:wasm});
    assert.equal(module.coreAbiVersion,1,'core ABI mismatch');
    assert.equal(module.coreCompilerVersion,'4.0.20','core compiler version mismatch');
    assert.equal(module.coreSourceSha256,identity.sourceSha256,'compiled core source identity mismatch');
  }
  const manifest={schema:'pandoeditor-core-wasm',abiVersion:1,sourceSha256:identity.sourceSha256,
    compiler:{name:'emscripten',version:'4.0.20'},inputs:identity.inputs,
    assets:{js:{file:'pandoeditor-core.js',sha256:sha256(js)},wasm:{file:'pandoeditor-core.wasm',sha256:sha256(wasm)}}};
  const destination=join(root,frontendWasmRoot);
  if(check) {
    assert.equal(sha256(readFileSync(join(destination,manifest.assets.js.file))),manifest.assets.js.sha256,'WASM JavaScript artifact stale');
    assert.equal(sha256(readFileSync(join(destination,manifest.assets.wasm.file))),manifest.assets.wasm.sha256,'WASM binary artifact stale');
    assert.deepEqual(JSON.parse(readFileSync(join(destination,'pandoeditor-core.manifest.json'))),manifest,'WASM manifest stale');
  } else {
    mkdirSync(destination,{recursive:true});
    // Publish the manifest last; readers reject an incomplete/mixed pair.
    for(const [name,bytes] of [[manifest.assets.js.file,js],[manifest.assets.wasm.file,wasm],
      ['pandoeditor-core.manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]) {
      const target=join(destination,name),temporary=target+'.tmp';
      writeFileSync(temporary,bytes);renameSync(temporary,target);
    }
  }
  return manifest;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const at=process.argv.indexOf('--build-dir');
  if(at<0||!process.argv[at+1])throw Error('Required: --build-dir DIR containing the generated JS/WASM pair');
  const manifest=await packageSharedCoreAssets(fileURLToPath(new URL('../',import.meta.url)),process.argv[at+1],
    {check:process.argv.includes('--check'),skipChecks:process.argv.includes('--skip-checks')});
  console.log(JSON.stringify({sourceSha256:manifest.sourceSha256,assets:manifest.assets,
    mode:process.argv.includes('--check')?'check':'package'}));
}
