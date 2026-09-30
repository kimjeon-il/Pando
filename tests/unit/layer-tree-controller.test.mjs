import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayerTreeController } from '../../assets/js/modules/layer-tree-controller.js';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { createSelectionUiController } from '../../assets/js/modules/selection-ui-controller.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';

function element() {
  const classes = new Set();
  const listeners = new Map();
  return {
    children: [], dataset: {}, attributes: {}, listeners,
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    append(...nodes) { this.children.push(...nodes); },
    prepend(...nodes) { this.children.unshift(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    querySelectorAll() { return this.children.filter(node => node.dataset.objectKey); },
    closest(selector) {
      return selector === '[data-object-search-select]' && this.dataset.objectSearchSelect ? this : null;
    },
  };
}

function setup() {
  const rows = {
    countries: [{ id: 'D', name: 'D 항목' }, { id: 'C', name: 'C 항목 묶음' }],
    labels: [{ id: 'B', name: 'B 항목' }],
    genericFeatures: [{ id: 'A', name: 'A 항목 묶음' }],
  };
  const itemRef = (group, id) => normalizeObjectRef({
    domain: group === 'countries' ? 'territorial' : group === 'labels' ? 'label' : 'generic',
    type: group === 'countries' ? 'country' : group === 'labels' ? 'label' : 'polygon', id,
  });
  const selectionDomain = createSelectionDomain();
  const ui = createSelectionUiController({ selectionDomain, resolveRef: normalizeObjectRef });
  const results = element();
  const snapshot = { revision: 1, search: '항목' };
  const controller = createLayerTreeController({
    document: { createElement: element }, elements: { searchResults: results },
    groups: { search: Object.keys(rows) },
    model: {
      snapshot: () => snapshot, items: group => rows[group], itemRef,
      compare: (a, b) => a.name.localeCompare(b.name), selectionSnapshot: selectionDomain.snapshot,
    },
    createEmptyState: element,
    commands: { selectItem: ({ group, id, range, additive, orderedRefs }) => ui.applyIntent(itemRef(group, id), {
      mode: range ? 'range' : additive ? 'toggle' : 'replace', orderedRefs, scope: 'layer-list',
    }) },
  });
  controller.bind();
  controller.render();
  const click = (id, shiftKey = false) => {
    const row = results.children.find(node => node.children[0]?.dataset.itemId === id);
    assert.ok(row, `Rendered row ${id} must exist`);
    results.listeners.get('click')({ target: row.children[0], shiftKey, ctrlKey: false, metaKey: false });
  };
  return { controller, selectionDomain, results, snapshot, click };
}

test('search Shift range follows displayed sorting across object groups and sets clicked primary', () => {
  const { results, click, selectionDomain } = setup();
  assert.deepEqual(results.children.map(row => row.children[0].dataset.itemId), ['A', 'B', 'C', 'D']);
  click('A');
  click('C', true);
  assert.deepEqual(selectionDomain.snapshot().selection.items.map(ref => ref.id), ['A', 'B', 'C']);
  assert.equal(selectionDomain.primary().id, 'C');
  assert.equal(selectionDomain.snapshot().selection.items.some(ref => ref.id === 'D'), false);
});

test('search rerender replaces the range order with the newly visible results', () => {
  const { controller, results, snapshot, click, selectionDomain } = setup();
  click('A');
  snapshot.search = '묶음';
  snapshot.revision += 1;
  controller.render();
  assert.deepEqual(results.children.map(row => row.children[0].dataset.itemId), ['A', 'C']);
  click('C', true);
  assert.deepEqual(selectionDomain.snapshot().selection.items.map(ref => ref.id), ['A', 'C']);
  assert.equal(selectionDomain.primary().id, 'C');
});
