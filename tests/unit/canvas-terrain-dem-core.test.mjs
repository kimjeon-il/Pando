import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { self: {} };
vm.runInNewContext(fs.readFileSync(new URL("../../shared/frontend/js/workers/canvas-terrain-dem-core.js", import.meta.url), 'utf8'), context);
const { colorAt, sampleTint, convertTile, affineTransform, flatTileRectangle, triangleClip } = context.self.PandoLabCanvasTerrainDem;

test('Canvas DEM reads encoded elevation, tint, and shade without treating RGB as a raster', () => {
  const tint = new Uint8ClampedArray([220, 180, 120, 255]);
  const land = colorAt([46, 224, 255, 255], tint, 1, 1, 0, 0); // encoded 12000m
  const sea = colorAt([15, 160, 128, 255], tint, 1, 1, 0, 0); // encoded 4000m, depth 8000m
  assert.equal(land.gray, 255);
  assert.equal(sea.gray, 128);
  assert.ok(land.land[0] > land.land[2]);
  assert.ok(sea.ocean[2] > sea.ocean[0]);
  assert.ok(sea.ocean[0] < land.land[0]);
});

test('Canvas DEM samples tint at geographic cell centers and interpolates across cells', () => {
  const tint = new Uint8ClampedArray([0, 0, 0, 255, 200, 100, 50, 255]);
  assert.equal(sampleTint(tint, 2, 1, -90, 0)[0], 0);
  assert.equal(sampleTint(tint, 2, 1, 90, 0)[0], 200 / 255);
  assert.ok(Math.abs(sampleTint(tint, 2, 1, 0, 0)[0] - 100 / 255) < 1e-10);
});

test('Canvas detailed DEM uses settled height-derived shade with the original polar fallback', () => {
  const dem = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < dem.length; index += 4) dem.set([46, 224, 128, 255], index);
  const tint = new Uint8ClampedArray([220, 180, 120, 255]);
  const options = { dem, width: 3, height: 3, tint, tintWidth: 1, tintHeight: 1,
    bounds: [-1, 1, 1, -1], pixelWidth: 1, pixelHeight: 1, levelWidth: 1350, levelHeight: 675 };
  const result = convertTile(options);
  assert.equal(result.land[16], 220);
  assert.equal(result.political[16], Math.round((0.42 + 0.58 * Math.SQRT1_2) * 255));
  const polar = convertTile({ ...options, bounds: [-1, 90, 1, 89.8] });
  assert.equal(polar.political[16], 128);
});

test('Canvas triangle projection maps every source corner without checkerboard seams', () => {
  const source = [[40, 50], [70, 50], [40, 80]], destination = [[300, 200], [350, 208], [315, 245]];
  const [a, b, c, d, e, f] = affineTransform(source, destination);
  source.forEach(([x, y], index) => {
    assert.ok(Math.abs(a * x + c * y + e - destination[index][0]) < 1e-8);
    assert.ok(Math.abs(b * x + d * y + f - destination[index][1]) < 1e-8);
  });
  assert.equal(affineTransform([[1, 1], [1, 1], [1, 1]], destination), null);
});

test('flat terrain tiles keep positive dimensions through a dateline-centered camera', () => {
  const ordinary = flatTileRectangle([93, 90, 180, -90], 100, [480, 360], [0, 20]);
  const dateline = flatTileRectangle([93, 90, 180, -90], 100, [480, 360], [170, 20]);
  assert.equal(dateline[2], ordinary[2]);assert.ok(dateline[2] > 0 && dateline[3] > 0);
  const wrapped = flatTileRectangle([93, 90, 180, -90], 100, [480, 360], [170, 20], 360);
  assert.ok(Math.abs(wrapped[0] - dateline[0] - 200 * Math.PI) < 1e-8);
});

test('triangle clips cover shared antialiased edges in either winding without moving texture coordinates', () => {
  for (const points of [[[0, 0], [10, 0], [0, 10]], [[0, 0], [0, 10], [10, 0]]]) {
    const clip = triangleClip(points, 0.5);
    assert.ok(clip.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
    assert.ok(clip[0][0] <= -0.5 && clip[0][1] <= -0.5);
    assert.deepEqual(points[0], [0, 0]);
  }
});
