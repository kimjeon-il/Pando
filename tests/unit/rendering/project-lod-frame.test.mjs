import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapVisualFrame } from '../../../src/rendering/map-visual-frame.js';

test('visual frame carries CSS project scale, relative zoom and common LOD identity independent of DPR', () => {
  const viewState = { projection: 'flat', size: { width: 900, height: 650 },
    scale: 750, zoom: 2.5, flatZoom: 2.5, translate: [450,300] };
  const first = createMapVisualFrame({ frameId: 1, viewState: { ...viewState, dpr: 1 } });
  const second = createMapVisualFrame({ frameId: 1, viewState: { ...viewState, dpr: 2 } });
  assert.equal(first.baseScale, 300);
  assert.equal(first.relativeZoom, 2.5);
  assert.equal(first.scalePixelsPerMeter, 750 / 6371008.8);
  assert.equal(first.lodPolicyKey, 'screen');
  assert.ok(first.lodSelectionKey);
  assert.equal(first.lodSelectionKey, second.lodSelectionKey);
  assert.equal(first.viewState.baseScale, first.baseScale);
  assert.equal(first.viewState.relativeZoom, first.relativeZoom);
});
