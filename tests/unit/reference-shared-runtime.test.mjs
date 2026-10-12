import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createReferenceManifest, verifyReferenceManifest } from '../../native/tools/reference-parity/source-manifest.mjs';
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('reference source and artifact hashes reject independent source or runtime changes', () => {
  const root=mkdtempSync(join(tmpdir(),'pando-reference-source-'));
  mkdirSync(join(root,'assets/js/modules'),{recursive:true});
  const path='assets/js/modules/reference.js';
  writeFileSync(join(root,path),'export const input=1;\n');
  const runtime=Buffer.from('var ReferenceWeb={input:1};\n');
  const manifest=createReferenceManifest(root,[path],runtime);
  verifyReferenceManifest(root,manifest,runtime);
  // Source line endings are a declared build representation, not geometry normalization.
  writeFileSync(join(root,path),'export const input=1;\r\n');
  verifyReferenceManifest(root,manifest,runtime);
  writeFileSync(join(root,path),'export const input=2;\n');
  assert.throws(()=>verifyReferenceManifest(root,manifest,runtime),/source hash/);
  writeFileSync(join(root,path),'export const input=1;\n');
  assert.throws(()=>verifyReferenceManifest(root,manifest,Buffer.from('modified')),/runtime hash/);
});

test('bundled native calibration retains reviewed affine, projective, TPS and error fixtures', () => {
  const native=new URL('../../native/',import.meta.url);
  const code=readFileSync(new URL('app/reference-web/runtime.js',native),'utf8');
  const api=runInNewContext(`${code}\nReferenceWeb;`,{}, {timeout:1000});
  const cases=JSON.parse(readFileSync(new URL('tests/fixtures/reference-calibration.json',native)));
  for(const {input,expected} of cases) {
    const actual=JSON.parse(JSON.stringify(api.calibration(input)));
    assert.equal(actual.calibrationOk,expected.ok,input.warpMode);
    assert.equal(actual.calibrationReason,expected.reason,input.warpMode);
    assert.deepEqual(actual.mesh,expected.mesh,input.warpMode);
  }
});

test('native build admission rejects canonical JS edits before accepting the generated runtime', () => {
  const root=mkdtempSync(join(tmpdir(),'pando-native-reference-check-'));
  mkdirSync(join(root,'assets/js/modules'),{recursive:true});
  mkdirSync(join(root,'native/tools/reference-parity'),{recursive:true});
  mkdirSync(join(root,'native/app/reference-web'),{recursive:true});
  for(const file of ['verify-source.mjs','source-manifest.mjs'])copyFileSync(
    new URL('../../native/tools/reference-parity/'+file,import.meta.url),join(root,'native/tools/reference-parity',file));
  const source='assets/js/modules/reference.js',runtime=Buffer.from('var ReferenceWeb={input:1};\n');
  writeFileSync(join(root,source),'export const input=1;\n');
  writeFileSync(join(root,'native/app/reference-web/runtime.js'),runtime);
  writeFileSync(join(root,'native/app/reference-web/manifest.json'),JSON.stringify(createReferenceManifest(root,[source],runtime)));
  const module=fileURLToPath(new URL('../../native/cmake/ReferenceRuntime.cmake',import.meta.url)).replaceAll('\\','/');
  writeFileSync(join(root,'CMakeLists.txt'),`cmake_minimum_required(VERSION 3.21)
project(ReferenceAdmission LANGUAGES NONE)
set(PANDO_REFERENCE_SOURCE_ROOT "${root.replaceAll('\\','/')}")
include("${module}")
add_custom_target(editor ALL)
add_dependencies(editor pandoeditor_reference_runtime_check)
`);
  const cmake=process.env.PANDOEDITOR_CMAKE_EXE||'cmake';
  const run=args=>spawnSync(cmake,args,{encoding:'utf8',timeout:15000});
  const configured=run(['-S',root,'-B',join(root,'build'),'-G','Ninja']);
  assert.equal(configured.status,0,configured.stdout+configured.stderr);
  const build=()=>run(['--build',join(root,'build'),'--parallel','1']);
  const before=build();assert.equal(before.status,0,before.stdout+before.stderr);
  writeFileSync(join(root,source),'export const input=2;\n');
  const after=build();assert.notEqual(after.status,0);
  assert.match(after.stdout+after.stderr,/source hash/);
});
