import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  MAP_OBJECT_CATEGORIES,
  MAP_OBJECT_CATEGORY_ORDER,
  MAP_OBJECT_TYPES,
  categoryForCreateItem,
} from '../assets/js/modules/map-object-categories.js';
import { OBJECT_ACTIONS, objectActionApplies } from '../assets/js/modules/object-action-registry.js';
import { ACTION_UI_BINDINGS } from '../assets/js/modules/object-registry-presenter.js';

const root = process.cwd();
const failures = [];
const fail = message => failures.push(message);

const requiredTypeFields = [
  'key', 'domain', 'type', 'category', 'label', 'icon', 'editor', 'creatable',
];
for (const [key, descriptor] of Object.entries(MAP_OBJECT_TYPES)) {
  for (const field of requiredTypeFields) {
    if (!(field in descriptor)) fail(`object type ${key} is missing '${field}'`);
  }
  if (descriptor.key !== key) fail(`object type ${key} must self-identify with key '${key}'`);
  if (!MAP_OBJECT_CATEGORIES[descriptor.category]) fail(`object type ${key} references unknown category '${descriptor.category}'`);
  if (!descriptor.label) fail(`object type ${key} must have a display label`);
  if (!descriptor.editor) fail(`object type ${key} must declare an editor target`);
  if (descriptor.creatable && (!descriptor.createButton || !descriptor.createAction)) {
    fail(`creatable object type ${key} must declare createButton and createAction`);
  }
  if (descriptor.creatable && categoryForCreateItem(key) !== descriptor.category) {
    fail(`creatable object type ${key} is not routed through its declared category`);
  }
  if (key !== 'distribution' && !descriptor.layerGroup) fail(`object type ${key} must declare layerGroup`);
  if (key !== 'distribution' && !descriptor.presentationGroup) fail(`object type ${key} must declare presentationGroup`);
}

if (MAP_OBJECT_TYPES.generic.creatable !== false) fail('generic objects must remain non-creatable');
if (MAP_OBJECT_TYPES.generic.fallbackOnly !== true) fail('generic objects must remain fallback-only');
if (MAP_OBJECT_TYPES.generic.createButton || MAP_OBJECT_TYPES.generic.createAction) fail('generic objects may not expose a create entry point');
if (JSON.stringify(MAP_OBJECT_TYPES.generic.allowedActions) !== JSON.stringify(['focus', 'lock', 'delete'])) {
  fail('generic objects must restrict product actions to focus/lock/delete');
}
if (objectActionApplies('coast-reconcile', { domain: 'generic', type: 'feature' })) {
  fail('generic objects may not reuse territorial coast reconciliation');
}

const expectedOrder = ['territorial', 'distribution', 'features'];
if (JSON.stringify(MAP_OBJECT_CATEGORY_ORDER) !== JSON.stringify(expectedOrder)) {
  fail(`object category order must remain ${expectedOrder.join(' → ')}`);
}
for (const [categoryKey, category] of Object.entries(MAP_OBJECT_CATEGORIES)) {
  for (const typeKey of category.createItems) {
    if (!MAP_OBJECT_TYPES[typeKey]) fail(`category ${categoryKey} references unknown type ${typeKey}`);
    else if (MAP_OBJECT_TYPES[typeKey].category !== categoryKey) fail(`category ${categoryKey} disagrees with type ${typeKey}`);
  }
}

for (const actionId of ['focus', 'lock', 'delete', 'change-type', 'border-edit', 'coast-reconcile']) {
  const action = OBJECT_ACTIONS[actionId];
  if (!action) {
    fail(`missing canonical object action '${actionId}'`);
    continue;
  }
  for (const field of ['id', 'command', 'label', 'icon', 'capability']) {
    if (!(field in action)) fail(`object action ${actionId} is missing '${field}'`);
  }
}
if (OBJECT_ACTIONS.delete?.danger !== true) fail('delete action must remain marked as danger');

const requiredBindings = Object.freeze({
  lock: ['objectLockBtn'],
  delete: ['objectDeleteBtn'],
  focus: ['focusSelectedObjectBtn', 'objectFocusMenuBtn'],
  'coast-reconcile': ['reconcileSubunitCoastBtn'],
  'change-type': ['changeCountryTypeBtn', 'changeSubunitTypeBtn'],
});
for (const [actionId, elementIds] of Object.entries(requiredBindings)) {
  const bound = new Set((ACTION_UI_BINDINGS[actionId] || []).map(binding => binding.elementId));
  for (const elementId of elementIds) {
    if (!bound.has(elementId)) fail(`object action ${actionId} is not shared by UI endpoint #${elementId}`);
  }
}

const uiRuntimeSource = fs.readFileSync(path.join(root, 'assets/js/modules/ui-runtime.js'), 'utf8');
if (!uiRuntimeSource.includes("import { installObjectRegistryPresenter } from './object-registry-presenter.js';")) {
  fail('canonical UI runtime must import the object registry presenter');
}
if (!uiRuntimeSource.includes('installObjectRegistryPresenter();')) {
  fail('object registry presenter is not installed by the canonical UI runtime');
}

const appSource = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
for (const marker of [
  'MAP_OBJECT_TYPES.country.label',
  'Object.values(MAP_OBJECT_TYPES)',
  'category.createItems.forEach(type =>',
]) {
  if (!appSource.includes(marker)) fail(`app.js is not consuming canonical object registry marker: ${marker}`);
}

if (failures.length) {
  console.error(`Object registry audit failed with ${failures.length} issue(s):`);
  for (const message of [...new Set(failures)]) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log(`Object registry audit passed: ${Object.keys(MAP_OBJECT_TYPES).length} object types, ${Object.keys(OBJECT_ACTIONS).length} actions, shared menu/editor bindings enforced.`);
}
