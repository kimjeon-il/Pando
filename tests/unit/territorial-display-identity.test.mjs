import assert from 'node:assert/strict';
import test from 'node:test';
import { territorialSelectionStatus } from "../../apps/editor/frontend/js/modules/country-display.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { createNodeSelection } from '../helpers/core-selection.mjs';

const namedRef = (type, id, displayName = '같은 이름') => ({ domain: 'territorial', type, id, displayName });

test('same-name countries retain separate identities without adding display codes', async t => {
  const first = namedRef('entity', 'TUR');
  const second = namedRef('entity', 'country-custom-123');
  assert.equal(territorialSelectionStatus(first), '같은 이름');
  assert.equal(territorialSelectionStatus(second), '같은 이름');
  const owner = await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [] });t.after(() => owner.dispose());
  const selection = owner.domain;
  await selection.setMany([first, second], { primary: first });
  assert.equal(selection.size(), 2);
  assert.deepEqual(selection.snapshot().selection.items.map(ref => ref.id), ['TUR', 'country-custom-123']);
  assert.equal(selection.primary().id, 'TUR');
  await selection.remove(first);
  assert.equal(selection.size(), 1);
  assert.equal(selection.primary().id, 'country-custom-123');
  assert.equal(territorialSelectionStatus(second, '10 km²'), '같은 이름 · 10 km²');
});

test('hierarchy positions share the same entity identity; repeated IDs do not create another selection', async t => {
  const root = namedRef('entity', 'shared:id');
  const child = { ...root, parentId: 'other' };
  const first = normalizeObjectRef(root), second = normalizeObjectRef(child);
  assert.equal(first.key, 'territorial:entity:shared%3Aid');
  assert.deepEqual(second, first);
  const owner = await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [] });t.after(() => owner.dispose());
  const selection = owner.domain;
  await selection.setMany([root, child], { primary: child });
  assert.equal(selection.size(), 1);
  await selection.toggle(root);
  assert.equal(selection.size(), 0);
});

test('renaming a selected object does not change its identity or emit a replacement selection', async t => {
  const changes = [];
  const owner = await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [],onSelectionChanged: (_snapshot, reason) => changes.push(reason) });t.after(() => owner.dispose());
  const selection = owner.domain;
  const original = namedRef('entity', 'TUR', '튀르키예');
  const renamed = { ...original, displayName: '새 이름 (국가)' };
  await selection.replace(original);
  await selection.replace(renamed);
  assert.equal(territorialSelectionStatus(renamed), '새 이름 (국가)');
  assert.deepEqual(selection.primary(), normalizeObjectRef(original));
  assert.deepEqual(changes, ['replace']);
  assert.equal(Object.isFrozen(selection.primary()), true);
  assert.equal(Object.hasOwn(selection.primary(), 'displayName'), false);
});

test('a display name alone never acts as a selectable object reference', async t => {
  const owner = await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [] });t.after(() => owner.dispose());
  const selection = owner.domain;
  const country = namedRef('entity', 'TUR');
  await selection.replace(country);
  assert.equal(normalizeObjectRef({ domain: 'territorial', type: 'entity', displayName: country.displayName }), null);
  await selection.remove(country.displayName);
  await selection.replace({ displayName: country.displayName });
  assert.equal(selection.size(), 1);
  assert.equal(selection.primary().id, 'TUR');
});
