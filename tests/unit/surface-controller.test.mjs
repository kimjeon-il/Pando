import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfaceController } from '../../assets/js/modules/surface-controller.js';

function classList() {
  const values = new Set();
  return {
    toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function element() {
  const attributes = new Map();
  return {
    classList: classList(),
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); },
  };
}

function fixture(initialLayout) {
  let layout = initialLayout;
  const elements = Object.fromEntries([
    'leftPanel', 'rightPanel', 'createMenu', 'mobileMapBtn', 'mobileCreateBtn', 'mobileEditBtn',
    'createMenuBtn', 'togglePanelBtn', 'mobileFileBtn', 'mobileBackdrop',
  ].map(id => [id, element()]));
  const workspace = element();
  const body = element();
  const document = {
    body,
    querySelector: selector => selector === '.workspace' ? workspace : null,
    querySelectorAll: () => [],
  };
  const controller = createSurfaceController({ getElement: id => elements[id], getLayout: () => layout, document });
  return { controller, elements, setLayout: value => { layout = value; } };
}

test('compact surfaces are mutually exclusive and synchronize ARIA once rendered', () => {
  const { controller, elements } = fixture('compact');
  for (const [surface, button] of [['layers', 'mobileMapBtn'], ['create', 'mobileCreateBtn'], ['editor', 'mobileEditBtn']]) {
    controller.open(surface);
    const view = controller.render();
    assert.equal(view[`${surface === 'layers' ? 'layers' : surface === 'editor' ? 'editor' : 'create'}Open`], true);
    assert.equal(elements[button].getAttribute('aria-expanded'), 'true');
    assert.equal(['mobileMapBtn', 'mobileCreateBtn', 'mobileEditBtn'].filter(id => elements[id].classList.contains('sheet-open')).length, 1);
  }
});

test('wide keeps the layer surface open while the create popover is active', () => {
  const { controller } = fixture('wide');
  controller.open('create');
  assert.deepEqual(controller.render(), { layersOpen: true, editorOpen: false, createOpen: true, activeMobileSheet: null });
});

test('mobile tracks one active sheet and clears it when closed', () => {
  const { controller } = fixture('mobile');
  controller.open('layers');
  controller.open('editor');
  assert.equal(controller.render().activeMobileSheet, 'edit');
  controller.close('editor');
  assert.equal(controller.render().activeMobileSheet, null);
});
