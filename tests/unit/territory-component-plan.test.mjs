import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import '../../assets/js/vendor/polygon-clipping.min.js';
import '../../assets/js/modules/country-geometry.js';
import { createTerritoryComponentPlan } from '../../assets/js/modules/territory-component-plan.js';
import { createTerritoryComponents } from '../../assets/js/modules/app-territory-components.js';
import { composeRiverBoundaryTerritoryComponents } from '../../assets/js/modules/river-territory-partition.js';
import { createEditingRenderPacket } from '../../assets/js/modules/editing-render-packet.js';

const normalize = globalThis.PandoLabCountryGeometry.normalizeCountryGeometry;
const clipper = globalThis.polygonClipping;
const square = (a, b, c, d) => normalize({ type: 'Polygon', coordinates: [[[a,b],[c,b],[c,d],[a,d],[a,b]]] });
const feature = geometry => ({ type: 'Feature', id: 'source', properties: { name: '기준' }, geometry });
const coords = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
const plan = createTerritoryComponentPlan({ clipper, normalize });

for (const filename of ['countries-preview-v0.33.0.geojson.gz', 'countries-ne-5.1.1.geojson']) {
  test(`Russia preparation preserves every original polygon without clipping: ${filename}`, async () => {
    const bytes = readFileSync(new URL(`../../assets/data/${filename}`, import.meta.url));
    const source = JSON.parse(filename.endsWith('.gz') ? gunzipSync(bytes) : bytes).features.find(f => f.id === 'RUS');
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

test('component cache and render packets reuse geometry across hover, selection and river toggles', async () => {
  let areas = 0;
  const source = feature(square(0, 0, 10, 10));
  const current = { stage: 'selection', activePhase: 'components', baseSourceFeatures: [source],
    selectedComponentKeys: [], componentFeatures: [source], useRiverBoundaries: false };
  const api = createTerritoryComponents();
  api.connect({ state: { territorySelectionSession: current }, countryName: () => '기준',
    d3: { geo: { area: () => { areas += 1; return 1; } } },
    composeRiverBoundaryTerritoryComponents });
  api.installComponentIndex(current, await plan.prepare({ features: [source] }), 'source:1');
  const initial = api.territoryComponentItems()[0];
  for (let i = 0; i < 20; i++) {
    current.selectedComponentKeys = i % 2 ? [initial.key] : [];
    const items = api.territoryComponentItems();
    const packet = createEditingRenderPacket({ territoryOperation: { components: items } });
    assert.equal(items[0].geometry, initial.geometry);
    assert.equal(packet.territoryOperation.components[0].geometry, initial.geometry);
  }
  assert.equal(areas, 1);
  current.useRiverBoundaries = true;
  current.riverPartitionStatus = 'ready';
  current.riverPartitionCandidates = [];
  current.riverPartitionDonorResults = [];
  api.installRiverComponentIndex(current, api.riverBoundaryComposition(), current.riverPartitionCandidates, current.riverPartitionDonorResults);
  assert.equal(api.territoryComponentItems()[0].sourcePolygonIndex, 0);
  current.useRiverBoundaries = false;
  assert.equal(api.territoryComponentItems()[0].geometry, initial.geometry);
  current.stage = 'review';
  assert.deepEqual(api.territoryComponentItems(), []);
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
