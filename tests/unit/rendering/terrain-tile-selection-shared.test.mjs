import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../../../src/rendering/workers/terrain-tile-selection-core.js', import.meta.url), 'utf8');
const scope = {};
vm.runInNewContext(source, { self: scope });
const tiles = scope.PandoLabTerrainTileSelection;

test('both rendering backends share source-resolution LOD decisions', () => {
  const coarse = { id: 0, width: 256, height: 128, tileSize: 128, rows: 1, columns: 2 };
  const detailed = { id: 1, width: 1024, height: 512, tileSize: 256, rows: 2, columns: 4 };
  const manifest = { levels: [coarse, detailed] };
  assert.equal(tiles.chooseLevel(manifest, 200).level, coarse);
  assert.equal(tiles.chooseLevel(manifest, 400).level, detailed);
  assert.equal(tiles.chooseLevel(manifest, 1200).resolutionLimited, true);
  assert.equal(tiles.chooseLevel(null, 100).level, null);
});

test('per-backend visibility cache reuses identical views and invalidates changes', () => {
  const level = { id: 2, width: 512, height: 256, tileSize: 256, rows: 1, columns: 2 };
  const cache = tiles.createVisibilityCache({ distance: () => 0, numericLevel: true });
  const query = { cameraKey: [100, 100, 50, 'flat', 0, 0, 0, 0],
    viewport: [100, 100], scale: 50, projection: 'flat',
    flatCenter: [0, 0], globeCenter: [0, 0] };
  const first = cache.select(level, query);
  assert.equal(cache.select(level, query), first);
  assert.equal(typeof first[0].level, 'number');
  assert.equal(cache.select(level, { ...query, includeAll: true }).length, 2);
  assert.notEqual(cache.select(level, { ...query, cameraKey: [100, 100, 60, 'flat', 0, 0, 0, 0] }), first);
  cache.clear();
  assert.notEqual(cache.select(level, query), first);
});

test('flat visible scan matches the exhaustive wrapped predicate with partial edge tiles', () => {
  const level = { id: 4, width: 1030, height: 515, tileSize: 128, rows: 5, columns: 9 };
  const reference = ({viewport, scale, flatCenter}) => {
    const keys = [];
    for (let row = 0; row < level.rows; row++) for (let column = 0; column < level.columns; column++) {
      const spec = tiles.tileSpec(level, column, row);
      const [west, north, east, south] = spec.bounds;
      const centerLon = (west + east) / 2, centerLat = (north + south) / 2;
      const lon = Math.abs((((centerLon - flatCenter[0]) + 540) % 360) - 180);
      if (lon <= viewport[0] / Math.max(1, scale) * 90 / Math.PI + (east - west) / 2 + 2
        && Math.abs(centerLat - flatCenter[1])
          <= viewport[1] / Math.max(1, scale) * 90 / Math.PI + (north - south) / 2 + 2)
        keys.push(spec.key);
    }
    return keys;
  };
  for (const flatCenter of [[0, 0], [179, 12], [-179, -35], [540, 0]]) {
    for (const scale of [20, 250, 2400]) {
      const input = { viewport: [400, 230], scale, flatCenter, projection: 'flat' };
      assert.deepEqual(Array.from(tiles.visible(level, input), row => row.key), reference(input));
    }
  }
  assert.equal(tiles.visible(level, { includeAll: true, viewport: [200, 100], scale: 1,
    projection: 'flat', flatCenter: [0, 0] }).length, 45);
});
