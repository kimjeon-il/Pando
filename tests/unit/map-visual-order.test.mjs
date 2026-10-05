import assert from 'node:assert/strict';
import test from 'node:test';
import { mapVisualOrder, mapVisualRank, INTERACTION_ROLE_PRIORITY, SELECTION_PAINT_ORDER, overlayVisualOrder } from '../../assets/js/modules/layer-presentation.js';
import { createSelectionPass } from '../../assets/js/modules/selection-pass.js';
import { createRenderDevice } from '../../assets/js/modules/render-device.js';

test('one policy orders paint, claim, selection and SVG roles without changing overlay object order', () => {
  assert.deepEqual(mapVisualOrder('hydro'), ['lake', 'lake-boundary', 'river', 'border-river']);
  const paint = mapVisualOrder('base');
  assert.ok(paint.indexOf('country-fill') < paint.indexOf('territorial-fill'));
  assert.ok(paint.indexOf('country-boundary') < paint.indexOf('independent-overlay'));
  assert.deepEqual(mapVisualOrder('base', 'gpu').filter(role => role.endsWith('-fill')), ['territorial-fill', 'country-fill']);
  assert.deepEqual(SELECTION_PAINT_ORDER, ['candidate', 'hover', 'secondary', 'primary']);
  assert.equal(INTERACTION_ROLE_PRIORITY['chosen-result'], 5);
  assert.ok(mapVisualRank('primary') < mapVisualRank('edit-preview'));
  assert.ok(mapVisualRank('edit-preview') < mapVisualRank('labels'));
  const presentation = { overlayOrder: ['distributions', 'subunits', 'regions', 'genericFeatures'], objectOrder: ['generic:a', 'generic:b'] };
  assert.ok(overlayVisualOrder(presentation, 'regions', 'boundary') < overlayVisualOrder(presentation, 'genericFeatures', 'fill'));
  assert.ok(overlayVisualOrder(presentation, 'genericFeatures', 'fill', 'generic:a') < overlayVisualOrder(presentation, 'genericFeatures', 'fill', 'generic:b'));
  assert.throws(() => mapVisualRank('unknown'), /visual role/);
});

test('selection submits the actual strokes in policy order regardless of input channel order', () => {
  const submitted = [];
  const renderer = { isAvailable: () => true, stats: () => ({}),
    drawBatches: batches => {
      const keys = batches.map(batch => batch.key); submitted.push(...keys);
      return { succeeded: true, renderedKeys: keys, missingKeys: [] };
    } };
  const pass = createSelectionPass();
  pass.initialize(createRenderDevice({ gl: {}, version: 2 }), { strokeRenderer: renderer });
  const geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
  pass.updateData({ channels: Object.fromEntries(['primary', 'secondary', 'hover', 'candidate'].map(role =>
    [role, [{ key: role, geometryRevision: 1, geometry }]])) });
  const result = pass.draw({}, {}, { frameContext: {} });
  assert.equal(result.succeeded, true);
  assert.deepEqual(submitted, SELECTION_PAINT_ORDER.map(role => `selection-object:${role}`));
});
