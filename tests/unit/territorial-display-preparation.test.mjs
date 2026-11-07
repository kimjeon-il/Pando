// Original feature contract: edit-preparation.test.mjs
// Viewer-only geometry preparation; manual border cutting and draft previews are retired.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/spherical-core.mjs';
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
import "../../shared/frontend/js/modules/polygon-geometry.js";
import { createMapDisplayPreparation } from "../../shared/frontend/js/modules/map-display-preparation.js";
import { touchGeometry } from "../../shared/frontend/js/modules/geometry-versions.js";
import { createGeometrySnapshotPool } from "../helpers/legacy-project-autosave.mjs";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";

const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };

test('shared adjacency keeps the original collinearity precision and raw date-line semantics', () => {
  for (const [shift, expected] of [[10,true], [10.00000005,true], [10.0000002,false], [20,false], [-350,false]]) {
    const other = { type: 'Polygon', coordinates: square.coordinates.map(ring => ring.map(([x, y]) => [x + shift, y])) };
    assert.equal(globalThis.PandoLabSphericalCore.territorialGeometriesAdjacent([square.coordinates],[other.coordinates]), expected);
  }
});

test('shared adjacency handles long separated and shared boundaries', () => {
  const boundary = y => Array.from({ length: 10001 }, (_, index) => [index / 100, y]);
  const shape = y => [[boundary(y)]];
  const adjacent = globalThis.PandoLabSphericalCore.territorialGeometriesAdjacent;
  assert.equal(adjacent(shape(0), shape(10)), false);
  assert.equal(adjacent(shape(0), shape(0)), true);
  const zigzag = Array.from({ length: 2001 }, (_, index) => [index / 100, index % 2 ? 10 : 0]);
  assert.equal(adjacent([[zigzag]], shape(5)), false);
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
test('history shares immutable geometry versions without mutable coordinate aliases', () => {
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
