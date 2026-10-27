import {editorStageRoot} from '../../../tools/worktree-storage.mjs';
import {nativeBuildArguments} from '../native-producer.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createDevelopmentAssets, stagePrototype, validateShellProfile } from '../stage.mjs';
import { startDevelopmentServer } from '../../../scripts/frontend-dev-server.mjs';
import { assertOrdinaryBuild, assertVerificationBuild } from '../packaged-artifacts.mjs';
import { createBuiltinWorldLoader } from "../../../shared/frontend/js/modules/builtin-world-loader.js";
import { createRuntimeProfile } from '../runtime-profile.js';

import { worldFixture } from './helpers/world-fixture.mjs';
test('data profile names describe real map data and a verification fixture', () => {
  assert.doesNotThrow(() => validateShellProfile('map-data', false));
  assert.doesNotThrow(() => validateShellProfile('test-fixture', true));
  assert.throws(() => validateShellProfile('test-fixture', false), /verification/i);
  for (const name of ['full-world', 'small-project']) assert.throws(() => validateShellProfile(name, true), /Unknown/);
});
test('ordinary staging and development reject the test profile before creating output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pandolab-profile-rejection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(stagePrototype({ root, profile: 'test-fixture' }), /verification/i);
  await assert.rejects(createDevelopmentAssets({ root, profile: 'test-fixture' }), /verification/i);
  await assert.rejects(startDevelopmentServer({ repository: root, port: 0, profile: 'test-fixture', observe: false }), /verification/i);
  await assert.rejects(stat(join(root, 'apps')), /ENOENT/);
});

test('ordinary artifact identity rejects the verification fixture profile', () => {
  assert.throws(() => assertOrdinaryBuild({ verification: false, profile: 'test-fixture' }), /map-data/i);
});

test('ordinary runtime profile refuses the fixture before loading its assets', async t => {
  const profile = { mode: 'test-fixture', verification: false,
    builtinWorld: { url: './fixture-world.json', sha256: 'a'.repeat(64) }, countriesUrl: './fixture-countries.json' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(profile)));
  await assert.rejects(createRuntimeProfile(profile), /map-data/i);
});

test('an environment-selected fixture cannot start ordinary development or a packaging build', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pandolab-profile-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'unused-target');
  for (const [script, args, verification] of [['dev.mjs', ['--native=windows'], '1'], ['packaged-artifacts.mjs', ['--fetch','--platform=windows','--mode=offline'], '0']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../' + script, import.meta.url)), ...args], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PANDOLAB_SHELL_PROFILE: 'test-fixture', PANDOLAB_SHELL_VERIFICATION: verification, CARGO_TARGET_DIR: target },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /test-fixture.*verification/i);
  }
  await assert.rejects(stat(target), /ENOENT/);
});
test('native build mode controls features and rejects the wrong artifact identity', () => {
  assert.ok(nativeBuildArguments('windows','verification').includes('custom-protocol,verification'));
  assert.ok(!nativeBuildArguments('windows','offline').includes('custom-protocol,verification'));
  assert.throws(() => assertOrdinaryBuild({ verification: true }), /verification/);
  assert.throws(() => assertOrdinaryBuild({ executionMode: 'development', verification: false }), /offline/);
  assert.throws(() => assertOrdinaryBuild({}), /identity/);
  assert.doesNotThrow(() => assertOrdinaryBuild({ verification: false, profile: 'map-data' }));
  assert.throws(() => assertVerificationBuild({ verification: false }), /verification/);
  assert.doesNotThrow(() => assertVerificationBuild({ verification: true, profile: 'test-fixture' }));
});

test('startup errors use ordinary reporting except in the auto verification window', async () => {
  const source = (await readFile(new URL('../startup.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', '"https://shell.test/shell/startup.js"')
    .replace('const verification = null;', 'const verification = globalThis.testVerification;');
  for (const [verification, auto, expected] of [[false, false, 'report'], [true, false, 'report'], [true, true, 'finish']]) {
    const calls = [];
    await runInNewContext(source, {
      testVerification: verification ? { finishDiagnostics: async report => calls.push(['finish', report]) } : null,
      writeDiagnosticReport: async report => calls.push(['report', report]),
      document: { readyState: 'complete', getElementById: () => null },
      window: { d3: {}, __PANDOLAB_SHELL_AUTO__: auto }, console: { error() {} },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], expected);
    assert.equal(calls[0][1].stage, 'startup');
    assert.match(calls[0][1].error.message, /dependencies are unavailable/);
    assert.ok(calls[0][1].error.stack);
  }
});
async function source(t) {
  const { root, put, pinData } = await worldFixture(t);
  await put('apps/editor/editor.html', '<html><head><base href="../../" data-product-base="editor" /></head><body>Editor<script src="assets/js/bootstrap.js?v=test" defer></script></body></html>');
  await put('assets/js/app.js', 'export const realApplication = true;');
  return { root, put, pinData };
}

test('stages the real frontend and exact WASM pair without analysis resources or world data', async t => {
  const { root } = await source(t);
  const result = await stagePrototype({ root, profile: 'test-fixture', verification: true });
  assert.ok(result.files.some(file => file.path === 'assets/js/app.js'));
  assert.ok(result.files.some(file=>file.path==='assets/js/modules/runtime-context.js'));
  assert.ok(result.files.every(file => !file.path.startsWith('assets/data/')||file.path.startsWith('assets/data/physical-land/')));
  assert.ok(result.files.every(file => !file.path.includes('reference-analysis')));
  assert.equal(Object.hasOwn(result,'referenceAnalysis'), false);
  assert.equal(await readFile(join(result.directory, 'assets/js/app.js'), 'utf8'), 'export const realApplication = true;');
  const html = await readFile(join(result.directory, 'index.html'), 'utf8');
  assert.match(html, /shell\/startup\.js/);
  assert.match(html, /<base href="\.\/" data-product-base="editor" \/>/);
  assert.match(html, /Editor/);
  assert.doesNotMatch(html, /Viewer only/);
  assert.doesNotMatch(html, /src="assets\/js\/bootstrap\.js/);
  assert.equal(result.profile, 'test-fixture');
  assert.equal(result.fixture.entityCount, 3);
  assert.ok(result.fixture.coordinateCount <= 100);
});

test('verification assets are opt-in and disappear on the next ordinary stage', async t => {
  const { root } = await source(t);
  const ordinary = await stagePrototype({ root });
  const names = result => result.files.map(file => file.path);
  assert.equal(ordinary.verification, false);
  assert.equal(ordinary.profile, 'map-data');
  assert.equal(ordinary.fixture, null);
  assert.ok(!names(ordinary).includes('shell/diagnostics.js'));
  assert.ok(!names(ordinary).includes('shell/full-world-probe.js'));
  assert.doesNotMatch(await readFile(join(ordinary.directory, 'shell/startup.js'), 'utf8'), /import.*(?:diagnostics|full-world-probe|reference-analysis-probe)/);
  const verified = await stagePrototype({ root, profile: 'test-fixture', verification: true });
  assert.ok(names(verified).includes('shell/verification.js'));
  assert.ok(names(verified).includes('shell/probe-storage.js'));
  assert.equal(JSON.parse(await readFile(join(verified.directory, 'shell/stage-profile.json'))).verification, true);
  await stagePrototype({ root });
  await assert.rejects(readFile(join(ordinary.directory, 'shell/verification.js')), /ENOENT/);
  await assert.rejects(readFile(join(ordinary.directory, 'shell/fixture-world.json')), /ENOENT/);
  await assert.rejects(stat(join(ordinary.directory, 'shell/transport')), /ENOENT/);
  assert.ok(names(ordinary).every(path=>!path.includes('reference-analysis')));
});

test('the verification fixture loads through the current builtin country transport', async t => {
  const { root } = await source(t);
  const result = await stagePrototype({ root, profile: 'test-fixture', verification: true });
  const profile = JSON.parse(await readFile(join(result.directory, 'shell/stage-profile.json')));
  const loader = createBuiltinWorldLoader({
    manifestUrl: 'https://shell.test/shell/fixture-world.json', manifestSpec: profile.builtinWorld,
    dataRevision: 'test-fixture', cacheStorage: null,
    fetchFn: async url => new Response(await readFile(join(result.directory, new URL(url).pathname))),
  });
  const { project } = await loader.loadProject('2026-10');
  assert.equal(project.territorialEntities.length, 3);
  assert.equal(project.timelineRecords.parentRelations.find(row => row.objectRef.id === 'shell-child-a').parentId, 'shell-country-a');
});

test('test-fixture staging retains required historical physical backgrounds without world objects',async t=>{
  const {root,put,pinData}=await source(t);
  const physicalLand={url:'assets/data/physical-land/v1/modern.gz'};
  const context={land:{url:'assets/data/physical-land/v1/historical-land.gz'},water:{url:'assets/data/physical-land/v1/historical-water.gz'}};
  await put('assets/js/build-meta.js','globalThis.PANDOLAB_BUILD_META=Object.freeze('+JSON.stringify({physicalLand,physicalWaterObjects:{geometries:[{land:context.land,asset:context.water}]}})+');');
  await put('assets/data/physical-land/v1/manifest.json',JSON.stringify({sourceSha256:'fixture-land',asset:physicalLand,waterObjects:{geometries:[{land:context.land,asset:context.water}]}}));
  for(const asset of [physicalLand,context.land,context.water])await put(asset.url,'physical');
  await pinData();
  const result=await stagePrototype({root,profile:'test-fixture',verification:true});
  for(const asset of [physicalLand,context.land,context.water])assert.ok(result.files.some(file=>file.path===asset.url));
  assert.equal(result.files.some(file=>file.path==='assets/data/world/huge.bin'),false);
});



test('rejects a modified WASM asset instead of blessing a new hash', async t => {
  const { root, put } = await source(t);
  await stagePrototype({ root });
  const previous = await readFile(join(editorStageRoot(root),'dist/index.html'));
  await put('assets/wasm/pandoeditor-core.wasm', 'tampered');
  await assert.rejects(stagePrototype({ root }), /WASM.*hash|hash.*WASM/i);
  assert.deepEqual(await readFile(join(editorStageRoot(root),'dist/index.html')), previous);
});

test('development assets reuse the validated stage plan without writing dist', async t => {
  const { root, put } = await source(t);
  const plan = await createDevelopmentAssets({ root });
  assert.equal(plan.assets.get('assets/js/app.js').file,undefined);
  assert.equal(plan.assets.get('assets/js/app.js').bytes.toString(),'export const realApplication = true;');
  assert.match(plan.assets.get('index.html').bytes.toString(), /shell\/startup.js/);
  await assert.rejects(readFile(join(editorStageRoot(root),'dist/index.html')), /ENOENT/);
  await put('assets/js/app.js', 'export const updated = true;');
  assert.equal(plan.assets.get('assets/js/app.js').bytes.toString('utf8'), 'export const realApplication = true;');
});

test('development reload publishes validated changes and preserves the native output', async t => {
  const { root, put } = await source(t);
  await put('apps/editor/src-tauri/target/native.exe', 'unchanged native');
  const server = await startDevelopmentServer({ repository: root, port: 0, observe: false, prepareLibrary:()=>({revision:'fixture'}) });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.server.address().port}`;
  assert.match(await fetch(base).then(response => response.text()), /reload.js/);
  const reload = await fetch(base + '/__frontend/reload.js').then(response => response.text());
  let nextCheck, reloads = 0;
  // The Android asset proxy supports completed responses, not streaming SSE.
  await new Promise(resolve => runInNewContext(reload, {
    fetch: path => fetch(base + path),
    location: { reload: () => reloads++ },
    setTimeout: check => { nextCheck = check; resolve(); },
  }));
  assert.equal(reloads, 0);
  await put('assets/js/app.js', 'export const updated = true;');
  await server.refresh();
  await nextCheck();
  assert.equal(reloads, 1, 'a completed health response reloads without an EventSource');
  assert.match(await fetch(base + '/assets/js/app.js').then(response => response.text()), /updated = true/);
  assert.equal((await fetch(base + '/__shell/health').then(response => response.json())).revision, 1);
  assert.equal(await readFile(join(root, 'apps/editor/src-tauri/target/native.exe'), 'utf8'), 'unchanged native');
  assert.equal((await fetch(base + '/config/library-data.json')).status, 404);
  const wasm = Buffer.from(await fetch(base + '/assets/wasm/pandoeditor-core.wasm').then(response => response.arrayBuffer()));
  await put('assets/wasm/pandoeditor-core.wasm', 'invalid replacement');
  await server.refresh();
  assert.deepEqual(Buffer.from(await fetch(base + '/assets/wasm/pandoeditor-core.wasm').then(response => response.arrayBuffer())), wasm);
});



test('requires the explicit editor base and never falls back to the viewer HTML', async t => {
  const { root, put } = await source(t);
  await put('apps/editor/editor.html', '<html><base href="../../" /><script src="assets/js/bootstrap.js" defer></script></html>');
  await assert.rejects(stagePrototype({ root }), /explicit product base/);
});

test('will not clear an output directory it does not own', async t => {
  const { root } = await source(t);
  await import('node:fs/promises').then(async fs=>{await fs.mkdir(join(editorStageRoot(root),'dist'),{recursive:true});await fs.writeFile(join(editorStageRoot(root),'dist/keep.txt'),'unrelated');});
  await assert.rejects(stagePrototype({ root }), /owned|ownership/i);
  assert.equal(await readFile(join(editorStageRoot(root),'dist/keep.txt'), 'utf8'), 'unrelated');
});

test('request instrumentation preserves a classic Worker strict directive', async t => {
  const { root, put } = await source(t);
  await put('assets/js/workers/strict-worker.js', "'use strict';\naccidentalLeak = true;\n");
  const result = await stagePrototype({ root });
  const worker = await readFile(join(result.directory, 'assets/js/workers/strict-worker.js'), 'utf8');
  const context = { location: new URL('http://tauri.localhost/assets/js/workers/strict-worker.js'), URL,
    fetch: async () => new Response('local') };
  assert.throws(() => runInNewContext(worker, context), /accidentalLeak is not defined/);
});
