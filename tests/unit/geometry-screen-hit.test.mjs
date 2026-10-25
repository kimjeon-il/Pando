import assert from 'node:assert/strict';
import test from 'node:test';
import { geometryHitsScreenPoint, projectedLineDistance, projectedPointDistance } from "../../shared/frontend/js/modules/geometry-screen-hit.js";
import { createObjectPicking } from "../../shared/frontend/js/modules/object-picking.js";

const project = ([x, y]) => [x * 10, y * 10];
const options = overrides => ({ project, contains: () => false, coordinateBounds: () => [0, 0, 10, 10], zoom: 1, boundsCache: new WeakMap(), ...overrides });

test('point and multipoint hits use projected pixel tolerance', () => {
  const config = options();
  assert.equal(projectedPointDistance([0, 0], [3, 4]), 5);
  assert.equal(geometryHitsScreenPoint({ type: 'Point', coordinates: [1, 1] }, [1, 1], [16, 10], 6, config), true);
  assert.equal(geometryHitsScreenPoint({ type: 'Point', coordinates: [1, 1] }, [1, 1], [17, 10], 6, config), false);
  assert.equal(geometryHitsScreenPoint({ type: 'MultiPoint', coordinates: [[1, 1], [5, 5]] }, [5, 5], [50, 50], 1, config), true);
  assert.equal(geometryHitsScreenPoint({ type: 'Point', coordinates: [1, 1] }, [1, 1], [10, 10], 8, options({ project: () => null })), false);
});

test('line and multipart distances clamp segment endpoints and do not bridge missing projected points', () => {
  assert.equal(projectedLineDistance({ type: 'LineString', coordinates: [[0, 0], [10, 0]] }, [50, 3], project), 3);
  assert.equal(projectedLineDistance({ type: 'LineString', coordinates: [[0, 0], [10, 0]] }, [103, 4], project), 5);
  assert.equal(projectedLineDistance({ type: 'MultiLineString', coordinates: [[[0, 0], [0, 0]], [[5, 5], [10, 5]]] }, [75, 52], project), 2);
  assert.equal(projectedLineDistance({ type: 'LineString', coordinates: [[0, 0], [5, 0], [10, 0]] }, [50, 0], point => point[0] === 5 ? null : project(point)), Infinity);
  assert.equal(projectedLineDistance(null, [0, 0], project), Infinity);
  const line = { type: 'LineString', coordinates: [[0, 0], [10, 0]] };
  assert.equal(geometryHitsScreenPoint(line, [5, 0], [50, 7], 8, options()), true);
  assert.equal(geometryHitsScreenPoint(line, [5, 0], [50, 9], 8, options()), false);
});

test('polygon interiors delegate containment and edges retain the screen tolerance', () => {
  const polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
  let containmentCalls = 0;
  const config = options({ contains: (coordinate, feature) => {
    assert.deepEqual(coordinate, [5, 5]);
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry, polygon);
    containmentCalls += 1;
    return true;
  } });
  assert.equal(geometryHitsScreenPoint(polygon, [5, 5], [50, 50], 1, config), true);
  assert.equal(containmentCalls, 1);
  assert.equal(geometryHitsScreenPoint(polygon, [5, 5], [50, 50], 1, options()), false);
  assert.equal(geometryHitsScreenPoint(polygon, [5, 0], [50, -3], 4, options()), true);
  assert.equal(projectedLineDistance({ type: 'MultiPolygon', coordinates: [polygon.coordinates] }, [50, -3], project), 3);
});

test('bounds cache is caller owned, zoom changes coarse rejection, and world bounds do not reject wrapped hits', () => {
  const line = { type: 'LineString', coordinates: [[0, 0], [10, 0]] };
  let boundsCalls = 0;
  const config = options({ coordinateBounds: () => { boundsCalls += 1; return [0, 0, 10, 10]; } });
  assert.equal(geometryHitsScreenPoint(line, [12, 0], [50, 0], 8, config), true);
  assert.equal(geometryHitsScreenPoint(line, [12, 0], [50, 0], 8, { ...config, zoom: 100 }), false);
  assert.equal(boundsCalls, 1);
  assert.deepEqual(config.boundsCache.get(line), [0, 0, 10, 10]);
  assert.equal(geometryHitsScreenPoint(line, [181, 0], [50, 0], 8, options({ coordinateBounds: () => [-180, -90, 180, 90] })), true);
  assert.equal(geometryHitsScreenPoint(null, [0, 0], [0, 0], 8, config), false);
});

test('editor getters keep their existing signatures and resolve live projection, zoom and cache dependencies', () => {
  const picking = createObjectPicking();
  const hit = picking.geometryHitsScreenPoint;
  const distance = picking.projectedLineDistance;
  let currentProjection = project;
  const cache = new WeakMap();
  picking.connect({ mapView: { activeProjection: () => currentProjection },
    spatialRecords: { geometryBoundsCache: cache }, cutGeometry: { coordinateBounds: () => [0, 0, 10, 10] },
    labelPresentation: { currentMapZoom: () => 1 }, landRelations: { pointInCountryFeature: () => false } });
  const point = { type: 'Point', coordinates: [2, 2] };
  assert.equal(hit(point, [2, 2], [20, 20]), true);
  assert.ok(cache.has(point));
  currentProjection = coordinate => coordinate;
  assert.equal(hit(point, [2, 2], [20, 20]), false);
  assert.equal(distance({ type: 'LineString', coordinates: [[0, 0], [10, 0]] }, [5, 3]), 3);
});
