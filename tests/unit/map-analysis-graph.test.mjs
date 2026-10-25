import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedCalculationCore as core } from "../../shared/frontend/js/modules/temporal.js";
const calculate = (op, input) => JSON.parse(core.referenceImageCalculate(op, JSON.stringify(input)));
const points = [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.5], [0.7, 0.5]].map(([u, v], i) =>
  ({ id: String(i), image: [u, v], coordinate: [10 + 20 * u, 50 - 10 * v] }));

test('automatic recommendation needs distributed independent source-pixel cross validation', () => {
  const result = calculate('georefQuality', { points, mode: 'affine', sourceWidth: 1000, sourceHeight: 500 });
  assert.equal(result.recommended, true);
  assert.equal(result.folded, false);
  assert.ok(result.crossValidationP95Pixels < 0.001);
  assert.ok(result.imageCoverage > 0.99);
  const sparse = calculate('georefQuality', { points: points.slice(0, 3), mode: 'affine', sourceWidth: 1000, sourceHeight: 500 });
  assert.equal(sparse.recommended, false);
  assert.equal(sparse.reason, 'insufficient-distributed-controls');
});

test('semantic boundary graph preserves two adjacent faces and a single shared border', () => {
  const w = 21, h = 15, bits = new Uint8Array(w * h), confidence = new Float32Array(w * h).fill(1);
  for (let x = 2; x <= 18; x++) { bits[2 * w + x] = 1; bits[12 * w + x] = 1; }
  for (let y = 2; y <= 12; y++) for (const x of [2, 10, 18]) bits[y * w + x] = 1;
  const graph = core.referenceBoundaryGraph(w, h, bits, confidence, { threshold: 0.55, simplifyTolerance: 0 });
  assert.equal(graph.ok, true);
  assert.equal(graph.faces.length, 2);
  assert.equal(graph.faces[0].touchesImageEdge, false);
  const shared = graph.chains.filter(chain => graph.faces.every(face => face.chainIds.includes(chain.id)));
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].points, Array.from({ length: 11 }, (_, i) => [10, i + 2]));
});

test('open lines and text-only masks never turn into invented polygons', () => {
  const w = 12, h = 12, bits = new Uint8Array(w * h), confidence = new Float32Array(w * h).fill(1);
  for (let x = 0; x < w; x++) bits[6 * w + x] = 1;
  bits[3 * w + 3] = 32;
  const graph = core.referenceBoundaryGraph(w, h, bits, confidence, { threshold: 0.55, simplifyTolerance: 0 });
  assert.equal(graph.faces.length, 0);
  assert.equal(graph.chains.length, 1);
  assert.equal(graph.chains[0].touchesImageEdge, true);
  assert.equal(graph.unresolved.length, 2);
});

test('consensus never counts two alternatives for one detected label as independent controls', () => {
  const duplicates = points.slice(0, 3).flatMap((point, i) => [0, 1].map(j => ({ ...point, id: `${i}-${j}`, detectionId: `d${i}`, placeId: `p${i}` })));
  const result = calculate('autoGeoref', { points: duplicates, mode: 'affine', minimumInliers: 6, inlierThresholdMeters: 100 });
  assert.equal(result.ok, false);
});

test('a dangling branch is retained as a line without corrupting its enclosing face', () => {
  const w = 15, bits = new Uint8Array(w * w), confidence = new Float32Array(w * w).fill(1);
  for (let x = 2; x <= 12; x++) bits[2 * w + x] = bits[12 * w + x] = 1;
  for (let y = 2; y <= 12; y++) bits[y * w + 2] = bits[y * w + 12] = 1;
  for (let y = 2; y <= 7; y++) bits[y * w + 7] = 1;
  const graph = core.referenceBoundaryGraph(w, w, bits, confidence, { threshold: .55, simplifyTolerance: 0 });
  assert.equal(graph.faces.length, 1);
  assert.equal(graph.faces[0].ring.some(([x, y]) => x === 7 && y === 7), false);
  assert.equal(graph.unresolved.length, 1);
});

test('projected boundary lines split at the dateline using the shared warp', () => {
  const warp = calculate('warp', { mode: 'affine', points: [{ id: 'a', image: [0, 0], coordinate: [179, 1] }, { id: 'b', image: [1, 0], coordinate: [-179, 1] }, { id: 'c', image: [0, 1], coordinate: [179, 0] }] });
  const graph = { width: 3, height: 3, chains: [{ id: 0, points: [[0, 1], [2, 1]] }], faces: [] };
  const result = calculate('projectBoundaryGraph', { warp, graph });
  assert.equal(result.lines[0].geometry.type, 'MultiLineString');
  assert.deepEqual(result.lines[0].geometry.coordinates, [[[179, .5], [180, .5]], [[-180, .5], [-179, .5]]]);
});

test('nonlinear projection samples the source edge so its curved midpoint is retained', () => {
  const controls = [[0, 0, 10, 40], [1, 0, 20, 40], [1, 1, 20, 30], [0, 1, 10, 30], [.5, .5, 15, 38]]
    .map(([u, v, lon, lat], index) => ({ id: String(index), image: [u, v], coordinate: [lon, lat], pinned: true }));
  const warp = calculate('warp', { points: controls, mode: 'tps' });
  const graph = { width: 101, height: 101, chains: [{ id: 0, points: [[0, 50], [100, 50]] }], faces: [] };
  const result = calculate('projectBoundaryGraph', { warp, graph });
  assert.ok(result.lines[0].geometry.coordinates.some(([lon, lat]) => Math.abs(lon - 15) < 1e-6 && Math.abs(lat - 38) < 1e-6));
});

test('a bridge between nested closed rings preserves the outer annulus and inner region', () => {
  const w = 31, labels = new Uint8Array(w * w), confidence = new Float32Array(w * w).fill(1);
  for (const [low, high] of [[2, 28], [10, 20]]) {
    for (let x = low; x <= high; x++) labels[low * w + x] = labels[high * w + x] = 1;
    for (let y = low; y <= high; y++) labels[y * w + low] = labels[y * w + high] = 1;
  }
  for (let y = 2; y <= 10; y++) labels[y * w + 15] = 1;
  const graph = core.referenceBoundaryGraph(w, w, labels, confidence, { threshold: .55, simplifyTolerance: 0 });
  assert.equal(graph.faces.length, 2);
  assert.equal(graph.faces.reduce((sum, face) => sum + face.holes.length, 0), 1);
});

test('short aligned dashed gaps need matching semantics and avoid text or transport confusion', () => {
  const w = 30, h = 12, labels = new Uint8Array(w * h), confidence = new Float32Array(w * h).fill(.3);
  for (let x = 2; x <= 11; x++) { labels[6 * w + x] = 1;confidence[6 * w + x] = .9; }
  for (let x = 15; x <= 26; x++) { labels[6 * w + x] = 1;confidence[6 * w + x] = .9; }
  const connected = core.referenceBoundaryGraph(w, h, labels, confidence, { threshold: .55, simplifyTolerance: 0 });
  assert.equal(connected.chains.length, 1);
  assert.ok(connected.unresolved.some(row => row.reason === 'inferred-dash-gap'));
  labels[6 * w + 13] = 32;
  const obscured = core.referenceBoundaryGraph(w, h, labels, confidence, { threshold: .55, simplifyTolerance: 0 });
  assert.equal(obscured.chains.length, 2);
});

test('editing source-pixel chains rebuilds faces and leaves the original graph unchanged', () => {
  const graph = { ok: true, width: 21, height: 21, chains: [
    { id: 0, points: [[2, 2], [18, 2], [18, 18]], semanticBits: 1, confidence: .9 },
    { id: 1, points: [[18, 18], [2, 18], [2, 2]], semanticBits: 1, confidence: .9 },
  ], faces: [], unresolved: [] };
  const original = structuredClone(graph);
  const closed = calculate('editBoundaryGraph', { graph, command: { type: 'replace', chainId: 0, points: graph.chains[0].points } });
  assert.equal(closed.faces.length, 1);
  const removed = calculate('editBoundaryGraph', { graph, command: { type: 'exclude', chainId: 1 } });
  assert.equal(removed.faces.length, 0);
  assert.equal(removed.chains.length, 1);
  const cut = calculate('editBoundaryGraph', { graph, command: { type: 'cut', chainId: 0, point: [10, 2] } });
  assert.equal(cut.faces.length, 0);
  assert.equal(cut.chains.length, 1);
  assert.equal(cut.unresolved.filter(row => row.reason === 'open-boundary').length, 2);
  assert.deepEqual(graph, original);
  assert.throws(() => calculate('editBoundaryGraph', { graph, command: { type: 'replace', chainId: 0, points: [[0, 0], [18, 18]] } }), /endpoint|접점/i);
});

test('joining reviewed open endpoints closes a face and ignores stale face candidates', () => {
  const graph = { ok: true, width: 21, height: 21, chains: [
    { id: 0, points: [[2, 2], [18, 2], [18, 18], [2, 18]], semanticBits: 1, confidence: .9 },
  ], faces: [{ id: 99, ring: [] }], unresolved: [] };
  const joined = calculate('editBoundaryGraph', { graph, command: { type: 'join', from: { chainId: 0, end: 'start' }, to: { chainId: 0, end: 'end' } } });
  assert.equal(joined.faces.length, 1);
  assert.notEqual(joined.faces[0].id, 99);
});
