import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadClassic(relativePath, globalName) {
  const filePath = path.join(root, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
  const value = globalThis[globalName];
  if (!value) throw new Error(`${globalName} was not initialized`);
  return value;
}

const earcut = loadClassic('assets/js/vendor/earcut.min.js', 'earcut');
const meshCore = loadClassic('assets/js/workers/gpu-mesh-core.js', 'PandoLabGpuMeshCore');

const square = (id, x) => ({
  type: 'Feature',
  id,
  properties: { name: id },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0],
    ]],
  },
});

test('GPU mesh worker packets include stable contiguous country stroke owner ranges', () => {
  const mesh = meshCore.buildGpuMeshFeatures([
    square('AAA', 0),
    square('BBB', 3),
  ], earcut, { validate: true });

  assert.ok(mesh.strokeStartsEnds instanceof Float32Array);
  assert.equal(mesh.strokeStartsEnds.length, mesh.lineIndices.length * 2);
  const firstCount = mesh.strokeOwnerRanges.AAA.count;
  const secondCount = mesh.strokeOwnerRanges.BBB.count;
  assert.ok(firstCount > 4, 'source boundary must gain subdivision vertices');
  assert.equal(firstCount, secondCount);
  assert.deepEqual(mesh.strokeOwnerRanges, {
    AAA: { first: 0, count: firstCount },
    BBB: { first: firstCount, count: secondCount },
  });
  assert.equal(mesh.countryTriangleRanges[0], 0);
  assert.ok(mesh.countryTriangleRanges[1] > 0);
  assert.equal(mesh.countryTriangleRanges[2], mesh.countryTriangleRanges[1]);
  assert.equal(mesh.countryTriangleRanges[3], mesh.countryTriangleRanges[1]);
  assert.deepEqual(Array.from(mesh.countryBoundaryRanges),
    [0, firstCount * 2, firstCount * 2, secondCount * 2]);
  assert.deepEqual(Array.from(mesh.countryBounds), [
    0, 0, 1_000_000, 1_000_000,
    3_000_000, 0, 4_000_000, 1_000_000,
  ]);
  assert.deepEqual(Array.from(mesh.countryBoundsFlags), [0, 0]);

  for (const [id, range] of Object.entries(mesh.strokeOwnerRanges)) {
    const countryIndex = mesh.countryIds.indexOf(id);
    assert.ok(countryIndex >= 0);
    for (let segment = range.first; segment < range.first + range.count; segment += 1) {
      const startIndex = mesh.lineIndices[segment * 2];
      const endIndex = mesh.lineIndices[segment * 2 + 1];
      assert.equal(mesh.countryIndices[startIndex], countryIndex);
      assert.equal(mesh.countryIndices[endIndex], countryIndex);
      assert.deepEqual(
        Array.from(mesh.strokeStartsEnds.slice(segment * 4, segment * 4 + 4)),
        [
          mesh.positions[startIndex * 2] * 1e-6,
          mesh.positions[startIndex * 2 + 1] * 1e-6,
          mesh.positions[endIndex * 2] * 1e-6,
          mesh.positions[endIndex * 2 + 1] * 1e-6,
        ],
      );
    }
  }
});

test('GPU mesh metadata represents date-line countries as wrapped longitude bounds', () => {
  const feature = {
    type: 'Feature',
    id: 'DATE',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [179, -1], [-179, -1], [-179, 1], [179, 1], [179, -1],
      ]],
    },
  };
  const mesh = meshCore.buildGpuMeshFeatures([feature], earcut, { validate: true });
  assert.deepEqual(Array.from(mesh.countryBounds), [179_000_000, -1_000_000, -179_000_000, 1_000_000]);
  assert.equal(mesh.countryBoundsFlags[0] & meshCore.COUNTRY_BOUNDS_FLAG_DATELINE, 1);
  assert.equal(mesh.countryTriangleRanges.length, 2);
  assert.equal(mesh.countryBoundaryRanges.length, 2);
});

const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

function assertBoundaryEdgesBelongToFill(mesh) {
  const fillEdges = new Set();
  for (let i = 0; i < mesh.triangleIndices.length; i += 3) {
    const [a, b, c] = mesh.triangleIndices.slice(i, i + 3);
    for (const [start, end] of [[a, b], [b, c], [c, a]]) fillEdges.add(edgeKey(start, end));
  }
  for (let i = 0; i < mesh.lineIndices.length; i += 2) {
    const a = mesh.lineIndices[i], b = mesh.lineIndices[i + 1];
    assert.ok(fillEdges.has(edgeKey(a, b)), `outline ${i / 2} must be an edge of a fill triangle`);
    assert.deepEqual(Array.from(mesh.strokeStartsEnds.slice(i * 2, i * 2 + 4)), [
      Math.fround(mesh.positions[a * 2] * 1e-6), Math.fround(mesh.positions[a * 2 + 1] * 1e-6),
      Math.fround(mesh.positions[b * 2] * 1e-6), Math.fround(mesh.positions[b * 2 + 1] * 1e-6),
    ]);
  }
}

test('canonical and preview country boundary chains track refined fill edges', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [8, 0], [8, 5], [0, 5], [0, 0]]] };
  const before = structuredClone(geometry);
  for (const maxEdgeDegrees of [0.499, 2]) {
    const mesh = meshCore.buildGpuMeshFeatures([{ id: 'WIDE', geometry }], earcut,
      { validate: true, maxEdgeDegrees });
    assert.ok(mesh.lineIndices.length > 8, 'long source edges must be subdivided');
    assert.ok(mesh.stats.maxEdgeDegrees <= maxEdgeDegrees + 1e-9);
    assertBoundaryEdgesBelongToFill(mesh);
    assert.deepEqual(mesh.strokeOwnerRanges.WIDE, { first: 0, count: mesh.lineIndices.length / 2 });
  }
  assert.deepEqual(geometry, before, 'display refinement must preserve source geometry');
});

test('holes and dateline outlines follow fill while artificial polar edges remain hidden', () => {
  const ring = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  const geometries = [
    { type: 'Polygon', coordinates: [ring(0, 0, 8, 6), ring(2, 2, 4, 4).reverse()] },
    { type: 'Polygon', coordinates: [[[179, -1], [-179, -1], [-179, 1], [179, 1], [179, -1]]] },
    { type: 'Polygon', coordinates: [[[-180, 80], [-90, 80], [0, 80], [90, 80],
      [180, 80], [180, 90], [-180, 90], [-180, 80]]] },
  ];
  for (const [index, geometry] of geometries.entries()) {
    const mesh = meshCore.buildGpuMeshFeatures([{ id: String(index), geometry }], earcut, { validate: true });
    assert.ok(mesh.lineIndices.length > 0);
    assertBoundaryEdgesBelongToFill(mesh);
    if (index === 2) for (let i = 0; i < mesh.strokeStartsEnds.length; i += 4) {
      assert.ok(Math.abs(mesh.strokeStartsEnds[i + 1]) < 90);
      assert.ok(Math.abs(mesh.strokeStartsEnds[i + 3]) < 90);
    }
  }
});

test('Argentina outlines follow the surviving fill after packed sliver removal', () => {
  const countries = JSON.parse(fs.readFileSync(path.join(root,
    'assets/data/territorial-entities/generated/current-world.geojson'), 'utf8'));
  const feature = countries.features.find(row => row.id === 'ARG');
  const before = structuredClone(feature.geometry);
  const mesh = meshCore.buildGpuMeshFeatures([feature], earcut, { validate: true });
  assert.ok(mesh.stats.removedDegenerateTriangleCount > 0, 'exercise packed triangle removal');
  assertBoundaryEdgesBelongToFill(mesh);
  const nearBorder = [];
  for (let i = 0; i < mesh.lineIndices.length; i += 2) {
    const a = mesh.lineIndices[i], b = mesh.lineIndices[i + 1];
    const ax = mesh.positions[a * 2] * 1e-6, ay = mesh.positions[a * 2 + 1] * 1e-6;
    const bx = mesh.positions[b * 2] * 1e-6, by = mesh.positions[b * 2 + 1] * 1e-6;
    if (Math.abs(ay + 22) < 0.01 && Math.abs(by + 22) < 0.01
      && Math.min(ax, bx) >= -63.64 && Math.max(ax, bx) <= -63.01) nearBorder.push(Math.abs(bx - ax));
  }
  assert.ok(nearBorder.reduce((sum, width) => sum + width, 0) > 0.62,
    'the failed border must remain covered by the final outline');
  assert.deepEqual(feature.geometry, before, 'packing must preserve canonical source geometry');
});
