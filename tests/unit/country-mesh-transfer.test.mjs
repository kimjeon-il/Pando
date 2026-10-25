import test from 'node:test';
import assert from 'node:assert/strict';
import { packCountryMeshFeatures, unpackCountryMeshFeatures } from '../../assets/js/modules/country-mesh-transfer.js';

test('presentation transfer preserves doubles, holes, polygon order and IDs without detaching source geometry', async () => {
  const ring = [[0.1234567890123, -5], [2, 1], [4, 2], [0.1234567890123, -5]];
  const features = [{ id: 'A', geometry: { type: 'Polygon', coordinates: [ring, ring.toReversed()] } },
    { id: 'B', geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring.toReversed()]] } }];
  const before = structuredClone(features);
  const packed = await packCountryMeshFeatures(features);
  const received = structuredClone(packed, { transfer: [packed.coordinates.buffer] });
  assert.deepEqual(unpackCountryMeshFeatures(received), before);
  assert.deepEqual(features, before);
});

test('packing yields within a large ring and stops an obsolete request before dispatch', async () => {
  let current = true, yields = 0;
  const features = [{ id: 'A', geometry: { type: 'Polygon', coordinates: [Array.from({ length: 50000 }, (_, n) => [n, n])] } }];
  await assert.rejects(packCountryMeshFeatures(features, { isCurrent: () => current,
    yieldTask: async () => { yields++; current = false; } }), { name: 'AbortError' });
  assert.equal(yields, 1);
});
