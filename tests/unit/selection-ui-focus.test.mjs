import assert from 'node:assert/strict';
import test from 'node:test';
/* global Event, EventTarget */
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createSelectionUiController } from '../../assets/js/modules/selection-ui-controller.js';
import { createPropertyEditorBindings } from '../../assets/js/modules/property-editor-bindings.js';

const country = id => normalizeObjectRef({ domain: 'territorial', type: 'entity', id });

function setup() {
  const domain = createSelectionDomain();
  const focused = [];
  const presented = [];
  const opened = [];
  const toolbarSynced = [];
  const presentationEvents = [];
  const toolbarEvents = [];
  let toolbarCleared = 0;
  const ui = createSelectionUiController({
    selectionDomain: domain,
    resolveRef: normalizeObjectRef,
    presenters: {
      default: (ref, options) => { presented.push(ref.key); presentationEvents.push({ kind: 'single', key: ref.key, ...options }); },
      multiple: current => presentationEvents.push({ kind: 'multiple', keys: current.items.map(ref => ref.key) }),
    },
    uiActions: {
      focusObject: ref => focused.push(ref.key),
      openEditor: ref => opened.push(ref.key),
      clearPresenter: () => presentationEvents.push({ kind: 'clear' }),
      syncSelectionToolbar: ref => { toolbarSynced.push(ref?.key || ''); toolbarEvents.push(ref.key); },
      clearSelectionToolbar: () => { toolbarCleared += 1; toolbarEvents.push(null); },
    },
  });
  return { domain, ui, focused, presented, opened, toolbarSynced, presentationEvents, toolbarEvents, get toolbarCleared() { return toolbarCleared; } };
}

test('toggle removal immediately reconciles the remaining presenter and toolbar', () => {
  const state = setup();
  const a = country('A');
  const b = country('B');
  assert.equal(state.ui.applyIntent(a), true);
  assert.equal(state.ui.applyIntent(b, { mode: 'toggle' }), true);
  assert.equal(state.ui.applyIntent(b, { mode: 'toggle' }), false);
  assert.equal(state.ui.applyIntent(a, { mode: 'toggle' }), false);
  assert.deepEqual(state.presentationEvents.map(event => event.kind === 'single' ? event.key : event.kind), [a.key, 'multiple', a.key, 'clear']);
  assert.deepEqual(state.toolbarEvents, [a.key, null, a.key, null]);
  assert.deepEqual(state.focused, []);
  assert.deepEqual(state.opened, []);
});

test('snapshot sync reconciles multi, single and empty presenters without interaction side effects', () => {
  const state = setup();
  const a = country('A');
  const b = country('B');
  state.domain.setMany([a, b], { primary: b });
  state.ui.syncNow(state.domain.snapshot());
  state.domain.toggle(b);
  state.ui.syncNow(state.domain.snapshot());
  state.domain.clear();
  state.ui.syncNow(state.domain.snapshot());
  assert.deepEqual(state.presentationEvents.map(event => event.kind === 'single' ? event.key : event.kind), ['multiple', a.key, 'clear']);
  assert.equal(state.presentationEvents[1].refreshOnly, true);
  assert.deepEqual(state.toolbarEvents, [null, a.key, null]);
  assert.deepEqual(state.focused, []);
  assert.deepEqual(state.opened, []);
});

test('removing a non-territorial primary presents the remaining object without focusing or reopening it', () => {
  const state = setup();
  const a = normalizeObjectRef({ domain: 'generic', type: 'polygon', id: 'A' });
  const b = normalizeObjectRef({ domain: 'label', type: 'label', id: 'B' });
  state.ui.applyIntent(a);
  state.ui.applyIntent(b, { mode: 'toggle' });
  const focusCount = state.focused.length;
  const openCount = state.opened.length;
  state.ui.applyIntent(b, { mode: 'toggle' });
  assert.equal(state.presentationEvents.at(-1).key, a.key);
  assert.equal(state.presentationEvents.at(-1).refreshOnly, true);
  assert.equal(state.focused.length, focusCount);
  assert.equal(state.opened.length, openCount);
});

for (const type of ['entity']) test(`${type} selection, reselection, toggle and range do not move the map`, () => {
  for (const scope of ['map', 'layer', 'chooser']) {
    const { domain, ui, focused, presented, opened, presentationEvents } = setup();
    const a = normalizeObjectRef({ domain: 'territorial', type, id: 'A' });
    const b = normalizeObjectRef({ domain: 'territorial', type, id: 'B' });
    ui.applyIntent(a, { scope });
    ui.applyIntent(a, { scope });
    assert.equal(domain.size(), 1);
    ui.applyIntent(b, { scope, mode: 'toggle' });
    assert.equal(domain.size(), 2);
    ui.applyIntent(b, { scope, mode: 'toggle' });
    assert.equal(domain.size(), 1);
    ui.applyIntent(a, { scope });
    ui.applyIntent(b, { scope, mode: 'range', orderedRefs: [a, b] });
    assert.equal(domain.size(), 2);
    assert.equal(domain.primary().key, b.key);
    assert.deepEqual(focused, []);
    assert.ok(presented.includes(a.key));
    assert.ok(presentationEvents.some(event => event.kind === 'multiple' && event.keys.includes(b.key)));
    assert.deepEqual(opened, []);
  }
});

test('non-territorial selection retains automatic focus', () => {
  const { ui, focused } = setup();
  for (const [domain, type] of [['generic', 'polygon'], ['hydro', 'river'], ['label', 'label'], ['distribution', 'distribution']]) {
    const ref = normalizeObjectRef({ domain, type, id: '1' });
    ui.applyIntent(ref);
    assert.equal(focused.at(-1), ref.key);
  }
  assert.equal(focused.length, 4);
});

for (const type of ['entity']) test(`explicit show-on-map button focuses the selected ${type}`, () => {
  const button = new EventTarget();
  const ref = normalizeObjectRef({ domain: 'territorial', type, id: 'A' });
  const focused = [];
  const bindings = createPropertyEditorBindings({
    getElement: id => {
      if (id === 'focusSelectedObjectBtn') return button;
      if (id === 'territorialTypeModal') return { querySelector: () => null };
      return null;
    },
    getPrimary: () => ref,
    bindColorPickers: () => {},
    focusObjectRef: value => focused.push(value),
  });
  bindings.bind();
  button.dispatchEvent(new Event('click'));
  assert.deepEqual(focused, [ref]);
  bindings.dispose();
});

test('selection toolbar follows single selection and clears for multiple selection', () => {
  const setupState = setup();
  const a = country('A');
  const b = country('B');
  setupState.ui.applyIntent(a, { openEditor: false });
  assert.equal(setupState.toolbarSynced.at(-1), a.key);
  setupState.ui.applyIntent(b, { mode: 'toggle', openEditor: false });
  setupState.ui.syncNow(setupState.domain.snapshot(), { force: true });
  assert.ok(setupState.toolbarCleared > 0);
});
