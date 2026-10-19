import assert from 'node:assert/strict';
import test from 'node:test';

import { createGlobalInputBindings } from '../../assets/js/modules/app-global-input-bindings.js';
import { createTaskPresentation } from '../../assets/js/modules/app-task-presentation.js';
import { registerReferenceImageInput, referenceImageNavigationHeld } from '../../assets/js/modules/reference-image-input.js';

test('global input initializes the image bridge through current domain ports', async t => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    delete globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__;
  });
  let active = false;
  const calls = [];
  const editingDomain = {
    draftInputActive: () => active,
    replaceDraftCoordinates(coordinates, options) {
      calls.push({ coordinates, options });
      return true;
    },
  };
  const bindings = createGlobalInputBindings();
  bindings.connect({
    domains: { editingDomain },
    feedback: { reportOperationError() {} },
    platform: { $: () => null },
    platformConfigurationB: { systemThemeQuery: { addEventListener() {} } },
  });
  bindings.bindGlobalInputUI();
  const bridge = globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__;
  const coordinates = [[126.9, 37.5], [127.1, 37.6]];

  assert.equal(bridge.isDraftActive(), false);
  assert.equal(await bridge.applyDraftCoordinates(coordinates), false);
  assert.equal(calls.length, 0);

  active = true;
  assert.equal(bridge.isDraftActive(), true);
  assert.equal(await bridge.applyDraftCoordinates(coordinates), true);
  assert.equal(await bridge.applyDraftCoordinates(coordinates, { source: 'reference-image-live-wire' }), true);
  assert.deepEqual(calls, [{
    coordinates,
    options: {
      record: true,
      inputPhase: 'refine',
      buildPreview: true,
      reason: 'reference-image-line-refined',
    },
  }, {
    coordinates,
    options: {
      record: true,
      inputPhase: 'refine',
      buildPreview: true,
      reason: 'reference-image-live-wire',
    },
  }]);
});

test('an open image surface keeps the shared editing instruction current during temporary map navigation', async t => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const listeners = new Map();
  globalThis.document = {
    activeElement: null,
    querySelectorAll: () => [],
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  globalThis.window = { addEventListener() {} };
  const unregister = registerReferenceImageInput({ active: () => false, surfaceOpen: () => true });
  t.after(() => {
    unregister();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    delete globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__;
  });

  const state = { tool: 'territorial-border', projectReplacing: false, spacePanActive: false, geometryPreview: { session: null } };
  const draft = { coords: [[0, 0], [1, 1]], inputPhase: 'refine' };
  const originalDraft = structuredClone(draft);
  const instruction = { textContent: '' };
  const taskPresentation = createTaskPresentation();
  taskPresentation.connect({
    projectState: { state },
    platform: { $: id => id === 'modeTaskInput' ? instruction : null },
    territorialModel: { entityRepository: { get: () => null } },
    draftPresentation: { editingDraftSnapshot: () => draft },
    domains: { projectDomain: { state: () => ({ timelineCursor: '1914-07' }) } },
  });
  taskPresentation.syncEditingContext();
  const editingInstruction = instruction.textContent;
  assert.equal(editingInstruction, '꼭짓점 드래그: 이동 · Space 누르기: 지도 이동');

  const forcedPan = { gate: false, host: false };
  const bindings = createGlobalInputBindings();
  bindings.connect({
    projectState: { state },
    domains: { editingDomain: { draftInputActive: () => true } },
    feedback: { reportOperationError: error => { throw error; } },
    platform: { $: () => null },
    lifecycleUi: { mapInteractionGate: { setForcedPan: value => { forcedPan.gate = value; } } },
    mapView: { mapHost: { setForcedPan: value => { forcedPan.host = value; } } },
    taskPresentation,
  });
  bindings.bindGlobalInputUI();
  const down = Object.assign(new globalThis.Event('keydown', { cancelable: true }), { key: ' ', code: 'Space' });
  await listeners.get('keydown')(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(state.spacePanActive, true);
  assert.equal(referenceImageNavigationHeld(), true);
  assert.deepEqual(forcedPan, { gate: true, host: true });
  assert.equal(instruction.textContent, '지도 이동 중 · 놓으면 편집 계속');

  listeners.get('keyup')(Object.assign(new globalThis.Event('keyup'), { key: ' ', code: 'Space' }));
  assert.equal(state.spacePanActive, false);
  assert.equal(referenceImageNavigationHeld(), false);
  assert.deepEqual(forcedPan, { gate: false, host: false });
  assert.equal(instruction.textContent, editingInstruction);
  assert.deepEqual(draft, originalDraft);
});

async function freshBridge(t, editingDomain, reportOperationError) {
  const { installReferenceImageEditingBridge } = await import(`../../assets/js/modules/reference-image-editing-bridge.js?case=${encodeURIComponent(t.name)}`);
  t.after(() => { delete globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__; });
  return installReferenceImageEditingBridge(() => editingDomain, reportOperationError);
}

test('image draft bridge waits for the same-session command acknowledgement', async t => {
  let acknowledge;
  const result = new Promise(resolve => { acknowledge = resolve; });
  const bridge = await freshBridge(t, {
    draftInputActive: () => true,
    replaceDraftCoordinates: () => result,
  }, () => assert.fail('a successful command must not report an error'));
  const applied = bridge.applyDraftCoordinates([[0, 0], [1, 1]]);
  assert.equal(typeof applied?.then, 'function');
  let settled = false;
  applied.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  acknowledge(true);
  assert.equal(await applied, true);
});

test('image draft bridge contains rejected commands with their technical cause', async t => {
  const failure = new Error('stale draft revision');
  const errors = [];
  const bridge = await freshBridge(t, {
    draftInputActive: () => true,
    replaceDraftCoordinates: async () => { throw failure; },
  }, (error, context) => errors.push({ error, context }));
  assert.equal(await bridge.applyDraftCoordinates([[0, 0], [1, 1]], { source: 'reference-image-live-wire' }), false);
  assert.deepEqual(errors, [{ error: failure, context: { source: 'reference-image-live-wire' } }]);
});

test('image draft bridge rejects a missing required command dependency visibly', async t => {
  const errors = [];
  const bridge = await freshBridge(t, { draftInputActive: () => true }, error => errors.push(error));
  assert.equal(await bridge.applyDraftCoordinates([[0, 0], [1, 1]]), false);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof TypeError);
});
