import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sharedSourceManifest, packageSharedCoreAssets } from '../../tools/package-shared-core-assets.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'pando-core-assets-'));
  mkdirSync(join(root,'shared/core'),{recursive:true});
  writeFileSync(join(root,'shared/CMakeLists.txt'),'project(core)\n');
  writeFileSync(join(root,'shared/core/model.cpp'),'int model=1;\n');
  const build=join(root,'build');mkdirSync(build);
  const identity=sharedSourceManifest(root);
  writeFileSync(join(build,'pandoeditor-core.js'),
    `export default async()=>({coreAbiVersion:1,coreCompilerVersion:'4.0.20',coreSourceSha256:'${identity.sourceSha256}'});\n`);
  writeFileSync(join(build,'pandoeditor-core.wasm'),Buffer.from([0,97,115,109,1,0,0,0]));
  return {root,build};
}

test('packages paired byte hashes and detects changed sources and missing outputs', async () => {
  const {root,build}=fixture();
  const manifest=await packageSharedCoreAssets(root,build);
  assert.equal(manifest.abiVersion,1);
  assert.equal(manifest.compiler.version,'4.0.20');
  assert.equal(manifest.inputs.length,2);
  assert.deepEqual(await packageSharedCoreAssets(root,build,{check:true}),manifest);
  writeFileSync(join(root,'shared/frontend/static/wasm/pandoeditor-core.wasm'),Buffer.from('changed'));
  await assert.rejects(packageSharedCoreAssets(root,build,{check:true}),error=>{
    assert.match(error.message,/WASM binary artifact stale/);
    assert.match(error.actual,/^[a-f0-9]{64}$/);
    return true;
  });
  writeFileSync(join(root,'shared/core/model.cpp'),'int model=2;\n');
  await assert.rejects(packageSharedCoreAssets(root,build),/source identity/);
  await assert.rejects(packageSharedCoreAssets(root,join(root,'missing')),/ENOENT/);
});

test('source digest defines only source text line endings and retains numeric edits', () => {
  const {root}=fixture(),before=sharedSourceManifest(root);
  writeFileSync(join(root,'shared/core/model.cpp'),'int model=1;\r\n');
  assert.deepEqual(sharedSourceManifest(root),before);
  writeFileSync(join(root,'shared/core/model.cpp'),'int model=2;\n');
  assert.notEqual(sharedSourceManifest(root).sourceSha256,before.sourceSha256);
});

test('vendored C++ headers participate in the same compiled source identity', () => {
  const {root}=fixture(),before=sharedSourceManifest(root);
  mkdirSync(join(root,'shared/third_party/earcut'),{recursive:true});
  const header=join(root,'shared/third_party/earcut/earcut.hpp');
  writeFileSync(header,'inline int triangulate() { return 1; }\n');
  const withVendor=sharedSourceManifest(root);
  assert.equal(withVendor.inputs.length,before.inputs.length+1);
  assert.notEqual(withVendor.sourceSha256,before.sourceSha256);
  writeFileSync(header,'inline int triangulate() { return 2; }\n');
  assert.notEqual(sharedSourceManifest(root).sourceSha256,withVendor.sourceSha256);
});

test('packages JavaScript with the committed LF bytes before fixing its manifest hash',async () => {
  const {root,build}=fixture();
  const path=join(build,'pandoeditor-core.js'),lf=readFileSync(path);
  writeFileSync(path,lf.toString('utf8').replace(/\n/g,'\r\n'));
  const manifest=await packageSharedCoreAssets(root,build);
  assert.deepEqual(readFileSync(join(root,'shared/frontend/static/wasm/pandoeditor-core.js')),lf);
  assert.equal(manifest.assets.js.sha256,createHash('sha256').update(lf).digest('hex'));
  assert.deepEqual(await packageSharedCoreAssets(root,build,{check:true}),manifest);
});
