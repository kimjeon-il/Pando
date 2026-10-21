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
    './reference-image-auto-georef.js': {
      buildReferenceImagePlaceSeeds: () => matches,
      buildReferenceImagePlaceSymbolCandidates: () => ({ candidates: matches, misses: [] }),
      createReferenceImagePointRaster: () => ({ width: 1000, height: 500 }),
      findReferenceImagePointSymbolNearTextBox: () => null,
    },
    './reference-image-store.js': {
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
      referenceImageWorkflow: ({ record }) => record.autoGeorefBusy || record.autoGeorefPreview
        ? { id: 'auto', title: '자동 맞춤', steps: ['분석', '결과 확인'], step: record.autoGeorefBusy ? 0 : 1, instruction: '확인하세요.', actions: [] }
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
    preparePlaces: () => new Promise(resolve => deferred.push(resolve)),
    getPlaces: () => matches,
  });
  await settle();
  api.open();
  state.records = state.getRecords();
  const click = async action => {
    const button = { disabled: false, dataset: { refAction: action } };
    panel.listeners.get('click')({ target: { closest: selector => selector === '[data-ref-action]' ? button : null } });
    await settle();
  };
  return {
    ...state, api, click, deferred,
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
        assert.equal(record.autoGeorefBusy, true);
        assert.equal(harness.deferred.length, 1);
        await cancel(harness);
        assert.equal(record.autoGeorefBusy, false, 'leaving analysis clears its busy state');
        harness.deferred[0]();
        await settle();
        assert.equal(record.autoGeorefBusy, false);
        assert.equal(record.autoGeorefPreview, null, 'cancelled analysis does not restore a result');
        assert.equal(record.controlPoints.length, 0, 'analysis cancellation does not apply calibration');
      } finally {
        for (const resolve of harness.deferred) resolve();
        await settle();
        harness.dispose();
      }
    });
  }
});

test('undo restores visibility without restoring cancelled automatic analysis', async () => {
  const harness = await controllerHarness();
  try {
    await harness.click('auto-georef');
    assert.equal(harness.record.autoGeorefBusy, true);
    harness.setVisible(false);
    assert.equal(harness.record.visible, false);
    await harness.click('cancel-auto-georef');
    await harness.click('undo');
    assert.equal(harness.record.visible, true);
    assert.equal(harness.record.autoGeorefBusy, false);
    assert.equal(harness.record.autoGeorefPreview, null);
    assert.deepEqual(harness.record.controlPoints, []);
  } finally {
    for (const resolve of harness.deferred) resolve();
    await settle();
    harness.dispose();
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
