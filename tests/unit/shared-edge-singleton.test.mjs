import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCountrySharedBoundaryState, prepareCountrySharedBoundaryPacket,
} from "../../shared/frontend/js/modules/country-shared-boundary-packet.js";
import {
  serializeCountrySharedBoundarySegments, buildCountrySharedBoundarySegments,
} from "../../shared/frontend/js/modules/boundary-topology.js";
import { geometryRevisionKey } from "../../shared/frontend/js/modules/geometry-versions.js";

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
