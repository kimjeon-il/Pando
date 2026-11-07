import { describe as contractSuite } from 'node:test';
import * as __boundary_dep0 from "node:test";
import * as __boundary_dep1 from "node:assert/strict";
import * as __boundary_dep2 from "../../shared/frontend/js/modules/boundary-lines.js";
import "../helpers/spherical-core.mjs";
import * as __boundary_dep3 from "../../shared/frontend/js/modules/boundary-topology.js";
import * as __boundary_dep4 from "../../shared/frontend/js/modules/country-shared-boundary-packet.js";
import * as __boundary_dep5 from "../../shared/frontend/js/modules/geometry-versions.js";

// Original feature contract: boundary-lines.test.mjs
contractSuite("boundary-lines", () => {
const test = __boundary_dep0.default;
const assert = __boundary_dep1.default;
const { connectBoundarySegments } = __boundary_dep2;




test('short reversed segments form a continuous line for dash spacing', () => {
  const lines = connectBoundarySegments([[[0, 0], [1, 0]], [[2, 0], [1, 0]], [[2, 0], [3, 0]]]);
  assert.deepEqual(lines, [[[0, 0], [1, 0], [2, 0], [3, 0]]]);
});
test('junctions and disconnected boundaries stay separate', () => {
  const lines = connectBoundarySegments([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[1, 0], [1, 1]], [[4, 0], [5, 0]]]);
  assert.equal(lines.length, 4);
  assert.equal(lines.reduce((sum, line) => sum + line.length - 1, 0), 4);
});
test('binary half-grid and signed-zero junctions match the shared C++ rule', () => {
  const lines = connectBoundarySegments([
    [[0.00390625, 0], [1, 0]],
    [[0.0039063, 0], [2, 0]],
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 3);
  assert.deepEqual(connectBoundarySegments([]), []);
});

test('closed boundaries preserve every segment', () => {
  const lines = connectBoundarySegments([[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 0]]]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 4);
  assert.deepEqual(lines[0][0], lines[0].at(-1));
});
});

// Original feature contract: boundary-topology-split.test.mjs
contractSuite("boundary-topology-split", () => {
const test = __boundary_dep0.default;
const assert = __boundary_dep1.default;
const { buildBoundaryTopologyFromSegments } = __boundary_dep3;





const raw = (featureId, segmentIndex, a, b) => ({
  featureId, polygonIndex: 0, ringIndex: 0,
  segmentIndex, endVertexIndex: segmentIndex + 1,
  a, b, interiorSide: 1,
});

test('compiled C++ splits a long shared edge against uneven neighboring vertices', () => {
  const source = [
    raw('A',0,[0,0],[2,0]), raw('B',0,[2,0],[1,0]),
    raw('B',1,[1,0],[0,0]),
  ];
  const before = structuredClone(source);
  const topology = buildBoundaryTopologyFromSegments(source);
  const shared = [...topology.segments.values()].filter(segment => segment.kind === 'shared');
  assert.equal(shared.length, 2);
  assert.ok(shared.every(segment => [...segment.ownerIds].sort().join('|') === 'A|B'));
  assert.deepEqual(shared.map(segment => [segment.a,segment.b]), [
    [[0,0],[1,0]], [[1,0],[2,0]],
  ]);
  const joint = topology.nodes.get('1,0');
  assert.deepEqual([...joint.ownerIds], ['B','A']);
  assert.equal(joint.virtualRefs.length, 1);
  assert.equal(joint.virtualRefs[0].featureId,'A');
  assert.equal(joint.virtualRefs[0].t,.5);
  assert.deepEqual(source,before);
});
test('a short dateline edge cannot share the long route through Greenwich',()=>{
  const source = [
    raw('L',0,[-179,20],[179,20]),
    raw('R',0,[-179,20],[0,20]),
    raw('R',1,[0,20],[179,20]),
  ];
  const topology=buildBoundaryTopologyFromSegments(source);
  const shared=[...topology.segments.values()].filter(segment=>segment.kind==='shared');
  assert.equal(shared.length,0);
  assert.ok(topology.nodes.get('0,20').virtualRefs.every(ref=>ref.featureId!=='L'));
});
test('the compiled candidate scan respects custom precision and epsilon',()=>{
  const source=[raw('A',0,[0,0],[1,0]),raw('B',0,[1,0],[0,0])];
  const topology=buildBoundaryTopologyFromSegments(source,{precision:5,epsilon:1e-7});
  assert.equal(topology.precision,5);
  assert.equal([...topology.segments.values()].filter(s=>s.kind==='shared').length,1);
  assert.deepEqual(buildBoundaryTopologyFromSegments([],{}).segments.size,0);
});
});

// Original feature contract: shared-edge-singleton.test.mjs
contractSuite("shared-edge-singleton", () => {
const test = __boundary_dep0.default;
const assert = __boundary_dep1.default;
const { createCountrySharedBoundaryState, prepareCountrySharedBoundaryPacket } = __boundary_dep4;
const { serializeCountrySharedBoundarySegments, buildCountrySharedBoundarySegments } = __boundary_dep3;
const { geometryRevisionKey } = __boundary_dep5;







const rectangle = (id, west, south, east, north) => {
  const geometry = { type: 'Polygon',
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
  return { id, geometry, boundaryRootId: id,
    boundaryGeometryRevision: geometryRevisionKey(geometry) };
};
const rows = () => [
  rectangle('A', 0, 0, 1, 1),
  rectangle('B', 1, 0, 2, 1),
  rectangle('C', 1, 0, 2, 1),
  rectangle('D', 20, 0, 21, 1),
  rectangle('E', 21, 0, 22, 1),
];
const canonical = state => serializeCountrySharedBoundarySegments(state.segments());

test('coincident contributions promote one edge to a merged multi-contact result and demote on removal', () => {
  const state = createCountrySharedBoundaryState();
  const features = rows();
  state.replace(features);
  const merged = state.segments().find(segment => segment.ownerIds.length === 3);
  assert.ok(merged, 'A-B and A-C coincide and must merge all three owners');
  assert.deepEqual(merged.ownerIds, ['A', 'B', 'C']);
  assert.deepEqual([...new Set(merged.refs.map(row => row.featureId))].sort(), ['A', 'B', 'C']);
  const independent = state.segments().find(segment => segment.ownerIds.includes('D'));
  const independentPrepared = state.preparedStore.get('D');
  assert.ok(independent);

  state.patch([], ['A']);
  assert.strictEqual(state.preparedStore.get('D'), independentPrepared);
  assert.strictEqual(state.segments().find(segment => segment.ownerIds.includes('D')), independent,
    'unaffected edge must preserve identity');
  assert.ok(state.segments().some(segment => segment.ownerIds.join('|') === 'B|C'));
  assert.ok(state.segments().every(segment => !segment.refs.some(ref => ref.featureId === 'A')),
    'removed contact must not retain obsolete source references');

  state.patch([], ['C']);
  assert.deepEqual(state.segments().map(segment => segment.ownerIds), [['D', 'E']],
    'last single-contact B-C contributions must be fully removed without ghost edges');
  state.patch([features[0], features[2]]);
  assert.ok(state.segments().some(segment => segment.ownerIds.join('|') === 'A|B|C'));
  const current = canonical(state);
  const expected = createCountrySharedBoundaryState();
  expected.replace(features);
  // Patch preserves surviving D/E edge identity and Map insertion order;
  // fresh replace may enumerate A/B/C before D/E. Compare canonical geometry,
  // not the unrelated contact insertion order.
  const sortSegments = values => [...values].map(JSON.stringify).sort();
  assert.deepEqual(sortSegments(current), sortSegments(canonical(expected)),
    'recreated contact geometry matches a fresh full replace');
});

test('cached shared segments hydrate to the same output when one and multiple owners coincide', () => {
  const features = rows();
  const expected = createCountrySharedBoundaryState();
  expected.replace(features);
  const cache = serializeCountrySharedBoundarySegments(buildCountrySharedBoundarySegments(features));
  const seeded = createCountrySharedBoundaryState();
  seeded.replace(features, { cachedSegments: cache, changedIds: new Set() });
  assert.deepEqual(canonical(seeded), canonical(expected));
  assert.equal(seeded.stats().contactComputationCount, 0);
  const packet = prepareCountrySharedBoundaryPacket(seeded.segments(), seeded.features(),
    { preparedStore: seeded.preparedStore });
  const freshPacket = prepareCountrySharedBoundaryPacket(expected.segments(), expected.features(),
    { preparedStore: expected.preparedStore });
  assert.deepEqual(packet.ownerIds, freshPacket.ownerIds);
  assert.deepEqual(packet.ownerRanges, freshPacket.ownerRanges);
  assert.deepEqual(packet.segments, freshPacket.segments);
  assert.deepEqual(Array.from(packet.startsEnds), Array.from(freshPacket.startsEnds));
  assert.deepEqual(packet.outlineOverrides.segments, freshPacket.outlineOverrides.segments);
});

test('unmodified singleton contact metadata and prepared geometry survive irrelevant patches', () => {
  const features = rows();
  const state = createCountrySharedBoundaryState();
  state.replace(features.slice(0, 2));
  const segment = state.segments()[0];
  const before = state.stats();
  assert.deepEqual(segment.ownerIds, ['A', 'B']);
  state.patch([rectangle('X', 50, 50, 51, 51)]);
  assert.strictEqual(state.segments()[0], segment);
  assert.equal(state.stats().contactCount, before.contactCount);
  state.patch([], ['X']);
  assert.strictEqual(state.segments()[0], segment);
  state.replace(features.slice(0, 2));
  assert.strictEqual(state.segments()[0], segment);
});
});
