import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import '../helpers/spherical-core.mjs';
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
import "../../shared/frontend/js/modules/polygon-geometry.js";
import { createTerritoryComponentPlan } from "../../tools/gis/territory-component-plan.js";

import { composeRiverBoundaryTerritoryComponents } from "../../tools/gis/river-territory-partition.js";

import { sharedCalculationCore } from "../../shared/frontend/js/modules/temporal.js";
import { validateWorldBundle } from "../../shared/frontend/js/modules/world-bundle-manifest.js";

const normalize = globalThis.PandoLabPolygonGeometry.normalizePolygonGeometry;
const clipper = globalThis.polygonClipping;
const square = (a, b, c, d) => normalize({ type: 'Polygon', coordinates: [[[a,b],[c,b],[c,d],[a,d],[a,b]]] });
const feature = geometry => ({ type: 'Feature', id: 'source', properties: { name: '기준' }, geometry });
const coords = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
const plan = createTerritoryComponentPlan({ clipper, normalize });
const data = new URL('../../assets/data/', import.meta.url);
const bundle = validateWorldBundle(JSON.parse(readFileSync(new URL('world/current.json', data), 'utf8')));

for (const [label, filename] of [['current preview', bundle.assets.previewCountries.url],
  ['Natural Earth source', 'countries-ne-5.1.1.geojson']]) {
  test(`Russia preparation preserves every original polygon without clipping: ${label}`, async () => {
    const bytes = readFileSync(new URL(filename, data));
    const source = JSON.parse(filename.endsWith('.gz') ? gunzipSync(bytes) : bytes).features.find(f => f.id === 'RUS');
    assert.ok(source, 'Russia must be present in the selected pinned source');
    const forbidden = () => assert.fail('unedited source must not run polygon operations');
    const fast = createTerritoryComponentPlan({ clipper: { union: forbidden, difference: forbidden, intersection: forbidden }, normalize: forbidden });
    const result = await fast.prepare({ features: [source] });
    assert.equal(result.items.length, coords(source.geometry).length);
    assert.equal(result.baseSourceGeometry, source.geometry);
    result.items.forEach((item, i) => {
      assert.equal(item.sourcePolygonIndex, i);
      assert.equal(item.geometry.coordinates, coords(source.geometry)[i]);
    });
  });
}

test('one source polygon can split into multiple residual components without losing provenance', async () => {
  const source = feature(square(0, 0, 10, 10));
  const removed = square(4, -1, 6, 11);
  const result = await plan.prepare({ features: [source], parts: [removed] });
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => item.sourcePolygonIndex), [0, 0]);
  assert.equal(new Set(result.items.map(item => item.key)).size, 2);
  const merged = clipper.union(...result.items.map(item => coords(item.geometry)));
  const expected = clipper.difference(coords(source.geometry), coords(removed));
  assert.deepEqual(clipper.xor(merged, expected), []);
  const restored = await plan.prepare({ features: [source] });
  assert.equal(restored.items.length, 1);
  assert.equal(restored.items[0].geometry.coordinates, coords(source.geometry)[0]);
});

test('selection, residual land, and river slivers conserve geometry and leave inputs unchanged', async () => {
  const source = square(0, 0, 10, 10);
  const selected = square(0, 0, 4, 10);
  const archived = square(8, 0, 10, 10);
  const input = { selected: [selected], components: true, archivedGeometry: archived, workingSourceGeometry: source };
  const before = structuredClone(input);
  const result = await plan.selection(input);
  assert.deepEqual(input, before);
  assert.deepEqual(clipper.xor(coords(result.combinedGeometry), clipper.union(coords(selected), coords(archived))), []);
  const slivers = await plan.slivers({ groups: [{ donorId: 'source', polygonIndex: 0, geometries: [source] }], combinedGeometry: result.combinedGeometry });
  assert.deepEqual(clipper.xor(coords(slivers[0].unselectedGeometries[0]), coords(square(4, 0, 8, 10))), []);
});

test('holes, islands and polygons on either side of the dateline retain all coordinates', async () => {
  const geometry = { type: 'MultiPolygon', coordinates: [
    [[[170,0],[179,0],[179,8],[170,8],[170,0]], [[172,2],[172,3],[173,3],[173,2],[172,2]]],
    [[[-179,0],[-170,0],[-170,8],[-179,8],[-179,0]]],
    [[[20,0],[20.00001,0],[20.00001,0.00001],[20,0]]],
  ] };
  const result = await plan.prepare({ features: [feature(geometry)] });
  assert.deepEqual(result.items.map(item => item.geometry.coordinates), geometry.coordinates);
});



test('cooperative cancellation stops before preparing the rest of a source', async () => {
  let checkpoints = 0;
  const abort = createTerritoryComponentPlan({ clipper, normalize, checkpoint: async () => {
    if (++checkpoints === 2) throw Object.assign(new Error('cancelled'), { cancelled: true });
  } });
  const geometry = { type: 'MultiPolygon', coordinates: [coords(square(0,0,1,1))[0], coords(square(2,0,3,1))[0]] };
  await assert.rejects(abort.prepare({ features: [feature(geometry)] }), /cancelled/);
  assert.equal(checkpoints, 2);
});

test('dateline cut selection subtracts wrapped candidates without changing the raw cutter source', async () => {
  const source = { type: 'Polygon', coordinates: [[[179,-2],[179,2],[-179,2],[-179,-2],[179,-2]]] };
  const lower = { type: 'MultiPolygon', coordinates: [square(179,-2,180,0).coordinates, square(-180,-2,-179,0).coordinates] };
  const upper = { type: 'MultiPolygon', coordinates: [square(179,0,180,2).coordinates, square(-180,0,-179,2).coordinates] };
  const before = structuredClone(source);
  const initial = await plan.prepare({ features: [feature(source)] });
  assert.equal(initial.workingSourceGeometry, source);
  const partial = await plan.selection({ selected: [lower], candidates: true, workingSourceGeometry: source });
  assert.deepEqual(clipper.xor(coords(partial.remainingGeometry), coords(upper)), []);
  const complete = await plan.selection({ selected: [lower, upper], candidates: true, workingSourceGeometry: source });
  assert.equal(complete.remainingGeometry, null);
  const archived = await plan.prepare({ features: [feature(source)], parts: [lower] });
  assert.deepEqual(clipper.xor(coords(archived.workingSourceGeometry), coords(upper)), []);
  assert.deepEqual(archived.items.map(item => item.sourcePolygonIndex), [0, 0]);
  assert.deepEqual(source, before);
});
