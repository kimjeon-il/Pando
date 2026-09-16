import assert from 'node:assert/strict';
import test from 'node:test';

import { installReferenceImageEditingBridge } from '../../assets/js/modules/reference-image-editing-bridge.js';

test('reference image editing bridge only replaces coordinates for an active draft', () => {
  let active = false;
  const calls = [];
  const editingDomain = {
    draftInputActive: () => active,
    replaceDraftCoordinates(coordinates, options) {
      calls.push({ coordinates, options });
      return true;
    },
  };
  const bridge = installReferenceImageEditingBridge(() => editingDomain);
  const coordinates = [[126.9, 37.5], [127.1, 37.6]];

  assert.equal(bridge.isDraftActive(), false);
  assert.equal(bridge.applyDraftCoordinates(coordinates), false);
  assert.equal(calls.length, 0);

  active = true;
  assert.equal(bridge.isDraftActive(), true);
  assert.equal(bridge.applyDraftCoordinates(coordinates), true);
  assert.deepEqual(calls, [{
    coordinates,
    options: {
      record: true,
      inputPhase: 'refine',
      buildPreview: true,
      reason: 'reference-image-line-refined',
    },
  }]);
});
