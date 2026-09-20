import assert from 'node:assert/strict';
import test from 'node:test';
import '../../assets/js/vendor/polygon-clipping.min.js';
import { createCountryCommandCalculator } from '../../assets/js/modules/map-edit-country-commands.js';

const pc = globalThis.polygonClipping;
const api = createCountryCommandCalculator(pc);
const box = (x, y, size) => [[[x, y], [x, y + size], [x + size, y + size], [x + size, y], [x, y]]];
const geom = polygons => ({ type: 'MultiPolygon', coordinates: polygons });
const feature = (id, polygons) => ({ id, properties: {}, geometry: geom(polygons) });
const source = box(0, 0, 0.01);
const small = (x, areaM2) => box(x, 0.002, Math.sqrt(areaM2) / 111195.08);
function annex({ leftovers, originalIsland = null, automatic = true, unselected = [] }) {
  const transferred = geom(pc.difference([source], leftovers));
  const features = [feature('D', [source, ...(originalIsland ? [originalIsland] : [])]), feature('T', [box(-0.02, 0, 0.01)])];
  const before = JSON.stringify(features);
  const { result } = api.calculate({ operation: 'annex', targetId: 'T', donorIds: ['D'], transferredGeometry: transferred,
    riverSliverContext: automatic ? [{ donorId: 'D', polygonIndex: 0, unselectedGeometries: unselected.map(p => geom([p])) }] : [],
  }, new Map(features.map(f => [f.id, f])));
  assert.equal(JSON.stringify(features), before);
  return result;
}

test('river-only automatic inclusion uses the same final geometry for the result', () => {
  const leftovers = [small(0.002, 0.2), small(0.004, 0.3)];
  const result = annex({ leftovers });
  assert.equal(result.autoIncludedSlivers.count, 2);
  assert.ok(Math.abs(result.autoIncludedSlivers.areaM2 - 0.5) < 0.001);
  assert.ok(result.removedIds.includes('D'));
  assert.equal(pc.difference([source], result.transferredGeometry.coordinates).length, 0);
  assert.equal(annex({ leftovers, automatic: false }).autoIncludedSlivers.count, 0);
});

test('existing islands and explicitly unselected cells are preserved', () => {
  const piece = small(0.002, 0.2), island = small(0.02, 0.1);
  const result = annex({ leftovers: [piece], originalIsland: island, unselected: [piece] });
  assert.equal(result.autoIncludedSlivers.count, 0);
  assert.equal(result.features.find(f => f.id === 'D').geometry.coordinates.length, 2);
});

test('one-square-meter per piece and ten-square-meter combined caps are enforced', () => {
  const leftovers = Array.from({ length: 12 }, (_, i) => small(0.001 + i * 0.0005, i === 11 ? 1.1 : 0.99));
  const result = annex({ leftovers });
  assert.equal(result.autoIncludedSlivers.count, 10);
  assert.ok(result.autoIncludedSlivers.areaM2 <= 10);
  assert.equal(result.features.find(f => f.id === 'D').geometry.coordinates.length, 2);
});

test('tiny explicit whole and partial transfers are not discarded by overlap tolerance', () => {
  const polygon = box(2, 0, 0.000003);
  const complete = api.subtractAreaFromGeometry(geom([polygon]), [polygon]);
  assert.equal(complete.affected, true);
  assert.equal(complete.geometry, null);
  const partial = api.subtractAreaFromGeometry(geom([polygon]), [box(2, 0, 0.0000015)]);
  assert.equal(partial.affected, true);
  const { result } = api.calculate({ operation: 'annex', targetId: 'T', donorIds: ['D'], transferredGeometry: geom([polygon]) },
    new Map([['D', feature('D', [polygon])], ['T', feature('T', [box(0, 0, 1)])]]));
  assert.ok(result.removedIds.includes('D'));
});

test('annex clips only a sub-grid source-boundary fringe before applying', () => {
  const donor = box(0, 0, 1);
  const fringe = [[[1, 0.25], [1, 0.75], [1 + 1e-8, 0.75], [1 + 1e-8, 0.25], [1, 0.25]]];
  const transferred = geom(pc.union([donor], [fringe]));
  const { result } = api.calculate({
    operation: 'annex', targetId: 'T', donorIds: ['D'], transferredGeometry: transferred,
  }, new Map([
    ['D', feature('D', [donor])],
    ['T', feature('T', [box(-2, 0, 1)])],
  ]));
  assert.equal(result.removedIds.includes('D'), true);
  const receivedOutsideDonor = pc.difference(result.transferredGeometry.coordinates, [donor]);
  assert.equal(receivedOutsideDonor.length, 0);
});

test('annex still rejects meaningful territory outside the selected sources', () => {
  const donor = box(0, 0, 1);
  const outside = box(1.01, 0.25, 0.1);
  assert.throws(() => api.calculate({
    operation: 'annex', targetId: 'T', donorIds: ['D'], transferredGeometry: geom(pc.union([donor], [outside])),
  }, new Map([
    ['D', feature('D', [donor])],
    ['T', feature('T', [box(-2, 0, 1)])],
  ])), /영토를 가져올 국가 밖/u);
});

test('point contact is not boundary ownership and ambiguous shared boundaries stay untouched', () => {
  const piece = small(0.002, 0.2);
  const corner = box(piece[0][2][0], piece[0][2][1], 0.001);
  assert.equal(api.sharesBoundary(piece, [corner]), false);
  const next = box(piece[0][2][0], 0.002, 0.001);
  const result = annex({ leftovers: [piece, next], unselected: [next] });
  assert.equal(result.autoIncludedSlivers.count, 0);
});
