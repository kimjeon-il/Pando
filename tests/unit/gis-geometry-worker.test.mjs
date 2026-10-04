import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { validateCollection } from '../../assets/js/modules/gis-geometry-validation.js';
import { GIS_GEOMETRY_TIMEOUT_MS, createGisGeometryValidator, createImportService } from '../../assets/js/modules/import-service.js';
import { createGisImportTransactionCommitter } from '../../assets/js/modules/gis-import-transaction.js';
import { normalizeTerritorialEntities } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import { createGisWorkerHarness } from './helpers/gis-worker-harness.mjs';

function feature(id, coordinates) {
  return {
    type: 'Feature',
    id,
    properties: { name: id },
    geometry: { type: 'MultiPolygon', coordinates: [coordinates] },
  };
}

const square = [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]];
const degenerate = [[[0, 0], [0, 0], [0, 0], [0, 0]]];

test('scoped GIS validation trusts unchanged canonical geometry and validates affected countries', async t => {
  const worker = createGisWorkerHarness(t);
  const collection = { type: 'FeatureCollection', features: [feature('affected', square), feature('trusted', degenerate)] };
  assert.equal((await worker.validate(collection, ['affected'])).ok, true);
  assert.equal((await worker.validate(collection)).ok, false);
});

test('scoped GIS overlap checks only compare pairs that contain an affected country', () => {
  const collection = {
    type: 'FeatureCollection',
    features: [feature('affected', square), feature('trusted-a', square), feature('trusted-b', square)],
  };
  let intersectionCalls = 0;
  const clipper = { intersection() { intersectionCalls += 1; return []; } };
  validateCollection(collection, ['affected'], clipper);
  assert.equal(intersectionCalls, 2);
  intersectionCalls = 0;
  validateCollection(collection, null, clipper);
  assert.equal(intersectionCalls, 3);
});

test('an empty scope falls back to full validation instead of silently trusting every country', async t => {
  const worker = createGisWorkerHarness(t);
  const collection = { type: 'FeatureCollection', features: [feature('invalid', degenerate)] };
  assert.equal((await worker.validate(collection, [])).ok, false);
});

test('actual GIS Worker isolates component pairs and retries polygon-clipping sweep failures', async t => {
  const secondSquare = [[[10, 10], [10, 12], [12, 12], [12, 10], [10, 10]]];
  const left = feature('left', square);
  left.geometry.coordinates.push(secondSquare);
  const right = feature('right', square);
  const worker = createGisWorkerHarness(t, { failFirstIntersection: true });
  const result = await worker.validate({ type: 'FeatureCollection', features: [left, right] }, ['left']);
  assert.equal(result.ok, true);
  assert.ok(result.intersectionAttempts >= 2);
});

test('GIS validator sends unique affected IDs and treats an empty scope as full validation', async t => {
  const messages = [];
  const worker = {
    postMessage(message) {
      messages.push(message);
      if (message.action === 'validate') globalThis.queueMicrotask(() => this.onmessage({ data: { id: message.id, ok: true, overlapAreaKm2: 0 } }));
    },
    terminate() {},
  };
  const validator = createGisGeometryValidator({ createWorker: () => worker });
  t.after(() => validator.dispose());
  const collection = { type: 'FeatureCollection', features: [feature('A', square)] };
  assert.equal((await validator.validate(collection, ['A', 'A', '', 0])).overlapAreaKm2, 0);
  assert.deepEqual(messages[0].affectedIds, ['A', '0']);
  assert.deepEqual(messages[0].collection, collection);
  await validator.validate(collection, []);
  assert.equal(messages[1].affectedIds, null);
});

test('GIS validator rejects timed out work, disposes its worker and permits a fresh request', async t => {
  assert.equal(GIS_GEOMETRY_TIMEOUT_MS, 60_000);
  let builds = 0, terminations = 0;
  const validator = createGisGeometryValidator({ timeoutMs: 15, createWorker: () => {
    const responds = ++builds > 1;
    return {
      postMessage(message) {
        if (responds && message.action === 'validate') globalThis.queueMicrotask(() => this.onmessage({ data: { id: message.id, ok: true, overlapAreaKm2: 0 } }));
      },
      terminate() { terminations++; },
    };
  } });
  t.after(() => validator.dispose());
  const collection = { type: 'FeatureCollection', features: [feature('A', square)] };
  await assert.rejects(validator.validate(collection), error => error.category === 'TIMEOUT' && error.operation === 'gis.validate');
  assert.equal(terminations, 1);
  assert.equal(validator.stats().pendingCount, 0);
  assert.equal((await validator.validate(collection)).overlapAreaKm2, 0);
  assert.equal(builds, 2);
});

test('current territorial import validates the complete batch and publishes only changed root IDs', async () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('../../assets/js/vendor/polygon-clipping.min.js', import.meta.url), 'utf8'), context);
  const state = { stateRevision: 0, territorialEntities: [] };
  initializeTestTerritorialState(state);
  const store = createTerritorialEntityStore({ getState: () => state });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  const events = [], patches = [];
  const committer = createGisImportTransactionCommitter({ state, entityStore: store, territorialEntityRepository: repository,
    normalizeTerritorialEntities, normalizePolygonGeometry: value => value, uid: () => 'source', polygonClipping: context.polygonClipping,
    recordHistory: () => events.push('history'), queueAutosave: () => events.push('save'), markLayerTreeDirty() {}, setActionStatus() {},
    markCountryGeometriesChanged: ids => { patches.push(ids); state.stateRevision++; },
    renderingDomain: { invalidateCountryPatch() {}, invalidateTerritorialPatch() {} },
  });
  let result = { targetType: 'general', collection: { type: 'FeatureCollection', features: [
    feature('A', square), { ...feature('child', square), properties: { parent_id: 'A' } },
  ] } };
  const service = createImportService({ openImportWizard: async () => result, getWizardOptions: () => ({}),
    getProjectGeneration: () => 7, validateStructuredGeometry: () => assert.fail('territorial validation belongs to the transaction') });
  const planned = await service.openFiles([{ name: 'entities.geojson' }]);
  assert.equal(planned.status, 'planned');
  assert.equal(planned.plan.kind, 'territorial');
  assert.equal(planned.plan.projectGeneration, 7);
  assert.deepEqual(await committer.commitTerritorialImport(planned.plan.payload.result, 'entities.geojson'), ['A', 'child']);
  assert.equal(repository.get('child').properties.parentId, 'A');
  assert.deepEqual(repository.get('A').geometry, feature('A', square).geometry);
  assert.deepEqual(patches, [['A']]);
  assert.deepEqual(events, ['history', 'save']);
  const before = store.snapshot();
  result = { targetType: 'general', collection: { features: [feature('new', square), feature('new', square)] } };
  const duplicate = await service.openFiles([{ name: 'duplicates.geojson' }]);
  await assert.rejects(committer.commitTerritorialImport(duplicate.plan.payload.result, 'duplicates.geojson'), /ID가 중복/);
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(patches, [['A']]);
  assert.deepEqual(events, ['history', 'save']);
});
