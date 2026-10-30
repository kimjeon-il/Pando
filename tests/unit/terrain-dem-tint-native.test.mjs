import assert from 'node:assert/strict';
import test from 'node:test';
import { maskNativeDemTint } from '../../tools/gis/terrain-dem-encode.mjs';

const directory = process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY;
test('tint mask validates planar inputs before launching native code', async () => {
  await assert.rejects(maskNativeDemTint({width: 1, height: 1, rgb: Buffer.alloc(2), ice: Buffer.alloc(1), land: Buffer.alloc(1), interior: Buffer.alloc(1)}), /grid/i);
});

test('tint mask preserves ice and land snow and rejects water', {skip: !directory}, async () => {
  const rgb = Buffer.from([255, 255, 180, 249, 237, 249, 255, 255, 190, 250, 244, 250, 255, 255, 170, 248, 240, 248]);
  const ice = Buffer.from([0, 1, 0, 0, 0, 1]);
  const land = Buffer.from([1, 1, 1, 1, 1, 0]);
  const interior = Buffer.from([1, 1, 1, 1, 0, 0]);
  const actual = await maskNativeDemTint({width: 6, height: 1, rgb, ice, land, interior}, {directory});
  assert.deepEqual(actual, Buffer.from([0, 1, 1, 1, 0, 1]));
});
