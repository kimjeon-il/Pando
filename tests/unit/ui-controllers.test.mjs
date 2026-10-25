import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfirmModalController } from "../../apps/editor/frontend/js/modules/confirm-modal-controller.js";
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

test('confirm modal controller owns focus, choice, and confirm lifecycle', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Object });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'HTMLElement', descriptor);
    else delete globalThis.HTMLElement;
  });
  const elements = Object.fromEntries(['modal', 'backdrop', 'title', 'message', 'impactSection', 'impactList', 'ok', 'cancel', 'choiceRow', 'choice']
    .map(key => [key, fakeElement()]));
  let confirmed = '';
  const controller = createConfirmModalController({
    document: { createElement: () => fakeElement() },
    window: { requestAnimationFrame: callback => callback() },
    elements,
    setChoices: (select, _choices, value) => { select.value = value; },
    reportOperationError: error => { throw error; },
  });
  controller.bind();
  controller.open({ title: '삭제', choices: [{ value: 'merge' }], impacts: ['1개 삭제'], onConfirm: value => { confirmed = value; } });
  assert.equal(controller.isOpen(), true);
  assert.equal(elements.ok.focused, true);
  elements.modal.dispatch('keydown',{key:'Escape',repeat:true,preventDefault(){},stopPropagation(){}});
  assert.equal(controller.isOpen(),true,'held Escape must not close the newly opened confirmation');
  await elements.ok.dispatch('click');
  assert.equal(confirmed, 'merge');
  assert.equal(controller.isOpen(), false);
});

test('confirm modal awaits an asynchronous command and contains its technical failure', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Object });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'HTMLElement', descriptor); else delete globalThis.HTMLElement; });
  const elements = Object.fromEntries(['modal','backdrop','title','message','impactSection','impactList','ok','cancel','choiceRow','choice']
    .map(key => [key, fakeElement()]));
  const errors = [];
  const controller = createConfirmModalController({ document: { createElement: fakeElement },
    window: { requestAnimationFrame: callback => callback() }, elements, setChoices() {},
    reportOperationError: error => errors.push(error) });
  let reject;
  const command = new Promise((resolve, fail) => { reject = fail; });
  controller.bind(); controller.open({ onConfirm: () => command });
  const pending = elements.ok.dispatch('click');
  assert.equal(controller.isOpen(), false);
  assert.deepEqual(errors, []);
  const error = Object.assign(new Error('Shared command rejected'), { code: 'CORE_COMMAND_UNSUPPORTED' });
  reject(error);
  assert.equal(await pending, false);
  assert.deepEqual(errors, [error]);
});

test('closing a modal preserves immediate UI/cancel timing and contains rejected asynchronous cancellation', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Object });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'HTMLElement', descriptor); else delete globalThis.HTMLElement; });
  const elements = Object.fromEntries(['modal','backdrop','title','message','impactSection','impactList','ok','cancel','choiceRow','choice']
    .map(key => [key, fakeElement()]));
  const errors = [], effects = [];
  const controller = createConfirmModalController({ document: { createElement: fakeElement },
    window: { requestAnimationFrame: callback => callback() }, elements, setChoices() {},
    reportOperationError: (error, context) => errors.push({ error, context }) });
  let reject;
  const acknowledgement = new Promise((resolve, fail) => { reject = fail; });
  controller.open({ onCancel: () => { effects.push('cancel-dispatched'); return acknowledgement; } });
  const pending = controller.close();
  assert.equal(controller.isOpen(), false); assert.deepEqual(effects, ['cancel-dispatched']);
  assert.deepEqual(errors, []);
  const error = Object.assign(new Error('Candidate cancellation failed'), { code: 'PL-CORE-LOAD' });
  reject(error); assert.equal(await pending, false);
  assert.deepEqual(errors, [{ error, context: { operation: 'cancel' } }]);
});

test('opening another modal dispatches the previous cancellation immediately with its own rejection boundary', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Object });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'HTMLElement', descriptor); else delete globalThis.HTMLElement; });
  const elements = Object.fromEntries(['modal','backdrop','title','message','impactSection','impactList','ok','cancel','choiceRow','choice']
    .map(key => [key, fakeElement()]));
  let reject, cancelled = 0, errorReported;
  const acknowledgement = new Promise((resolve, fail) => { reject = fail; });
  const reported = new Promise(resolve => { errorReported = resolve; });
  const controller = createConfirmModalController({ document: { createElement: fakeElement },
    window: { requestAnimationFrame: callback => callback() }, elements, setChoices() {},
    reportOperationError: (error, context) => errorReported({ error, context }) });
  controller.open({ onCancel: () => { cancelled += 1; return acknowledgement; } });
  assert.equal(controller.open({ title: 'Next modal' }), true);
  assert.equal(cancelled, 1); assert.equal(controller.isOpen(), true); assert.equal(elements.title.textContent, 'Next modal');
  const error = Object.assign(new Error('Old cancellation rejected'), { code: 'PL-CORE-CANCELLED' });
  reject(error); assert.deepEqual(await reported, { error, context: { operation: 'cancel' } });
  assert.equal(controller.isOpen(), true);
});

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
