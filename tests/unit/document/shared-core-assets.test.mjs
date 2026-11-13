import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sharedSourceManifest, packageSharedCoreAssets } from "../../../tools/build/package-shared-core-assets.mjs";

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'pando-core-assets-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const p of ['src/document/native','src/geometry/native','tools/build/native','config'])mkdirSync(join(root,p),{recursive:true});
  writeFileSync(join(root,'config/core-source-roots.json'),JSON.stringify({schema:'pando-core-source-roots-v1',roots:['src/document/native','src/geometry/native','tools/build/native']}));
  writeFileSync(join(root,'config/toolchain-versions.json'),JSON.stringify({schema:'pando-development-toolchain-v1',emscripten:'6.0.3'}));
  writeFileSync(join(root,'tools/build/native/CMakeLists.txt'),'project(core)\n');
  writeFileSync(join(root,'src/document/native/model.cpp'),'int model=1;\n');
  const build=join(root,'build');mkdirSync(build);
  const identity=sharedSourceManifest(root);
  writeFileSync(join(build,'pandoeditor-core.js'),
    `export default async()=>({coreAbiVersion:1,coreCompilerVersion:'6.0.3',coreSourceSha256:'${identity.sourceSha256}'});\n`);
  writeFileSync(join(build,'pandoeditor-core.wasm'),Buffer.from([0,97,115,109,1,0,0,0]));
  return {root,build};
}

test('packages paired byte hashes and detects changed sources and missing outputs', async t => {
  const {root,build}=fixture(t);
  const manifest=await packageSharedCoreAssets(root,build);
  assert.equal(manifest.abiVersion,1);
  assert.equal(manifest.compiler.version,'6.0.3');
  assert.equal(manifest.inputs.length,3);
  assert.deepEqual(await packageSharedCoreAssets(root,build,{check:true}),manifest);
  writeFileSync(join(root,'config/toolchain-versions.json'),JSON.stringify({schema:'pando-development-toolchain-v1',emscripten:'6.0.4'}));
  await assert.rejects(packageSharedCoreAssets(root,build),/core compiler version mismatch/);
  writeFileSync(join(root,'config/toolchain-versions.json'),JSON.stringify({schema:'pando-development-toolchain-v1',emscripten:'6.0.3'}));
  writeFileSync(join(root,'assets/wasm/pandoeditor-core.wasm'),Buffer.from('changed'));
  await assert.rejects(packageSharedCoreAssets(root,build,{check:true}),error=>{
    assert.match(error.message,/WASM binary artifact stale/);
    assert.match(error.actual,/^[a-f0-9]{64}$/);
    return true;
  });
  writeFileSync(join(root,'src/document/native/model.cpp'),'int model=2;\n');
  await assert.rejects(packageSharedCoreAssets(root,build),/source identity/);
  await assert.rejects(packageSharedCoreAssets(root,join(root,'missing')),/ENOENT/);
});

test('source digest defines only source text line endings and retains numeric edits', t => {
  const {root}=fixture(t),before=sharedSourceManifest(root);
  writeFileSync(join(root,'src/document/native/model.cpp'),'int model=1;\r\n');
  assert.deepEqual(sharedSourceManifest(root),before);
  writeFileSync(join(root,'src/document/native/model.cpp'),'int model=2;\n');
  assert.notEqual(sharedSourceManifest(root).sourceSha256,before.sourceSha256);
});

test('vendored C++ headers participate in the same compiled source identity', t => {
  const {root}=fixture(t),before=sharedSourceManifest(root);
  mkdirSync(join(root,'src/geometry/native/vendor/earcut'),{recursive:true});
  const header=join(root,'src/geometry/native/vendor/earcut/earcut.hpp');
  writeFileSync(header,'inline int triangulate() { return 1; }\n');
  const withVendor=sharedSourceManifest(root);
  assert.equal(withVendor.inputs.length,before.inputs.length+1);
  assert.notEqual(withVendor.sourceSha256,before.sourceSha256);
  writeFileSync(header,'inline int triangulate() { return 2; }\n');
  assert.notEqual(sharedSourceManifest(root).sourceSha256,withVendor.sourceSha256);
});

test('packages JavaScript with the committed LF bytes before fixing its manifest hash',async t => {
  const {root,build}=fixture(t);
  const path=join(build,'pandoeditor-core.js'),lf=readFileSync(path);
  writeFileSync(path,lf.toString('utf8').replace(/\n/g,'\r\n'));
  const manifest=await packageSharedCoreAssets(root,build);
  assert.deepEqual(readFileSync(join(root,'assets/wasm/pandoeditor-core.js')),lf);
  assert.equal(manifest.assets.js.sha256,createHash('sha256').update(lf).digest('hex'));
  assert.deepEqual(await packageSharedCoreAssets(root,build,{check:true}),manifest);
});
