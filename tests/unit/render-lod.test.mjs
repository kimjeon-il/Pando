import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRenderLod, simplifyRenderGeometry } from '../../assets/js/modules/render-lod.js';

const wavyLine = {
  type: 'LineString',
  coordinates: Array.from({ length: 101 }, (_value, index) => [index * 0.01, Math.sin(index / 6) * 0.002]),
};

test('render LOD never simplifies exact, selected, or editing geometry', () => {
  assert.equal(resolveRenderLod({ requested: 'coarse', policy: 'exact' }), 'high');
  assert.equal(resolveRenderLod({ requested: 'coarse', policy: 'independent', protected: true }), 'high');
  assert.equal(simplifyRenderGeometry(wavyLine, { lod: 'coarse', policy: 'exact' }), wavyLine);
});

test('independent display geometry is simplified without mutating canonical coordinates', () => {
  const before = JSON.parse(JSON.stringify(wavyLine));
  const display = simplifyRenderGeometry(wavyLine, { lod: 'coarse', policy: 'independent' });
  assert.ok(display.coordinates.length < wavyLine.coordinates.length);
  assert.deepEqual(wavyLine, before);
  assert.notEqual(display, wavyLine);
});

test('dateline chains stay unsimplified and globe LOD bounds long projected edges', () => {
  const dateline = { type: 'LineString', coordinates: [[179, 0], [-179, 0], [-178, 0]] };
  const preserved = simplifyRenderGeometry(dateline, { lod: 'coarse', policy: 'independent' });
  assert.equal(preserved.coordinates.length, 3);
  const globe = simplifyRenderGeometry({ type: 'LineString', coordinates: [[0, 0], [20, 0]] }, {
    lod: 'coarse', policy: 'independent', projection: 'globe',
  });
  assert.ok(globe.coordinates.length >= 6);
});
