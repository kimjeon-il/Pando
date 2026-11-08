import { describe as contractSuite } from 'node:test';
import "../helpers/spherical-core.mjs";
import * as __boundary_dep0 from "node:test";
import * as __boundary_dep1 from "node:assert/strict";
import * as __boundary_dep2 from "../../src/geometry/boundary-topology.js";
import * as __boundary_dep3 from "../../src/geometry/country-contact-core.js";
import * as __boundary_dep4 from "../../src/geometry/boundary-spatial-index.js";
contractSuite("boundary-source-row-compact", () => {
const test = __boundary_dep0.default;
const assert = __boundary_dep1.default;
const { boundarySourceSegments, prepareBoundaryFeature, createPreparedBoundaryStore, buildBoundaryTopologyFromSegments, buildCountrySharedBoundarySegments } = __boundary_dep2;
const { computeCountrySharedContacts } = __boundary_dep3;






const rectangle = (id, x1, y1, x2, y2) => ({ id, geometry: { type: 'Polygon', coordinates: [[
  [x1,y1], [x2,y1], [x2,y2], [x1,y2], [x1,y1],
]] } });
const sourceOwn = row => ({ featureId: row.featureId, polygonIndex: row.polygonIndex, ringIndex: row.ringIndex,
  segmentIndex: row.segmentIndex, endVertexIndex: row.endVertexIndex, a: row.a, b: row.b,
  interiorSide: row.interiorSide });

test('only Worker-prepared source rows share per-ring metadata; legacy edit source stays complete', () => {
  const feature = { id: 'MULTI', geometry: { type: 'MultiPolygon', coordinates: [
    [
      [[0,0], [3,0], [3,3], [0,3], [0,0]],
      [[1,1], [1,2], [2,2], [2,1], [1,1]],
    ],
    [[[179,0], [181,0], [181,2], [179,2], [179,0]]],
  ] } };
  const legacy = boundarySourceSegments(feature);
  const prepared = prepareBoundaryFeature(feature);
  assert.equal(prepared.segments.length, legacy.length);
  assert.deepEqual(prepared.segments.map(sourceOwn), legacy);
  assert.deepEqual(Object.keys(legacy[0]), ['featureId','polygonIndex','ringIndex','segmentIndex',
    'endVertexIndex','a','b','interiorSide']);
  for (let i = 0; i < legacy.length; i++) {
    const a = prepared.segments[i], b = legacy[i];
    assert.strictEqual(a.a, b.a);
    assert.strictEqual(a.b, b.b);
    assert.equal(Object.hasOwn(a,'featureId'), false);
    assert.equal(Object.hasOwn(a,'ringIndex'), false);
    assert.equal(Object.hasOwn(a,'interiorSide'), false);
    assert.deepEqual(Object.keys(a), ['segmentIndex','endVertexIndex','a','b']);
  }
  assert.strictEqual(Object.getPrototypeOf(prepared.segments[0]), Object.getPrototypeOf(prepared.segments[3]));
  assert.notStrictEqual(Object.getPrototypeOf(prepared.segments[3]), Object.getPrototypeOf(prepared.segments[4]));
  assert.notStrictEqual(Object.getPrototypeOf(prepared.segments[7]), Object.getPrototypeOf(prepared.segments[8]));
  assert.ok(prepared.spatialIndex.query([-1,-1,4,4]).includes(prepared.segments[0]),
    'packed source index returns the exact original compact row object');
  assert.ok(prepared.spatialIndex.query([179.3,-1,179.7,1]).some(edge => edge.polygonIndex === 1));
  assert.deepEqual(feature.geometry, { type:'MultiPolygon', coordinates: feature.geometry.coordinates });
});

test('C++ calculated border output owns all source metadata and preserves original geometry arrays', () => {
  const source = [rectangle('A',0,0,1,1), rectangle('B',1,0,2,1)];
  const preparedStore = createPreparedBoundaryStore();
  preparedStore.replace(source);
  const [left,right] = source.map(x => preparedStore.get(x.id));
  const results = computeCountrySharedContacts([[left,right]]);
  assert.equal(results.length,1);
  assert.equal(results[0].length,1);
  const contact = results[0][0];
  assert.deepEqual(contact.ownerIds,['A','B']);
  assert.equal(contact.refs.length,2);
  for (const ref of contact.refs) {
    const original = preparedStore.get(ref.featureId).segments.find(row =>
      row.polygonIndex === ref.polygonIndex && row.ringIndex === ref.ringIndex
      && row.segmentIndex === ref.segmentIndex);
    assert.ok(original);
    assert.deepEqual(sourceOwn(ref),sourceOwn(original));
    assert.strictEqual(ref.a, original.a);
    assert.strictEqual(ref.b, original.b);
    for(const key of ['featureId','polygonIndex','ringIndex','interiorSide','startT','endT'])
      assert.equal(Object.hasOwn(ref,key),true,'contact ref must materialize '+key);
  }
});

test('prepared compact source topology can materialize old source refs for legacy contact comparison', () => {
  const inputs = [rectangle('L',0,0,1,1),rectangle('R',1,0,2,1)];
  const prepared = inputs.map(prepareBoundaryFeature);
  const rows = prepared.flatMap(row=>row.segments);
  const topo = buildBoundaryTopologyFromSegments(rows);
  const refs = [...topo.segments.values()].flatMap(row=>row.refs);
  assert.ok(refs.length>0);
  for(const ref of refs){
    assert.equal(Object.hasOwn(ref,'featureId'),true);
    assert.equal(Object.hasOwn(ref,'polygonIndex'),true);
    assert.equal(Object.hasOwn(ref,'ringIndex'),true);
    assert.equal(Object.hasOwn(ref,'interiorSide'),true);
  }
  const output = buildCountrySharedBoundarySegments(inputs);
  assert.equal(output.length, 1);
  assert.deepEqual(output[0].ownerIds, ['L','R']);
  assert.deepEqual([output[0].start, output[0].end].sort((a, b) => a[1] - b[1]),
    [[1,0],[1,1]], 'source segment direction is not an output contract');
});
});
contractSuite("boundary-spatial-index-packed", () => {
const test = __boundary_dep0.default;
const assert = __boundary_dep1.default;
const { createBoundarySpatialIndex } = __boundary_dep4;




function fixture() {
  const values = [], boxes = [];
  for (let i = 0; i < 768; i++) {
    values.push(Object.freeze({ id: i }));
    const x = -179 + (i % 80) * 4.1, y = -70 + Math.floor(i / 80) * 13.3;
    const first = [x, y, x + 0.75, y + 0.5];
    boxes.push(i % 13 === 0
      ? [first, [x + 360, y, x + 360.75, y + 0.5]]
      : [first]);
  }
  // The broad phase must preserve antimeridian splitting, large-row fallback,
  // overlapping multi-box membership and numeric-key overflow fallback.
  boxes[0] = [[179, 0, 180, 1], [-180, 0, -179, 1]];
  boxes[1] = [[-180, -90, 180, 90]];
  boxes[2] = [[17.2, 0, 18.1, 1], [17.7, 0, 18.7, 1]];
  boxes[3] = [[32768, 0, 32768.25, 0.25]];
  boxes[4] = [[-32769, 0, -32768.75, 0.25]];
  return { values, boxes };
}
const queries = [
  [178.5, -0.01, -178.5, 1.01],
  [17.0, -0.01, 19, 1.01],
  [-180, -90, 180, 90],
  [32767.9, -0.1, 32768.3, 0.5],
  [-32769.1, -0.1, -32768.5, 0.5],
  [[179, 0, 180, 1], [-180, 0, -179, 1]],
  [1, -90, 2, 90],
  [-999, -999, 999, 999],
];
for (let i = 0; i < 300; i++) {
  const x = -180 + ((i * 79) % 360), y = -88 + ((i * 31) % 174);
  queries.push([x - 0.1, y - 0.05, x + (i % 3) * 2.25, y + (i % 5) * 1.2]);
}

test('packed segment broad phase returns the same identity and ordered candidates as the mutable reference', () => {
  const { values, boxes } = fixture(), before = structuredClone(boxes);
  const dynamic = createBoundarySpatialIndex(), packed = createBoundarySpatialIndex();
  values.forEach((value, i) => dynamic.insert(i, value, boxes[i]));
  assert.equal(packed.loadPacked(values, boxes), true);
  const storage = packed.stats();
  assert.equal(storage.packed, true);
  assert.equal(storage.entries, values.length);
  assert.ok(storage.boxes > values.length);
  assert.ok(storage.postings >= values.length - storage.large);
  assert.ok(storage.typedBytes < 128 * values.length, 'packed numeric storage should be compact per segment');
  assert.deepEqual(boxes, before, 'source bounding boxes must not mutate');
  assert.deepEqual(packed.values(), values);
  for (const bounds of queries) {
    const expected = dynamic.query(bounds), actual = packed.query(bounds);
    assert.deepEqual(actual.map(row => row.id), expected.map(row => row.id), 'candidate order at ' + JSON.stringify(bounds));
    for (let i = 0; i < expected.length; i++) assert.strictEqual(actual[i], expected[i], 'original edge refs must be retained');
  }
  assert.throws(() => packed.insert(0, values[0], boxes[0]), /immutable/);
  assert.throws(() => packed.remove(0), /immutable/);
  assert.throws(() => packed.loadPacked(values, boxes), /fresh/);
});

test('small mutable indexes preserve replace/remove and exact dateline inclusion', () => {
  const index = createBoundarySpatialIndex();
  assert.equal(index.loadPacked(['east', 'west'], [[[178, 0, 179, 1]], [[-179, 0, -178, 1]]]), false);
  assert.deepEqual(index.query([177, -1, -177, 2]), ['east', 'west']);
  index.remove(0);
  assert.deepEqual(index.query([177, -1, -177, 2]), ['west']);
  index.insert(0, 'new-east', [178, 0, 179, 1]);
  assert.deepEqual(index.query([177, -1, -177, 2]), ['new-east', 'west']);
  assert.deepEqual(index.values(), ['west', 'new-east']);
  assert.deepEqual(index.stats(), { packed: false, entries: 2 });
});

test('packed queries work after many lookup epochs and preserve multi-box exact bounds', () => {
  const { values, boxes } = fixture(), index = createBoundarySpatialIndex();
  index.loadPacked(values, boxes);
  for (let i = 0; i < 1500; i++) {
    assert.ok(index.query([179, 0, 180, 1]).includes(values[0]));
    assert.ok(index.query([-180, 0, -179, 1]).includes(values[0]));
    assert.ok(!index.query([40, 40, 41, 41]).includes(values[0]));
  }
  // A large footprint is returned by narrow queries, but only if its exact
  // original source bounding boxes overlap (no false positive from cell hash).
  assert.ok(index.query([0, 0, 0.25, 0.25]).includes(values[1]));
  assert.ok(!index.query([300, 91, 301, 92]).includes(values[1]));
});

test('packed construction requires matching source rows and never changes an active index', () => {
  const index = createBoundarySpatialIndex();
  assert.throws(() => index.loadPacked([{}], []), /same length/);
  assert.deepEqual(index.values(), []);
  index.insert('A', 'kept', [0, 0, 1, 1]);
  assert.throws(() => index.loadPacked(['replacement'], [[[0, 0, 1, 1]]]), /fresh/);
  assert.deepEqual(index.query([0.5, 0.5, 0.7, 0.7]), ['kept']);
  assert.deepEqual(index.values(), ['kept']);
});
});
