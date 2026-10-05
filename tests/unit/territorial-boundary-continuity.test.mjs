import { createMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { layerStyle } from '../../assets/js/modules/layer-presentation.js';
import { buildTerritorialInternalBoundarySegments } from '../../assets/js/modules/boundary-topology.js';
import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';

const rectangle = (west, south, east, north) => ({ type: 'Polygon',
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const features = (east = 2) => [
  createTerritorialFeature({ id: 'ROOT', entityKind: 'general', geometry: rectangle(0, 0, 4, 4) }),
  createTerritorialFeature({ id: 'LEFT', entityKind: 'general', parentId: 'ROOT', geometry: rectangle(1, 1, east, 3) }),
  createTerritorialFeature({ id: 'RIGHT', entityKind: 'general', parentId: 'ROOT', geometry: rectangle(2, 1, 3, 3) }),
];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function harness(t) {
  const state = { territorialEntities: features(), layerVisibility: {}, itemVisibility: {},
    layerPresentation: { styles: {}, objectStyles: {} }, countryVisualPhase: 'canonical' };
  initializeTestTerritorialState(state);
  const store = createTerritorialEntityStore({ getState: () => state });
  const repo = createTerritorialEntityRepository({ entityStore: store });
  const requests = [], replacements = [], diagnostics = [], scheduled = [];
  let revision = 1, generation = 0, readyCount = 0;
  const replaceGpuSceneDomain = (domain, data) => {
    if (domain === 'territorial-boundaries') replacements.push(structuredClone(data.strokes));
  };
  const rendering = createRenderingDomain({
    prepareView: ({ frameId }) => createMapVisualFrame({ frameId, projectGeneration: generation,
      viewState: { projection: 'flat', size: { width: 800, height: 600 }, scale: 100, dpr: 1 }, projectPath: () => 'snapshot-path' }),
    requestFrame: callback => { scheduled.push(callback); return scheduled.length; },
    prepareEditDisplay: (payload, options) => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const rows = repo.list();
      const segments = buildTerritorialInternalBoundarySegments(
        rows.filter(row => !row.properties.parentId), rows.filter(row => row.properties.parentId));
      requests.push({ payload, options, resolve, reject, segments });
      return promise;
    },
    onEditDisplayReady: () => { readyCount++; },
    reportDiagnostic: entry => diagnostics.push(entry),
    projectDomain: { getGeneration: () => generation },
    countryResources: { mapTheme: () => ({ border: '#ffffff' }) },
    territorialResources: {
      getState: () => state, displayEntities: repo.list, entityRepository: repo,
      visibleMapObjectCandidates: () => repo.list().map(row => ({ id: row.id })),
      geometryMayIntersectViewport: () => true,
      isLayerItemVisible: (group, id) => state.itemVisibility[id] !== false,
      isNativeBuiltinSubunit: () => false,
      selectionGeometryRevision: key => `${key}:${revision}`,
      replaceGpuSceneDomain,
    },
    territorialBoundaryResources: {
      getState: () => state, getCountryLandRevision: () => 1,
      getTerritorialGeometryRevision: () => revision,
      geometryToken: geometry => JSON.stringify(geometry),
      territorialEntityColor: () => '', layerStyle, mapTheme: () => ({ border: '#ffffff' }),
      replaceGpuSceneDomain, gpuSceneOrder: () => 30,
    },
  });
  t.after(() => rendering.dispose());
  const render = () => { rendering.invalidateTerritorialPatch('M1-topology-frame'); scheduled.shift()(); };
  const resolve = async (index, segments = requests[index].segments) => {
    requests[index].resolve({ result: { segments } }); await flush();
  };
  const change = (rows, nextRevision = revision + 1) => { store.replaceEntities(rows); revision = nextRevision; };
  const reset = () => { generation++; rendering.resetProjectGeneration(generation); };
  return { state, store, rendering, requests, replacements, diagnostics, render, resolve, change, reset,
    last: () => replacements.at(-1), readyCount: () => readyCount };
}

async function present(h) {
  h.render(); await h.resolve(0); h.render();
  assert.ok(h.last().length > 0, 'baseline must contain real topology strokes');
  return structuredClone(h.last());
}

test('old boundary stays published while the next topology is pending and promotes only in a render', async t => {
  const h = harness(t), old = await present(h);
  const oldStats = h.rendering.getTerritorialBoundaryStats();
  h.change(features(1.8)); h.render();
  assert.deepEqual(h.last(), old, 'calculating must not clear the presented scene');
  assert.equal(h.rendering.getTerritorialBoundaryStats().inputSignature, oldStats.inputSignature);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'preparing');
  assert.ok(h.rendering.getTerritorialBoundaryStats().pendingInputSignature);
  await h.resolve(1);
  assert.deepEqual(h.last(), old, 'a Worker response must not publish a scene itself');
  assert.equal(h.rendering.getTerritorialBoundaryStats().inputSignature, oldStats.inputSignature);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'ready');
  h.render();
  assert.notDeepEqual(h.last(), old);
  assert.ok(h.last().length > 0);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'idle');
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingInputSignature, '');
  assert.equal(h.readyCount(), 2);
  assert.ok(h.replacements.slice(2).every(strokes => strokes.length > 0));
});

test('responses in reverse order cannot replace the latest boundary candidate', async t => {
  const h = harness(t); await present(h);
  h.change(features(1.8)); h.render();
  h.change(features(1.6)); h.render();
  await h.resolve(2); h.render();
  const latest = structuredClone(h.last()), signature = h.rendering.getTerritorialBoundaryStats().inputSignature;
  await h.resolve(1); h.render();
  assert.deepEqual(h.last(), latest);
  assert.equal(h.rendering.getTerritorialBoundaryStats().inputSignature, signature);
  assert.equal(h.requests.length, 3);
});

test('A to B to A invalidates pending B even when displayed A needs no rebuild', async t => {
  const h = harness(t), old = await present(h);
  h.change(features(1.8), 2); h.render();
  h.change(features(), 1); h.render();
  await h.resolve(1); h.render();
  assert.deepEqual(h.last(), old);
  assert.equal(h.requests.length, 2, 'returning to presented A must not request topology again');
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'idle');
});

test('repeated B input uses a new request identity rather than accepting an earlier B response', async t => {
  const h = harness(t), old = await present(h);
  h.change(features(1.8), 2); h.render();
  h.change(features(), 1); h.render();
  h.change(features(1.8), 2); h.render();
  assert.equal(h.requests.length, 3);
  await h.resolve(1); h.render();
  assert.deepEqual(h.last(), old);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'preparing');
  await h.resolve(2); h.render();
  assert.notDeepEqual(h.last(), old);
});

test('project reset rejects an old response even when its input signature repeats', async t => {
  const h = harness(t);
  h.render(); h.reset(); h.render();
  await h.resolve(0);
  assert.equal(h.rendering.getTerritorialBoundaryStats().segmentCount, 0);
  assert.equal(h.readyCount(), 0);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'preparing');
  await h.resolve(1); h.render();
  assert.ok(h.last().length > 0);
  assert.equal(h.readyCount(), 1);
});

test('disposed rendering ignores pending topology without scheduling another render', async t => {
  const h = harness(t); h.render(); h.rendering.dispose();
  await h.resolve(0);
  assert.equal(h.readyCount(), 0);
  assert.equal(h.rendering.getTerritorialBoundaryStats().segmentCount, 0);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'idle');
});

test('project reset clears previously presented topology before starting a fresh candidate', async t => {
  const h = harness(t); await present(h);
  h.change(features(1.8)); h.render(); h.reset(); h.render();
  assert.deepEqual(h.last(), [], 'project replacement must not retain old-project boundaries');
  await h.resolve(1); h.render(); assert.deepEqual(h.last(), []);
  await h.resolve(2); h.render(); assert.ok(h.last().length > 0);
});

test('removing all polygon children clears the boundary and invalidates pending topology', async t => {
  const h = harness(t); await present(h);
  h.change(features(1.8)); h.render();
  h.change(features().slice(0, 1)); h.render();
  assert.deepEqual(h.last(), []);
  await h.resolve(1); h.render();
  assert.deepEqual(h.last(), []);
  assert.equal(h.rendering.getTerritorialBoundaryStats().segmentCount, 0);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'idle');
});

test('deleted owners are filtered from retained topology while surviving owners keep their strokes', async t => {
  const h = harness(t); await present(h);
  const retainedSegments = h.requests[0].segments;
  h.change(features().filter(feature => feature.id !== 'RIGHT')); h.render();
  assert.ok(h.last().length > 0);
  const coordinates = h.last().flatMap(packet => packet.geometry.coordinates.flat());
  assert.ok(coordinates.every(point => point[0] <= 2), 'deleted RIGHT-only edges must disappear');
  assert.equal(h.rendering.getTerritorialBoundaryStats().segmentCount, retainedSegments.length);
});

for (const setting of ['layer', 'item', 'boundary', 'opacity']) {
  test(`${setting} hiding filters the retained boundary during calculation without replacing topology`, async t => {
    const h = harness(t); await present(h);
    h.change(features(1.8)); h.render();
    if (setting === 'layer') h.state.layerVisibility.subunits = false;
    if (setting === 'item') h.state.itemVisibility = { LEFT: false, RIGHT: false };
    if (setting === 'boundary') h.state.layerPresentation.styles.subunits = { boundaryVisible: false };
    if (setting === 'opacity') h.state.layerPresentation.styles.subunits = { opacity: 0 };
    h.render(); assert.deepEqual(h.last(), []);
    assert.equal(h.requests.length, 2);
    h.state.layerVisibility = {}; h.state.itemVisibility = {}; h.state.layerPresentation.styles = {};
    h.render(); assert.ok(h.last().length > 0);
    assert.equal(h.requests.length, 2);
  });
}

test('a valid empty Worker result clears the old scene only when promoted', async t => {
  const h = harness(t), old = await present(h);
  h.change(features(1.8)); h.render(); await h.resolve(1, []);
  assert.deepEqual(h.last(), old);
  h.render(); assert.deepEqual(h.last(), []);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'idle');
  h.render(); assert.equal(h.requests.length, 2);
});

test('topology failure retains the last boundary, reports technical cause, and does not retry each frame', async t => {
  const h = harness(t), old = await present(h);
  h.change(features(1.8)); h.render();
  const error = new Error('Topology operation failed');
  h.requests[1].reject(error); await flush();
  for (let index = 0; index < 4; index++) h.render();
  assert.deepEqual(h.last(), old);
  assert.equal(h.requests.length, 2);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'failed');
  assert.equal(h.diagnostics.length, 1);
  assert.equal(h.diagnostics[0].operation, 'territorial-boundary-prepare');
  assert.equal(h.diagnostics[0].technicalMessage, error.message);
  assert.equal(h.diagnostics[0].stack, error.stack);
  h.change(features(1.6)); h.render();
  assert.equal(h.requests.length, 3);
  await h.resolve(2); h.render(); assert.notDeepEqual(h.last(), old);
});

test('superseded cancellation is expected and cannot alter the newer pending request', async t => {
  const h = harness(t), old = await present(h);
  h.change(features(1.8)); h.render(); h.change(features(1.6)); h.render();
  h.requests[1].reject(Object.assign(new Error('superseded'), { name: 'AbortError' })); await flush();
  assert.equal(h.diagnostics.length, 0);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'preparing');
  h.render(); assert.deepEqual(h.last(), old);
  await h.resolve(2); h.render(); assert.notDeepEqual(h.last(), old);
});

test('current cancellation retains the boundary and permits a later externally requested render to retry', async t => {
  const h = harness(t), old = await present(h);
  h.change(features(1.8)); h.render();
  h.requests[1].reject(Object.assign(new Error('sources rebased'), { cancelled: true })); await flush();
  assert.deepEqual(h.last(), old);
  assert.equal(h.readyCount(), 1, 'cancellation must not schedule an automatic retry');
  assert.equal(h.diagnostics.length, 0);
  h.render(); assert.equal(h.requests.length, 3);
  await h.resolve(2); h.render(); assert.notDeepEqual(h.last(), old);
});

test('invalid Worker result retains the boundary and reports the broken required contract', async t => {
  const h = harness(t), old = await present(h);
  h.change(features(1.8)); h.render();
  h.requests[1].resolve({ result: { segments: null } }); await flush();
  h.render(); assert.deepEqual(h.last(), old);
  assert.equal(h.rendering.getTerritorialBoundaryStats().pendingStatus, 'failed');
  assert.match(h.diagnostics[0].technicalMessage, /requires segments/);
  assert.equal(h.requests.length, 2);
});

test('boundary style changes reuse topology and rendering does not mutate project content', async t => {
  const h = harness(t); await present(h);
  const before = { identities: h.store.identities(), records: structuredClone(h.state.timelineRecords),
    archive: h.state.geometries.snapshot() };
  h.state.layerPresentation.styles.subunits = { opacity: 0.5 }; h.render();
  assert.equal(h.requests.length, 1);
  assert.ok(h.last().every(packet => packet.style.alpha === 0.5));
  assert.deepEqual(h.store.identities(), before.identities);
  assert.deepEqual(h.state.timelineRecords, before.records);
  assert.deepEqual(h.state.geometries.snapshot(), before.archive);
});
