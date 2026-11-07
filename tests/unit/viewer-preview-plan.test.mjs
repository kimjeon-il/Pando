import {pagesRepositoryFixture} from '../helpers/frontend-pages-fixture.mjs';
import assert from 'node:assert/strict';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {classifyViewerPreview,scheduleViewerPreview,previewSlug} from '../../scripts/viewer-preview-plan.mjs';
import {stagePreview} from '../../scripts/stage-viewer-preview.mjs';
import {createRuntimePerformanceMetrics} from '../../shared/frontend/js/modules/runtime-performance-metrics.js';

const full={web:true};
test('Viewer changes select the preview and source-matched application checks',()=>{
  const changed=classifyViewerPreview(['shared/frontend/css/ui.css'],full);
  for(const id of ['preview','browser','contracts'])assert.equal(changed[id],true,id);
  const native=classifyViewerPreview(['shared/core/src/project.cpp'],full);
  assert.equal(native.preview,true);
  const docs=classifyViewerPreview(['reports/development/testing/a.md'],full);
  assert.equal(docs.preview,false);
  assert.equal(docs.contracts,false);
});
test('manual scopes and branch slug reject unsafe values',()=>{
  const acceptance=classifyViewerPreview([],full,'acceptance');
  assert.equal(acceptance.preview,true);
  assert.equal(acceptance.contracts,true);
  const snapshot=classifyViewerPreview([],full,'preview');
  assert.equal(snapshot.preview,true);
  assert.equal(snapshot.browser,false);
  assert.equal(snapshot.contracts,false);
  for(const bad of ['qt','other'])assert.throws(()=>classifyViewerPreview([],full,bad),/VIEWER_PREVIEW_INVALID_SCOPE/);
  for(const branch of ['work/objects','work/places','work/feature-123','integration/r4-gis-w2-20261103'])
    assert.ok(previewSlug(branch).includes('-'));
  for(const branch of ['main','work/','work/../escape','work/nested/branch','work/.hidden'])
    assert.throws(()=>previewSlug(branch),/VIEWER_PREVIEW_UNSUPPORTED_BRANCH/);
});

async function fixture(t){const f=await pagesRepositoryFixture(t);return {...f,output:f.stage};}

test('static preview emits the committed viewer closure without native code',async t=>{
  const x=await fixture(t);
  const m=await stagePreview({...x,branch:'work/objects'});
  assert.equal(m.branch,'work/objects');assert.equal(m.mode,'downloadable-static-snapshot');
  assert.equal(m.publicUrl,null);assert.equal(m.files,m.included.length);
  assert.equal(readFileSync(join(x.output,'index.html'),'utf8').includes('Viewer'),true);
  assert.deepEqual(readFileSync(join(x.output,'assets/wasm/pandoeditor-core.wasm')),
    Buffer.from([0,97,115,109,1,0,0,0]));
  assert.throws(()=>readFileSync(join(x.output,'native/secret.txt')),/ENOENT/);
});
test('preview refuses an untracked or missing required WASM pair',async t=>{
  const x=await fixture(t);rmSync(join(x.root,'shared/frontend/static/wasm/pandoeditor-core.wasm'));
  await assert.rejects(stagePreview({...x,branch:'work/objects'}),/ENOENT|protected|source file/);
});
test('preview never writes over the repository checkout',async t=>{
  const x=await fixture(t);
  await assert.rejects(stagePreview({root:x.root,output:join(x.root,'public'),
    branch:'work/objects'}),/outside the source repository/);
});

test('Viewer startup telemetry preserves late interactive, editable and ready milestones', () => {
  const markers = Object.fromEntries(Array.from({ length: 45 }, (_, i) => ['detail'+i, i]));
  const globalObject = { __PANDOLAB_STARTUP_METRICS__: {
    ...markers, interactiveMs: 1750.125, editableMs: 3800,
    readyMs: null, rendererStatus: 'enhanced', geometryError: '',
  } };
  const metrics = createRuntimePerformanceMetrics({
    globalObject, performanceObject: { now: () => 0, getEntriesByType: () => [] },
    PerformanceObserverCtor: null,
  });
  const start = metrics.snapshot().startup;
  assert.equal(start.detail0, 0);
  assert.equal(start.interactiveMs, 1750.13);
  assert.equal(start.editableMs, 3800);
  assert.equal(start.readyMs, null, 'pending readiness remains null, not a fabricated zero');
  assert.equal(start.rendererStatus, 'enhanced');
  assert.equal(Object.hasOwn(start, 'detail44'), false, 'unknown diagnostics stay bounded');
  globalObject.__PANDOLAB_STARTUP_METRICS__.readyMs = 4811.5;
  assert.equal(metrics.snapshot().startup.readyMs, 4811.5);
  metrics.dispose();
});


test('only changed source reaches automatic preview; a pending artifact defers the run',()=>{
  const affected=classifyViewerPreview(['shared/core/src/polygonclipping.cpp'],full);
  const pending={statuses:{wasm:{needed:true}},selectedFamilies:['world-mesh'],blockedFamilies:[]};
  const deferred=scheduleViewerPreview(affected,{event:'push',scope:'auto',artifactState:pending});
  for(const id of ['preview','browser','contracts'])assert.equal(deferred[id],false);
  assert.equal(deferred.deferredToArtifacts,true);
  const published=scheduleViewerPreview(affected,{event:'workflow_dispatch',scope:'auto',artifactState:pending});
  assert.equal(published.preview,true);
  assert.equal(published.browser,true);
});
test('verified artifact handoff and current Viewer acceptance are source-pinned',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/viewer-preview.yml',import.meta.url),'utf8');
  const producer=readFileSync(new URL('../../.github/workflows/generated-artifacts-p2.yml',import.meta.url),'utf8');
  assert.match(producer,/gh workflow run viewer-preview\.yml/);
  assert.match(workflow,/application-contracts:/);
  assert.match(workflow,/uses: \.\/\.github\/workflows\/application-architecture\.yml/);
  assert.match(workflow,/head_sha: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/);
  assert.match(workflow,/scripts\/stage-viewer-preview\.mjs/);
  assert.match(workflow,/git merge-base --is-ancestor/);
  assert.match(workflow,/calculation-performance:/);
});
