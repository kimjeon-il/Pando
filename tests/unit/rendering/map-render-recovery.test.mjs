import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapRenderCoordinator, MAP_RENDER_DIRTY } from '../../../src/rendering/map-render-coordinator.js';

// No runtime data, WASM, or DOM is needed to check the presentation boundary.
test('GPU recovery may stage only selection fallback while the map frame remains unpresentable', () => {
  const queued = [], calls = [];
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => queued.push(callback),
    prepareView: ({ frameId }) => ({ frameId }),
    canPresentFrame: () => false,
    renderers: {
      view: () => ({ succeeded: false }),
      canRenderRecoverySelection: () => true,
      selectionRecovery: () => calls.push('fallback'),
      selectionData: () => calls.push('presented-selection'),
      viewPresentation: () => calls.push('presented-map'),
    },
  });
  coordinator.invalidate(MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_FRAME, 'gpu-context-lost');
  queued.shift()();
  assert.deepEqual(calls, ['fallback'], 'SVG outline fallback must not accept a GPU frame');
  coordinator.invalidate(MAP_RENDER_DIRTY.VIEW | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_FRAME, 'camera-moving');
  queued.shift()();
  assert.deepEqual(calls, ['fallback'], 'a deferred camera frame must not reproject selection fallback');
  coordinator.invalidate(MAP_RENDER_DIRTY.PROJECT | MAP_RENDER_DIRTY.SELECTION_DATA, 'new-project');
  queued.shift()();
  assert.deepEqual(calls, ['fallback'], 'new-project presentation stays frozen');
});
