import assert from 'node:assert/strict';
import test from 'node:test';


import { createObjectSearchController } from "../../shared/frontend/js/modules/object-search-controller.js";
import { createTooltipController } from "../../shared/frontend/js/modules/tooltip-controller.js";

function fakeElement() {
  const listeners = new Map();
  const classes = new Set(['hidden']);
  return {
    id: '', value: '', checked: false, textContent: '', dataset: {}, style: {}, focused: false,
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value),
      toggle(value, force) { if (force) classes.add(value); else classes.delete(value); },
    },
    addEventListener(type, callback) { listeners.set(type, callback); },
    dispatch(type, event = {}) { return listeners.get(type)?.({ target: this, currentTarget: this, ...event }); },
    focus() { this.focused = true; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] ?? null; },
    removeAttribute(name) { delete this[name]; },
    getBoundingClientRect() { return { left: 10, top: 10, bottom: 30, width: 20, height: 20 }; },
  };
}









test('object search controller translates search DOM events into commands', () => {
  const search = fakeElement();
  const calls = [];
  const controller = createObjectSearchController({
    window: { clearTimeout() {}, setTimeout: callback => { callback(); return 1; }, Event: class { constructor(type) { this.type = type; } } },
    elements: { search },
    groups: { tree: [], search: [], names: {} },
    model: { snapshot: () => ({ revision: 0, search: '', folders: {} }), items: () => [] },
    commands: {
      setSearchValue: value => calls.push(['search', value]),
      commitSearch: () => calls.push(['commit']),
    },
  });
  controller.bind();
  search.value = '독일';
  search.dispatch('input');
  assert.deepEqual(calls, [['search', '독일'], ['commit']]);
});

test('tooltip controller owns accessible show and hide state', () => {
  const tooltip = fakeElement();
  tooltip.id = 'uiTooltip';
  const target = fakeElement();
  target.id = 'owner';
  target.dataset.tooltip = '도움말';
  const controller = createTooltipController({
    document: { getElementById: id => id === 'owner' ? target : null, addEventListener() {}, documentElement: { classList: { contains: () => false } } },
    window: {
      matchMedia: () => ({ matches: true }),
      innerWidth: 400,
      innerHeight: 300,
      addEventListener() {},
      clearTimeout() {},
      setTimeout(callback) { callback(); return 1; },
    },
    tooltip,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  });
  controller.show(target);
  assert.equal(tooltip.textContent, '도움말');
  assert.equal(target['aria-describedby'], 'uiTooltip');
  controller.hide();
  assert.equal(tooltip.classList.contains('hidden'), true);
  assert.equal(target['aria-describedby'], undefined);
});
