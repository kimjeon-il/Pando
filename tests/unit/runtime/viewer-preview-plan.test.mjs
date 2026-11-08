import { describe as contractSuite } from 'node:test';
import * as __dep0 from "../../helpers/frontend-pages-fixture.mjs";
import * as __dep1 from "node:assert/strict";
import * as __dep2 from "node:fs";
import * as __dep3 from "node:path";
import * as __dep4 from "node:test";
import * as __dep5 from "../../../scripts/viewer-preview-plan.mjs";
import * as __dep6 from "../../../scripts/stage-viewer-preview.mjs";
import * as __dep7 from "../../../src/runtime/runtime-performance-metrics.js";
import * as __dep8 from "../../helpers/frontend-source.mjs";
import * as __dep9 from "node:module";
import * as __dep10 from "node:url";
import * as __dep11 from "node:util";
import * as __dep12 from "node:buffer";
import * as __dep13 from "node:vm";
import * as __dep14 from "../../../src/data/project-file-reader.js";
import * as __dep15 from "../../../src/document/initial-document.js";
import * as __dep16 from "../../helpers/core-project.mjs";
import * as __dep17 from "../../fixtures/viewer-project-package.mjs";
contractSuite("viewer-preview-plan", () => {
const { pagesRepositoryFixture } = __dep0;
const assert = __dep1.default;
const { readFileSync, rmSync } = __dep2;
const { join } = __dep3;
const test = __dep4.default;
const { classifyViewerPreview, scheduleViewerPreview, previewSlug } = __dep5;
const { stagePreview } = __dep6;
const { createRuntimePerformanceMetrics } = __dep7;

const full={web:true};
test('Viewer changes select the preview and source-matched application checks',()=>{
  const changed=classifyViewerPreview(['src/ui/css/ui.css'],full);
  for(const id of ['preview','browser','contracts'])assert.equal(changed[id],true,id);
  const native=classifyViewerPreview(['src/document/native/src/project.cpp'],full);
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
  const x=await fixture(t);rmSync(join(x.root,'assets/wasm/pandoeditor-core.wasm'));
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
  const affected=classifyViewerPreview(['src/geometry/native/src/polygonclipping.cpp'],full);
  const pending={statuses:{wasm:{needed:true}},selectedFamilies:['world-mesh'],blockedFamilies:[]};
  const deferred=scheduleViewerPreview(affected,{event:'push',scope:'auto',artifactState:pending});
  for(const id of ['preview','browser','contracts'])assert.equal(deferred[id],false);
  assert.equal(deferred.deferredToArtifacts,true);
  const published=scheduleViewerPreview(affected,{event:'workflow_dispatch',scope:'auto',artifactState:pending});
  assert.equal(published.preview,true);
  assert.equal(published.browser,true);
});
});
contractSuite("viewer-project-reader", async () => {
const { repositoryFrontendSnapshot, nodeWorkerScript } = __dep8;
const assert = __dep1.default;
const { readFileSync } = __dep2;
const { createRequire } = __dep9;
const { fileURLToPath } = __dep10;
const { TextEncoder, TextDecoder } = __dep11;
const { File, btoa } = __dep12;
const vm = __dep13.default;
const test = __dep4.default;
const { readProjectFile } = __dep14;
const { createInitialDocument } = __dep15;
const { createNodeCoreProject } = __dep16;
const { createViewerProjectPackage } = __dep17;

// Execute the production read Worker and sql.js; adapt only browser transport to Node.
const sqlDirectory = new URL("../../../assets/js-vendor/sql/", import.meta.url);
const sqlContext = vm.createContext({ module: { exports: {} }, require: createRequire(import.meta.url), process,
  __dirname: fileURLToPath(sqlDirectory), Buffer, console, TextEncoder, TextDecoder });
vm.runInContext(readFileSync(new URL('sql-wasm.js', sqlDirectory), 'utf8'), sqlContext);
const SQL = await sqlContext.initSqlJs({ wasmBinary: readFileSync(new URL('sql-wasm.wasm', sqlDirectory)) });

const frontendSnapshot=await repositoryFrontendSnapshot();
function installReaderWorker(t) {
  const original = globalThis.Worker,originalURL=globalThis.URL,originalMeta=globalThis.PANDOLAB_BUILD_META;
  globalThis.PANDOLAB_BUILD_META=frontendSnapshot.buildMeta;
  globalThis.URL=class extends originalURL{constructor(value,base){super(value,base);if(this.protocol==='file:'&&this.pathname.endsWith('/src/data/workers/project-read-worker.js'))return new originalURL('https://fixture.invalid/assets/js/workers/project-read-worker.js');}};
  const workers = [];
  globalThis.Worker = class {
    constructor(url) {
      workers.push(this);
      this.context = vm.createContext({ URL, console, TextEncoder, TextDecoder, Uint8Array, btoa,
        location: { href: 'https://fixture.invalid/assets/js/workers/project-read-worker.js' }, initSqlJs: async () => SQL, importScripts() {},
        postMessage: data => { if (!this.terminated) this.onmessage({ data }); } });
      this.context.self = this.context;
      assert.ok(url.pathname.endsWith('/project-read-worker.js'));
      vm.runInContext(nodeWorkerScript(frontendSnapshot,'assets/js/workers/project-read-worker.js'), this.context, { filename:'https://fixture.invalid/assets/js/workers/project-read-worker.js',importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
    }
    postMessage(message, transfer) {
      const data = structuredClone(message, { transfer });
      Promise.resolve().then(() => this.context.onmessage({ data })).catch(error => this.onerror(error));
    }
    terminate() { this.terminated = true; }
  };
  t.after(() => { globalThis.URL=originalURL;globalThis.PANDOLAB_BUILD_META=originalMeta;if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original; });
  return workers;
}

async function createNativeSession() {
  const owner=await createNodeCoreProject(createInitialDocument({appVersion:'0.36.0'}),{productMode:'viewer',replaceSnapshot:async()=>true});
  return {...owner,commandOwner:owner.client};
}

test('viewer reader preserves exact current C++ GeoPackage geometries, properties and timeline records', async t => {
  const workers = installReaderWorker(t);
  const file = await createViewerProjectPackage();
  const project = await readProjectFile(new File([file.bytes], 'current.GPKG'));
  assert.deepEqual(project, file.project);
  assert.equal(project.territorialEntities[0].properties.name, '파일 지도 A');
  assert.equal(project.territorialEntities[0].properties.notes, '원본 메타데이터 보존');
  assert.deepEqual(project.geometries, file.project.geometries);
  assert.deepEqual(project.timelineRecords, file.project.timelineRecords);
  assert.ok(project.timelineRecords.geometryBindings.some(binding => binding.validFrom === '1914-07'));
  const session = await createNativeSession();
  t.after(() => session.dispose());
  await session.project.open(async () => project);
  const owner = session;
  for (const [month, version] of [['1914-06', 1], ['1914-07', 2]]) {
    await owner.commandOwner.setTimelineCursor(month);
    const world = owner.documentModel.projectWorld(await owner.commandOwner.resolveWorld(month), owner.commandOwner.state().epoch);
    const entity = world.entities.find(row => row.id === 'A');
    assert.deepEqual(entity.geometryRef, { id: 'shape', version });
    assert.deepEqual(entity.geometry, file.project.geometries.find(row => row.id === 'shape' && row.version === version).geojson);
  }
  assert.ok(workers.every(worker => worker.terminated));
});

test('reader errors and rejected native admission preserve the accepted document', async t => {
  const workers = installReaderWorker(t);
  const file = await createViewerProjectPackage();
  const session = await createNativeSession();
  t.after(() => session.dispose());
  assert.equal(await session.project.open(() => readProjectFile(new File([file.bytes], 'valid.gpkg'))), true);
  const accepted = session;
  const snapshot = accepted.documentModel.snapshot();
  const state = accepted.commandOwner.state();
  await assert.rejects(session.project.open(() => readProjectFile(new File(['not sqlite'], 'broken.gpkg'))));
  await assert.rejects(session.project.open(() => readProjectFile(new File([file.bytes], 'wrong.json'))), /\.gpkg/);
  await assert.rejects(session.project.open(async () => ({ ...file.project, schemaVersion: -1 })));
  assert.equal(session, accepted);
  assert.deepEqual(accepted.documentModel.snapshot(), snapshot);
  assert.deepEqual(accepted.commandOwner.state(), state);
  assert.ok(workers.every(worker => worker.terminated));
});

test('a later valid file wins even when the earlier real GeoPackage read finishes last', async t => {
  installReaderWorker(t);
  const first = await createViewerProjectPackage('늦은 이전 지도');
  const latest = await createViewerProjectPackage('최신 지도');
  const session = await createNativeSession();
  t.after(() => session.dispose());
  let release;
  const delayedFile = { name: 'older.gpkg', arrayBuffer: () => new Promise(resolve => { release = resolve; }) };
  const pending = session.project.open(() => readProjectFile(delayedFile));
  assert.equal(await session.project.open(() => readProjectFile(new File([latest.bytes], 'latest.gpkg'))), true);
  release(first.bytes.buffer.slice(first.bytes.byteOffset, first.bytes.byteOffset + first.bytes.byteLength));
  assert.equal(await pending, false);
  assert.equal(session.documentModel.snapshot().territorialEntities[0].properties.name, '최신 지도');
  assert.equal(session.commandOwner.state().canUndo, false);
});
});
