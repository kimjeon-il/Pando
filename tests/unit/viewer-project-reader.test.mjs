import {repositoryFrontendSnapshot,nodeWorkerScript} from '../helpers/frontend-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TextEncoder, TextDecoder } from 'node:util';
import { File, btoa } from 'node:buffer';
import vm from 'node:vm';
import test from 'node:test';
import { readProjectFile } from "../../shared/frontend/js/modules/project-file-reader.js";
import { createInitialDocument } from "../../shared/frontend/js/modules/initial-document.js";
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

// Execute the production read Worker and sql.js; adapt only browser transport to Node.
const sqlDirectory = new URL('../../shared/frontend/js/vendor/sql/', import.meta.url);
const sqlContext = vm.createContext({ module: { exports: {} }, require: createRequire(import.meta.url), process,
  __dirname: fileURLToPath(sqlDirectory), Buffer, console, TextEncoder, TextDecoder });
vm.runInContext(readFileSync(new URL('sql-wasm.js', sqlDirectory), 'utf8'), sqlContext);
const SQL = await sqlContext.initSqlJs({ wasmBinary: readFileSync(new URL('sql-wasm.wasm', sqlDirectory)) });

const frontendSnapshot=await repositoryFrontendSnapshot();
function installReaderWorker(t) {
  const original = globalThis.Worker,originalURL=globalThis.URL,originalMeta=globalThis.PANDOLAB_BUILD_META;
  globalThis.PANDOLAB_BUILD_META=frontendSnapshot.buildMeta;
  globalThis.URL=class extends originalURL{constructor(value,base){super(value,base);if(this.protocol==='file:'&&this.pathname.endsWith('/shared/frontend/js/workers/project-read-worker.js'))return new originalURL('https://fixture.invalid/assets/js/workers/project-read-worker.js');}};
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
