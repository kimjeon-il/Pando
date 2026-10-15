import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREVIEW_ROOT, validatePreviewCorpus } from '../../tools/check-terrain-preview.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url));
const manifest = JSON.parse(read(PREVIEW_ROOT + 'manifest.json'));
const world = JSON.parse(read('native/assets/world/manifest.json'));
const inventory = JSON.parse(read('native/assets/world/physical-inventory-c0bd31d1.json'));
const native = read('native/assets/world/terrain-preview/v0.13.3-p1/manifest.json');
const files = new Map(['manifest.json', ...Object.keys(manifest.tiles)].map(path => [path, read(PREVIEW_ROOT + path)]));
const verify = (changes = {}) => validatePreviewCorpus(manifest, changes.files || files, changes.native || native, changes.world || world, changes.inventory || inventory);

test('current Web and App preview bytes and immutable sources are identical', () => { assert.deepEqual(verify().errors, []); });
test('preview corruption and missing files cannot pass', () => {
  const changed = new Map(files);changed.set('0/0-0.webp', Buffer.from('altered'));
  assert.ok(verify({ files: changed }).errors.some(error => error.includes('0/0-0.webp')));
  changed.delete('0/0-0.webp');assert.ok(verify({ files: changed }).errors.some(error => error.includes('inventory')));
});
test('native divergence, unpinned origins and old raster entries cannot pass', () => {
  assert.ok(verify({ native: Buffer.from('changed') }).errors.some(error => error.includes('manifests differ')));
  const changed = structuredClone(world);changed.terrain.source.ref = 'main';
  assert.ok(verify({ world: changed }).errors.some(error => error.includes('provenance')));
  const old = structuredClone(inventory);old.assets.push({ path: 'terrain/v0.12.6/manifest.json' });
  assert.ok(verify({ inventory: old }).errors.some(error => error.includes('old raster')));
});
