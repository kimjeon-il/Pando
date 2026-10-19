import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { buildPhysicalLandMask } from '../../tools/build-physical-land-mask.mjs';

test('physical mask preserves the pinned terrain source geometry and excludes political metadata', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] };
  const source = { type: 'FeatureCollection', features: [{ id: 'country', properties: { validFrom: '2026-10-01', color: 'red' }, geometry }] };
  const before = structuredClone(source);
  const { manifest, bytes } = buildPhysicalLandMask(Buffer.from(JSON.stringify(source)));
  const result = JSON.parse(gunzipSync(bytes));
  assert.deepEqual(result, { type: 'MultiPolygon', coordinates: [geometry.coordinates] });
  assert.equal(manifest.asset.compressedBytes, bytes.length);
  assert.match(manifest.asset.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(source, before);
});
