import test from 'node:test';
import assert from 'node:assert/strict';
import zlib, { gunzipSync } from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
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

test('physical mask bytes and manifest are identical across gzip host OS headers', () => {
  const source = Buffer.from(JSON.stringify({ features: [{ geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } }] }));
  const original = zlib.gzipSync;
  const results = [];
  try {
    for (const os of [3, 10, 255]) {
      zlib.gzipSync = (...args) => { const bytes = original(...args); bytes[9] = os; return bytes; };
      syncBuiltinESMExports();
      results.push(buildPhysicalLandMask(source));
    }
  } finally {
    zlib.gzipSync = original;
    syncBuiltinESMExports();
  }
  for (const result of results) {
    assert.equal(result.bytes[9], 10, 'retain the committed physical-land gzip header on every host');
    assert.deepEqual(result, results[0]);
  }
});
