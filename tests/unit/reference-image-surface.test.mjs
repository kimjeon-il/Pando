import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfaceController } from '../../assets/js/modules/surface-controller.js';
import { installReferenceImageSurface } from '../../assets/js/modules/reference-image-surface.js';

class Element {
  constructor(document) {
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.textWrites = 0;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
    };
    document.elements.push(this);
  }
  set className(value) { this.classList.add(...value.split(' ')); }
  set textContent(value) { this.text = value; this.textWrites += 1; }
  get textContent() { return this.text; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  append(child) {
    if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child);
    child.parent = this;
    this.children.push(child);
  }
  prepend(child) { this.append(child); this.children.unshift(this.children.pop()); }
  querySelector(selector) {
    return this.children.find(child => child.classList.contains(selector.slice(1))) || null;
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
}

function fixture() {
  const document = { elements: [], activeElement: null, querySelector: () => null };
  document.createElement = () => new Element(document);
  document.body = document.createElement();
  const panel = document.createElement();
  const launcher = document.createElement();
  const header = document.createElement();
  header.className = 'reference-image-panel-header';
  panel.append(header);
  const editor = document.createElement();
  panel.append(editor);
  let layout = 'mobile';
  const controller = createSurfaceController({ document, getElement: id => document.elements.find(element => element.id === id), getLayout: () => layout });
  let registered;
  let heights = [];
  const sync = () => { controller.render(); registered?.sync(); };
  const workspace = {
    surfaceController: controller,
    isMobile: () => layout === 'mobile',
    registerReferenceImageSurface(adapter) { registered = adapter; sync(); return () => { registered = null; }; },
    openSurface(name) { controller.open(name); sync(); },
    closeSurface(name) { controller.close(name); sync(); },
    toggleSurface(name) { controller.toggle(name); sync(); },
    setMobileSheetHeight(_panel, value) { heights.push(value); },
    setReferenceImageGestureActive() {},
  };
  return { panel, launcher, editor, workspace, controller, heights, sync, setLayout(value) { layout = value; } };
}

test('late image surface registration reuses controls and closes once even with a reentrant mode callback', () => {
  const f = fixture();
  f.controller.open('reference');
  let opened = 0;
  let closed = 0;
  let adapter;
  adapter = installReferenceImageSurface({ ...f, workspaceSurfaces: f.workspace, onOpen: () => { opened += 1; }, onClose: () => { closed += 1; adapter.setEditing(false); } });
  const body = f.panel.querySelector('.reference-image-body');
  assert.equal(body.children.includes(f.editor), true);
  assert.equal(f.panel.hidden, false);
  assert.equal(opened, 1);
  f.panel.dataset.sheetSnap = '2';
  adapter.setEditing(true, '지도 위치 선택');
  assert.equal(body.inert, true);
  adapter.setEditing(false);
  assert.deepEqual(f.heights, [2]);
  f.workspace.openSurface('display');
  assert.equal(f.panel.hidden, true);
  assert.equal(closed, 1);
  f.sync();
  assert.equal(closed, 1);
  assert.equal(f.launcher.getAttribute('aria-expanded'), 'false');
});

test('repeated mode synchronization does not rewrite the live status node', () => {
  const f = fixture();
  const adapter = installReferenceImageSurface({ ...f, workspaceSurfaces: f.workspace });
  adapter.open();
  adapter.setEditing(true, '배치 중');
  const summary = f.panel.querySelector('.reference-image-editing-summary');
  const hint = summary.children[0];
  const writes = hint.textWrites;
  adapter.setEditing(true, '배치 중');
  assert.equal(hint.textWrites, writes);
  assert.equal(summary.children[1].classList.contains('btn'), true);
  assert.equal(summary.children[2].classList.contains('btn'), true);
});
