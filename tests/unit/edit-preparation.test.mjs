import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
vm.runInThisContext(readFileSync(new URL('../../assets/js/vendor/d3.min.js', import.meta.url), 'utf8'));
import '../../assets/js/vendor/polygon-clipping.min.js';
import '../../assets/js/modules/country-geometry.js';
import { prepareCutInWorker } from '../../assets/js/modules/cut-worker-preparation.js';
import { geometrySegmentIndex, segmentQueryBounds, territorialSegmentCandidates } from '../../assets/js/modules/geometry-segment-index.js';
import '../../assets/js/modules/territorial-edit-plan.js';
import { createEditDisplayPreparation } from '../../assets/js/modules/edit-display-preparation.js';
import { createGeometrySnapshotPool, touchGeometry } from '../../assets/js/modules/geometry-versions.js';

const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };

test('indexed adjacency keeps the original collinearity precision and raw date-line semantics', () => {
  const plain = globalThis.PandoLabTerritorialEdit.createKernel(globalThis.polygonClipping);
  const indexed = globalThis.PandoLabTerritorialEdit.createKernel(globalThis.polygonClipping, { segmentCandidates: territorialSegmentCandidates });
  for (const shift of [10, 10.00000005, 10.0000002, 20, -350]) {
    const other = { type: 'Polygon', coordinates: square.coordinates.map(ring => ring.map(([x, y]) => [x + shift, y])) };
    assert.equal(indexed.adjacent(square, other), plain.adjacent(square, other));
  }
});

test('display preparation reuses unchanged groups and discards removed boundaries', async () => {
  const service = createEditDisplayPreparation();
  const country = { id: 'RUS', geometry: square, properties: {} };
  const unit = { id: 'child', geometry: { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]] }, properties: { unitType: 'subunit', sovereignId: 'RUS', parentId: 'RUS' } };
  const first = await service.prepare({ kind: 'boundaries' }, [country], [unit]);
  assert.ok(first.segments.length);
  unit.properties.color = '#000000';
  const second = await service.prepare({ kind: 'boundaries' }, [country], [unit]);
  assert.equal(second.segments[0], first.segments[0]);
  assert.deepEqual((await service.prepare({ kind: 'boundaries' }, [country], [])).segments, []);
});
test('history shares immutable versions but never live editing arrays', () => {
  const pool = createGeometrySnapshotPool();
  const feature = { id: 'RUS', geometry: structuredClone(square), properties: { name: 'RUS' } };
  const first = pool.clone(feature), second = pool.clone(feature);
  assert.equal(first.geometry, second.geometry);
  assert.notEqual(first.geometry.coordinates, feature.geometry.coordinates);
  assert.throws(() => { first.geometry.coordinates[0][0][0] = 20; });
  feature.geometry.coordinates[0][1][0] = 11;
  touchGeometry(feature.geometry);
  const third = pool.clone(feature);
  assert.notEqual(third.geometry, first.geometry);
  assert.equal(first.geometry.coordinates[0][1][0], 10);
  assert.equal(third.geometry.coordinates[0][1][0], 11);
  assert.equal(pool.restore(third, feature).geometry, feature.geometry);
  const restored = pool.restore(first, feature);
  assert.notEqual(restored.geometry, feature.geometry);
  assert.notEqual(restored.geometry, first.geometry);
  restored.geometry.coordinates[0][0][0] = 7;
  assert.equal(first.geometry.coordinates[0][0][0], 0);
});

test('indexed segments retain date-line and long crossing edges, and reuse the same index', () => {
  const geometry = { type: 'Polygon', coordinates: [[[179, 0], [-179, 0], [-179, 3], [179, 3], [179, 0]]] };
  const index = geometrySegmentIndex(geometry);
  assert.equal(geometrySegmentIndex(geometry), index);
  assert.ok(index.query([-180, -1, -179.5, 1]).some(edge => edge.segmentIndex === 0));
  assert.ok(index.query(segmentQueryBounds([180, -1], [180, 1])).some(edge => edge.segmentIndex === 0));
});

test('worker cut assessment and split share the exact validated cut and preserve source coordinates', () => {
  const source = structuredClone(square);
  const result = prepareCutInWorker({ source, coords: [[-1, 5], [11, 5]], buildPreview: true,
    view: { kind: 'flat', scale: 200, translate: [200, 200], rotate: [0, 0, 0], center: [0, 0],
      size: { width: 800, height: 600 }, coarsePointer: false, snapDistance: { mouse: 10, touch: 20 } } },
  globalThis.PandoLabCountryGeometry, globalThis.d3, globalThis.polygonClipping);
  assert.equal(result.valid, true, result.message);
  assert.ok(result.split, result.splitError);
  assert.equal(result.split.candidates.length, 2);
  assert.equal(result.split.candidates.reduce((sum, candidate) => sum + candidate.area, 0), 100);
  assert.deepEqual(source, square);
});
