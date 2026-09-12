import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { createCountryCommits } from '../../assets/js/modules/app-country-commits.js';
import { createCountryModes } from '../../assets/js/modules/app-country-modes.js';
import { createCutGeometry } from '../../assets/js/modules/app-cut-geometry.js';
import { createCountryValidation } from '../../assets/js/modules/app-country-validation.js';
import { createLandRelations } from '../../assets/js/modules/app-land-relations.js';
import { createGeometryPreview } from '../../assets/js/modules/app-geometry-preview.js';
import { createTerritoryComponents } from '../../assets/js/modules/app-territory-components.js';
import { planDrawnTerritoryAnnex } from '../../assets/js/modules/annex-geometry.js';
import { snapLineEndpointsToBoundary } from '../../assets/js/modules/territorial-geometry.js';
import { createEditingRenderPacket } from '../../assets/js/modules/editing-render-packet.js';
import { createRingHitTester } from '../../assets/js/modules/ring-hit-test.js';

const worker = vm.createContext({ URL });
worker.self = worker;
worker.location = { href: 'http://test/assets/js/workers/map-edit-worker.js' };
worker.importScripts = () => {};
for (const path of ['modules/country-geometry.js', 'vendor/polygon-clipping.min.js', 'workers/map-edit-worker.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../../assets/js/${path}`, import.meta.url), 'utf8'), worker);
}
const pc = worker.polygonClipping;
const geometry = worker.PandoLabCountryGeometry;
const executeAnnex = vm.runInContext('executeAnnex', worker);
const box = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] });
const noop = () => {};

function harness(t, method = 'polygon') {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.window = { polygonClipping: pc, matchMedia: () => ({ matches: false }) };
  t.after(() => {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else delete globalThis.window;
  });
  const features = [{ id: 'T', properties: {}, geometry: box(-3, 0, -2, 10) }, { id: 'D', properties: {}, geometry: box(0, 0, 10, 10) }];
  const state = {
    tool: 'annex-territory', annexPhase: method, annexSelectionMethod: method,
    annexTargetCountryId: 'T', annexDonorCountryIds: ['D'], annexCandidates: [],
    annexSelectedCandidateIndex: null, annexSelectedComponentKeys: [], annexUseRiverBoundaries: false,
    annexDrawnSelections: [], annexDrawnGeometry: null, annexRemainingGeometry: null,
    annexSourceGeometry: features[1].geometry, geometryPreview: { session: null }, size: { width: 10000 },
  };
  let draft = { coords: [], issues: [], strokeActive: false };
  const commits = createCountryCommits();
  const modes = createCountryModes();
  const cut = createCutGeometry();
  const validation = createCountryValidation();
  const relations = createLandRelations();
  const preview = createGeometryPreview();
  const components = createTerritoryComponents();
  const requests = [];
  const errors = [];
  const ports = {
    ...geometry, state, snapLineEndpointsToBoundary, createRingHitTester,
    activeProjection: () => p => p.map(n => n * 100), isCoordVisible: () => true,
    CUT_ENDPOINT_SNAP_DISTANCE: { mouse: 0.1, touch: 0.1 },
    clamp: (n, min, max) => Math.min(max, Math.max(min, n)),
    coordKey: preview.coordKey, coordNear: preview.coordNear,
    pointInRing: relations.pointInRing, pointOnSegment: relations.pointOnSegment,
    segmentsProperlyIntersect: validation.segmentsProperlyIntersect, ringHasSelfIntersection: validation.ringHasSelfIntersection,
    interpolateCoordinate: validation.interpolateCoordinate, geometryPolygonSets: preview.geometryPolygonSets,
    geometryMultiCoordinates: components.geometryMultiCoordinates, multiPolygonPlanarArea: components.multiPolygonPlanarArea,
    normalizeClippedLandGeometry: cut.normalizeClippedLandGeometry,
    countryFeatureById: id => features.find(f => f.id === id), countryName: f => f.id,
    selectedCountryUnionGeometry: () => features[1].geometry, requireCountriesUnlocked: () => true,
    activeCutDraftSourceGeometry: cut.activeCutDraftSourceGeometry, assessCutDraft: cut.assessCutDraft,
    buildCutSplitCandidates: cut.buildCutSplitCandidates, planDrawnTerritoryAnnex,
    editingDraftCoordinates: () => draft.coords, editingDraftSnapshot: () => draft,
    isPolygonDraftTool: () => state.annexPhase === 'polygon', isGenericFeatureDraftTool: () => false,
    dispatchTool: (tool, actions) => actions[tool](),
    defaultDraftInstruction: () => '그리세요.', setModeBanner: noop, updateModeButtons: noop,
    resetRiverPartitionState: noop, updateTerritoryComponentSelectionFeedback: noop,
    setActionStatus: (...args) => errors.push(args), reportOperationError: error => { throw error; },
    cancelScheduledAnnexPreview: commits.cancelScheduledAnnexPreview, scheduleAnnexGeometryPreview: commits.scheduleAnnexGeometryPreview,
    discardActiveGeometryPreview: () => { state.geometryPreview.session = null; },
    renderingDomain: { invalidateEditingOverlays: noop, invalidateGpuInteraction: noop, invalidateSelection: noop },
    editingDomain: {
      startDraft: ({ coords }) => { draft = { coords, issues: [], strokeActive: false }; },
      replaceDraftCoordinates: coords => { draft.coords = coords; },
      clearDraft: () => { draft = { coords: [], issues: [], strokeActive: false }; }, refreshTerritoryOperation: noop,
    },
    snapshotEditable: () => structuredClone(features),
    beginWorkerGeometryPreview: options => new Promise(resolve => requests.push({ ...options, resolve })),
  };
  for (const module of [validation, relations, preview, components, cut, commits, modes]) module.connect(ports);
  relations.initializeRingHitTester();
  t.after(() => commits.cancelScheduledAnnexPreview());
  return {
    state, commits, modes, cut, features, requests, errors, components,
    draw: coords => { draft.coords = structuredClone(coords); commits.finishDraft(); },
    area: value => components.multiPolygonPlanarArea(components.geometryMultiCoordinates(value)),
    workerPlan: () => executeAnnex({ targetId: 'T', donorIds: ['D'], transferredGeometry: state.annexDrawnGeometry }, new Map(features.map(f => [f.id, f]))),
  };
}

test('separate and overlapping drawn areas accumulate without moving the project before application', t => {
  const h = harness(t);
  const before = JSON.stringify(h.features);
  h.draw(box(1, 1, 3, 3).coordinates[0].slice(0, -1));
  assert.equal(h.area(h.state.annexDrawnGeometry), 4);
  assert.equal(h.commits.addAnnexDrawnSelection(), true);
  h.draw(box(2, 2, 4, 4).coordinates[0].slice(0, -1));
  assert.equal(h.area(h.state.annexCandidates[0].geometry), 3);
  assert.equal(h.area(h.state.annexDrawnGeometry), 7);
  h.commits.addAnnexDrawnSelection();
  h.draw(box(7, 7, 8, 8).coordinates[0].slice(0, -1));
  assert.equal(h.area(h.state.annexDrawnGeometry), 8);
  const result = h.workerPlan();
  assert.equal(h.area(result.features.find(f => f.id === 'D').geometry), 92);
  assert.equal(h.area(result.features.find(f => f.id === 'T').geometry), 18);
  assert.equal(JSON.stringify(h.features), before);
  assert.equal(h.requests.length, 0);
});

test('two real line cuts select opposite ends from the remaining source and undo restores it', t => {
  const h = harness(t, 'line');
  h.draw([[2, -1], [2, 11]]);
  assert.equal(h.state.annexPhase, 'side');
  assert.equal(h.area(h.state.annexDrawnGeometry), 20);
  h.commits.addAnnexDrawnSelection();
  assert.equal(h.area(h.cut.activeCutDraftSourceGeometry()), 80);
  h.draw([[8, -1], [8, 11]]);
  assert.equal(h.area(h.state.annexDrawnGeometry), 40);
  assert.equal(h.area(h.workerPlan().features.find(f => f.id === 'D').geometry), 60);
  h.commits.undoAnnexDrawnSelection();
  assert.equal(h.area(h.state.annexDrawnGeometry), 20);
  assert.equal(h.state.annexPhase, 'side');
  h.commits.undoAnnexDrawnSelection();
  assert.equal(h.state.annexPhase, 'line');
  assert.equal(h.state.annexDrawnGeometry, null);
  assert.equal(h.area(h.state.annexSourceGeometry), 100);
});

test('going back preserves selections; changing method or donors clears them', t => {
  const h = harness(t);
  h.draw(box(1, 1, 3, 3).coordinates[0].slice(0, -1));
  h.commits.addAnnexDrawnSelection();
  h.draw(box(7, 7, 8, 8).coordinates[0].slice(0, -1));
  const selected = h.state.annexDrawnSelections;
  const source = h.state.annexSourceGeometry;
  h.modes.returnAnnexToPreviousStep();
  assert.equal(h.state.annexPhase, 'method');
  h.modes.beginAnnexSelection();
  assert.equal(h.state.annexDrawnSelections, selected);
  assert.equal(h.state.annexSourceGeometry, source);
  assert.equal(h.area(h.state.annexDrawnGeometry), 5);
  h.modes.returnAnnexToPreviousStep();
  h.modes.selectAnnexSelectionMethod('line');
  assert.equal(h.state.annexDrawnSelections.length, 0);
  assert.equal(h.state.annexDrawnGeometry, null);
  h.modes.returnAnnexToPreviousStep();
  h.modes.toggleAnnexDonor('D');
  assert.deepEqual(h.state.annexDonorCountryIds, []);
});

test('the same candidate index from an older batch cannot revive a stale preview', async t => {
  const h = harness(t);
  h.draw(box(1, 1, 3, 3).coordinates[0].slice(0, -1));
  t.mock.timers.tick(300);
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.annexPreviewPending, true);
  h.commits.addAnnexDrawnSelection();
  h.draw(box(7, 7, 8, 8).coordinates[0].slice(0, -1));
  t.mock.timers.tick(300);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].shouldKeepResult(), false);
  assert.equal(h.requests[1].shouldKeepResult(), true);
  assert.equal(h.area(h.requests[1].payload.transferredGeometry), 5);
  h.requests[0].resolve(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.annexPreviewPending, true);
  h.requests[1].resolve(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.annexPreviewPending, false);
});

test('fully selected land blocks add and existing selections can be reviewed without another drawing', t => {
  const h = harness(t);
  h.draw(box(0, 0, 10, 10).coordinates[0].slice(0, -1));
  assert.equal(h.state.annexRemainingGeometry, null);
  assert.equal(h.commits.addAnnexDrawnSelection(), false);
  h.commits.undoAnnexDrawnSelection();
  h.draw(box(1, 1, 3, 3).coordinates[0].slice(0, -1));
  h.commits.addAnnexDrawnSelection();
  h.draw([]);
  assert.equal(h.state.annexPhase, 'polygon-preview');
  assert.equal(h.area(h.state.annexDrawnGeometry), 4);
});

test('accumulated highlight is frozen and does not become an interactive current candidate', () => {
  const packet = createEditingRenderPacket({ territoryOperation: { kind: 'annex-territory', phase: 'line',
    candidates: [{ index: -1, geometry: box(0, 0, 1, 1), selected: true, interactive: false }],
  } });
  assert.equal(packet.territoryOperation.candidates[0].interactive, false);
  assert.equal(packet.territoryOperation.candidates[0].selected, true);
  assert.equal(Object.isFrozen(packet.territoryOperation.candidates[0].geometry), true);
});
