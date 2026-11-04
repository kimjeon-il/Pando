import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfaceController } from '../../shared/frontend/js/modules/surface-controller.js';

function element(id = '') {
  const attributes = new Map(), classes = new Set();
  return { id, inert: false,
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); } },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); } };
}
function fixture(initialLayout) {
  let layout = initialLayout;
  const elements = Object.fromEntries(['objectSearchSurface','mapDisplaySurface','objectSearchBtn',
    'mapDisplayBtn','mobileSearchBtn','mobileDisplayBtn','mobileFileBtn','mobileBackdrop'].map(id => [id, element(id)]));
  const workspace = element('workspace'), body = element('body');
  const document = { body, activeElement: null, querySelector: selector => selector === '.workspace' ? workspace : null };
  return { controller: createSurfaceController({ getElement: id => elements[id], getLayout: () => layout, document }),
    elements, body, workspace, setLayout: value => { layout = value; } };
}

test('retired editor and creation surfaces cannot replace current search', () => {
  const { controller } = fixture('wide');
  controller.open('search');
  for (const surface of ['editor','create','layers','reference']) assert.equal(controller.open(surface), false);
  assert.equal(controller.isOpen('search'), true);
  assert.equal(controller.isOpen('display'), false);
});

test('search and display replace each other and synchronize triggers', () => {
  for (const layout of ['wide','compact','mobile','phone-landscape']) {
    const { controller, elements } = fixture(layout);
    controller.open('search'); controller.render();
    assert.equal(elements.objectSearchBtn.getAttribute('aria-expanded'), 'true');
    assert.equal(elements.objectSearchSurface.inert, false);
    controller.open('display'); controller.render();
    assert.equal(controller.isOpen('search'), false);
    assert.equal(controller.isOpen('display'), true);
    assert.equal(elements.mobileSearchBtn.getAttribute('aria-expanded'), 'false');
    assert.equal(elements.mobileDisplayBtn.getAttribute('aria-expanded'), 'true');
    controller.close('display'); controller.render();
    assert.equal(controller.isOpen('display'), false);
    assert.equal(elements.mobileDisplayBtn.getAttribute('aria-expanded'), 'false');
  }
});

test('mobile sheets expose dialog state and keep one active surface', () => {
  const { controller, elements, body } = fixture('mobile');
  controller.open('search'); controller.render();
  assert.equal(controller.activeMobileSheet, 'search');
  assert.equal(elements.objectSearchSurface.getAttribute('role'), 'dialog');
  assert.equal(elements.objectSearchSurface.getAttribute('aria-hidden'), 'false');
  assert.equal(elements.mapDisplaySurface.inert, true);
  assert.equal(body.classList.contains('map-sheet-open'), true);
  controller.open('display'); controller.render();
  assert.equal(elements.objectSearchSurface.inert, true);
  assert.equal(elements.mapDisplaySurface.inert, false);
  controller.close('display'); controller.render();
  assert.equal(controller.activeMobileSheet, null);
  assert.equal(body.classList.contains('map-sheet-open'), false);
});

test('the active search panel survives desktop, portrait and landscape transitions', () => {
  const { controller, setLayout, elements } = fixture('wide');
  controller.open('search'); controller.render();
  for (const [previous, next] of [['wide','compact'],['compact','mobile'],['mobile','phone-landscape'],['phone-landscape','wide']]) {
    setLayout(next); controller.syncLayout(previous); controller.render();
    assert.equal(controller.isOpen('search'), true, next);
    assert.equal(elements.objectSearchBtn.getAttribute('aria-expanded'), 'true', next);
    assert.equal(controller.activeMobileSheet, ['mobile','phone-landscape'].includes(next) ? 'search' : null, next);
  }
});
