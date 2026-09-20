import assert from 'node:assert/strict';
import test from 'node:test';

import { createGlobalInputBindings } from '../../assets/js/modules/app-global-input-bindings.js';

test('global input initializes the image bridge through current domain ports', t => {
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
    platform: { $: () => null },
    platformConfigurationB: { systemThemeQuery: { addEventListener() {} } },
  });
  bindings.bindGlobalInputUI();
  const bridge = globalThis.__PANDOLAB_REFERENCE_IMAGE_EDITING__;
  const coordinates = [[126.9, 37.5], [127.1, 37.6]];

  assert.equal(bridge.isDraftActive(), false);
  assert.equal(bridge.applyDraftCoordinates(coordinates), false);
  assert.equal(calls.length, 0);

  active = true;
  assert.equal(bridge.isDraftActive(), true);
  assert.equal(bridge.applyDraftCoordinates(coordinates), true);
  assert.equal(bridge.applyDraftCoordinates(coordinates, { source: 'reference-image-live-wire' }), true);
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
