import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLSIBCoast } from '../../tools/gis/lsib-screen-native.mjs';

const cases = JSON.parse(await readFile(new URL('../fixtures/lsib-coast-oracle.json', import.meta.url), 'utf8'));
// GEOS versions may rotate ring starting points, reverse winding, or reorder
// disjoint components. Preserve every coordinate while comparing those forms.
function canonicalRing(ring) {
  assert.deepEqual(ring[0], ring.at(-1));
  const points = ring.slice(0, -1), candidates = [];
  const comparePoint = (a, b) => a[0] - b[0] || a[1] - b[1];
  let minimum = points[0];
  for (const point of points) if (comparePoint(point, minimum) < 0) minimum = point;
  for (let i = 0; i < points.length; i++) if (comparePoint(points[i], minimum) === 0) {
    for (const direction of [1, -1]) {
      const sequence = Array.from({ length: points.length }, (_, n) => points[(i + direction * n + points.length) % points.length]);
      candidates.push(JSON.stringify(sequence));
    }
  }
  return candidates.sort()[0];
}
function canonicalPolygon(polygon) {
  return JSON.stringify([canonicalRing(polygon[0]), ...polygon.slice(1).map(canonicalRing).sort()]);
}
function canonicalGeometry(geometry) {
  if (geometry.type === 'Polygon') return [canonicalPolygon(geometry.coordinates)];
  assert.equal(geometry.type, 'MultiPolygon');
  return geometry.coordinates.map(canonicalPolygon).sort();
}
function assertEquivalent(actual, expected) {
  assert.deepEqual(Object.keys(actual.geometries).sort(), Object.keys(expected.geometries).sort());
  for (const code of Object.keys(expected.geometries))
    assert.deepEqual(canonicalGeometry(actual.geometries[code]), canonicalGeometry(expected.geometries[code]), code);
  assert.deepEqual(actual.sections, expected.sections);
  assert.deepEqual(actual.review, expected.review);
}
test('coast comparison ignores only ring ordering, not coordinate changes', () => {
  const original = {type:'Polygon',coordinates:[[[0,0],[3,0],[3,2],[0,2],[0,0]]]};
  const rotated = {type:'Polygon',coordinates:[[[3,2],[3,0],[0,0],[0,2],[3,2]]]};
  const changed = {type:'Polygon',coordinates:[[[3,2],[3,0],[0,0],[0,2.1],[3,2]]]};
  assert.deepEqual(canonicalGeometry(original), canonicalGeometry(rotated));
  assert.notDeepEqual(canonicalGeometry(original), canonicalGeometry(changed));
});
for (const fixture of cases) test(`coast: ${fixture.name}`, async () => {
  const input = structuredClone(fixture);
  if (fixture.error) await assert.rejects(prepareLSIBCoast(input), { code: 'LSIB_COAST_REJECTED', message: fixture.error });
  else assertEquivalent(await prepareLSIBCoast(input), fixture.expected);
  assert.deepEqual(input, fixture);
});
test('coast exposes an unavailable native binary', async () => {
  await assert.rejects(prepareLSIBCoast(cases[0],{binary:'missing-lsib-native'}),/native.*failed/i);
});

test('coast: selected FRA/MCO source matches the Python result', { skip: !process.env.PANDO_LSIB_COAST_ORACLE }, async () => {
  const fixture = JSON.parse(await readFile(process.env.PANDO_LSIB_COAST_ORACLE, 'utf8'));
  assertEquivalent(await prepareLSIBCoast(fixture), fixture.expected);
});
