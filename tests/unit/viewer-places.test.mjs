import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createPlaceWorkerStore } from '../../assets/js/modules/place-worker-store.js';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { createCoreDocumentReadModel } from '../../assets/js/modules/core-document-read-model.js';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';
import { placeView } from '../helpers/place-view.mjs';

const moduleUrl = new URL('../../assets/js/modules/viewer-places.js', import.meta.url);
const assets = new URL('../../assets/data/places/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', assets), 'utf8'));
const bytes = new Uint8Array(readFileSync(new URL('places-v1.bin', assets)));

async function fixture(t, options = {}) {
  assert.ok(existsSync(moduleUrl), 'Viewer places need the existing place runtime adapter');
  const { project } = await createViewerProjectPackage();
  const documentModel = createCoreDocumentReadModel(project);
  const commandOwner = createNodeCoreDocument({ productMode: 'viewer',
    onTransition: (result, operation) => documentModel.acceptTransition(result, operation) });
  await commandOwner.load(JSON.stringify(project));
  let current = { documentModel, commandOwner };
  const store = createPlaceWorkerStore({ manifest, fetchBytes: async () => bytes });
  const requests = [], errors = [], changes = [];
  const { createViewerPlaces } = await import(moduleUrl.href);
  const places = createViewerPlaces({ assetRevision: 'test-revision', getSession: () => current,
    onChange: () => changes.push(true), onError: error => errors.push(error),
    createWorker: () => {
      const worker = { terminate() {}, postMessage(message) {
        if (message.type !== 'request') return;
        requests.push(message);
        Promise.resolve().then(async () => {
          await options.beforeRequest?.(message);
          const result = message.operation === 'place.search'
            ? await store.search(message.payload.query) : await store.queryViewport(message.payload.view);
          worker.onmessage?.({ data: { ...message, type: 'result', ok: true, result } });
        }).catch(error => worker.onmessage?.({ data: { ...message, type: 'result', ok: false,
          error: { message: error.message, code: 'PL-PLACE-TEST' } } }));
      } };
      return worker;
    } });
  t.after(() => { places.dispose(); commandOwner.dispose(); });
  const view = placeView({ flatCenter: [127, 37], threshold: 10 });
  const frame = { ...view.projectionFrame, ...view.projectionFrame.rows,
    projection: view.projection, viewState: { flatCenter: view.flatCenter, globeRotation: view.rotation } };
  return { places, commandOwner, documentModel, requests, errors, changes, frame,
    clearSession: () => { current = null; } };
}

test('viewer searches published place bytes, admits C++ identity and resolves historical names without edits', async t => {
  const f = await fixture(t);
  const before = f.documentModel.snapshot();
  await f.commandOwner.setTimelineCursor('1930-01');
  const found = await f.places.search('Leningrad');
  const city = found.find(row => row.id === 'builtin:place:geonames:498817');
  assert.ok(city);
  assert.equal(city.geometry.type, 'Point');
  assert.equal(city.properties.name, '레닌그라드');
  await f.commandOwner.selectionApply({ action: 'replace', ref: city.selectionRef, scope: 'labels' });
  assert.deepEqual((await f.commandOwner.selectionSnapshot()).primary, city.selectionRef);
  assert.deepEqual(f.documentModel.snapshot(), before);
  assert.equal(f.commandOwner.state().canUndo, false);
  assert.equal(f.requests[0].operation, 'place.search');
  assert.equal(new URL(f.requests[0].payload.manifestUrl).searchParams.get('v'), 'test-revision');
  assert.deepEqual(f.errors, []);
});

test('viewer viewport uses CSS projection frame and produces shared label rows with saved visibility', async t => {
  const f = await fixture(t);
  assert.equal(await f.places.prepare(f.frame, { zoom: 10, month: '2020-01' }), true);
  const seoul = f.places.records().find(row => row.sourceId === '1835848');
  assert.ok(seoul);
  const state = f.documentModel.snapshot();
  const labels = f.places.labels({ state, month: '2020-01', languages: { ko: true, en: true, native: false } });
  const label = labels.find(row => row.id === seoul.id);
  assert.deepEqual(label.coordinate, seoul.coordinates);
  assert.deepEqual(label.rows.map(row => row.text), ['서울', 'Seoul']);
  assert.ok(label.width > 0 && label.height > 19);
  assert.equal(f.requests[0].payload.view.mapDate, '2020-01-31');
  assert.deepEqual(f.requests[0].payload.view.projectionFrame.cssViewport, [400,400]);
  assert.equal(f.places.labels({ state: { ...state, layerVisibility: { ...state.layerVisibility, labels: false } }, month: '2020-01' }).length, 0);
  assert.ok(!f.places.labels({ state: { ...state, itemVisibility: { ...state.itemVisibility, labels: { [seoul.id]: false } } }, month: '2020-01' }).some(row => row.id === seoul.id));
  assert.ok(!f.places.labels({ state: { ...state, labels: [{ sourcePlaceId: seoul.id }] }, month: '2020-01' }).some(row => row.id === seoul.id));
  assert.equal(f.places.labels({ state, month: '-0100-01' }).length, 0);
  assert.equal(f.changes.length, 1);
});

test('viewer retires a pending place result when its document is replaced', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { beforeRequest: async () => { started(); await gate; } });
  const pending = f.places.prepare(f.frame, { zoom: 10, month: '2020-01' });
  await began; f.clearSession(); release();
  assert.equal(await pending, false);
  assert.deepEqual(f.places.records(), []);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.errors, []);
});

test('viewer reports a failed place viewport and retries without publishing partial records', async t => {
  let fail = true;
  const f = await fixture(t, { beforeRequest: () => { if (fail) throw new Error('place shard unavailable'); } });
  const before = f.documentModel.snapshot();
  assert.equal(await f.places.prepare(f.frame, { zoom: 10, month: '2020-01' }), false);
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0].message, /place shard unavailable/u);
  assert.deepEqual(f.places.records(), []);
  assert.deepEqual(f.changes, []);
  fail = false;
  assert.equal(await f.places.prepare(f.frame, { zoom: 10, month: '2020-01' }), true);
  assert.ok(f.places.records().length > 0);
  assert.deepEqual(f.documentModel.snapshot(), before);
});
