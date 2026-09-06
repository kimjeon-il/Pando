import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const context = vm.createContext({ URL });
context.self = context;
context.location = { href: 'http://test/assets/js/workers/map-edit-worker.js' };
context.importScripts = () => {};
for (const path of ['modules/country-geometry.js', 'vendor/polygon-clipping.min.js', 'workers/map-edit-worker.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../../assets/js/${path}`, import.meta.url), 'utf8'), context);
}
const pc = context.polygonClipping;
const api = vm.runInContext('({executeAnnex, subtractAreaFromGeometry, sliverAreaM2})', context);
const box = (x, y, size) => [[[x, y], [x, y + size], [x + size, y + size], [x + size, y], [x, y]]];
const geom = polygons => ({ type: 'MultiPolygon', coordinates: polygons });
const feature = (id, polygons) => ({ id, properties: {}, geometry: geom(polygons) });
const source = box(0, 0, 0.01);
const small = (x, areaM2) => box(x, 0.002, Math.sqrt(areaM2) / 111195.08);
function annex({ leftovers, originalIsland = null, automatic = true, unselected = [] }) {
  const transferred = geom(pc.difference([source], leftovers));
  const features = [feature('D', [source, ...(originalIsland ? [originalIsland] : [])]), feature('T', [box(-0.02, 0, 0.01)])];
  const before = JSON.stringify(features);
  const result = api.executeAnnex({ targetId: 'T', donorIds: ['D'], transferredGeometry: transferred,
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
  const result = api.executeAnnex({ targetId: 'T', donorIds: ['D'], transferredGeometry: geom([polygon]) },
    new Map([['D', feature('D', [polygon])], ['T', feature('T', [box(0, 0, 1)])]]));
  assert.ok(result.removedIds.includes('D'));
});

test('point contact is not boundary ownership and ambiguous shared boundaries stay untouched', () => {
  const piece = small(0.002, 0.2);
  context.piece = piece;
  context.corner = box(piece[0][2][0], piece[0][2][1], 0.001);
  assert.equal(vm.runInContext('sharesBoundary(piece, [corner])', context), false);
  const next = box(piece[0][2][0], 0.002, 0.001);
  const result = annex({ leftovers: [piece, next], unselected: [next] });
  assert.equal(result.autoIncludedSlivers.count, 0);
});
