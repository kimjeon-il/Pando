import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import '../../helpers/spherical-core.mjs';
await import('../../../src/geometry/polygon-geometry.js');
await import('../../../src/rendering/workers/gpu-mesh-core.js');

const core = globalThis.PandoLabSphericalCore;
const adapter = globalThis.PandoLabPolygonGeometry;
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

// Generated data may retain exact zero-length steps. This is not source ingress.
const repeatedBoundary = [[0,0],[0,0],[0,2],[0,2],[2,2],[2,0],[0,0],[0,0]];
test('generated zero-length edges preserve all original coordinates and strict source diagnostics', () => {
  assert.ok(core.validateTerritorialRing(repeatedBoundary).some(issue=>issue.kind==='duplicate-vertex'));
  for (let rotation=0;rotation<repeatedBoundary.length-1;rotation++) {
    const points=repeatedBoundary.slice(0,-1),ring=[...points.slice(rotation),...points.slice(0,rotation)];ring.push(ring[0]);
    const input=geometry(ring),before=JSON.stringify(input),events=[];
    assert.deepEqual(core.validateClippedTerritorialRing(ring),[]);
    assert.equal(core.validateClippedGisGeometry([input.coordinates]),true);
    assert.deepEqual(adapter.normalizeClippedPolygonGeometry(input,{onPrecisionDiscard:row=>events.push(row)}),input);
    assert.deepEqual(events,[]);assert.equal(JSON.stringify(input),before);
  }
});
test('generated normalization retains one-ULP distinct collinear points beside zero-length steps',()=>{
  const ring=[[0,0],[0,2],[2,2],[2,0],[1+Number.EPSILON,0],[1,0],[1,0],[0,0]];
  assert.deepEqual(core.normalizePolygonGeometry(geometry(ring),true),geometry(ring));
});
for(const [name,ring]of [
  ['all zero',[[0,0],[0,0],[0,0],[0,0]]],
  ['two effective vertices',[[0,0],[0,0],[1,0],[1,0],[0,0]]],
  ['nonadjacent self touch',[[0,0],[2,0],[2,0],[0,0],[0,2],[2,2],[0,0]]],
  ['self crossing after duplicate',[[0,0],[0,0],[3,2],[0,2],[2,0],[0,0]]],
])test('generated zero-edge handling still rejects '+name,()=>{
  assert.ok(core.validateClippedTerritorialRing(ring).length);
  assert.throws(()=>core.normalizePolygonGeometry(geometry(ring),true),/INVALID_POLYGON/);
});
test('zero-edge error indices still reference the original ring',()=>{
  const issues=core.validateClippedTerritorialRing([[0,0],[0,0],[2,0],[1,0],[1,1],[0,0]]);
  assert.deepEqual(issues,[{kind:'self-intersection',coordinate:[2,0],segmentIndex:1}]);
});
test('render mesh is unchanged while prepared polygon packet retains zero-edge coordinates and holes',()=>{
  const hole=[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5],[.5,.5]];
  const plain={type:'Polygon',coordinates:[ordinary,hole]},repeated=structuredClone(plain);
  for(const ring of repeated.coordinates){ring.splice(1,0,ring[0]);ring.push(ring.at(-1));}
  const before=JSON.stringify(repeated),engine=globalThis.PandoLabGpuMeshCore;engine.setSharedCore(core);
  const a=engine.buildPolygonGeometryPacket(plain),b=engine.buildPolygonGeometryPacket(repeated);
  for(const key of Object.keys(a).filter(key=>!['ringCoordinates','ringOffsets','polygonOffsets'].includes(key)))assert.deepEqual(b[key],a[key],key);
  assert.deepEqual(Array.from(b.ringCoordinates),repeated.coordinates.flat(2));
  assert.deepEqual(Array.from(b.polygonOffsets),[0,2]);assert.equal(JSON.stringify(repeated),before);
});
