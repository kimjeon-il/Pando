import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import '../../helpers/spherical-core.mjs';
await import('../../../src/geometry/polygon-geometry.js');
await import('../../../src/rendering/workers/gpu-mesh-core.js');
import * as validation from '../../../src/geometry/geometry-validation.js';
import { buildTopologyPreview } from '../../../tools/gis/preview-topology.mjs';

const core = globalThis.PandoLabSphericalCore;
const adapter = globalThis.PandoLabPolygonGeometry;
const validateClippedGeometry = feature => validation.validateGeometry(feature, {clipped:true});
const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/clipped-positive-ring.json', import.meta.url), 'utf8'));
const geometry = ring => ({ type: 'Polygon', coordinates: [ring] });
const exact = fixture.exactTarget[0];
const ordinary = [[0,0],[0,2],[2,2],[2,0],[0,0]];
const vertices = ring => ring.slice(0,-1).map(point => JSON.stringify(point)).sort();

test('clipped positive input-double triangle survives without a precision discard or moved vertex', () => {
  const input = geometry(exact), snapshot = JSON.stringify(input), events = [];
  const output = adapter.normalizeClippedPolygonGeometry(input, { onPrecisionDiscard: row => events.push(row) });
  assert.deepEqual(vertices(output.coordinates[0]), vertices(exact));
  assert.equal(output.coordinates[0].length, exact.length);
  assert.deepEqual(events, []);
  assert.equal(JSON.stringify(input), snapshot);
});

test('clipped narrow quadrilateral remains distinct while source admission stays unchanged', () => {
  const ring = [[1,1],[2,1],[2,1+Number.EPSILON],[1,1+Number.EPSILON],[1,1]];
  const output = core.normalizePolygonGeometry(geometry(ring), true);
  assert.deepEqual(vertices(output.coordinates[0]), vertices(ring));
  assert.throws(() => core.normalizePolygonGeometry(geometry(ring), false), /INVALID_POLYGON/);
  assert.throws(() => core.normalizePolygonGeometry(geometry(exact), false), /INVALID_POLYGON/);
});

test('source admission still rejects the captured positive triangle independently of generated success', () => {
  assert.throws(() => core.normalizePolygonGeometry(geometry(exact), false), /INVALID_POLYGON/);
});

for (const [name, ring] of [
  ['zero area', [[0,0],[1,1],[2,2],[0,0]]],
  ['self crossing', [[0,0],[2,2],[0,2],[2,0],[0,0]]],
  ['nonzero self crossing', [[0,0],[3,2],[0,2],[2,0],[0,0]]],
  ['retraced edge', [[0,0],[2,0],[1,0],[1,1],[0,0]]],
  ['self-crossing open walk', [[0,0],[0,1],[1,0],[1,1]]],
]) test(`exact clipped admission rejects ${name}`, () => {
  assert.throws(() => core.normalizePolygonGeometry(geometry(ring), true), /INVALID_POLYGON/);
});

test('ordinary source and clipped geometry retain the existing output', () => {
  assert.deepEqual(core.normalizePolygonGeometry(geometry(ordinary), true),
    core.normalizePolygonGeometry(geometry(ordinary), false));
});

test('clipped normalization closes a valid open triangle exactly while validation rejects open stored rings', () => {
  const open = [[0,0],[0,1],[1,0]];
  const output = core.normalizePolygonGeometry(geometry(open), true);
  assert.equal(output.coordinates[0].length, 4);
  assert.deepEqual(output.coordinates[0][0], output.coordinates[0].at(-1));
  assert.deepEqual(vertices(output.coordinates[0]), open.map(point=>JSON.stringify(point)).sort());
  assert.ok(core.validateClippedTerritorialRing(open).some(issue=>issue.kind==='invalid-geometry'||issue.kind==='open-ring'));
});

test('five-vertex source pair reproduces the same positive component without changing Boolean coordinates', () => {
  const before = JSON.stringify([fixture.left, fixture.right]);
  for (const polygon of [fixture.left, fixture.right]) core.normalizePolygonGeometry({type:'Polygon',coordinates:polygon},false);
  const raw = core.polygonOperation('difference', [[fixture.left],[fixture.right]], false);
  assert.ok(raw.some(polygon => JSON.stringify(polygon) === JSON.stringify(fixture.exactTarget)));
  assert.equal(JSON.stringify([fixture.left, fixture.right]), before);
  const rawTriangle = raw.find(polygon => JSON.stringify(polygon) === JSON.stringify(fixture.exactTarget));
  assert.deepEqual(vertices(core.normalizePolygonGeometry({type:'Polygon',coordinates:rawTriangle},true).coordinates[0]), vertices(exact));
});

test('generated ring validation and winding use exact contract without changing source validation', () => {
  assert.deepEqual(core.validateClippedTerritorialRing(exact), []);
  assert.ok(core.validateTerritorialRing(exact).length > 0);
  const normalized = core.normalizePolygonGeometry(geometry(exact), true);
  assert.equal(core.hasCanonicalClippedPolygonWinding(normalized), true);
  assert.equal(core.hasCanonicalPolygonWinding(normalized), false);
  assert.equal(core.validateClippedGisGeometry([normalized.coordinates]), true);
  assert.equal(core.validateGisGeometry([normalized.coordinates]), false);
});

test('native display mesh triangulates the exact triangle and does not mutate canonical data', () => {
  const before = JSON.stringify(exact);
  const normalized = core.normalizePolygonGeometry(geometry(exact), true);
  const mesh = core.polygonBuildFillMesh(normalized.coordinates, 0.5, true, null);
  assert.equal(mesh.geographic.length, 3);
  assert.deepEqual(mesh.geographic.map(JSON.stringify).sort(), vertices(exact));
  assert.equal(mesh.triangles.length, 3);
  assert.equal(mesh.boundaryChains[0].vertices.length, 3);
  assert.deepEqual(mesh.removedTriangles, []);
  assert.equal(JSON.stringify(exact), before);
});

test('generated preview validation restores and retains the tiny component beside ordinary land', () => {
  const feature = {type:'Feature',id:'EXACT',properties:{},geometry:{type:'MultiPolygon',coordinates:[[ordinary],[exact]]}};
  const before = JSON.stringify(feature);
  const preview = buildTopologyPreview([feature], {
    maxCoordinates:100, proportions:[0],
    normalizeGeometry:adapter.normalizeClippedPolygonGeometry,
    hasCanonicalWinding:adapter.hasCanonicalClippedPolygonWinding,
    validateGeometry:validateClippedGeometry,
  });
  assert.equal(preview.features[0].geometry.coordinates.length, 2);
  assert.deepEqual(vertices(preview.features[0].geometry.coordinates[1][0]), vertices(exact));
  assert.equal(JSON.stringify(feature), before);
});

test('subpixel display reduction does not remove the canonical component or its coordinates', () => {
  const normalized = core.normalizePolygonGeometry({type:'MultiPolygon',coordinates:[[ordinary],[exact]]}, true);
  const feature = {type:'Feature',id:'EXACT',properties:{},geometry:normalized};
  const before = JSON.stringify(feature);
  const engine = globalThis.PandoLabGpuMeshCore;
  engine.setSharedCore(core);
  const mesh = engine.buildGpuMeshFeatures([feature], {validate:true});
  assert.ok(mesh.triangleIndices.length > 0, 'ordinary land remains visible');
  assert.ok(mesh.stats.removedDegenerateTriangleCount > 0, 'only the display derivative has collapsed primitives');
  assert.equal(JSON.stringify(feature), before);
  assert.equal(feature.geometry.coordinates.length, 2);
});

const currentCaptured = JSON.parse(fs.readFileSync(new URL('../../fixtures/clipped-positive-current-rings.json', import.meta.url), 'utf8'));
assert.equal(currentCaptured.fragments.length, 14);
for (const {componentIndex, polygon} of currentCaptured.fragments)
test(`current native fragment ${componentIndex} preserves exact vertices without spending the discard budget`, () => {
  const input = {type:'Polygon',coordinates:polygon}, before = JSON.stringify(input), audit = [];
  assert.throws(() => core.normalizePolygonGeometry(input, false), /INVALID_POLYGON/);
  const normalized = adapter.normalizeClippedPolygonGeometry(input, {onPrecisionDiscard:row=>audit.push(row)});
  assert.equal(normalized.type, 'Polygon');
  assert.equal(normalized.coordinates.length, polygon.length);
  assert.deepEqual(vertices(normalized.coordinates[0]), vertices(polygon[0]));
  assert.equal(normalized.coordinates[0].length, polygon[0].length);
  assert.deepEqual(audit, []);
  assert.equal(core.hasCanonicalClippedPolygonWinding(normalized), true);
  assert.deepEqual(core.validateClippedTerritorialRing(normalized.coordinates[0]), []);
  assert.equal(core.validateClippedGisGeometry([normalized.coordinates]), true);
  assert.equal(JSON.stringify(input), before);
});
