import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferenceImagePlaceSymbolCandidates,
  findReferenceImagePointSymbol,
} from '../../assets/js/modules/reference-image-auto-georef.js';

function makeRaster(width = 120, height = 100, background = 236) {
  return { width, height, luma: new Uint8Array(width * height).fill(background) };
}

function fillDisk(raster, cx, cy, radius, value) {
  for (let y = Math.max(0, cy - radius); y <= Math.min(raster.height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(raster.width - 1, cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        raster.luma[y * raster.width + x] = value;
      }
    }
  }
}

test('point-symbol detector snaps from an approximate city position to a compact map dot', () => {
  const raster = makeRaster();
  fillDisk(raster, 67, 43, 3, 25);
  const expectedUv = [62 / (raster.width - 1), 46 / (raster.height - 1)];
  const result = findReferenceImagePointSymbol(raster, expectedUv, { searchRadiusPx: 14 });
  assert.ok(result);
  assert.ok(Math.abs(result.pixel[0] - 67) < 0.2);
  assert.ok(Math.abs(result.pixel[1] - 43) < 0.2);
  assert.ok(result.confidence > 0.55);
  assert.equal(result.polarity, 'dark');
});

test('point-symbol detector ignores elongated linework in the search window', () => {
  const raster = makeRaster();
  for (let x = 45; x <= 75; x += 1) raster.luma[50 * raster.width + x] = 20;
  const result = findReferenceImagePointSymbol(raster, [60 / 119, 50 / 99], { searchRadiusPx: 18 });
  assert.equal(result, null);
});

test('place candidate builder de-duplicates two place seeds that snap to the same symbol', () => {
  const raster = makeRaster();
  fillDisk(raster, 40, 45, 3, 30);
  fillDisk(raster, 85, 55, 3, 35);
  const seeds = [
    { id: 'berlin', name: 'Berlin', expectedUv: [38 / 119, 44 / 99], coordinate: [13.4, 52.5], priority: 90, kind: 'capital' },
    { id: 'berlin-duplicate', name: 'Berlin alt', expectedUv: [42 / 119, 46 / 99], coordinate: [13.41, 52.51], priority: 20, kind: 'city' },
    { id: 'leipzig', name: 'Leipzig', expectedUv: [82 / 119, 57 / 99], coordinate: [12.37, 51.34], priority: 70, kind: 'city' },
  ];
  const result = buildReferenceImagePlaceSymbolCandidates(raster, seeds, {
    searchRadiusPx: 12,
    dedupeRadiusPx: 5,
  });
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.some(candidate => candidate.id === 'berlin'));
  assert.ok(result.candidates.some(candidate => candidate.id === 'leipzig'));
  assert.ok(result.misses.some(item => item.reason === 'duplicate-symbol'));
});

test('point-symbol detector can also find a compact light symbol on a dark local background', () => {
  const raster = makeRaster(90, 90, 28);
  fillDisk(raster, 45, 48, 3, 230);
  const result = findReferenceImagePointSymbol(raster, [43 / 89, 45 / 89], { searchRadiusPx: 12 });
  assert.ok(result);
  assert.equal(result.polarity, 'light');
  assert.ok(result.confidence > 0.5);
});
