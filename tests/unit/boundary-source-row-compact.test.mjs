import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { boundarySourceSegments, prepareBoundaryFeature, createPreparedBoundaryStore,
  buildBoundaryTopologyFromSegments, buildCountrySharedBoundarySegments } from "../../shared/frontend/js/modules/boundary-topology.js";
import { computeCountrySharedContacts } from "../../shared/frontend/js/modules/country-contact-core.js";

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
