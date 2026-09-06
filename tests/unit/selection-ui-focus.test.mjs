import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createSelectionUiController } from '../../assets/js/modules/selection-ui-controller.js';
import { createPropertyEditorBindings } from '../../assets/js/modules/property-editor-bindings.js';

const country = id => normalizeObjectRef({ domain: 'territorial', type: 'country', id });

function setup() {
  const domain = createSelectionDomain();
  const focused = [];
  const presented = [];
  const opened = [];
  const ui = createSelectionUiController({
    selectionDomain: domain,
    resolveRef: normalizeObjectRef,
    presenters: { default: ref => presented.push(ref.key) },
    uiActions: {
      focusObject: ref => focused.push(ref.key),
      openEditor: ref => opened.push(ref.key),
    },
  });
  return { domain, ui, focused, presented, opened };
}

test('country selection, reselection, toggle and range present without focusing the map', () => {
  for (const scope of ['map', 'layer', 'chooser']) {
    const { domain, ui, focused, presented, opened } = setup();
    const a = country('A');
    const b = country('B');
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
    assert.ok(presented.includes(a.key) && presented.includes(b.key));
    assert.deepEqual(opened, presented);
  }
});

test('non-country selection retains automatic focus', () => {
  const { ui, focused } = setup();
  for (const [domain, type] of [['territorial', 'region'], ['generic', 'polygon'], ['hydro', 'river'], ['label', 'label'], ['distribution', 'distribution']]) {
    const ref = normalizeObjectRef({ domain, type, id: '1' });
    ui.applyIntent(ref);
    assert.equal(focused.at(-1), ref.key);
  }
  assert.equal(focused.length, 5);
});

test('explicit show-on-map button still focuses the selected country', () => {
  const button = new EventTarget();
  const ref = country('A');
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
