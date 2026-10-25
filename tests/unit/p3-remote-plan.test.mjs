import {pagesRepositoryFixture} from '../helpers/frontend-pages-fixture.mjs';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { classifyP3, scheduleP3, previewSlug } from '../../scripts/p3-plan-remote.mjs';
import { stagePreview } from '../../scripts/p3-stage-preview.mjs';
import { createRuntimePerformanceMetrics } from "../../shared/frontend/js/modules/runtime-performance-metrics.js";

const full={web:true};
test('Web-only changes select preview and browser, without application compilation',()=>{
  assert.deepEqual(['preview','browser'].map(k=>classifyP3(['shared/frontend/css/ui.css'],full)[k]),
    [true,true]);
});
test('shared C++ changes select Web safety checks',()=>{
  const p=classifyP3(['shared/core/src/project.cpp'],full);
  assert.equal(p.browser,true);assert.equal(p.preview,true);
});
test('infrastructure first install schedules all available checks, reports-only skips all',()=>{
  const p=classifyP3(['.github/workflows/remote-preview-p3.yml'],full);
  assert.equal(p.browser,true);
  assert.equal(classifyP3(['reports/development/testing/a.md'],full).preview,false);
});
test('manual modes and branch slugs reject unexpected strings',()=>{
  const acceptance=classifyP3([],full,'acceptance');
  for(const key of ['preview','browser','contracts'])assert.equal(acceptance[key],true,key);
  assert.throws(()=>classifyP3([],full,'qt'),/P3_INVALID_SCOPE/);
  assert.throws(()=>classifyP3([],full,'other'),/P3_INVALID_SCOPE/);
  assert.equal(previewSlug('work/objects'),'work-objects');
  assert.equal(previewSlug('work/places'),'work-places');
  assert.equal(previewSlug('work/integration-objects-20261017'),'work-integration-objects-20261017');
  assert.equal(previewSlug('work/feature-123'),'work-feature-123');
  for (const invalid of ['../../main','main','work/','work/UPPER','work/../escape','work/nested/branch','work/.hidden'])
    assert.throws(()=>previewSlug(invalid),/P3_UNSUPPORTED_PREVIEW_BRANCH/);
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

test('P3 startup telemetry preserves late interactive, editable and ready milestones', () => {
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


test('app documentation changes do not rebuild the app',()=>{
  const result=classifyP3(['apps/editor/README.md','shared/README.md'],full);
  for(const key of ['preview','browser'])assert.equal(result[key],false,key);
});

test('source push waits for artifacts; result SHA dispatch verifies once',()=>{
  const affected=classifyP3(['shared/core/src/polygonclipping.cpp'],full);
  const artifactState={statuses:{wasm:{needed:true}},selectedFamilies:['world-mesh'],blockedFamilies:[]};
  const pending=scheduleP3(affected,{event:'push',artifactState});
  for(const key of ['preview','browser'])assert.equal(pending[key],false,key);
  assert.equal(pending.deferredToArtifacts,true);
  const dispatched=scheduleP3(affected,{event:'workflow_dispatch',artifactState});
  for(const key of ['preview','browser'])assert.equal(dispatched[key],true,key);
  artifactState.statuses.wasm.needed=false;artifactState.selectedFamilies=[];
});
