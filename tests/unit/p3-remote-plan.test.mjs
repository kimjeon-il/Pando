import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { classifyP3, scheduleP3, previewSlug } from '../../scripts/p3-plan-remote.mjs';
import { stagePreview } from '../../scripts/p3-stage-preview.mjs';
import { createRuntimePerformanceMetrics } from '../../assets/js/modules/runtime-performance-metrics.js';

const full={native:true,web:true},webOnly={native:false,web:true};
test('Web-only changes select preview and browser, not Qt compiler',()=>{
  assert.deepEqual(['preview','browser','qt'].map(k=>classifyP3(['assets/css/ui.css'],full)[k]),
    [true,true,false]);
  assert.equal(classifyP3(['assets/data/places/index.json'],webOnly).qt,false);
});
test('native source changes select only platform build when Web is unchanged',()=>{
  const p=classifyP3(['native/app/editorcontroller.cpp'],full);
  assert.equal(p.qt,true);assert.equal(p.preview,false);assert.equal(p.browser,false);
  const noCxx=classifyP3(['native/app/editorcontroller.cpp'],webOnly);
  assert.equal(noCxx.qt,false);
});
test('shared C++ changes select Web safety and Qt when native is present',()=>{
  const p=classifyP3(['shared/core/src/project.cpp'],full);
  assert.equal(p.qt,true);assert.equal(p.browser,true);assert.equal(p.preview,true);
});
test('infrastructure first install schedules all available checks, reports-only skips all',()=>{
  const p=classifyP3(['.github/workflows/remote-preview-p3.yml'],full);
  assert.equal(p.qt,true);assert.equal(p.browser,true);
  assert.equal(classifyP3(['reports/development/testing/a.md'],full).qt,false);
  assert.equal(classifyP3(['reports/development/testing/a.md'],full).preview,false);
});
test('manual modes and branch slugs reject unexpected strings',()=>{
  assert.equal(classifyP3([],full,'all').qt,true);
  const acceptance=classifyP3([],full,'acceptance');
  for(const key of ['preview','browser','qt','contracts'])assert.equal(acceptance[key],true,key);
  assert.equal(classifyP3([],full,'qt').preview,false);
  assert.equal(classifyP3([],full,'off').qt,false);
  assert.equal(classifyP3([],webOnly,'qt').qt,false);
  assert.throws(()=>classifyP3([],full,'other'),/P3_INVALID_SCOPE/);
  assert.equal(previewSlug('work/objects'),'work-objects');
  assert.equal(previewSlug('work/places'),'work-places');
  assert.equal(previewSlug('work/integration-objects-20261017'),'work-integration-objects-20261017');
  assert.throws(()=>previewSlug('../../main'),/P3_UNSUPPORTED_PREVIEW_BRANCH/);
});
function fixture(t) {
  const base=mkdtempSync(join(tmpdir(),'pando-p3-stage-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const root=join(base,'repo'),output=join(base,'preview');
  mkdirSync(root,{recursive:true});
  const put=(name,bytes)=>{
    const file=join(root,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);
  };
  put('index.html','<html><head><title>Test</title></head><body>Map</body></html>');
  put('.nojekyll','');
  put('assets/data/world/current.json','{}');
  put('assets/js/workers/core-session-worker.js','/* fixture */');
  put('assets/wasm/pandoeditor-core.js','// fixture');
  put('assets/wasm/pandoeditor-core.wasm',Buffer.from([0,97,115,109,1,0,0,0]));
  put('assets/wasm/pandoeditor-core.manifest.json','{}');
  put('native/secret.txt','excluded');
  execFileSync('git',['init','-q'],{cwd:root});
  execFileSync('git',['add','.'],{cwd:root});
  execFileSync('git',['-c','user.email=ci@example.invalid','-c','user.name=CI',
    'commit','-qm','fixture'],{cwd:root});
  return {root,output,put};
}
test('static preview copies tracked HTML/assets but no native code',t=>{
  const x=fixture(t);
  const m=stagePreview({...x,branch:'work/objects'});
  assert.equal(m.branch,'work/objects');assert.equal(m.mode,'downloadable-static-snapshot');
  assert.equal(m.publicUrl,null);assert.equal(m.files,7);
  assert.equal(readFileSync(join(x.output,'index.html'),'utf8').includes('Map'),true);
  assert.deepEqual(readFileSync(join(x.output,'assets/wasm/pandoeditor-core.wasm')),
    Buffer.from([0,97,115,109,1,0,0,0]));
  assert.throws(()=>readFileSync(join(x.output,'native/secret.txt')),/ENOENT/);
});
test('preview refuses an untracked or missing required WASM pair',t=>{
  const x=fixture(t);rmSync(join(x.root,'assets/wasm/pandoeditor-core.wasm'));
  assert.throws(()=>stagePreview({...x,branch:'work/objects'}),/ENOENT|P3_PREVIEW/);
});
test('preview never writes over the repository checkout',t=>{
  const x=fixture(t);
  assert.throws(()=>stagePreview({root:x.root,output:join(x.root,'public'),
    branch:'work/objects'}),/P3_PREVIEW_OUTPUT_INSIDE_SOURCE/);
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


test('native documentation changes do not rebuild the app',()=>{
  const result=classifyP3(['native/docs/build.md','shared/README.md'],full);
  for(const key of ['preview','browser','qt'])assert.equal(result[key],false,key);
});

test('source push waits for artifacts; result SHA dispatch verifies once',()=>{
  const affected=classifyP3(['shared/core/src/polygonclipping.cpp'],full);
  const artifactState={statuses:{wasm:{needed:true}},selectedFamilies:['world-mesh'],deferredFamilies:[],blockedFamilies:[]};
  const pending=scheduleP3(affected,{event:'push',artifactState});
  for(const key of ['preview','browser','qt'])assert.equal(pending[key],false,key);
  assert.equal(pending.deferredToArtifacts,true);
  const dispatched=scheduleP3(affected,{event:'workflow_dispatch',artifactState});
  for(const key of ['preview','browser','qt'])assert.equal(dispatched[key],true,key);
  artifactState.statuses.wasm.needed=false;artifactState.selectedFamilies=[];
  assert.equal(scheduleP3(affected,{event:'push',artifactState}).qt,true);
});

test('hydro changes reuse the Qt build and unrelated app changes omit hydro tests',()=>{
  const hydro=classifyP3(['native/app/hydroassetreader.cpp'],full);
  assert.equal(hydro.hydro,true);assert.equal(hydro.qt,true);
  assert.equal(classifyP3(['native/app/referenceimagelibrary.cpp'],full).hydro,false);
  for(const file of ['assets/css/a.css','native/app/editorcontroller.cpp','shared/core/src/geometry.cpp','assets/data/hydro/current/manifest.json','docs/build.md','assets/wasm/pandoeditor-core.wasm']) {
    const result=classifyP3([file],full);
    assert.equal(typeof result.qt,'boolean');
    assert.equal(typeof result.contracts,'boolean');
  }
});
