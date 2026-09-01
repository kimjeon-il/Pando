import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfaceTabsController } from '../../assets/js/modules/surface-tabs-controller.js';

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function tab(key, panel, document) {
  const attributes = new Map([
    ['role', 'tab'],
    ['data-surface-tab', key],
    ['aria-controls', panel],
    ['aria-selected', 'false'],
  ]);
  return {
    id: `${key}Tab`,
    dataset: { surfaceTab: key },
    ownerDocument: document,
    classList: classList(),
    hidden: false,
    disabled: false,
    tabIndex: -1,
    focused: false,
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    focus() { this.focused = true; },
    closest(selector) {
      if (selector === '[role="tab"]') return this;
      if (selector === '[role="tab"][data-surface-tab]') return this;
      if (selector === '[role="tablist"]') return this.tablist;
      return null;
    },
  };
}

function fixture() {
  const listeners = new Map();
  const panels = new Map();
  const document = {
    getElementById(id) { return panels.get(id) || null; },
  };
  for (const id of ['onePanel', 'twoPanel', 'threePanel']) {
    const attributes = new Map();
    panels.set(id, { setAttribute(name, value) { attributes.set(name, value); }, attributes });
  }
  const tabs = [tab('one', 'onePanel', document), tab('two', 'twoPanel', document), tab('three', 'threePanel', document)];
  const tablist = {
    querySelectorAll() { return tabs; },
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  for (const item of tabs) item.tablist = tablist;
  const selections = [];
  const controller = createSurfaceTabsController({
    tablist,
    onSelect: (key, options) => selections.push({ key, options }),
  });
  controller.bind();
  return { controller, listeners, panels, selections, tabs };
}

test('sync applies the shared active, ARIA, roving tabindex, and panel label contract', () => {
  const { controller, panels, tabs } = fixture();
  assert.equal(controller.sync('two', { focus: true }), 'two');
  assert.deepEqual(tabs.map(item => item.getAttribute('aria-selected')), ['false', 'true', 'false']);
  assert.deepEqual(tabs.map(item => item.tabIndex), [-1, 0, -1]);
  assert.equal(tabs[1].classList.contains('active'), true);
  assert.equal(tabs[1].focused, true);
  assert.equal(panels.get('twoPanel').attributes.get('aria-labelledby'), 'twoTab');
});

test('keyboard navigation skips unavailable tabs and delegates selection once', () => {
  const { listeners, selections, tabs } = fixture();
  tabs[1].hidden = true;
  let prevented = false;
  listeners.get('keydown')({
    key: 'ArrowRight',
    target: tabs[0],
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.deepEqual(selections, [{ key: 'three', options: { focus: true } }]);
});
