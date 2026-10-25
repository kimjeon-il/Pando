import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../helpers/spherical-core.mjs';
vm.runInThisContext(readFileSync(new URL("../../shared/frontend/js/vendor/d3.min.js", import.meta.url), 'utf8'));
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
import "../../shared/frontend/js/modules/polygon-geometry.js";
import { prepareCutInWorker } from "../../apps/editor/frontend/js/modules/cut-worker-preparation.js";
import { createTerritoryComponentPlan } from "../../apps/editor/frontend/js/modules/territory-component-plan.js";
import { normalizePolygonGeometry } from "../../shared/frontend/js/modules/map-edit-geometry.js";
import { geometrySegmentIndex, segmentQueryBounds, territorialSegmentCandidates } from "../../apps/editor/frontend/js/modules/geometry-segment-index.js";
import "../../shared/frontend/js/modules/territorial-edit-plan.js";
import { createMapDisplayPreparation } from "../../shared/frontend/js/modules/map-display-preparation.js";
import { createGeometrySnapshotPool, touchGeometry } from "../../shared/frontend/js/modules/geometry-versions.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";

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
  const service = createMapDisplayPreparation();
  const country = createTerritorialFeature({ id: 'RUS', entityKind: 'general', geometry: square });
  const unit = createTerritorialFeature({ id: 'child', entityKind: 'general', parentId: 'RUS',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]] } });
  const first = await service.prepare({ kind: 'boundaries' }, [country], [unit]);
  assert.ok(first.segments.length);
  unit.properties.style.color = '#000000';
  const second = await service.prepare({ kind: 'boundaries' }, [country], [unit]);
  assert.equal(second.segments[0], first.segments[0]);
  assert.deepEqual((await service.prepare({ kind: 'boundaries' }, [country], [])).segments, []);
});

test('display preparation shares unchanged monthly shapes and invalidates a touched geometry', async () => {
  const service = createMapDisplayPreparation();
  const country = createTerritorialFeature({ id: 'ROOT', entityKind: 'general', geometry: square });
  const unit = createTerritorialFeature({ id: 'CHILD', entityKind: 'general', parentId: 'ROOT',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]] } });
  const first = await service.prepare({ kind: 'boundaries' }, [country], [unit]);
  for (const month of ['January', 'February', 'March']) {
    const same = await service.prepare({ kind: 'boundaries' }, [{ ...country, properties: { ...country.properties, name: month } }],
      [{ ...unit, properties: { ...unit.properties, name: month } }]);
    assert.strictEqual(same.segments[0], first.segments[0]);
  }
  for (const ring of unit.geometry.coordinates) for (const coordinate of ring) if (coordinate[0] === 5) coordinate[0] = 6;
  touchGeometry(unit.geometry);
  const changed = await service.prepare({ kind: 'boundaries' }, [country], [unit]);
  assert.notStrictEqual(changed.segments[0], first.segments[0]);
  assert.ok(changed.segments.some(segment => segment.a[0] === 6 && segment.b[0] === 6));
  assert.ok(first.segments.every(segment => segment.a[0] !== 6 && segment.b[0] !== 6));
});

test('display preparation retains independent regional boundaries across general parents', async () => {
  const country = (id, west, east) => createTerritorialFeature({ id, entityKind: 'general',
    geometry: { type: 'Polygon', coordinates: [[[west, 0], [east, 0], [east, 10], [west, 10], [west, 0]]] } });
  const roots = [country('WEST', 0, 5), country('EAST', 5, 10)];
  const region = createTerritorialFeature({ id: 'REGION', entityKind: 'regional',
    geometry: { type: 'Polygon', coordinates: [[[3, 2], [7, 2], [7, 8], [3, 8], [3, 2]]] } });
  const result = await createMapDisplayPreparation().prepare({ kind: 'boundaries' }, roots, [region]);
  assert.ok(result.segments.some(segment => segment.a[0] < 5 || segment.b[0] < 5));
  assert.ok(result.segments.some(segment => segment.a[0] > 5 || segment.b[0] > 5));
  assert.ok(result.segments.every(segment => segment.styleType === 'region' && segment.unitOwners[0].id === 'REGION'));
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
  globalThis.PandoLabPolygonGeometry, globalThis.d3, globalThis.polygonClipping);
  assert.equal(result.valid, true, result.message);
  assert.ok(result.split, result.splitError);
  assert.equal(result.split.candidates.length, 2);
  assert.equal(result.split.candidates.reduce((sum, candidate) => sum + candidate.area, 0), 100);
  assert.deepEqual(source, square);
});

test('Turkey cut candidates remain usable by territory selection preparation', async () => {
  const countries = JSON.parse(readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson', import.meta.url), 'utf8'));
  const source = countries.features.find(feature => feature.id === 'TUR')?.geometry;
  assert.ok(source);
  const cut = prepareCutInWorker({ source, coords: [[26, 41.8], [29, 41.8]], buildPreview: true,
    view: { kind: 'flat', scale: 200, translate: [200, 200], rotate: [0, 0, 0], center: [0, 0],
      size: { width: 800, height: 600 }, coarsePointer: false, snapDistance: { mouse: 10, touch: 20 } } },
  globalThis.PandoLabPolygonGeometry, globalThis.d3, globalThis.polygonClipping);
  assert.equal(cut.valid, true, cut.message);
  assert.equal(cut.split.candidates.length, 2);
  const candidate = cut.split.candidates.reduce((smaller, next) => next.area < smaller.area ? next : smaller);
  const plan = createTerritoryComponentPlan({ clipper: globalThis.polygonClipping, normalize: normalizePolygonGeometry });
  const result = await plan.selection({ currentGeometry: candidate.geometry, workingSourceGeometry: source });
  assert.ok(result.combinedGeometry);
  assert.ok(result.remainingGeometry);
});
