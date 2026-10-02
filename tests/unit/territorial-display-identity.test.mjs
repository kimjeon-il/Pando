import assert from 'node:assert/strict';
import test from 'node:test';
import { territorialSelectionStatus } from '../../assets/js/modules/country-display.js';
import { createObjectSelectionController, normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';

const namedRef = (type, id, displayName = '같은 이름') => ({ domain: 'territorial', type, id, displayName });

test('same-name countries retain separate identities without adding display codes', () => {
  const first = namedRef('country', 'TUR');
  const second = namedRef('country', 'country-custom-123');
  assert.equal(territorialSelectionStatus(first), '같은 이름');
  assert.equal(territorialSelectionStatus(second), '같은 이름');
  const selection = createObjectSelectionController();
  selection.setMany([first, second], { primary: first });
  assert.equal(selection.size(), 2);
  assert.deepEqual(selection.items().map(ref => ref.id), ['TUR', 'country-custom-123']);
  assert.equal(selection.primary().id, 'TUR');
  selection.remove(first);
  assert.equal(selection.size(), 1);
  assert.equal(selection.primary().id, 'country-custom-123');
  assert.equal(territorialSelectionStatus(second, '10 km²'), '같은 이름 · 10 km²');
});

test('a country and subunit remain distinct even when their names and raw IDs match', () => {
  const country = namedRef('country', 'shared:id');
  const subunit = namedRef('subunit', 'shared:id');
  const countryRef = normalizeObjectRef(country);
  const subunitRef = normalizeObjectRef(subunit);
  assert.notEqual(countryRef.key, subunitRef.key);
  assert.equal(countryRef.key, 'territorial:country:shared%3Aid');
  assert.equal(subunitRef.key, 'territorial:subunit:shared%3Aid');
  const selection = createObjectSelectionController();
  selection.setMany([country, subunit], { primary: subunit });
  assert.equal(selection.size(), 2);
  assert.deepEqual(selection.primary(), subunitRef);
  selection.toggle(country);
  assert.equal(selection.has(country), false);
  assert.equal(selection.has(subunit), true);
  assert.deepEqual(selection.primary(), subunitRef);
});

test('renaming a selected object does not change its identity or emit a replacement selection', () => {
  const changes = [];
  const selection = createObjectSelectionController({ onChange: (_snapshot, reason) => changes.push(reason) });
  const original = namedRef('country', 'TUR', '튀르키예');
  const renamed = { ...original, displayName: '새 이름 (국가)' };
  selection.replace(original);
  selection.replace(renamed);
  assert.equal(territorialSelectionStatus(renamed), '새 이름 (국가)');
  assert.deepEqual(selection.primary(), normalizeObjectRef(original));
  assert.deepEqual(changes, ['replace']);
  assert.equal(Object.isFrozen(selection.primary()), true);
  assert.equal(Object.hasOwn(selection.primary(), 'displayName'), false);
});

test('a display name alone never acts as a selectable object reference', () => {
  const selection = createObjectSelectionController();
  const country = namedRef('country', 'TUR');
  selection.replace(country);
  assert.equal(normalizeObjectRef({ domain: 'territorial', type: 'country', displayName: country.displayName }), null);
  selection.remove(country.displayName);
  selection.replace({ displayName: country.displayName });
  assert.equal(selection.size(), 1);
  assert.equal(selection.primary().id, 'TUR');
});
