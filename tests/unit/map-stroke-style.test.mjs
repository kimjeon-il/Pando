import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../assets/js/modules/map-interaction-style.js';
import { createMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';

const frame = dpr => createMapVisualFrame({ frameId: 1, viewState: { projection: 'flat', size: { width: 1200, height: 700 },
  scale: 1200 / (2 * Math.PI) * 0.75, translate: [600, 350], dpr } });

test('interaction zoom policy uses CSS scale at every DPR', () => {
  assert.ok(policy.interactionStrokeScale(frame(1)) < 0.5);
  assert.equal(policy.interactionStrokeScale(frame(2)), policy.interactionStrokeScale(frame(1)));
});
test('base roles preserve current fixed widths, visibility and one stroke shape policy', () => {
  for (const [role, width, dash] of [['subunit', 2, [0, 0]], ['subunit-internal', 1.1, [3, 2]], ['region', 1.5, [7, 3]], ['generic', 1, [0, 0]]]) {
    const style = policy.resolveMapStrokeStyle({ theme: { border: '#123456' }, color: '#123456',
      layerStyle: { boundaryWidth: 1, opacity: 0.4, boundaryVisible: true } }, role);
    assert.equal(style.width, width); assert.equal(style.alpha, 0.4); assert.deepEqual(style.dash, dash);
    assert.equal(style.color, '#123456'); assert.equal(style.scaleWithView, false); assert.equal(style.casing, null);
    assert.equal(policy.resolveMapStrokeStyle({ theme: { border: '#123456' }, layerStyle: { boundaryVisible: false } }, role).alpha, 0);
  }
});
test('country and hydro roles are immutable CSS styles, converted only at the GPU boundary', () => {
  const theme = { border: '#123456', borderAlpha: 0.8, borderWidth: 2, lakeOpacity: 0.5, lakeBoundaryWidth: 3, lakeBoundaryVisible: true, riverOpacity: 0.7, riverWidth: 4 };
  const country = policy.resolveMapStrokeStyle({ theme }, 'country');
  assert.equal(country.width, 1.44); assert.equal(country.alpha, 0.8);
  const lake = policy.resolveMapStrokeStyle({ theme, color: '#ffffff' }, 'hydro-boundary');
  assert.equal(lake.width, 3); assert.equal(lake.alpha, 0.5);
  const selected = policy.resolveMapStrokeStyle(policy.resolveMapInteractionStyle({ outlineVisible: false }), 'edit-target', { directManipulation: true });
  assert.equal(selected.width, 2.5, 'direct editing remains visible with ordinary selection outlines disabled');
  const css = policy.scaleInteractionStroke({ ...country, casing: { width: 3 }, dash: [3, 2] }, frame(2));
  const gpu = policy.gpuStrokeStyle(css, frame(2));
  assert.equal(gpu.width, 2 * css.width); assert.equal(gpu.casing.width, 6); assert.deepEqual(gpu.dash, [6, 4]);
  assert.equal(css.width, country.width); assert.deepEqual(css.dash, [3, 2]);
  assert.ok(Object.isFrozen(country)); assert.throws(() => policy.resolveMapStrokeStyle({}, 'unknown-role'), /role/i);
});
