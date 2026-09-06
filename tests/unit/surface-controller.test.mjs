import assert from 'node:assert/strict';
import test from 'node:test';
import { SURFACE_OPEN_ORIGINS, createSurfaceController } from '../../assets/js/modules/surface-controller.js';

function classList() {
  const values = new Set();
  return {
    toggle(name, enabled) { enabled ? values.add(name) : values.delete(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function element(id = '') {
  const attributes = new Map();
  return {
    id,
    classList: classList(),
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); },
  };
}

function fixture(initialLayout) {
  let layout = initialLayout;
  const elements = Object.fromEntries([
    'leftPanel', 'rightPanel', 'createMenu', 'mobileMapBtn', 'createMenuBtn', 'mobileEditBtn',
    'mobileFileBtn', 'mobileBackdrop', 'multiEditBtn',
  ].map(id => [id, element(id)]));
  const workspace = element('workspace');
  const body = element('body');
  const document = {
    body,
    activeElement: null,
    querySelector: selector => selector === '.workspace' ? workspace : null,
    querySelectorAll: () => [],
  };
  const controller = createSurfaceController({ getElement: id => elements[id], getLayout: () => layout, document });
  return {
    controller,
    document,
    elements,
    setLayout: value => { layout = value; },
    setActiveElement: id => { document.activeElement = id ? elements[id] : null; },
  };
}

test('compact surfaces are mutually exclusive and synchronize ARIA once rendered', () => {
  const { controller, elements } = fixture('compact');
  for (const [surface, button] of [['layers', 'mobileMapBtn'], ['create', 'createMenuBtn'], ['editor', 'mobileEditBtn']]) {
    controller.open(surface);
    const view = controller.render();
    assert.equal(view[`${surface === 'layers' ? 'layers' : surface === 'editor' ? 'editor' : 'create'}Open`], true);
    assert.equal(elements[button].getAttribute('aria-expanded'), 'true');
    assert.equal(['mobileMapBtn', 'createMenuBtn', 'mobileEditBtn'].filter(id => elements[id].classList.contains('sheet-open')).length, 1);
    assert.equal(controller.originOf(surface), SURFACE_OPEN_ORIGINS.USER);
  }
});

test('wide keeps the layer surface open while the create popover is active', () => {
  const { controller, elements } = fixture('wide');
  controller.open('create');
  assert.deepEqual(controller.render(), { layersOpen: true, editorOpen: false, createOpen: true, activeMobileSheet: null });
  assert.equal(elements.mobileMapBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(elements.createMenuBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.createMenu.getAttribute('role'), 'dialog');
  assert.equal(elements.createMenu.getAttribute('aria-modal'), 'false');
});

test('wide workspace rail swaps one contextual pane at a time', () => {
  const { controller, elements } = fixture('wide');

  controller.open('editor');
  assert.deepEqual(controller.render(), { layersOpen: true, editorOpen: true, createOpen: false, activeMobileSheet: null });
  assert.equal(controller.isOpen('layers'), false);
  assert.equal(elements.mobileEditBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.mobileMapBtn.getAttribute('aria-expanded'), 'false');

  controller.open('layers');
  assert.deepEqual(controller.render(), { layersOpen: true, editorOpen: false, createOpen: false, activeMobileSheet: null });
  assert.equal(controller.isOpen('layers'), true);
  assert.equal(elements.mobileMapBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.mobileEditBtn.getAttribute('aria-expanded'), 'false');
});

test('mobile tracks one explicit active sheet and clears it when closed', () => {
  const { controller, elements } = fixture('mobile');
  controller.open('layers');
  controller.open('editor');
  assert.equal(controller.render().activeMobileSheet, 'edit');
  assert.equal(elements.rightPanel.getAttribute('role'), 'dialog');
  controller.close('editor');
  assert.equal(controller.render().activeMobileSheet, null);
});

test('automatic editor open is blocked on mobile but explicit editor intent opens it', () => {
  const { controller } = fixture('mobile');
  assert.equal(controller.open('editor', { automatic: true }), false);
  assert.deepEqual(controller.render(), {
    layersOpen: false, editorOpen: false, createOpen: false, activeMobileSheet: null,
  });
  assert.equal(controller.open('editor'), true);
  assert.deepEqual(controller.render(), {
    layersOpen: false, editorOpen: true, createOpen: false, activeMobileSheet: 'edit',
  });
});

test('contextual multi-edit remains an explicit user request on mobile', () => {
  const { controller, setActiveElement } = fixture('mobile');
  setActiveElement('multiEditBtn');
  assert.equal(controller.open('editor', { automatic: true }), true);
  assert.equal(controller.originOf('editor'), SURFACE_OPEN_ORIGINS.USER);
  assert.equal(controller.render().activeMobileSheet, 'edit');
});

test('manual editor close suppresses later automatic reopen until a user opens it', () => {
  const { controller } = fixture('compact');
  assert.equal(controller.open('editor', { automatic: true }), true);
  assert.equal(controller.originOf('editor'), SURFACE_OPEN_ORIGINS.AUTOMATIC);
  assert.equal(controller.close('editor', { manual: true, selected: true }), true);
  assert.equal(controller.state.editorManuallyCollapsed, true);
  assert.equal(controller.open('editor', { automatic: true }), false);
  assert.equal(controller.open('editor'), true);
  assert.equal(controller.state.editorManuallyCollapsed, false);
  assert.equal(controller.originOf('editor'), SURFACE_OPEN_ORIGINS.USER);
});

test('toggle owns the common open and manual-close state transition', () => {
  const { controller } = fixture('compact');
  assert.equal(controller.toggle('editor', { selected: true }), true);
  assert.equal(controller.isOpen('editor'), true);
  assert.equal(controller.toggle('editor', { selected: true }), true);
  assert.equal(controller.isOpen('editor'), false);
  assert.equal(controller.state.automaticOpenBlocked.editor, true);
});

test('layout changes preserve user-opened transient surfaces without promoting persistent wide layers', () => {
  const wideEditor = fixture('wide');
  wideEditor.controller.open('editor');
  wideEditor.controller.render();
  wideEditor.setLayout('compact');
  wideEditor.controller.syncLayout('wide');
  assert.deepEqual(wideEditor.controller.render(), {
    layersOpen: false, editorOpen: true, createOpen: false, activeMobileSheet: null,
  });

  const compactCreate = fixture('compact');
  compactCreate.controller.open('create');
  compactCreate.controller.render();
  compactCreate.setLayout('mobile');
  compactCreate.controller.syncLayout('compact');
  assert.deepEqual(compactCreate.controller.render(), {
    layersOpen: false, editorOpen: false, createOpen: true, activeMobileSheet: 'create',
  });

  const persistentWideLayers = fixture('wide');
  persistentWideLayers.controller.render();
  persistentWideLayers.setLayout('mobile');
  persistentWideLayers.controller.syncLayout('wide');
  assert.deepEqual(persistentWideLayers.controller.render(), {
    layersOpen: false, editorOpen: false, createOpen: false, activeMobileSheet: null,
  });
});

test('automatic editor state does not become a mobile sheet during responsive transition', () => {
  const automaticEditor = fixture('wide');
  assert.equal(automaticEditor.controller.open('editor', { automatic: true }), true);
  automaticEditor.controller.render();
  automaticEditor.setLayout('mobile');
  automaticEditor.controller.syncLayout('wide');
  assert.deepEqual(automaticEditor.controller.render(), {
    layersOpen: false, editorOpen: false, createOpen: false, activeMobileSheet: null,
  });

  const userEditor = fixture('wide');
  userEditor.controller.open('editor');
  userEditor.controller.render();
  userEditor.setLayout('mobile');
  userEditor.controller.syncLayout('wide');
  assert.deepEqual(userEditor.controller.render(), {
    layersOpen: false, editorOpen: true, createOpen: false, activeMobileSheet: 'edit',
  });
});
