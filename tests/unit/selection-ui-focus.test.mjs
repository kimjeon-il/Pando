import assert from 'node:assert/strict';
import test from 'node:test';
/* global Event, EventTarget */
import { createNodeSelection } from '../helpers/core-selection.mjs';
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { createSelectionUiController } from "../../shared/frontend/js/modules/selection-ui-controller.js";
import { createPropertyEditorBindings } from "../../apps/editor/frontend/js/modules/property-editor-bindings.js";

const country = id => normalizeObjectRef({ domain: 'territorial', type: 'entity', id });

async function setup(t) {
  const owner = await createNodeSelection();
  t.after(() => owner.dispose());
  const domain = owner.domain;
  const focused = [];
  const presented = [];
  const opened = [];
  const presentationEvents = [];
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
    },
  });
  return { domain, ui, focused, presented, opened, presentationEvents };
}

test('toggle removal reconciles the remaining presenter after the actual Core ACK', async t => {
  const state = await setup(t);
  const a = country('A');
  const b = country('B');
  assert.equal(await state.ui.applyIntent(a), true);
  assert.equal(await state.ui.applyIntent(b, { mode: 'toggle' }), true);
  assert.equal(await state.ui.applyIntent(b, { mode: 'toggle' }), false);
  assert.equal(await state.ui.applyIntent(a, { mode: 'toggle' }), false);
  assert.deepEqual(state.presentationEvents.map(event => event.kind === 'single' ? event.key : event.kind), [a.key, 'multiple', a.key, 'clear']);
  assert.deepEqual(state.focused, []);
  assert.deepEqual(state.opened, [a.key]);
});

test('snapshot sync reconciles multi, single and empty presenters without interaction side effects', async t => {
  const state = await setup(t);
  const a = country('A');
  const b = country('B');
  await state.domain.setMany([a, b], { primary: b });
  state.ui.syncNow(state.domain.snapshot());
  await state.domain.toggle(b);
  state.ui.syncNow(state.domain.snapshot());
  await state.domain.clear();
  state.ui.syncNow(state.domain.snapshot());
  assert.deepEqual(state.presentationEvents.map(event => event.kind === 'single' ? event.key : event.kind), ['multiple', a.key, 'clear']);
  assert.equal(state.presentationEvents[1].refreshOnly, true);
  assert.deepEqual(state.focused, []);
  assert.deepEqual(state.opened, []);
});

test('removing a non-territorial primary presents the remaining object without focusing or reopening it', async t => {
  const state = await setup(t);
  const a = normalizeObjectRef({ domain: 'generic', type: 'polygon', id: 'A' });
  const b = normalizeObjectRef({ domain: 'label', type: 'label', id: 'B' });
  await state.ui.applyIntent(a);
  await state.ui.applyIntent(b, { mode: 'toggle' });
  const focusCount = state.focused.length;
  const openCount = state.opened.length;
  await state.ui.applyIntent(b, { mode: 'toggle' });
  assert.equal(state.presentationEvents.at(-1).key, a.key);
  assert.equal(state.presentationEvents.at(-1).refreshOnly, true);
  assert.equal(state.focused.length, focusCount);
  assert.equal(state.opened.length, openCount);
});

for (const type of ['entity']) test(`${type} selection, reselection, toggle and range do not move the map`, async t => {
  for (const scope of ['map', 'layer', 'chooser']) {
    const { domain, ui, focused, presented, opened, presentationEvents } = await setup(t);
    const a = normalizeObjectRef({ domain: 'territorial', type, id: 'A' });
    const b = normalizeObjectRef({ domain: 'territorial', type, id: 'B' });
    await ui.applyIntent(a, { scope });
    await ui.applyIntent(a, { scope });
    assert.equal(domain.size(), 1);
    await ui.applyIntent(b, { scope, mode: 'toggle' });
    assert.equal(domain.size(), 2);
    await ui.applyIntent(b, { scope, mode: 'toggle' });
    assert.equal(domain.size(), 1);
    await ui.applyIntent(a, { scope });
    await ui.applyIntent(b, { scope, mode: 'range', orderedRefs: [a, b] });
    assert.equal(domain.size(), 2);
    assert.equal(domain.primary().key, b.key);
    assert.deepEqual(focused, []);
    assert.ok(presented.includes(a.key));
    assert.ok(presentationEvents.some(event => event.kind === 'multiple' && event.keys.includes(b.key)));
    assert.deepEqual(opened, [a.key, a.key, a.key]);
  }
});

test('non-territorial selection retains automatic focus', async t => {
  const { ui, focused } = await setup(t);
  for (const [domain, type] of [['generic', 'polygon'], ['hydro', 'river'], ['label', 'label'], ['distribution', 'distribution']]) {
    const ref = normalizeObjectRef({ domain, type, id: '1' });
    await ui.applyIntent(ref);
    assert.equal(focused.at(-1), ref.key);
  }
  assert.equal(focused.length, 4);
});

test('a single territorial map click opens the editor without moving the map', async t => {
  const { ui, opened, focused } = await setup(t);
  const ref = country('DEU');
  await ui.applyIntent(ref, { scope: 'map' });
  assert.deepEqual(opened, [ref.key]);
  assert.deepEqual(focused, []);
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
    reportOperationError: error => assert.fail(error.stack),
    focusObjectRef: value => focused.push(value),
  });
  bindings.bind();
  button.dispatchEvent(new Event('click'));
  assert.deepEqual(focused, [ref]);
  bindings.dispose();
});

test('explicit territorial edit entrypoint still opens the editor without moving the map', async t => {
  const { ui, opened, focused } = await setup(t);
  const ref = country('DEU');
  await ui.applyIntent(ref, { scope: 'layer', openEditor: true });
  assert.deepEqual(opened, [ref.key]);
  assert.deepEqual(focused, []);
});
