import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCountrySharedBoundarySegments } from '../../assets/js/modules/boundary-topology.js';
import { prepareCountrySharedBoundaryPacket, visibleCountrySharedSegments, shouldShowSharedCountryBorders, reconcileCountrySharedBoundarySegments } from '../../assets/js/modules/country-shared-boundary-packet.js';
import { countryGeometrySignature, changedCountryGeometryIds } from '../../assets/js/modules/country-shared-boundary-cache.js';

const rectangle = (id, west, south, east, north) => ({
  type: 'Feature', id, properties: {}, geometry: { type: 'Polygon', coordinates: [[
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ]] },
});

test('physical country boundaries contain shared land borders exactly once, without coasts', () => {
  const segments = buildCountrySharedBoundarySegments([
    rectangle('LEFT', 0, 0, 1, 1), rectangle('RIGHT', 1, 0, 2, 1),
    rectangle('ISLAND', 5, 0, 6, 1),
  ]);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].ownerIds, ['LEFT', 'RIGHT']);
  assert.deepEqual([segments[0].start, segments[0].end].sort((a, b) => a[1] - b[1]), [[1, 0], [1, 1]]);
});

test('a deleted neighbor turns a former shared border into a coast', () => {
  const left = rectangle('LEFT', 0, 0, 1, 1);
  const right = rectangle('RIGHT', 1, 0, 2, 1);
  assert.equal(buildCountrySharedBoundarySegments([left, right]).length, 1);
  assert.equal(buildCountrySharedBoundarySegments([left]).length, 0);
  const previous = buildCountrySharedBoundarySegments([left, right]);
  assert.deepEqual(reconcileCountrySharedBoundarySegments(previous, [left], new Set(['RIGHT'])), []);
});

test('a changed country updates only its shared contact and does not reuse stale cache', () => {
  const left = rectangle('LEFT', 0, 0, 1, 1);
  const right = rectangle('RIGHT', 1, 0, 2, 1);
  const island = rectangle('ISLAND', 4, 0, 5, 1);
  const signatures = Object.fromEntries([left, right, island]
    .map(feature => [feature.id, countryGeometrySignature(feature)]));
  const moved = rectangle('RIGHT', 1, 1, 2, 2);
  assert.deepEqual([...changedCountryGeometryIds([left, moved, island], signatures)], ['RIGHT']);
  const previous = buildCountrySharedBoundarySegments([left, right, island]);
  assert.deepEqual(reconcileCountrySharedBoundarySegments(previous, [left, moved, island], new Set(['RIGHT'])), []);
});

test('artificial dateline edges do not become country borders', () => {
  const east = rectangle('EAST', 179, 0, 180, 1);
  const west = rectangle('WEST', 180, 0, 181, 1);
  assert.deepEqual(buildCountrySharedBoundarySegments([east, west]), []);
});

test('physical style alone switches the base border to the shared packet', () => {
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: true, terrainStyle: 'physical' }), true);
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: false, terrainStyle: 'physical' }), false);
  assert.equal(shouldShowSharedCountryBorders({ terrainVisible: true, terrainStyle: 'political' }), false);
});

test('one hidden owner keeps a shared border, while two hidden owners remove it', () => {
  const segments = buildCountrySharedBoundarySegments([
    rectangle('LEFT', 0, 0, 1, 1), rectangle('RIGHT', 1, 0, 2, 1),
  ]);
  const packet = prepareCountrySharedBoundaryPacket(segments);
  assert.equal(packet.preparedGeometry.segmentCount, 1);
  assert.equal(visibleCountrySharedSegments(packet.segments, id => id === 'LEFT').length, 1);
  assert.equal(visibleCountrySharedSegments(packet.segments, () => false).length, 0);
});
