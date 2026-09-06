import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAP_OBJECT_CATEGORIES,
  MAP_OBJECT_TYPES,
  categoryForLayerGroup,
  layerGroupForObjectType,
  objectTypeDescriptor,
  objectTypeKeyForRef,
  objectTypeLabel,
  presentationGroupForObjectType,
} from '../../assets/js/modules/map-object-categories.js';
import {
  OBJECT_ACTIONS,
  createObjectActionExecutor,
  objectActionApplies,
  resolveObjectAction,
} from '../../assets/js/modules/object-action-registry.js';
import { ACTION_UI_BINDINGS } from '../../assets/js/modules/object-registry-presenter.js';

test('object registry exposes canonical domain/category/editor metadata', () => {
  assert.equal(MAP_OBJECT_TYPES.country.domain, 'territorial');
  assert.equal(MAP_OBJECT_TYPES.country.category, 'territorial');
  assert.equal(MAP_OBJECT_TYPES.country.editor, 'country');
  assert.equal(MAP_OBJECT_TYPES.admin.editor, 'administrative');
  assert.equal(MAP_OBJECT_TYPES.river.domain, 'hydro');
  assert.equal(MAP_OBJECT_TYPES.river.editor, 'hydro');
  assert.equal(MAP_OBJECT_TYPES.generic.domain, 'generic');
  assert.equal(MAP_OBJECT_TYPES.generic.creatable, false);
  assert.deepEqual(MAP_OBJECT_CATEGORIES.features.createItems, ['label', 'river', 'lake']);
});

test('object refs resolve through one registry key and presentation mapping', () => {
  assert.equal(objectTypeKeyForRef({ domain: 'territorial', type: 'admin', id: 'a' }), 'admin');
  assert.equal(objectTypeKeyForRef({ domain: 'distribution', type: 'language', id: 'd' }), 'distribution');
  assert.equal(objectTypeKeyForRef({ domain: 'hydro', type: 'lake', id: 'l' }), 'lake');
  assert.equal(objectTypeDescriptor({ domain: 'generic', type: 'feature' }), MAP_OBJECT_TYPES.generic);
  assert.equal(objectTypeLabel({ domain: 'territorial', type: 'territory' }), '권역');
  assert.equal(layerGroupForObjectType('distribution', { subtype: 'ethnicity' }), 'ethnicities');
  assert.equal(presentationGroupForObjectType('river'), 'rivers');
  assert.equal(categoryForLayerGroup('genericFeatures'), 'features');
});

test('action registry resolves dynamic lock metadata and applicability', () => {
  assert.equal(resolveObjectAction('lock', { locked: false }).label, '잠금');
  assert.equal(resolveObjectAction('lock', { locked: true }).label, '잠금 해제');
  assert.equal(resolveObjectAction('lock', { locked: true }).icon, 'icon-lock-closed');
  assert.equal(resolveObjectAction('delete').danger, true);
  assert.equal(objectActionApplies('change-type', { domain: 'territorial', type: 'country' }), true);
  assert.equal(objectActionApplies('change-type', { domain: 'hydro', type: 'river' }), false);
  assert.equal(objectActionApplies('border-edit', { domain: 'territorial', type: 'territory' }), false);
  assert.equal(objectActionApplies('border-edit', { domain: 'territorial', type: 'country' }), true);
  assert.ok(OBJECT_ACTIONS['coast-reconcile']);
});

test('action executor delegates canonical commands without owning mutation logic', () => {
  const calls = [];
  const executor = createObjectActionExecutor({
    execute(command, context, payload) {
      calls.push({ command, context, payload });
      return 'done';
    },
  });
  const context = { domain: 'territorial', type: 'country', capabilities: new Set(['change-type']) };
  assert.equal(executor.execute('change-type', context, { type: 'territory' }), 'done');
  assert.deepEqual(calls[0], {
    command: 'territorial.change-type',
    context,
    payload: { type: 'territory' },
  });
  assert.equal(executor.execute('border-edit', { ...context, capabilities: new Set() }), false);
});

test('shared layer menu and editor endpoints bind to the same action ids', () => {
  assert.deepEqual(ACTION_UI_BINDINGS.lock.map(binding => binding.elementId), ['objectLockBtn']);
  assert.deepEqual(ACTION_UI_BINDINGS.delete.map(binding => binding.elementId), ['objectDeleteBtn']);
  assert.ok(ACTION_UI_BINDINGS['change-type'].some(binding => binding.elementId === 'changeCountryTypeBtn'));
  assert.ok(ACTION_UI_BINDINGS['coast-reconcile'].some(binding => binding.elementId === 'reconcileAdministrativeCoastBtn'));
});
