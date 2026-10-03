import assert from 'node:assert/strict';
import test from 'node:test';
import { territorialSelectionStatus } from '../../assets/js/modules/country-display.js';
import { createObjectSelectionController, normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';

const namedRef = (type, id, displayName = '같은 이름') => ({ domain: 'territorial', type, id, displayName });

test('same-name countries retain separate identities without adding display codes', () => {
  const first = namedRef('entity', 'TUR');
  const second = namedRef('entity', 'country-custom-123');
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

test('hierarchy positions share the same entity identity; repeated IDs do not create another selection', () => {
  const root = namedRef('entity', 'shared:id');
  const child = { ...root, parentId: 'other' };
  const first = normalizeObjectRef(root), second = normalizeObjectRef(child);
  assert.equal(first.key, 'territorial:entity:shared%3Aid');
  assert.deepEqual(second, first);
  const selection = createObjectSelectionController();
  selection.setMany([root, child], { primary: child });
  assert.equal(selection.size(), 1);
  selection.toggle(root);
  assert.equal(selection.size(), 0);
});

test('renaming a selected object does not change its identity or emit a replacement selection', () => {
  const changes = [];
  const selection = createObjectSelectionController({ onChange: (_snapshot, reason) => changes.push(reason) });
  const original = namedRef('entity', 'TUR', '튀르키예');
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
  const country = namedRef('entity', 'TUR');
  selection.replace(country);
  assert.equal(normalizeObjectRef({ domain: 'territorial', type: 'entity', displayName: country.displayName }), null);
  selection.remove(country.displayName);
  selection.replace({ displayName: country.displayName });
  assert.equal(selection.size(), 1);
  assert.equal(selection.primary().id, 'TUR');
});
