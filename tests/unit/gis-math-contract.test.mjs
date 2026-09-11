import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import * as boundary from '../../assets/js/modules/geographic-boundary.js';
import { distanceKm, geometryAreaKm2, lineDistanceKm } from '../../assets/js/modules/geometry-metrics.js';
import * as partitions from '../../assets/js/modules/river-territory-partition.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const clone = value => structuredClone(value);

function loadClassic(relativePath, globalName, context) {
  const filename = path.join(root, relativePath);
  vm.runInContext(read(relativePath), context, { filename });
  const value = context[globalName];
  if (!value) throw new Error(`${globalName} was not initialized`);
  return value;
}

function createBoundaryWorker() {
  const context = vm.createContext({ console, self: null });
  context.self = context;
  vm.runInContext(read('assets/js/workers/geographic-boundary-core.js'), context);
  return context.PandoLabGeographicBoundary;
}

function createGisWorker() {
  const messages = [];
  const context = vm.createContext({ console, self: null, messages });
  context.self = context;
  context.importScripts = () => {};
  vm.runInContext(read('assets/js/vendor/polygon-clipping.min.js'), context);
  context.postMessage = message => messages.push(message);
  vm.runInContext(read('assets/js/workers/gis-geometry-worker.js'), context);
  return {
    validate(collection, affectedIds = null) {
      messages.length = 0;
      context.onmessage({ data: { id: 1, action: 'validate', collection, affectedIds } });
      return messages[0];
    },
  };
}

function ring(x0, y0, x1, y1, clockwise = true) {
  const points = clockwise
    ? [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]
    : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  points.push(points[0].slice());
  return points;
}

function polygonFeature(id, coordinates) {
  return { type: 'Feature', id, properties: { name: id }, geometry: { type: 'Polygon', coordinates } };
}

function boundaryFixtures() {
  return [
    { type: 'Polygon', coordinates: [ring(0, 0, 2, 2)] },
    { type: 'Polygon', coordinates: [ring(0, 0, 4, 4), ring(1, 1, 2, 2, false)] },
    { type: 'MultiPolygon', coordinates: [[ring(0, 0, 1, 1)], [ring(10, 10, 12, 12)]] },
    { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 1]] },
    { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
    { type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { type: 'Polygon', coordinates: [ring(2, 2, 3, 3)] }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(0, 0, 1, 1)] } }, { type: 'Feature', geometry: { type: 'LineString', coordinates: [[2, 2], [3, 3]] } }] },
    { type: 'Polygon', coordinates: [[[179, 0], [-179, 0], [-179, 1], [179, 1], [179, 0]]] },
    { type: 'Polygon', coordinates: [[[-180, 88], [0, 89], [180, 88], [-180, 88]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [0, 0], [1, 0], [1, 1], [0, 0]]] },
    { type: 'LineString', coordinates: [[0, 0], [Number.NaN, 1], [1, 1]] },
    { type: 'Polygon', coordinates: [[[-180, 10], [180, 10], [180, 12], [-180, 12], [-180, 10]]] },
  ];
}

test('browser and Worker geographic boundary contracts are exact and non-mutating', () => {
  const worker = createBoundaryWorker();
  for (const input of boundaryFixtures()) {
    const snapshot = clone(input);
    assert.deepEqual(JSON.parse(JSON.stringify(worker.buildRenderableBoundarySegments(input))), boundary.buildRenderableBoundarySegments(input));
    assert.deepEqual(worker.normalizeLongitude(541), boundary.normalizeLongitude(541));
    assert.equal(worker.isArtificialBoundaryEdge([180, 1], [-180, 2]), boundary.isArtificialBoundaryEdge([180, 1], [-180, 2]));
    assert.deepEqual(JSON.parse(JSON.stringify(worker.buildRenderableBoundarySegments(input))), boundary.buildRenderableBoundarySegments(input));
    assert.deepEqual(input, snapshot);
  }
});

test('spherical distance and area contracts preserve dateline and holes', () => {
  const epsilon = (expected, actual) => Math.max(1e-6, Math.max(Math.abs(expected), Math.abs(actual)) * 1e-9);
  assert.equal(distanceKm([10, 20], [10, 20]), 0);
  assert.ok(Math.abs(distanceKm([0, 0], [1, 0]) - 111.1950802335329) <= epsilon(distanceKm([0, 0], [1, 0]), 111.1950802335329));
  assert.ok(distanceKm([0, 80], [1, 80]) < distanceKm([0, 0], [1, 0]));
  assert.ok(distanceKm([179, 0], [-179, 0]) < 300);
  const line = [[179, 0], [-179, 0], [-179, 1]];
  assert.ok(Math.abs(lineDistanceKm(line) - (distanceKm(line[0], line[1]) + distanceKm(line[1], line[2]))) <= 1e-9);
  const outer = { type: 'Polygon', coordinates: [ring(0, 0, 2, 2)] };
  const withHole = { type: 'Polygon', coordinates: [ring(0, 0, 2, 2), ring(0.5, 0.5, 1, 1, false)] };
  assert.ok(geometryAreaKm2(outer) > geometryAreaKm2(withHole));
  assert.ok(geometryAreaKm2({ type: 'MultiPolygon', coordinates: [outer.coordinates, [ring(10, 10, 11, 11)]] }) > geometryAreaKm2(outer));
});

test('GIS Worker validates canonical geometry and reports spherical overlap area', () => {
  const worker = createGisWorker();
  const left = polygonFeature('left', [ring(0, 0, 2, 2)]);
  const right = polygonFeature('right', [ring(1, 1, 3, 3)]);
  const collection = { type: 'FeatureCollection', features: [left, right] };
  const snapshot = clone(collection);
  const result = worker.validate(collection);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.firstOverlap)), ['left', 'right']);
  const expectedOverlap = geometryAreaKm2({ type: 'Polygon', coordinates: [ring(1, 1, 2, 2)] });
  // d3.geo.area uses ring winding to distinguish a spherical complement.  The
  // worker's clipping output is intentionally allowed to use either winding;
  // compare the physical (minor) overlap area, not the orientation convention.
  const sphereAreaKm2 = 4 * Math.PI * 6371.0088 ** 2;
  const workerMinorArea = Math.min(result.overlapAreaKm2, sphereAreaKm2 - result.overlapAreaKm2);
  const tolerance = Math.max(1e-6, Math.max(expectedOverlap, workerMinorArea) * 1e-9);
  assert.ok(Math.abs(workerMinorArea - expectedOverlap) <= tolerance, `${workerMinorArea} !== ${expectedOverlap} (raw worker area: ${result.overlapAreaKm2})`);
  assert.deepEqual(collection, snapshot);
  const invalid = worker.validate({ type: 'FeatureCollection', features: [polygonFeature('invalid', [ring(0, 0, 0, 0)])] });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /유효하지 않습니다/);
  assert.equal(worker.validate({ type: 'FeatureCollection', features: [left, polygonFeature('trusted', [ring(0, 0, 0, 0)])] }, ['left']).ok, true);
});

test('country normalizer and GPU mesh preserve winding, finite packets and owner ranges', () => {
  const classicContext = vm.createContext({ console, self: null });
  classicContext.self = classicContext;
  const countryGeometry = loadClassic('assets/js/modules/country-geometry.js', 'PandoLabCountryGeometry', classicContext);
  const earcut = loadClassic('assets/js/vendor/earcut.min.js', 'earcut', classicContext);
  const meshCore = loadClassic('assets/js/workers/gpu-mesh-core.js', 'PandoLabGpuMeshCore', classicContext);
  const fixtures = [
    polygonFeature('normal', [ring(0, 0, 2, 2)]),
    polygonFeature('reversed', [ring(3, 0, 5, 2, false), ring(3.5, 0.5, 4, 1, true)]),
    polygonFeature('dateline', [[[-179, 0], [179, 0], [179, 2], [-179, 2], [-179, 0]]]),
    { type: 'Feature', id: 'multi', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[ring(10, 0, 11, 1)], [ring(12, 0, 13, 1)]] } },
  ];
  const snapshot = clone(fixtures);
  const normalized = fixtures.map(feature => ({ ...feature, geometry: countryGeometry.normalizeCountryGeometry(feature.geometry) })).filter(feature => feature.geometry);
  assert.ok(normalized.every(feature => countryGeometry.hasCanonicalCountryWinding(feature.geometry)));
  const mesh = meshCore.buildGpuMeshFeatures(normalized, earcut, { validate: true });
  assert.ok(Array.from(mesh.positions).every(Number.isFinite));
  assert.ok(Array.from(mesh.strokeStartsEnds).every(Number.isFinite));
  assert.ok(Array.from(mesh.triangleIndices).every(index => index >= 0 && index < mesh.positions.length / 2));
  for (let index = 0; index < mesh.triangleIndices.length; index += 3) {
    const points = [0, 1, 2].map(offset => [
      mesh.positions[mesh.triangleIndices[index + offset] * 2],
      mesh.positions[mesh.triangleIndices[index + offset] * 2 + 1],
    ]);
    const area = (points[1][0] - points[0][0]) * (points[2][1] - points[0][1])
      - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
    assert.notEqual(area, 0);
  }
  assert.deepEqual(fixtures, snapshot);
  const repeat = meshCore.buildGpuMeshFeatures(normalized.map(clone), earcut, { validate: true });
  assert.deepEqual(Array.from(repeat.strokeStartsEnds), Array.from(mesh.strokeStartsEnds));
  assert.deepEqual(repeat.strokeOwnerRanges, mesh.strokeOwnerRanges);
});

test('river partition browser contract is deterministic and non-mutating', () => {
  const clipperContext = vm.createContext({});
  vm.runInContext(read('assets/js/vendor/polygon-clipping.min.js'), clipperContext);
  const donors = [
    { countryId: 'donor-a', geometryRevision: 1, geometry: { type: 'Polygon', coordinates: [ring(0, 0, 10, 10)] } },
    { countryId: 'donor-b', geometryRevision: 1, geometry: { type: 'MultiPolygon', coordinates: [[ring(20, 0, 30, 10)], [ring(40, 0, 41, 1)]] } },
  ];
  const riverFeatures = [
    { type: 'Feature', id: 'vertical', geometry: { type: 'LineString', coordinates: [[5, -1], [5, 11]] } },
    { type: 'Feature', id: 'horizontal', geometry: { type: 'LineString', coordinates: [[-1, 5], [11, 5]] } },
    { type: 'Feature', id: 'dangling', geometry: { type: 'LineString', coordinates: [[5, 5], [6, 6]] } },
  ];
  const snapshotDonors = clone(donors);
  const snapshotRivers = clone(riverFeatures);
  const first = partitions.buildRiverTerritoryPartitions({ donors, riverFeatures, clipper: clipperContext.polygonClipping, hydroRevision: 'contract' });
  const second = partitions.buildRiverTerritoryPartitions({ donors: clone(donors), riverFeatures: clone(riverFeatures), clipper: clipperContext.polygonClipping, hydroRevision: 'contract' });
  assert.equal(first.diagnostics.algorithmRevision, 'river-partitions-v2');
  assert.deepEqual(first.donorResults, second.donorResults);
  assert.deepEqual(first.candidates.map(candidate => candidate.key), second.candidates.map(candidate => candidate.key));
  assert.deepEqual(first.candidates.map(candidate => candidate.geometry), second.candidates.map(candidate => candidate.geometry));
  assert.ok(first.candidates.length >= 4);
  assert.deepEqual(donors, snapshotDonors);
  assert.deepEqual(riverFeatures, snapshotRivers);
});

test('GIS contract test sources stay worker-safe and do not revive removed paths', () => {
  const workerSources = [
    read('assets/js/workers/geographic-boundary-core.js'),
    read('assets/js/workers/gis-geometry-worker.js'),
    read('assets/js/workers/gpu-mesh-core.js'),
  ].join('\n');
  assert.doesNotMatch(workerSources, /document\.|window\.|getContext\(|activeProjection\(|state\.view/);
  const productionSources = [
    read('assets/js/modules/geographic-boundary.js'),
    read('assets/js/modules/river-territory-partition.js'),
    workerSources,
  ].join('\n');
  assert.doesNotMatch(productionSources, /gpu-state-scope|selection-coverage|annex-source-v1|frontier-pocket/);
  assert.match(read('assets/js/workers/geographic-boundary-core.js'), /180/);
  assert.match(read('assets/js/modules/geographic-boundary.js'), /atPole|atDateLine/);
});
