import {
  MAP_OBJECT_CATEGORIES,
  MAP_OBJECT_TYPES,
} from './map-object-categories.js';
import { resolveObjectAction } from './object-action-registry.js';

const ACTION_UI_BINDINGS = Object.freeze({
  focus: Object.freeze([
    Object.freeze({ elementId: 'focusSelectedObjectBtn', icon: true }),
  ]),
  lock: Object.freeze([
    Object.freeze({ elementId: 'objectLockBtn', labelSelector: '[data-editor-action-label]', helpSelector: '[data-editor-action-help]', dynamic: true }),
    Object.freeze({ elementId: 'objectLockMenuBtn', labelSelector: '#objectLockMenuLabel', dynamic: true }),
  ]),
  delete: Object.freeze([
    Object.freeze({ elementId: 'objectDeleteBtn', labelSelector: 'strong', helpSelector: '[data-editor-action-help]', icon: true }),
    Object.freeze({ elementId: 'objectDeleteMenuBtn', labelSelector: 'span:last-child', icon: true }),
  ]),
  'change-type': Object.freeze([
    Object.freeze({ elementId: 'changeCountryTypeBtn', labelSelector: 'strong' }),
    Object.freeze({ elementId: 'changeTerritoryTypeBtn', labelSelector: 'strong' }),
    Object.freeze({ elementId: 'changeAdministrativeTypeBtn', labelSelector: 'strong' }),
  ]),
  'border-edit': Object.freeze([
    Object.freeze({ elementId: 'editBorderBtn', labelSelector: 'strong' }),
    Object.freeze({ elementId: 'multiBorderEditBtn', labelSelector: 'strong' }),
  ]),
  'coast-edit': Object.freeze([
    Object.freeze({ elementId: 'editCoastBtn', labelSelector: 'strong' }),
  ]),
  'coast-reconcile': Object.freeze([
    Object.freeze({ elementId: 'reconcileAdministrativeCoastBtn', labelSelector: 'strong', icon: true }),
  ]),
});

export { ACTION_UI_BINDINGS };

function syncUseIcon(element, icon) {
  if (!element || !icon) return;
  const use = element.querySelector('use');
  if (use) use.setAttribute('href', `#${icon}`);
}

function syncObjectTaxonomy(root) {
  for (const node of root.querySelectorAll?.('[data-map-category]') || []) {
    const descriptor = MAP_OBJECT_CATEGORIES[node.dataset.mapCategory];
    if (!descriptor) continue;
    const heading = node.querySelector('.create-menu-group-title, .layer-category-title');
    if (heading) heading.textContent = descriptor.label;
    node.dataset.objectCategory = descriptor.key;
  }

  for (const node of root.querySelectorAll?.('[data-map-object-type]') || []) {
    const descriptor = MAP_OBJECT_TYPES[node.dataset.mapObjectType];
    if (!descriptor) continue;
    node.dataset.objectDomain = descriptor.domain;
    node.dataset.objectCategory = descriptor.category;
    node.dataset.objectEditor = descriptor.editor;
    node.dataset.objectCreatable = String(descriptor.creatable);
    const label = node.querySelector('strong');
    if (label) label.textContent = descriptor.label;
    if (descriptor.icon) syncUseIcon(node.querySelector('.create-menu-icon') || node, descriptor.icon);
  }
}

function syncActionBinding(root, actionId, binding) {
  const element = root.getElementById?.(binding.elementId) || root.querySelector?.(`#${binding.elementId}`);
  if (!element) return;
  const context = actionId === 'lock' ? { locked: element.getAttribute('aria-pressed') === 'true' } : {};
  const action = resolveObjectAction(actionId, context);
  if (!action) return;
  element.dataset.objectAction = action.id;
  element.dataset.objectCommand = action.command;
  element.dataset.objectDanger = String(action.danger);

  // Dynamic actions such as lock/unlock continue to be state-rendered by app.js.
  // The registry still owns their resolver and command identity.
  if (!binding.dynamic) {
    const label = binding.labelSelector ? element.querySelector(binding.labelSelector) : null;
    if (label) label.textContent = action.label;
    if (binding.helpSelector) {
      const help = element.querySelector(binding.helpSelector);
      if (help) help.textContent = action.help;
    }
    if (binding.icon) syncUseIcon(element, action.icon);
    if (element.hasAttribute('aria-label')) element.setAttribute('aria-label', action.label);
    if (element.hasAttribute('data-tooltip')) element.dataset.tooltip = action.label;
  }
}

export function installObjectRegistryPresenter({ root = document } = {}) {
  syncObjectTaxonomy(root);
  for (const [actionId, bindings] of Object.entries(ACTION_UI_BINDINGS)) {
    for (const binding of bindings) syncActionBinding(root, actionId, binding);
  }
  const documentElement = root.documentElement || document.documentElement;
  if (documentElement) documentElement.dataset.objectRegistry = 'ready';
}
