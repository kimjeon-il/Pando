import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { self: {} };
vm.runInNewContext(fs.readFileSync(new URL("../../shared/frontend/js/workers/canvas-terrain-dem-core.js", import.meta.url), 'utf8'), context);
const { convertTile, affineTransform, flatTileRectangle, triangleClip, budgetedDemTiles, convertedBytesPerPixel } = context.self.PandoLabCanvasTerrainDem;
const presentation = JSON.parse(fs.readFileSync(new URL('../fixtures/terrain-presentation.json', import.meta.url)));
const constantTile = height => {
  const dem = new Uint8ClampedArray(3 * 3 * 4), encoded = height + 12000;
  for (let index=0;index<dem.length;index+=4) dem.set([encoded >> 8, encoded & 255, 212, 255], index);
  return { dem, width:3, height:3, tint:new Uint8ClampedArray([...presentation.tint,255]),tintWidth:1,tintHeight:1,
    bounds:[-1,1,1,-1],pixelWidth:1,pixelHeight:1,levelWidth:1350,levelHeight:675 };
};

test('Canvas converts flat plains and plateaus to the selected elevation colors and grayscale', () => {
  for (const row of presentation.flatLand) {
    const options=constantTile(row.height), before=options.dem.slice(), result=convertTile(options);
    assert.deepEqual([...result.land.slice(16,19)],row.rgb,`${row.height}m land`);
    assert.equal(result.political[16],row.gray,`${row.height}m grayscale`);
    assert.deepEqual(options.dem,before,'presentation cannot change source elevations');
  }
  assert.deepEqual([...convertTile(constantTile(-4000)).ocean.slice(16,19)],[53,98,137]);
});

test('Canvas tile conversion interpolates geographic tint before mixing elevation colors', () => {
  const options=constantTile(0);
  const result=convertTile({...options,tint:new Uint8ClampedArray([0,0,0,255,200,100,50,255]),tintWidth:2});
  assert.deepEqual([...result.land.slice(16,19)],[106,115,70]);
});

test('Canvas detailed DEM uses settled height-derived shade with the original polar fallback', () => {
  const dem = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < dem.length; index += 4) dem.set([72, 68, 128, 255], index); // 6500m
  const tint = new Uint8ClampedArray([220, 180, 120, 255]);
  const options = { dem, width: 3, height: 3, tint, tintWidth: 1, tintHeight: 1,
    bounds: [-1, 1, 1, -1], pixelWidth: 1, pixelHeight: 1, levelWidth: 1350, levelHeight: 675 };
  const result = convertTile(options);
  assert.deepEqual([...result.land.slice(16,19)],[235,217,186]);
  assert.equal(result.political[16], 224);
  const polar = convertTile({ ...options, bounds: [-1, 90, 1, 89.8] });
  assert.equal(polar.political[16], 85, 'polar input uses the new neutral-shade normalization and height tone');
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

test('Canvas DEM uses the highest complete viewport LOD that fits its decoded 96MiB budget', () => {
  assert.equal(convertedBytesPerPixel, 12);
  const levels = [{id:0},{id:1},{id:2},{id:3}];
  const spec = key => ({key, pixelWidth:1024, pixelHeight:1024});
  const visible = level => Array.from({length: [2,4,8,16][level.id]},
    (_, index) => spec(`${level.id}/${index}`));
  const budget = 96 * 1024 * 1024;
  const fit = budgetedDemTiles(levels, levels[3], visible, budget);
  assert.equal(fit.level.id, 2, '16 fully decoded three-plane tiles cannot fit 96MiB');
  assert.equal(fit.specs.length, 8);
  assert.equal(fit.limited, true);
  assert.ok(fit.specs.reduce((sum, tile) =>
    sum + (tile.pixelWidth + 2) * (tile.pixelHeight + 2) * convertedBytesPerPixel, 0) <= budget);
  const roomy = budgetedDemTiles(levels, levels[3], visible, 256 * 1024 * 1024);
  assert.equal(roomy.level.id, 3);
  assert.equal(roomy.limited, false);
  assert.equal(budgetedDemTiles(levels, null, visible, budget).level, null);
});
