import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/spherical-core.mjs';
import '../../../src/rendering/workers/gpu-mesh-core.js';
import { sharedCalculationCore } from '../../../src/document/temporal.js';
import { tileLargePolygonLodFeatures } from '../../../src/rendering/render-lod.js';
import { createCountryMeshPreparation } from '../../../src/rendering/country-mesh-preparation.js';
import { prepareMeshSpatialBlocks, visibleMeshSpatialLeaves } from '../../../src/rendering/mesh-spatial-blocks.js';
import { visibleLargeCountryTilesForFrame } from '../../../src/rendering/gpu-country-ranges.js';

const shape = (id, minX, maxX) => ({
  id, geometry: { type: 'Polygon', coordinates: [[
    [minX, 0], [maxX, 0], [maxX, 3], [minX, 3], [minX, 0],
  ]] },
});
const clip = (left, right) => sharedCalculationCore.polygonOperation('intersection', [left, right], false);
const context = { throwIfCancelled() {} };

test('one large country is clipped into independently cached geographic tiles', () => {
  const country = shape('mainland', 0, 8), source = JSON.stringify(country);
  const cache = new Map();
  const regions = [{ id: 'mainland', tiles: [[0, 0], [1, 0]] }];
  const first = tileLargePolygonLodFeatures([country], regions, {
    intersection: clip, sourceKey: 'source-1', lodKey: 'zoom-1',
    minimumVertices: 4, cache,
  });
  assert.equal(first.tiledCountryCount, 1);
  assert.equal(first.features[0].geometry, null);
  assert.equal(first.features[0].lodParts.length, 2);
  assert.equal(first.tilesPrepared, 2);
  assert.equal(first.tilesReused, 0);
  assert.equal(JSON.stringify(country), source);
  const pan = tileLargePolygonLodFeatures([country], [{ id: 'mainland', tiles: [[1, 0]] }], {
    intersection: clip, sourceKey: 'source-1', lodKey: 'zoom-1',
    minimumVertices: 4, cache,
  });
  assert.equal(pan.tilesReused, 1);
  assert.equal(pan.tilesPrepared, 0);
  for (const { geometry } of first.features[0].lodParts) {
    assert.equal(geometry.type, 'MultiPolygon');
    assert.ok(geometry.coordinates.length);
    for (const polygon of geometry.coordinates)
      for (const ring of polygon) assert.deepEqual(ring[0], ring.at(-1));
  }
});

test('mesh preparation stitches tile parts under one country ID and reuses unchanged tile work', async () => {
  const engine = globalThis.PandoLabGpuMeshCore;
  engine.setSharedCore(sharedCalculationCore);
  const store = createCountryMeshPreparation({ engine, yieldTask: async () => {} });
  const country = shape('mainland', 0, 8), other = shape('other', 12, 14);
  const cache = new Map();
  const get = tiles => tileLargePolygonLodFeatures([country], [{ id: 'mainland', tiles }], {
    intersection: clip, sourceKey: 'source-1', lodKey: 'zoom-1',
    minimumVertices: 4, cache,
  }).features[0];
  const first = await store.build([get([[0, 0], [1, 0]]), other], context);
  assert.deepEqual(first.countryIds, ['mainland', 'other']);
  assert.equal(first.preparation.tileCount, 2);
  assert.equal(first.preparation.builtCount, 3);
  assert.equal(first.countryTriangleRanges.length, 4);
  assert.ok(first.countryTriangleRanges[1] > 0);
  assert.ok(first.countryTriangleRanges[3] > 0);
  const second = await store.build([get([[1, 0]]), other], context);
  assert.equal(second.preparation.builtCount, 0);
  assert.equal(second.preparation.reusedCount, 2);
  assert.equal(second.countryIds.length, 2);
  assert.ok(second.positions.length < first.positions.length);
  assert.ok(second.countryTriangleRanges[1] > 0);
  assert.equal(second.countryTriangleRanges[2], second.countryTriangleRanges[1]);
});

test('canonical BVH selects visible internal blocks without revisiting offscreen roots', () => {
  const positions = Int32Array.from([
    0,0, 1000000,0, 0,1000000, 12000000,0, 13000000,0, 12000000,1000000,
  ]);
  const indices = new Uint32Array(3000 * 3);
  for (let index = 0; index < 3000; index++)
    indices.set(index % 2 ? [3, 4, 5] : [0, 1, 2], index * 3);
  const mesh = prepareMeshSpatialBlocks({
    positions, countryIndices: new Uint16Array(6),
    triangleIndices: indices, lineIndices: Uint32Array.from([0,1,3,4]),
    countryTriangleRanges: Uint32Array.from([0,indices.length]),
    countryBoundaryRanges: Uint32Array.from([0,4]),
  });
  mesh.metadataCountryIds = ['mainland'];
  mesh.countryBounds = Int32Array.from([0,0,13000000,1000000]);
  mesh.countryBoundsFlags = new Uint32Array(1);
  const frame = { mode: 1, cssViewport: [600,400], cssTranslate: [300,200],
    cssScale: 1500, flatCenter: [0,0], worldOffsets: [0] };
  const leaves = visibleMeshSpatialLeaves(mesh, frame, { padding: 10 });
  assert.ok(Array.isArray(leaves));
  assert.ok(leaves.length > 0);
  const first = visibleLargeCountryTilesForFrame(mesh, frame, {
    minTriangles: 100, paddingPixels: 10,
  });
  assert.deepEqual(first, visibleLargeCountryTilesForFrame(mesh, frame, {
    minTriangles: 100, paddingPixels: 10,
  }));
  assert.equal(first[0].id, 'mainland');
  assert.ok(first[0].tiles.every(tile => tile[0] >= 0 && tile[0] <= 1));
  const shifted = visibleLargeCountryTilesForFrame(mesh, {
    ...frame, flatCenter: [12 * Math.PI / 180, 0],
  }, { minTriangles: 100, paddingPixels: 10 });
  assert.ok(shifted.length);
  assert.notDeepEqual(first[0].tiles, shifted[0].tiles);
});
