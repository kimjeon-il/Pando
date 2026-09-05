import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfirmModalController } from '../../assets/js/modules/confirm-modal-controller.js';
import { createLayerTreeController } from '../../assets/js/modules/layer-tree-controller.js';
import { createTooltipController } from '../../assets/js/modules/tooltip-controller.js';

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
    dispatch(type, event = {}) { listeners.get(type)?.({ target: this, ...event }); },
    focus() { this.focused = true; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    getBoundingClientRect() { return { left: 10, top: 10, bottom: 30, width: 20, height: 20 }; },
  };
}

test('confirm modal controller owns focus, choice, and confirm lifecycle', () => {
  const elements = Object.fromEntries(['modal', 'backdrop', 'title', 'message', 'impactSection', 'impactList', 'ok', 'cancel', 'choiceRow', 'choice']
    .map(key => [key, fakeElement()]));
  let confirmed = '';
  const controller = createConfirmModalController({
    document: { createElement: () => fakeElement() },
    window: { requestAnimationFrame: callback => callback() },
    elements,
    setChoices: (select, _choices, value) => { select.value = value; },
  });
  controller.bind();
  controller.open({ title: '삭제', choices: [{ value: 'merge' }], impacts: ['1개 삭제'], onConfirm: value => { confirmed = value; } });
  assert.equal(controller.isOpen(), true);
  assert.equal(elements.choice.focused, true);
  elements.ok.dispatch('click');
  assert.equal(confirmed, 'merge');
  assert.equal(controller.isOpen(), false);
});

test('layer tree controller translates DOM events into commands', () => {
  const visibility = fakeElement();
  const search = fakeElement();
  const calls = [];
  const controller = createLayerTreeController({
    window: { setTimeout: callback => { callback(); return 1; }, Event: class { constructor(type) { this.type = type; } } },
    elements: { visibilityInputs: { countries: visibility }, search },
    groups: { tree: [], search: [], names: {} },
    model: { snapshot: () => ({ revision: 0, search: '', folders: {} }), items: () => [] },
    commands: {
      setLayerVisibility: (...args) => calls.push(['visibility', ...args]),
      setSearchValue: value => calls.push(['search', value]),
      commitSearch: () => calls.push(['commit']),
    },
  });
  controller.bind();
  visibility.checked = false;
  visibility.dispatch('change');
  search.value = '독일';
  search.dispatch('input');
  assert.deepEqual(calls, [['visibility', 'countries', false], ['search', '독일'], ['commit']]);
});

test('tooltip controller owns accessible show and hide state', () => {
  const tooltip = fakeElement();
  tooltip.id = 'uiTooltip';
  const target = fakeElement();
  target.id = 'owner';
  target.dataset.tooltip = '도움말';
  const controller = createTooltipController({
    document: { getElementById: id => id === 'owner' ? target : null, addEventListener() {}, documentElement: { classList: { contains: () => false } } },
    window: { matchMedia: () => ({ matches: true }), innerWidth: 400, innerHeight: 300, addEventListener() {} },
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
