import assert from 'node:assert/strict';
import test from 'node:test';
import { Blob, btoa } from 'node:buffer';
import { packReferenceImages, unpackReferenceImages } from '../../assets/js/modules/reference-image-package.js';

const mapQuad = [[0, 10], [20, 10], [20, 0], [0, 0]];
test('project image package stores each immutable source once, preserving independent calibration and crops', async () => {
  const blob = new Blob(['shared source'], { type: 'image/png' });
  const rows = [{ id: 'original', name: 'original', blob, mapQuad, controlPoints: [{ id: 'manual', image: [.2, .4], coordinate: [4, 6] }] },
    { id: 'inset', name: 'inset', blob, mapQuad, sourceRect: { x: 10, y: 20, width: 100, height: 80 } }];
  const packed = await packReferenceImages(rows);
  assert.equal(packed.sources.length, 1);
  assert.equal(Object.hasOwn(packed.records[0], 'blob'), false);
  assert.equal(Object.hasOwn(packed.records[0], 'analysis'), false);
  const restored = await unpackReferenceImages(JSON.parse(JSON.stringify(packed)));
  assert.equal(restored[0].blob, restored[1].blob);
  assert.equal(await restored[0].blob.text(), 'shared source');
  assert.deepEqual(restored[1].sourceRect, rows[1].sourceRect);
  assert.deepEqual(restored[0].controlPoints, rows[0].controlPoints);
  const damaged = structuredClone(packed);damaged.sources[0].base64 = btoa('tampered');
  await assert.rejects(unpackReferenceImages(damaged), { code: 'PL-REF-PACKAGE-HASH' });
  const missing = structuredClone(packed);missing.records[0].sourceHash = 'a'.repeat(64);
  await assert.rejects(unpackReferenceImages(missing), { code: 'PL-REF-PACKAGE-SOURCE' });
  const duplicate = structuredClone(packed);duplicate.records.push(duplicate.records[0]);
  await assert.rejects(unpackReferenceImages(duplicate), { code: 'PL-REF-PACKAGE-RECORD' });
});
