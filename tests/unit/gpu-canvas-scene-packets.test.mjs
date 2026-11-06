import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasScenePackets } from '../../shared/frontend/js/modules/gpu-canvas-scene-packets.js';

test('Canvas packets keep geometry on the Worker until its source changes or the Worker restarts', () => {
  const packets = createCanvasScenePackets();
  const geometry = new Float64Array([0, 0, 1, 1]);
  const first = { key: 'land', sourceKey: 'v1', ringCoordinates: geometry, style: { color: '#fff' } };
  assert.equal(packets.delta([first], 'scene')[0].ringCoordinates, geometry);
  assert.equal(Object.hasOwn(packets.delta([first], 'scene')[0], 'ringCoordinates'), false);
  assert.equal(packets.delta([{ ...first, sourceKey: 'v2' }], 'scene')[0].ringCoordinates, geometry,
    'changed source identity must resend geometry despite an identical buffer');
  assert.equal(Object.hasOwn(packets.delta([{ ...first, sourceKey: 'v2' }], 'scene')[0], 'ringCoordinates'), false);
  assert.equal(Object.hasOwn(packets.delta([], 'scene')[0] || {}, 'ringCoordinates'), false);
  assert.equal(packets.delta([first], 'scene')[0].ringCoordinates, geometry);
  packets.clear();
  assert.equal(packets.delta([first], 'scene')[0].ringCoordinates, geometry);
});

test('Canvas packet projections include current polygon, stroke and boundary fields', () => {
  const packets = createCanvasScenePackets();
  const polygon = { key: 'land', ringCoordinates: new Float64Array([0, 0]), role: 'physical-land', discarded: 1 };
  assert.equal(packets.scenePolygons([polygon])[0].ringCoordinates, polygon.ringCoordinates);
  assert.equal(Object.hasOwn(packets.scenePolygons([polygon])[0], 'discarded'), false);
  assert.deepEqual(packets.scenePolygons([{ key: 'empty' }]), []);
  assert.deepEqual(packets.sceneStrokes({ strokes: [{ key: 'coast', startsEnds: [0, 1], discarded: 1 }] }).map(row => row.key), ['coast']);
  assert.equal(packets.countryBoundary(null), null);
  assert.deepEqual(packets.countryBoundary({ segments: [1], outlineOverrides: { startsEnds: [2], ownerRanges: [], ownerIds: [], internalOwners: [] } }).segments, [1]);
});
