import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { setImmediate } from 'node:timers';

import { createReferenceImageInteraction } from '../../assets/js/modules/reference-image-interaction.js';

let harnessId = 0;
const settle = () => new Promise(resolve => setImmediate(resolve));

function element() {
  const children = new Map();
  const listeners = new Map();
  const classes = new Set();
  return {
    dataset: {}, hidden: false, listeners, textContent: '',
    classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      toggle: (value, active) => active ? classes.add(value) : classes.delete(value),
    },
    append() {}, remove() {}, replaceChildren() {}, setAttribute() {},
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name),
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    querySelectorAll: () => [],
  };
}

async function controllerHarness() {
  const savedGlobals = new Map(['document', 'Image', 'requestAnimationFrame', '__PANDOLAB_MAP_HOST__']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const panel = element();
  const map = element();
  const workspace = element();
  map.closest = selector => selector === '.workspace' ? workspace : null;
  const launcher = element();
  const mapQuad = [[0, 10], [20, 10], [20, 0], [0, 0]];
  const deferred = [];
  const state = { records: [], writes: 0, options: null, surfaceOptions: null, input: null };
  const matches = Array.from({ length: 8 }, (_, index) => ({
    id: `symbol-${index}`, image: [index / 10, 0.5], coordinate: [index, 1], confidence: 1,
  }));
  globalThis.document = {
    documentElement: { dataset: {} },
    getElementById: id => id === 'map' ? map : id === 'referenceImageBtn' ? launcher : null,
  };
  globalThis.Image = class {
    naturalWidth = 1000;
    naturalHeight = 500;
    set src(_value) { globalThis.queueMicrotask(() => this.onload()); }
  };
  globalThis.requestAnimationFrame = callback => { globalThis.queueMicrotask(callback); return 1; };
  globalThis.__PANDOLAB_MAP_HOST__ = {
    project: coordinate => [...coordinate], unproject: point => [...point],
  };

  const mocks = {
    './reference-image-georef.js': {
      REFERENCE_IMAGE_WARP_MODES: { AUTO: 'auto', SIMILARITY: 'similarity', AFFINE: 'affine', PROJECTIVE: 'projective', TPS: 'tps' },
      buildReferenceImageAutoGeoref: candidates => ({
        ok: true, inlierCount: candidates.length, inlierIds: candidates.map(candidate => candidate.id),
        rejectedCount: 0, diagnostics: { rmsMeters: 1 },
      }),
      buildReferenceImageCalibrationWarp: () => ({ ok: false, minimumPoints: 2, pointCount: 0 }),
      buildReferenceImageMesh: () => null,
      referenceImageWarpQuad: () => null,
    },
    './reference-image-model.js': {
      normalizeReferenceImageRecord: source => ({
        visible: true, locked: false, opacity: 0.5, blendMode: 'source-over', warpMode: 'auto',
        controlPoints: [], linearConstraints: [], anchor: null, cornerPinEnabled: false, ...source,
      }),
      referenceImageMappingSignature: record => JSON.stringify(record.controlPoints),
      serializeReferenceImageRecord: record => record,
    },
    './reference-image-source.js': {
      decodeReferenceImageSource: async () => ({ image: { naturalWidth: 200, naturalHeight: 100 }, url: '' }),
      referenceImageSourceHash: async () => 'fixture-source',
    },
    './reference-image-renderer.js': {
      createReferenceImageCanvasRenderer: options => {
        state.getRecords = options.getRecords;
        return { requestRender() {}, destroy() {}, hitTestUv: () => [0.25, 0.5] };
      },
    },
    './reference-image-input.js': {
      referenceImageKeyBlocked: () => false,
      referenceImageNavigationHeld: () => false,
      registerReferenceImageInput: options => { state.input = options; return () => {}; },
    },
    './reference-image-analysis-client.js': {
      createReferenceAnalysisClient: () => ({ cancel() {}, dispose() {} }),
    },
    './reference-image-analysis.js': {
      createReferenceImageAnalysisService: () => ({
        analyzeGeoreference: async () => {
          await new Promise(resolve => deferred.push(resolve));
          return { ok: true, matching: { matches }, georef: { inlierIds: matches.map(row => row.id) } };
        },
        analyzeLayout: async () => {
          await new Promise(resolve => deferred.push(resolve));
          return { panels: state.layoutPanels || [{ id: 'panel-main', kind: 'main', sourceRect: { x: 10, y: 5, width: 100, height: 80 } },
            { id: 'panel-inset', kind: 'inset', sourceRect: { x: 120, y: 10, width: 60, height: 50 } }] };
        },
        applyExtractedFeatures: async (_record, _analysis, ids) => {
          state.appliedIds = ids;
          if (state.holdApply) await new Promise(resolve => deferred.push(resolve));
          return ids;
        },
        editBoundaries: async (_record, analysis, command) => {
          state.commands = [...(state.commands || []), command];
          if (state.holdEdit) await new Promise(resolve => deferred.push(resolve));
          return { ...analysis, graph: { ...analysis.graph, edited: true }, edits: [...(analysis.edits || []), command] };
        },
        assertCurrent() {},
      }),
    },
    './reference-image-store.js': {
      markReferenceImageCollectionChanged() {},
      registerReferenceImageCollection: owner => { state.collection = owner; return () => {}; },
      listStoredReferenceImages: async () => ['ref-a', 'ref-b'].map(id => ({
        id, name: id, mapQuad, blob: new Blob(['image'], { type: 'image/png' }),
      })),
      putStoredReferenceImage: async () => { state.writes += 1; },
      replaceStoredReferenceImages: async () => { state.writes += 1; },
    },
    './reference-image-ui.js': {
      createReferenceImagePanel: () => panel,
      referenceImageEditorMarkup: options => { state.options = options; return ''; },
      renderReferenceImageList() {},
      referenceImageWorkflow: ({ record }) => record.analysis?.busy || record.analysis?.georef
        ? { id: 'auto', title: '자동 맞춤', steps: ['분석', '결과 확인'], step: record.analysis?.busy ? 0 : 1, instruction: '확인하세요.', actions: [] }
        : null,
    },
    './reference-image-surface.js': {
      installReferenceImageSurface: options => {
        state.surfaceOptions = options;
        return {
          open() { panel.hidden = false; options.onOpen(); },
          close() { panel.hidden = true; options.onClose(); },
          setEditing() {}, setGestureActive() {}, setWorkflow() {}, resetScroll() {}, destroy() {},
        };
      },
    },
  };
  const key = `__referenceImageWorkflowHarness${++harnessId}`;
  globalThis[key] = mocks;
  const controllerUrl = new URL('../../assets/js/modules/reference-image-controller.js', import.meta.url);
  controllerUrl.searchParams.set('workflowTest', String(harnessId));
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === controllerUrl.href && mocks[specifier]) {
        const source = `const exports = globalThis[${JSON.stringify(key)}][${JSON.stringify(specifier)}];\n`
          + Object.keys(mocks[specifier]).map(name => `export const ${name} = exports.${name};`).join('\n');
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  let module;
  try { module = await import(controllerUrl.href); }
  finally { hooks.deregister(); delete globalThis[key]; }
  const api = module.installReferenceImageController({
    workspaceSurfaces: {}, confirm: async () => false,
    isBlocked: () => state.blocked === true,
    startBoundaryTrace: async (_id, target) => { state.traceTarget = target; state.surfaceOptions.onAuxiliaryEditingStart();return true; },
  });
  await settle();
  api.open();
  state.records = state.getRecords();
  const click = async (action, attributes = {}) => {
    const button = { disabled: false, dataset: { refAction: action, ...attributes } };
    panel.listeners.get('click')({ target: { closest: selector => selector === '[data-ref-action]' ? button : null } });
    await settle();
  };
  return {
    ...state, api, click, deferred,
    appliedIds: () => state.appliedIds,
    commands: () => state.commands || [],
    traceTarget: () => state.traceTarget,
    holdEdit: () => { state.holdEdit = true; },
    holdApply: () => { state.holdApply = true; },
    block: () => { state.blocked = true; },
    layoutPanels: panels => { state.layoutPanels = panels; },
    get record() { return state.options.record; },
    select(id) {
      panel.listeners.get('click')({ target: { closest: selector => selector === '[data-reference-image-id]'
        ? { dataset: { referenceImageId: id } } : null } });
    },
    lock() {
      panel.querySelector('[data-ref-editor]').listeners.get('change')({
        type: 'change', target: { dataset: { refField: 'locked' }, checked: true },
      });
    },
    setVisible(visible) {
      panel.querySelector('[data-ref-editor]').listeners.get('change')({
        type: 'change', target: { dataset: { refField: 'visible' }, checked: visible },
      });
    },
    dispose() {
      api.destroy();
      for (const [name, descriptor] of savedGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test('cancelling or leaving automatic analysis cannot restore a late result', async t => {
  const cancellations = {
    'cancel button': harness => harness.click('cancel-auto-georef'),
    Escape: harness => harness.input.key({ key: 'Escape' }),
    'panel close': harness => harness.api.close(),
    'image selection': harness => harness.select('ref-a'),
    'manual point tool': harness => harness.click('gcp'),
    'auxiliary tool start': harness => harness.surfaceOptions.onAuxiliaryEditingStart(),
    'record lock': harness => harness.lock(),
  };
  for (const [name, cancel] of Object.entries(cancellations)) {
    await t.test(name, async () => {
      const harness = await controllerHarness();
      try {
        await harness.click('auto-georef');
        const record = harness.record;
        assert.equal(record.analysis?.busy, true);
        assert.equal(harness.deferred.length, 1);
        await cancel(harness);
        assert.equal(!!record.analysis?.busy, false, 'leaving analysis clears its busy state');
        harness.deferred[0]();
        await settle();
        assert.equal(!!record.analysis?.busy, false);
        assert.equal(record.analysis, null, 'cancelled analysis does not restore a result');
        assert.equal(record.controlPoints.length, 0, 'analysis cancellation does not apply calibration');
      } finally {
        for (const resolve of harness.deferred) resolve();
        await settle();
        harness.dispose();
      }
    });
  }
});

test('project-owned image adoption remains available while user editing is blocked for replacement', async () => {
  const harness = await controllerHarness();
  try {
    const original = await harness.collection.capture();
    harness.block();
    await harness.collection.replace([]);
    assert.equal(harness.api.list().length, 0);
    await harness.collection.replace(original);
    assert.equal(harness.api.list().length, 2);
  } finally { harness.dispose(); }
});

test('layout review creates a separate shared-source crop and undo restores the original collection', async () => {
  const harness = await controllerHarness();
  try {
    const original = harness.record;
    original.controlPoints = [{ id: 'manual', image: [0.5, 0.5], coordinate: [10, 5] }];
    await harness.click('analyze-layout');
    assert.equal(original.analysis?.stage, 'layout');
    harness.deferred[0](); await settle();
    assert.equal(original.analysis.layout.panels.length, 2);
    await harness.click('use-layout-panel', { panelId: 'panel-inset' });
    const crop = harness.record;
    assert.notEqual(crop.id, original.id);
    assert.equal(crop.blob, original.blob);
    assert.deepEqual(crop.sourceRect, { x: 120, y: 10, width: 60, height: 50 });
    assert.deepEqual(crop.controlPoints, []);
    assert.equal(original.controlPoints.length, 1, 'manual calibration stays on the original');
    assert.equal(harness.api.list().length, 3);
    await harness.click('cancel-auto-georef');
    await harness.click('undo');
    assert.equal(harness.api.list().length, 2);
    assert.equal(harness.api.list().find(row => row.id === original.id).controlPointCount, 1);
  } finally {
    for (const resolve of harness.deferred) resolve();
    await settle(); harness.dispose();
  }
});

test('late layout results do not create crop records after selection changes', async () => {
  const harness = await controllerHarness();
  try {
    const original = harness.record;
    await harness.click('auto-analysis');
    assert.equal(original.analysis.stage, 'layout');
    harness.select('ref-a');
    harness.deferred[0](); await settle();
    assert.equal(original.analysis, null);
    assert.equal(harness.api.list().length, 2);
  } finally { harness.dispose(); }
});

test('automatic analysis continues through one clear main frame without requesting a panel choice', async () => {
  const harness = await controllerHarness();
  try {
    const original = harness.record;
    harness.layoutPanels([{ id: 'main-only', kind: 'main', requiresReview: false, sourceRect: { x: 5, y: 5, width: 190, height: 90 } }]);
    await harness.click('auto-analysis');harness.deferred[0]();await settle();
    assert.notEqual(harness.record.id, original.id);
    assert.equal(original.visible, false);
    assert.equal(harness.record.analysis.stage, 'georef');
    assert.equal(harness.record.analysis.extractAfter, true);
    assert.equal(harness.deferred.length, 2);
  } finally { for (const resolve of harness.deferred) resolve();await settle();harness.dispose(); }
});

test('location choice and selected boundary import keep their review state until dispatch', async () => {
  const harness = await controllerHarness();
  try {
    const choice = { ok: true, georef: { inlierIds: ['chosen'] } };
    harness.record.analysis = { georef: { ok: true, requiresLocationChoice: true, locations: [choice] } };
    // Missing index must not accidentally accept a region.
    await harness.click('choose-location');
    assert.equal(harness.record.analysis.georef.requiresLocationChoice, true);
    await harness.click('choose-location', { location: '0' });
    assert.equal(harness.record.analysis.georef, choice);
    harness.record.analysis = { reviewing: true, boundaries: { graph: {} }, selectedIds: new Set(['line:0']) };
    await harness.click('apply-boundaries');
    assert.deepEqual(harness.appliedIds(), ['line:0']);
    assert.equal(harness.record.analysis.reviewing, false);
  } finally { harness.dispose(); }
});

test('undo restores visibility without restoring cancelled automatic analysis', async () => {
  const harness = await controllerHarness();
  try {
    await harness.click('auto-georef');
    assert.equal(harness.record.analysis?.busy, true);
    harness.setVisible(false);
    assert.equal(harness.record.visible, false);
    await harness.click('cancel-auto-georef');
    await harness.click('undo');
    assert.equal(harness.record.visible, true);
    assert.equal(!!harness.record.analysis?.busy, false);
    assert.equal(harness.record.analysis, null);
    assert.deepEqual(harness.record.controlPoints, []);
  } finally {
    for (const resolve of harness.deferred) resolve();
    await settle();
    harness.dispose();
  }
});

test('boundary review dispatches edits, preserves review during retrace, and owns its undo history', async () => {
  const harness = await controllerHarness();
  try {
    const original = { graph: { width: 100, height: 100, chains: [{ id: 0, points: [[1, 2], [8, 9]] }, { id: 1, points: [[4, 5], [8, 9]] }] } };
    const review = { reviewing: true, boundaries: original, selectedIds: new Set(['line:0']), graphHistory: { past: [], future: [] } };
    harness.record.analysis = review;
    await harness.click('boundary-exclude', { chainId: '0' });
    assert.equal(harness.record.analysis, review);
    assert.deepEqual(harness.commands().at(-1), { type: 'exclude', chainId: 0 });
    assert.equal(review.selectedIds.size, 0);
    await harness.click('boundary-undo');
    assert.equal(review.boundaries, original);
    await harness.click('boundary-redo');
    assert.equal(review.boundaries.graph.edited, true);
    await harness.click('boundary-cut', { chainId: '1' });
    assert.equal(harness.input.active(), true);
    harness.input.begin([3, 4], { button: 0 }).end([3, 4]);
    await settle();
    assert.deepEqual(harness.commands().at(-1), { type: 'cut', chainId: 1, point: [24.75, 49.5] });
    await harness.click('boundary-endpoint', { chainId: '0', end: 'end' });
    await harness.click('boundary-endpoint', { chainId: '1', end: 'start' });
    assert.deepEqual(harness.commands().at(-1), { type: 'join', from: { chainId: 0, end: 'end' }, to: { chainId: 1, end: 'start' } });
    await harness.click('boundary-retrace', { chainId: '0' });
    assert.equal(harness.record.analysis, review, 'auxiliary trace start must keep its owning boundary review');
    assert.equal(review.editingChainId, 0);
    assert.equal(await harness.traceTarget().onApply([[1, 2], [4, 6], [8, 9]]), true);
    assert.equal(harness.commands().at(-1).type, 'replace');
    harness.traceTarget().onClose();
    assert.equal(review.editingChainId, null);
  } finally { harness.dispose(); }
});

test('a late boundary graph edit cannot restore cancelled review', async () => {
  const harness = await controllerHarness();
  try {
    harness.record.analysis = { reviewing: true, boundaries: { graph: { chains: [{ id: 0 }] } }, selectedIds: new Set(), graphHistory: { past: [], future: [] } };
    harness.holdEdit();
    await harness.click('boundary-exclude', { chainId: '0' });
    assert.equal(harness.record.analysis.busy, true);
    await harness.click('cancel-boundaries');
    harness.deferred[0]();
    await settle();
    assert.equal(harness.record.analysis.reviewing, false);
    assert.equal(harness.record.analysis.boundaries.graph.edited, undefined);
  } finally { harness.dispose(); }
});

test('a late generic import acknowledgement cannot cancel a newer analysis workflow', async () => {
  const harness = await controllerHarness();
  try {
    harness.record.analysis = { reviewing: true, boundaries: { graph: {} }, selectedIds: new Set(['line:0']) };
    harness.holdApply();
    await harness.click('apply-boundaries');
    assert.equal(harness.record.analysis.stage, 'apply');
    await harness.click('gcp');
    await harness.click('auto-georef');
    const newer = harness.record.analysis;
    assert.equal(newer.busy, true);
    harness.deferred[0]();
    await settle();
    assert.equal(harness.record.analysis, newer);
    assert.equal(newer.busy, true);
  } finally {
    for (const resolve of harness.deferred) resolve();await settle();harness.dispose();
  }
});

test('selecting a GCP image point renders the map step without committing a partial point', () => {
  const record = { id: 'ref-a', locked: false, controlPoints: [], anchor: null };
  const renderedSteps = [];
  let history = 0;
  let interaction;
  interaction = createReferenceImageInteraction({
    mapElement: element(), records: [record], selected: () => record,
    renderer: { requestRender() {}, hitTestUv: () => [0.25, 0.5] },
    getSurface: () => ({ setEditing() {}, setGestureActive() {} }),
    currentToken: () => 'token', validToken: token => token === 'token',
    history: { push: () => { history += 1; } },
    renderEditor: () => renderedSteps.push(interaction.getState().gcpState?.step),
    setHint() {},
  });
  interaction.armGcp(record);
  const tap = interaction.beginGesture([10, 20], { button: 0, pointerId: 1 });
  tap.end([10, 20]);
  assert.equal(renderedSteps.at(-1), 'map');
  assert.deepEqual(record.controlPoints, []);
  assert.equal(history, 0);
  interaction.cancelGcp();
  assert.equal(interaction.getState().gcpState, null);
  assert.deepEqual(record.controlPoints, []);
});
