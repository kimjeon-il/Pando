import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createTerritorialFeature, normalizeTerritorialEntities } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createGisImportTransactionCommitter } from '../../assets/js/modules/gis-import-transaction.js';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../../assets/js/vendor/polygon-clipping.min.js', import.meta.url), 'utf8'), context);
const clipper = context.polygonClipping;
const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 8], [8, 8], [8, 0], [0, 0]]] };

function harness(overrides = {}) {
  const state = { stateRevision: 0, territorialEntities: [createTerritorialFeature({ id: 'A', entityKind: 'general', geometry })] };
  const store = createTerritorialEntityStore({ getState: () => state });
  const repository = createTerritorialEntityRepository({ entityStore: store });
  const calls = [], rootPatches = [];
  const committer = createGisImportTransactionCommitter({ state, entityStore: store, territorialEntityRepository: repository,
    normalizeTerritorialEntities, normalizePolygonGeometry: value => value, deepClone: structuredClone, uid: () => 'generated',
    polygonClipping: clipper, recordHistory: () => calls.push('history'), queueAutosave: () => calls.push('save'),
    markLayerTreeDirty() {}, setActionStatus() {}, markCountryGeometriesChanged: ids => { rootPatches.push(ids); state.stateRevision++; },
    renderingDomain: { invalidateTerritorialPatch() {}, invalidateCountryPatch() {} }, ...overrides,
  });
  return { committer, repository, calls, state, rootPatches };
}

test('current GIS uses one entity import contract for general parents and independent regions', async () => {
  const h = harness();
  assert.equal(typeof h.committer.commitTerritorialImport, 'function');
  await h.committer.commitTerritorialImport({ targetType: 'general', mapping: { parentId: 'A', idField: 'code', nameField: 'title' },
    collection: { features: [{ type: 'Feature', properties: { code: 'child', title: 'Child' }, geometry }] } }, 'objects.geojson');
  assert.equal(h.repository.get('child').properties.parentId, 'A');
  assert.equal(h.repository.get('child').properties.entityKind, 'general');
  await h.committer.commitTerritorialImport({ targetType: 'regional', collection: {
    features: [{ type: 'Feature', id: 'region', properties: { name: 'Cross-border region' }, geometry }],
  } }, 'regions.geojson');
  assert.equal(h.repository.get('region').properties.parentId, '');
  assert.equal(h.repository.get('region').properties.entityKind, 'regional');
  assert.deepEqual(h.repository.get('A').geometry, geometry);
  assert.deepEqual(h.calls, ['history', 'save', 'history', 'save']);
});

test('invalid imported parent aborts the entire current batch before history or storage changes', async () => {
  const h = harness();
  const before = h.repository.list();
  await assert.rejects(() => h.committer.commitTerritorialImport({ targetType: 'general', collection: { features: [
    { type: 'Feature', id: 'ok', properties: { parent_id: 'A' }, geometry },
    { type: 'Feature', id: 'bad', properties: { parent_id: 'missing' }, geometry },
  ] } }, 'objects.geojson'), /부모|상위/);
  assert.strictEqual(h.repository.list(), before);
  assert.deepEqual(h.calls, []);
});

test('a GIS FID of zero preserves its identity and imported child parent reference', async () => {
  const h = harness();
  await h.committer.commitTerritorialImport({ targetType: 'general', mapping: { idField: '__fid__' }, collection: { features: [
    { type: 'Feature', id: 0, properties: { name: 'Zero' }, geometry },
    { type: 'Feature', id: 1, properties: { name: 'Child', parent_id: '0' }, geometry },
  ] } }, 'objects.geojson');
  assert.equal(h.repository.get('0').properties.name, 'Zero');
  assert.equal(h.repository.get('1').properties.parentId, '0');
});

test('new general roots reach the existing GPU and Worker geometry mutation boundary', async () => {
  const h = harness();
  await h.committer.commitTerritorialImport({ targetType: 'general', collection: { features: [{ type: 'Feature', id: 'new-root', properties: {}, geometry }] } }, 'objects.geojson');
  assert.deepEqual(h.rootPatches, [['new-root']]);
  assert.equal(h.state.stateRevision, 1);
});
test('edits during a coast decision cancel the detached import before any publication', async () => {
  let release, entered;
  const wait = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const h = harness({ buildSharedBoundaryTopology: () => ({}), analyzeAdminCountryCoast: () => ({ status: 'ready', conflicts: [{}] }),
    ensureGisRuntime: async () => {}, getCoastReconciliationController: async () => ({ open: async () => { entered(); return wait; } }),
    normalizeCoastDecision: value => value, territorialEntityName: feature => feature.id, countryName: feature => feature.id,
    createCancellationError: message => Object.assign(new Error(message), { cancelled: true }) });
  const before = h.repository.list();
  const pending = h.committer.commitTerritorialImport({ targetType: 'regional', mapping: { coastReferenceId: 'A' }, collection: {
    features: [{ type: 'Feature', id: 'R', properties: {}, geometry }] } }, 'regions.geojson');
  const stored = h.state.territorialEntities;
  await started; h.state.stateRevision++; release('independent');
  await assert.rejects(pending, error => error.cancelled === true);
  assert.strictEqual(h.state.territorialEntities, stored); assert.deepEqual(h.repository.list(), before); assert.deepEqual(h.calls, []);
});
