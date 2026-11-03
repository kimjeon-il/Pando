import {editorStageRoot} from '../../../tools/worktree-storage.mjs';
import {nativeBuildArguments} from '../native-producer.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createDevelopmentAssets,stagePrototype,validateShellProfile} from '../stage.mjs';
import {assertOrdinaryBuild,assertVerificationBuild} from '../packaged-artifacts.mjs';
import {worldFixture} from './helpers/world-fixture.mjs';

const files=stage=>new Set(stage.files.map(row=>row.path));
const legacy=[
  'assets/js/app.js','assets/js/bootstrap.js','assets/js/gis-io.js',
  'shell/startup.js','shell/native-storage.js','shell/document-transfer-contract.js',
  'shell/native-platform-adapter.js','shell/verification.js','shell/diagnostics.js',
];
test('E6 keeps map-data and an explicit verification-only fixture; no graphical editor mode',()=>{
  assert.doesNotThrow(()=>validateShellProfile('map-data',false));
  assert.doesNotThrow(()=>validateShellProfile('test-fixture',true));
  assert.throws(()=>validateShellProfile('test-fixture',false),/verification/i);
  assert.throws(()=>validateShellProfile('graphical-editor',true),/Unknown/);
  assert.throws(()=>nativeBuildArguments('android','development'),/platform/i);
  assert.doesNotThrow(()=>assertOrdinaryBuild({verification:false,profile:'map-data'}));
  assert.throws(()=>assertOrdinaryBuild({verification:true}),/verification/);
  assert.doesNotThrow(()=>assertVerificationBuild({verification:true,profile:'test-fixture'}));
});
test('E6 ordinary startup rejects the fixture before writing assets',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pandolab-e6-reject-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await assert.rejects(stagePrototype({root,profile:'test-fixture'}),/verification/i);
  await assert.rejects(createDevelopmentAssets({root,profile:'test-fixture'}),/verification/i);
  await assert.rejects(stat(join(root,'apps')),/ENOENT/);
});
test('E6 Windows map-data package contains the viewer, review shell and no retired editor runtime',async t=>{
  const {root}=await worldFixture(t);
  const stage=await stagePrototype({root,profile:'map-data'});
  const names=files(stage);
  assert.equal(stage.nativeEntry,'review.html');
  assert.ok(names.has('review.html')&&names.has('index.html'));
  assert.ok(names.has('assets/js/viewer.js'));
  assert.ok(names.has('assets/wasm/pandoeditor-core.wasm'));
  for(const old of legacy)assert.equal(names.has(old),false,old);
  assert.equal(stage.worldData.countryCount,258);
  const reviewer=await readFile(join(stage.directory,'review.html'),'utf8');
  assert.match(reviewer,/assets\/js\/viewer\.js/);
  assert.match(reviewer,/id="reviewPanel"/);
  assert.doesNotMatch(reviewer,/shell\/startup\.js|assets\/js\/bootstrap\.js/);
});
test('E6 native reviewer has verification probe only in explicit verification mode',async t=>{
  const {root}=await worldFixture(t);
  const normal=await stagePrototype({root});
  for(const old of legacy)assert.equal(files(normal).has(old),false,old);
  assert.equal(files(normal).has('shell/review-probe.js'),false);
  const verified=await stagePrototype({root,profile:'test-fixture',verification:true});
  assert.ok(files(verified).has('shell/review-probe.js'));
  for(const old of legacy)assert.equal(files(verified).has(old),false,old);
  assert.match(await readFile(join(verified.directory,'review.html'),'utf8'),/shell\/review-probe\.js/);
  await stagePrototype({root});
  await assert.rejects(readFile(join(editorStageRoot(root),'dist/shell/review-probe.js')),/ENOENT/);
});
test('E6 staging enforces the read-only reviewer even when an old caller asks for an editor',async t=>{
  const {root}=await worldFixture(t);
  await assert.rejects(stagePrototype({root,windowsReview:false}),/graphical editor staging is retired/i);
});
test('E6 original WASM hashes remain authoritative and reject tampering without altering the last stage',async t=>{
  const {root,put}=await worldFixture(t);
  await stagePrototype({root});
  const previous=await readFile(join(editorStageRoot(root),'dist/review.html'));
  await put('assets/wasm/pandoeditor-core.wasm','tampered');
  await assert.rejects(stagePrototype({root}),/WASM.*hash|hash.*WASM/i);
  assert.deepEqual(await readFile(join(editorStageRoot(root),'dist/review.html')),previous);
});
test('E6 development server assets expose only the same reviewer without mutating native outputs',async t=>{
  const {root}=await worldFixture(t);
  const stage=await createDevelopmentAssets({root});
  assert.ok(stage.assets.has('review.html'));
  assert.ok(stage.assets.has('assets/js/viewer.js'));
  for(const old of legacy)assert.equal(stage.assets.has(old),false,old);
  await assert.rejects(readFile(join(editorStageRoot(root),'dist/review.html')),/ENOENT/);
});
test('E6 refuses to erase an unowned stage directory',async t=>{
  const {root}=await worldFixture(t);
  const {mkdir,writeFile}=await import('node:fs/promises');
  const folder=join(editorStageRoot(root),'dist');
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'keep.txt'),'not-owned');
  await assert.rejects(stagePrototype({root}),/owned|ownership/i);
  assert.equal(await readFile(join(folder,'keep.txt'),'utf8'),'not-owned');
});
