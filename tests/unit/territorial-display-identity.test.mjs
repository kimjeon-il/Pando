import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { createNodeSelection } from '../helpers/core-selection.mjs';

const namedRef = (type, id, displayName = '같은 이름') => ({ domain: 'territorial', type, id, displayName });



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
