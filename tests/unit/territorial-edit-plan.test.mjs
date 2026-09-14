import test from 'node:test';
import assert from 'node:assert/strict';
import '../../assets/js/vendor/polygon-clipping.min.js';
import '../../assets/js/modules/territorial-edit-plan.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';

const kernel = globalThis.PandoLabTerritorialEdit.createKernel(globalThis.polygonClipping);
const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const country = (id = 'KR', geometry = square(0, 0, 10, 10)) => ({ type: 'Feature', id, properties: { name: id }, geometry });
const unit = (id, parentId, geometry, sovereignId = 'KR') => createTerritorialFeature({ id, unitType: 'subunit', name: id, parentId, sovereignId, geometry });
const created = geometry => unit('new', 'KR', geometry);
const patch = (result, id) => result.features.find(feature => feature.id === id);

test('country boundary previews transfer whole children, disclose cuts and preserve locked descendants', () => {
  const countries = [country('KR', square(0, 0, 5, 10)), country('JP', square(5, 0, 10, 10))];
  const moved = unit('moved', 'KR', square(4, 1, 5, 2));
  const cut = unit('cut', 'KR', square(3, 4, 5, 6));
  const request = { operation: 'country-boundary', targetId: 'KR', countries, units: [moved, cut],
    featurePatches: [country('KR', square(0, 0, 4, 10)), country('JP', square(4, 0, 10, 10))] };
  const before = structuredClone(request);
  const result = kernel.plan(request);
  assert.deepEqual(request, before);
  assert.equal(patch(result, 'moved').properties.sovereignId, 'JP');
  assert.equal(patch(result, 'moved').properties.parentId, 'JP');
  assert.equal(kernel.area(patch(result, 'cut').geometry), 2);
  assert.ok(result.impacts.some(impact => impact.id === 'cut' && impact.kind === 'clip-child'));
  cut.properties.locked = true;
  assert.throws(() => kernel.plan(request), /잠긴/);
});

test('promotion changes the country and ancestor shapes with descendants and locked ancestors guarded', () => {
  const parent = unit('parent', 'KR', square(0, 0, 5, 5));
  const source = unit('source', 'parent', square(0, 0, 3, 3));
  const child = unit('child', 'source', square(1, 1, 2, 2));
  const request = { operation: 'promote', targetId: 'source', newCountry: country('source', source.geometry), countries: [country()], units: [parent, source, child] };
  const result = kernel.plan(request);
  assert.deepEqual(result.countryIds, ['KR', 'source']);
  assert.equal(kernel.area(patch(result, 'KR').geometry), 91);
  assert.equal(kernel.area(patch(result, 'parent').geometry), 16);
  assert.equal(patch(result, 'child').properties.sovereignId, 'source');
  assert.equal(patch(result, 'child').properties.parentId, 'source');
  parent.properties.locked = true;
  assert.throws(() => kernel.plan(request), /잠긴/);
});

test('separate coastal additions accumulate on the same hierarchy', () => {
  const mainland = square(0, 0, 10, 10);
  const additionA = square(1, 10, 2, 11), additionB = square(7, 10, 8, 12);
  const draft = { type: 'MultiPolygon', coordinates: globalThis.polygonClipping.union(mainland.coordinates, additionA.coordinates, additionB.coordinates) };
  const result = kernel.plan({ operation: 'coast', targetId: 'KR', draft, countries: [country()], units: [unit('province', 'KR', mainland)] });
  assert.equal(kernel.area(patch(result, 'province').geometry), 103);
});

test('creating in uncovered land leaves the parent and uncovered land implicit', () => {
  const countries = [country()], draft = square(1, 1, 3, 3);
  const before = structuredClone(countries);
  const result = kernel.plan({ operation: 'create', targetId: 'KR', parentId: 'KR', countries, units: [], draft, newFeature: created(draft) });
  assert.deepEqual(countries, before);
  assert.deepEqual(result.features.map(feature => feature.id), ['new']);
  assert.deepEqual(patch(result, 'new').properties.style, {});
  assert.equal('isRemainder' in patch(result, 'new').properties, false);
  assert.equal('adminLevel' in patch(result, 'new').properties, false);
});

test('donor splitting preserves islands and creates a sibling with parent style inheritance', () => {
  const donor = unit('donor', 'KR', { type: 'MultiPolygon', coordinates: [square(0, 0, 5, 5).coordinates, square(7, 7, 8, 8).coordinates] });
  donor.properties.style = { color: '#ff0000', opacity: 0.8 };
  const draft = square(0, 0, 2, 5);
  const result = kernel.plan({ operation: 'create', targetId: 'KR', parentId: 'KR', sourceId: 'donor', countries: [country()], units: [donor], draft, newFeature: created(draft) });
  assert.equal(kernel.area(patch(result, 'donor').geometry), 16);
  assert.equal(patch(result, 'new').properties.parentId, 'KR');
  assert.deepEqual(patch(result, 'new').properties.style, {});
  assert.throws(() => kernel.plan({ operation: 'create', targetId: 'KR', parentId: 'KR', sourceId: 'donor', countries: [country()], units: [donor], draft: donor.geometry, newFeature: created(donor.geometry) }), /전체/);
});

test('final scope rejects foreign parents, overlapping siblings and missing source IDs', () => {
  const countries = [country(), country('JP', square(20, 0, 30, 10))];
  const a = unit('a', 'KR', square(0, 0, 5, 5)), b = unit('b', 'JP', square(20, 0, 25, 5), 'JP');
  const request = { operation: 'annex', targetId: 'a', parentId: 'KR', sourceId: 'b', countries, units: [a, b], draft: b.geometry };
  assert.throws(() => kernel.plan(request), /같은 소속 국가/);
  assert.throws(() => kernel.plan({ ...request, sourceId: 'missing' }), /기준 영역/);
  assert.throws(() => kernel.validate(countries, [a, unit('overlap', 'KR', square(1, 1, 4, 4))]), /겹칩니다/);
});

test('merge uses connectivity of the whole chosen set and reparents descendants', () => {
  const units = [unit('a', 'KR', square(0, 0, 3, 5)), unit('b', 'KR', square(3, 0, 6, 5)), unit('c', 'KR', square(6, 0, 9, 5)), unit('child', 'c', square(7, 1, 8, 2))];
  const result = kernel.plan({ operation: 'merge', targetId: 'a', parentId: 'KR', sourceIds: ['c', 'b'], countries: [country()], units });
  assert.equal(kernel.area(patch(result, 'a').geometry), 45);
  assert.equal(patch(result, 'child').properties.parentId, 'a');
  assert.throws(() => kernel.plan({ operation: 'merge', targetId: 'a', parentId: 'KR', sourceIds: ['c'], countries: [country()], units }), /연결/);
});

test('descendant cuts are explicit impacts, with no generated fragments and no source writes', () => {
  const units = [unit('donor', 'KR', square(0, 0, 8, 8)), unit('child', 'donor', square(2, 2, 6, 6)), unit('grandchild', 'child', square(3, 3, 5, 5))];
  const before = structuredClone(units), draft = square(0, 0, 4, 8);
  const request = { operation: 'create', targetId: 'KR', parentId: 'KR', sourceId: 'donor', countries: [country()], units, draft, newFeature: created(draft) };
  const result = kernel.plan(request);
  assert.deepEqual(units, before);
  assert.deepEqual(result.impacts.map(impact => impact.id), ['child', 'grandchild']);
  assert.equal(kernel.area(patch(result, 'child').geometry), 8);
  assert.deepEqual(result.features.map(feature => feature.id).sort(), ['child', 'donor', 'grandchild', 'new']);
  units[2].properties.locked = true;
  assert.throws(() => kernel.plan(request), /잠긴/);
});

test('a completely transferred child changes parent while keeping its own descendants', () => {
  const units = [unit('donor', 'KR', square(0, 0, 8, 8)), unit('child', 'donor', square(1, 1, 2, 2)), unit('grandchild', 'child', square(1, 1, 1.5, 1.5))];
  const draft = square(0, 0, 4, 8);
  const result = kernel.plan({ operation: 'create', targetId: 'KR', parentId: 'KR', sourceId: 'donor', countries: [country()], units, draft, newFeature: created(draft) });
  assert.equal(patch(result, 'child').properties.parentId, 'new');
  assert.equal(patch(result, 'grandchild'), undefined);
  assert.equal(result.impacts.length, 0);
});

test('coast expansion and erosion are identical at country, province and county entrypoints', () => {
  const units = [unit('province', 'KR', square(0, 0, 5, 10)), unit('county', 'province', square(0, 0, 5, 5))];
  const additions = globalThis.polygonClipping.union(country().geometry.coordinates, square(-1, 1, 0, 4).coordinates);
  for (const draft of [{ type: 'MultiPolygon', coordinates: additions }, square(1, 0, 10, 10)]) {
    const requests = ['KR', 'province', 'county'].map(targetId => kernel.plan({ operation: 'coast', targetId, countries: [country()], units, draft }));
    assert.deepEqual(requests[0], requests[1]); assert.deepEqual(requests[1], requests[2]);
    assert.ok(patch(requests[0], 'KR')); assert.ok(patch(requests[0], 'province')); assert.ok(patch(requests[0], 'county'));
  }
});

test('ambiguous reclamation requires ownership, independent of unit array order', () => {
  const units = [unit('a', 'KR', square(0, 0, 5, 10)), unit('b', 'KR', square(5, 0, 10, 10))];
  const draft = { type: 'MultiPolygon', coordinates: globalThis.polygonClipping.union(country().geometry.coordinates, square(2, -1, 8, 0).coordinates) };
  const request = { operation: 'coast', targetId: 'KR', countries: [country()], units, draft };
  const unresolved = kernel.plan(request).impacts.find(impact => impact.kind === 'coast-owner');
  assert.ok(unresolved);
  const allocations = { [unresolved.key]: 'b' };
  const a = kernel.plan({ ...request, allocations }), b = kernel.plan({ ...request, units: [...units].reverse(), allocations });
  assert.deepEqual(patch(a, 'b').geometry, patch(b, 'b').geometry);
  assert.equal(patch(a, 'a'), undefined);
});

test('border movement preserves the shared outer boundary and rejects invasion', () => {
  const units = [unit('a', 'KR', square(0, 0, 5, 10)), unit('b', 'KR', square(5, 0, 10, 10))];
  const featurePatches = [unit('a', 'KR', square(0, 0, 6, 10)), unit('b', 'KR', square(6, 0, 10, 10))];
  const request = { operation: 'boundary', targetId: 'a', parentId: 'KR', countries: [country()], units, featurePatches };
  assert.equal(kernel.area(patch(kernel.plan(request), 'a').geometry), 60);
  featurePatches[0].geometry = square(-1, 0, 6, 10);
  assert.throws(() => kernel.plan(request), /바깥 경계/);
});
