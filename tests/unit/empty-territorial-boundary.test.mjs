import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTerritorialInternalBoundarySegments } from '../../assets/js/modules/boundary-topology.js';

test('no polygon units never inspect canonical country geometry', () => {
  const countries = [{ get geometry() { throw new Error('must not inspect countries'); } }];
  assert.deepEqual(buildTerritorialInternalBoundarySegments(countries, []), []);
  assert.deepEqual(buildTerritorialInternalBoundarySegments(countries, [{ geometry: { type: 'Point', coordinates: [0, 0] } }]), []);
});

const polygon = (id, coordinates, properties = {}) => ({
  type: 'Feature',
  id,
  properties,
  geometry: { type: 'Polygon', coordinates: [coordinates] },
});

const country = (id = 'A') => polygon(id, [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], { entityKind: 'general', parentId: '' });
const leftUnit = (id, properties) => polygon(id, [[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]], properties);
const rightUnit = (id, properties) => polygon(id, [[2, 0], [4, 0], [4, 4], [2, 4], [2, 0]], properties);
const internalSegments = (countries, units) => buildTerritorialInternalBoundarySegments(countries, units)
  .filter(segment => segment.a[0] === 2 && segment.b[0] === 2);

test('general children with the same root preserve both owners and use the short dashed boundary style', () => {
  const segments = internalSegments([country()], [
    leftUnit('left', { entityKind: 'general', parentId: 'A' }),
    rightUnit('right', { entityKind: 'general', parentId: 'A' }),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].styleType, 'subunit-internal');
  assert.deepEqual(segments[0].unitOwners, [
    { id: 'left', entityKind: 'general', rootId: 'A' },
    { id: 'right', entityKind: 'general', rootId: 'A' },
  ]);
});

test('a one-sided general perimeter inside its root uses the same short dashed style', () => {
  const segments = internalSegments([country()], [
    leftUnit('left', { entityKind: 'general', parentId: 'A' }),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].styleType, 'subunit-internal');
});

test('valid cross-root general edges are left to the country boundary renderer', () => {
  const countries = [country('A'), country('B')];
  const segments = internalSegments(countries, [
    leftUnit('left', { entityKind: 'general', parentId: 'A' }),
    rightUnit('right', { entityKind: 'general', parentId: 'B' }),
  ]);
  assert.deepEqual(segments, []);
});

test('independent regional styling needs no country association and missing parents fail visibly', () => {
  const regionSegments = internalSegments([country()], [
    leftUnit('left', { entityKind: 'general', parentId: 'A' }),
    rightUnit('right', { entityKind: 'regional', parentId: '' }),
  ]);
  assert.equal(regionSegments.length, 1);
  assert.equal(regionSegments[0].styleType, 'region');

  assert.throws(() => internalSegments([country()], [
    leftUnit('invalid', { entityKind: 'general', parentId: 'missing' }),
  ]), /부모/);
});

test('country exteriors are not duplicated by territorial boundary segments', () => {
  assert.deepEqual(buildTerritorialInternalBoundarySegments([country()], [
    polygon('whole', [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], { entityKind: 'general', parentId: 'A' }),
  ]), []);
});
