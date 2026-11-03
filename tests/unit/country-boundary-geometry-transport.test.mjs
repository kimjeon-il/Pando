import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryVersionStore } from '../../shared/frontend/js/modules/geometry-version-store.js';
import { createCountryBoundaryGeometryTransport } from '../../shared/frontend/js/modules/country-boundary-geometry-transport.js';
import { touchGeometry } from '../../shared/frontend/js/modules/geometry-versions.js';

const polygon = (west, east) => ({ type: 'Polygon',
  coordinates: [[[west, 0], [east, 0], [east, 1], [west, 1], [west, 0]]] });
const feature = (id, geometry, parentId = '', name = id) => ({
  type: 'Feature', id, geometry,
  properties: { parentId, entityKind: 'general', name },
  boundaryRootId: parentId || id,
});

test('P6-3 sends only certified immutable geometry omissions and preserves all current metadata', () => {
  const immutable = createGeometryVersionStore([
    { id: 'root-geometry', version: 1, geojson: polygon(0, 1) },
    { id: 'child-geometry', version: 1, geojson: polygon(1, 2) },
  ]);
  const root = immutable.get({ id: 'root-geometry', version: 1 });
  const child = immutable.get({ id: 'child-geometry', version: 1 });
  const mutable = polygon(3, 4);
  const transport = createCountryBoundaryGeometryTransport();
  const original = [feature('ROOT', root), feature('CHILD', child, 'ROOT'), feature('OTHER', mutable)];
  const first = transport.planReplace(original);
  assert.equal(first.type, 'replace');
  assert.ok(first.features.every(row => Object.hasOwn(row, 'geometry')));
  assert.equal(transport.acknowledge('worker-ack:1'), true);

  const renamed = [feature('ROOT', root, '', 'Renamed'), feature('CHILD', child, '', 'Reassigned'),
    feature('OTHER', mutable)];
  const next = transport.planReplace(renamed);
  assert.equal(next.type, 'delta');
  assert.equal(next.baseToken, 'worker-ack:1');
  assert.deepEqual(next.removedIds, []);
  assert.ok(!Object.hasOwn(next.features[0], 'geometry'), 'unchanged frozen root sends no coordinates');
  assert.ok(!Object.hasOwn(next.features[1], 'geometry'), 'owner reassignment preserves current hierarchy metadata');
  assert.equal(next.features[1].properties.parentId, '');
  assert.equal(next.features[0].properties.name, 'Renamed');
  assert.strictEqual(next.features[2].geometry, mutable, 'unregistered mutable geometry is never omitted');
  assert.equal(transport.pendingReusedGeometryCount(), 2);

  // An in-flight job may be superseded. Its unacknowledged geometry cannot
  // serve as the base of a subsequent request.
  assert.equal(transport.planReplace(renamed).type, 'replace');
  assert.equal(transport.acknowledge('worker-ack:2'), true);
  const moved = structuredClone(renamed);
  moved[0].geometry.coordinates[0][1][0] += 1e-8;
  const changed = transport.planReplace(moved);
  assert.equal(changed.type, 'replace', 'cloned geometry cannot claim the old immutable provenance');
  assert.equal(transport.acknowledge('worker-ack:3'), true);

  transport.reset();
  assert.equal(transport.planReplace(renamed).type, 'replace', 'Worker restart/rollback must retransmit a full base');
});

test('P6-3 supports removed IDs and trailing insertion but falls back for reorder', () => {
  const store = createGeometryVersionStore([{ id: 'a', version: 1, geojson: polygon(0, 1) }]);
  const a = feature('A', store.get({ id: 'a', version: 1 }));
  const b = feature('B', polygon(2, 3));
  const transport = createCountryBoundaryGeometryTransport();
  transport.planReplace([a, b]);
  transport.acknowledge('ack-1');
  const deletion = transport.planReplace([a]);
  assert.equal(deletion.type, 'delta');
  assert.deepEqual(deletion.removedIds, ['B']);
  assert.equal(deletion.features.length, 1);
  assert.ok(!Object.hasOwn(deletion.features[0], 'geometry'));
  transport.acknowledge('ack-2');
  const addition = transport.planReplace([a, feature('C', polygon(4, 5))]);
  assert.equal(addition.type, 'delta');
  assert.ok(Object.hasOwn(addition.features[1], 'geometry'));
  transport.acknowledge('ack-3');
  assert.equal(transport.planReplace([feature('C', polygon(4, 5)), a]).type, 'replace');
});

test('P6-3 touch revisions and missing acknowledgement force safe full geometry', () => {
  const store = createGeometryVersionStore([{ id: 'a', version: 1, geojson: polygon(0, 1) }]);
  const row = feature('A', store.get({ id: 'a', version: 1 }));
  const transport = createCountryBoundaryGeometryTransport();
  transport.planReplace([row]);
  assert.equal(transport.acknowledge(''), false);
  transport.planReplace([row]);
  transport.acknowledge('ack-2');
  touchGeometry(row.geometry);
  const fresh = transport.planReplace([row]);
  assert.equal(fresh.type, 'replace', 'a new revision may not be declared identical even at the same object address');
});
