import assert from 'node:assert/strict';
import test from 'node:test';
import '../../assets/js/vendor/polygon-clipping.min.js';
import { createTerritorialFeature, territorialRootId } from '../../assets/js/modules/territorial-units.js';
import { normalizePolygonGeometry } from '../../assets/js/modules/map-edit-geometry.js';
import { calculateTerritorialEdit } from '../../assets/js/modules/map-edit-territorial-commands.js';

const square = (x0, y0, x1, y1) => normalizePolygonGeometry({ type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const entity = (id, entityKind, geometry, options = {}) => createTerritorialFeature({ id, entityKind, geometry, ...options });
const kernel = globalThis.PandoLabTerritorialEdit.createKernel(globalThis.polygonClipping);

function fixture() {
  const countries = [entity('A', 'general', square(0, 0, 5, 5)), entity('B', 'general', square(5, 0, 10, 5))];
  const units = [entity('parent', 'general', square(4, 0, 5, 5), { parentId: 'A' }),
    entity('child', 'general', square(4, 1, 5, 2), { parentId: 'parent' }),
    entity('grandchild', 'general', square(4.2, 1.2, 4.8, 1.8), { parentId: 'child' })];
  return { countries, units };
}

function requestFor(operation, units) {
  return operation === 'transfer'
    ? { operation, targetId: 'parent', countryId: 'B' }
    : { operation, targetId: 'parent', newCountry: entity('parent', 'general', units[0].geometry) };
}

for (const operation of ['transfer', 'promote']) {
  for (const lockedId of ['child', 'grandchild']) {
    test(`${operation} rejects a country change inherited by locked ${lockedId} without changing inputs`, () => {
      const { countries, units } = fixture();
      units.find(feature => feature.id === lockedId).properties.locked = true;
      const request = requestFor(operation, units);
      const before = structuredClone({ request, countries, units });
      assert.throws(() => calculateTerritorialEdit(request, [...countries, ...units], globalThis.polygonClipping),
        error => error.message.includes(lockedId) && error.message.includes('잠긴'));
      assert.deepEqual({ request, countries, units }, before);
    });
  }
  test(`${operation} allows unlocked descendants and derives their new country from unchanged child fields`, () => {
    const { countries, units } = fixture();
    const before = structuredClone({ countries, units });
    const result = calculateTerritorialEdit(requestFor(operation, units), [...countries, ...units], globalThis.polygonClipping);
    const removed = new Set(result.removedIds);
    const after = new Map([...countries, ...units].filter(feature => !removed.has(feature.id)).map(feature => [feature.id, feature]));
    for (const feature of result.features) after.set(feature.id, feature);
    for (const childId of ['child', 'grandchild']) {
      assert.equal(territorialRootId(after.get(childId), id => after.get(id)), operation === 'transfer' ? 'B' : 'parent');
      assert.deepEqual(after.get(childId), units.find(feature => feature.id === childId));
      assert.equal(Object.hasOwn(after.get(childId).properties, 'sovereignId'), false);
    }
    assert.deepEqual({ countries, units }, before);
  });
}

test('the final commit guard rejects a locked descendant country change even outside the affected ID list', () => {
  const { countries, units } = fixture();
  units[2].properties.locked = true;
  const before = [...countries, ...units];
  const after = structuredClone(units);
  after[0].properties.parentId = 'B';
  const nextCountries = structuredClone(countries);
  nextCountries[0].geometry = square(0, 0, 4, 5);
  nextCountries[1].geometry = square(4, 0, 10, 5);
  assert.throws(() => kernel.validate([...nextCountries, ...after], before, ['parent']), /grandchild:.*잠긴/);
});

test('the final commit guard allows ancestor reparenting within the same country when the locked child is unchanged', () => {
  const { countries, units } = fixture();
  units[2].properties.locked = true;
  const container = entity('container', 'general', units[0].geometry, { parentId: 'A' });
  const beforeUnits = [...units, container];
  const after = structuredClone(beforeUnits);
  after[0].properties.parentId = 'container';
  assert.equal(kernel.validate([...countries, ...after], [...countries, ...beforeUnits], ['parent']), true);
});
