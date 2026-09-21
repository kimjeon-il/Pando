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
    'objectSearchSurface', 'mapDisplaySurface', 'editorSurface', 'createMenu', 'objectSearchBtn',
    'mapDisplayBtn', 'mobileSearchBtn', 'mobileDisplayBtn', 'createMenuBtn', 'mobileEditBtn',
    'mobileFileBtn', 'mobileBackdrop', 'mobileCreateBtn', 'referenceImageSurface', 'referenceImageBtn',
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

test('reference image is the only mobile sheet and restores its trigger state across layout changes', () => {
  const { controller, elements, setLayout } = fixture('wide');
  controller.open('editor');
  assert.equal(controller.open('reference'), true);
  controller.render();
  assert.equal(controller.isOpen('editor'), true);
  setLayout('mobile');
  controller.syncLayout('wide');
  controller.render();
  assert.equal(controller.activeMobileSheet, 'reference');
  assert.equal(controller.isOpen('editor'), false);
  assert.equal(elements.referenceImageBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.referenceImageSurface.getAttribute('role'), 'dialog');
  controller.open('display');
  controller.render();
  assert.equal(controller.isOpen('reference'), false);
  assert.equal(elements.referenceImageSurface.inert, true);
  assert.equal(elements.referenceImageBtn.getAttribute('aria-expanded'), 'false');
  controller.open('reference');
  setLayout('compact');
  controller.syncLayout('mobile');
  controller.render();
  assert.equal(controller.isOpen('reference'), true);
  controller.close('reference');
  controller.render();
  assert.equal(elements.referenceImageSurface.inert, true);
});

test('compact search preserves the editor and synchronizes ARIA while replacing competing menus', () => {
  const { controller, elements } = fixture('compact');
  controller.open('editor');
  controller.open('search');
  controller.render();
  assert.equal(controller.isOpen('editor'), true);
  assert.equal(elements.objectSearchBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.mobileEditBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.objectSearchSurface.inert, false);
  controller.open('editor', { automatic: true });
  assert.equal(controller.isOpen('search'), true);
  controller.close('search');
  controller.render();
  assert.equal(controller.isOpen('editor'), true);
  assert.equal(elements.objectSearchSurface.inert, true);
  controller.close('editor');
  for (const [surface, button] of [['search', 'mobileSearchBtn'], ['display', 'mobileDisplayBtn'], ['editor', 'mobileEditBtn']]) {
    controller.open(surface);
    const view = controller.render();
    assert.equal(view[`${surface}Open`], true);
    assert.equal(elements[button].getAttribute('aria-expanded'), 'true');
    assert.equal(['mobileSearchBtn', 'mobileDisplayBtn', 'mobileEditBtn'].filter(id => elements[id].classList.contains('sheet-open')).length, 1);
    assert.equal(controller.originOf(surface), SURFACE_OPEN_ORIGINS.USER);
  }
});

test('retired layer surface cannot change command surfaces', () => {
  const { controller } = fixture('wide');
  controller.open('search');
  const before = controller.render();
  assert.equal(controller.open('layers'), false);
  assert.deepEqual(controller.render(), before);
});

test('desktop create keeps the editor while replacing competing menus', () => {
  for (const layout of ['wide', 'compact']) {
    const { controller, elements } = fixture(layout);
    controller.open('editor');
    controller.open('create');
    assert.equal(controller.render().editorOpen, true);
    assert.equal(elements.createMenu.getAttribute('role'), 'menu');
    assert.equal(elements.createMenuBtn.getAttribute('aria-expanded'), 'true');
    assert.equal(controller.open('editor', { automatic: true }), false);
    assert.equal(controller.isOpen('create'), true);
    controller.close('create');
    controller.render();
    assert.equal(elements.createMenu.inert, true);
    assert.equal(controller.isOpen('editor'), true);
    controller.open('display');
    controller.open('create');
    assert.equal(controller.isOpen('display'), false);
  }
});

test('mobile create participates in sheet exclusivity, roles and trigger ARIA', () => {
  const { controller, elements } = fixture('mobile');
  for (const surface of ['create', 'search', 'editor', 'display', 'create']) {
    controller.open(surface);
    controller.render();
    assert.equal(['create', 'search', 'editor', 'display'].filter(key => controller.isOpen(key)).length, 1);
  }
  assert.equal(controller.activeMobileSheet, 'create');
  assert.equal(elements.createMenu.getAttribute('role'), 'dialog');
  assert.equal(elements.createMenu.inert, false);
  assert.equal(elements.mobileCreateBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.mobileEditBtn.getAttribute('aria-expanded'), 'false');
  controller.close('create');
  controller.render();
  assert.equal(controller.activeMobileSheet, null);
  assert.equal(elements.createMenu.inert, true);
  assert.equal(elements.mobileCreateBtn.getAttribute('aria-expanded'), 'false');
});

test('create reuses its panel through mobile and compact transitions', () => {
  const { controller, elements, setLayout } = fixture('compact');
  const original = elements.createMenu;
  controller.open('create');
  controller.render();
  setLayout('mobile');
  controller.syncLayout('compact');
  controller.render();
  assert.equal(controller.activeMobileSheet, 'create');
  assert.equal(elements.createMenu, original);
  assert.equal(elements.createMenu.getAttribute('role'), 'dialog');
  setLayout('compact');
  controller.syncLayout('mobile');
  controller.render();
  assert.equal(controller.isOpen('create'), true);
  assert.equal(controller.activeMobileSheet, null);
  assert.equal(elements.createMenu, original);
  assert.equal(elements.createMenu.getAttribute('role'), 'menu');
});

test('wide editor can coexist with one transient command surface', () => {
  const { controller, elements } = fixture('wide');

  controller.open('editor');
  assert.deepEqual(controller.render(), { createOpen: false, searchOpen: false, displayOpen: false, editorOpen: true, activeMobileSheet: null });
  assert.equal(elements.mobileEditBtn.getAttribute('aria-expanded'), 'true');

  controller.open('display');
  assert.deepEqual(controller.render(), { createOpen: false, searchOpen: false, displayOpen: true, editorOpen: true, activeMobileSheet: null });
  controller.open('search');
  assert.deepEqual(controller.render(), { createOpen: false, searchOpen: true, displayOpen: false, editorOpen: true, activeMobileSheet: null });
  assert.equal(elements.mobileSearchBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.mobileDisplayBtn.getAttribute('aria-expanded'), 'false');
});

test('mobile tracks one explicit active sheet and clears it when closed', () => {
  const { controller, elements } = fixture('mobile');
  controller.open('search');
  controller.open('display');
  controller.open('editor');
  assert.equal(controller.render().activeMobileSheet, 'edit');
  assert.equal(elements.editorSurface.getAttribute('role'), 'dialog');
  controller.close('editor');
  assert.equal(controller.render().activeMobileSheet, null);
});

test('automatic editor open is blocked on mobile but explicit editor intent opens it', () => {
  const { controller } = fixture('mobile');
  assert.equal(controller.open('editor', { automatic: true }), false);
  assert.deepEqual(controller.render(), {
    createOpen: false, searchOpen: false, displayOpen: false, editorOpen: false, activeMobileSheet: null,
  });
  assert.equal(controller.open('editor'), true);
  assert.deepEqual(controller.render(), {
    createOpen: false, searchOpen: false, displayOpen: false, editorOpen: true, activeMobileSheet: 'edit',
  });
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

test('toggle owns the common open and close transition without treating it as a manual editor dismissal', () => {
  const { controller } = fixture('compact');
  assert.equal(controller.toggle('editor', { selected: true }), true);
  assert.equal(controller.isOpen('editor'), true);
  assert.equal(controller.toggle('editor', { selected: true }), true);
  assert.equal(controller.isOpen('editor'), false);
  assert.equal(controller.state.automaticOpenBlocked.editor, false);
});

test('layout changes preserve a user-opened transient command surface', () => {
  const wideSearch = fixture('wide');
  wideSearch.controller.open('editor');
  wideSearch.controller.open('search');
  wideSearch.controller.render();
  wideSearch.setLayout('compact');
  wideSearch.controller.syncLayout('wide');
  assert.deepEqual(wideSearch.controller.render(), {
    createOpen: false, searchOpen: true, displayOpen: false, editorOpen: true, activeMobileSheet: null,
  });

  wideSearch.setLayout('mobile');
  wideSearch.controller.syncLayout('compact');
  assert.deepEqual(wideSearch.controller.render(), {
    createOpen: false, searchOpen: true, displayOpen: false, editorOpen: false, activeMobileSheet: 'search',
  });
});

test('an active editor surface follows the responsive transition to mobile', () => {
  const automaticEditor = fixture('wide');
  assert.equal(automaticEditor.controller.open('editor', { automatic: true }), true);
  automaticEditor.controller.render();
  automaticEditor.setLayout('mobile');
  automaticEditor.controller.syncLayout('wide');
  assert.deepEqual(automaticEditor.controller.render(), {
    createOpen: false, searchOpen: false, displayOpen: false, editorOpen: true, activeMobileSheet: 'edit',
  });

  const userEditor = fixture('wide');
  userEditor.controller.open('editor');
  userEditor.controller.render();
  userEditor.setLayout('mobile');
  userEditor.controller.syncLayout('wide');
  assert.deepEqual(userEditor.controller.render(), {
    createOpen: false, searchOpen: false, displayOpen: false, editorOpen: true, activeMobileSheet: 'edit',
  });
});
