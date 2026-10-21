import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfaceController } from '../../assets/js/modules/surface-controller.js';
import { installReferenceImageSurface } from '../../assets/js/modules/reference-image-surface.js';
import { setReferenceImageSurfaceEditing, setReferenceImageSurfaceActions } from '../../assets/js/modules/reference-image-surface-port.js';
import { installReferenceImageLineRefiner } from '../../assets/js/modules/reference-image-line-refine-controller.js';
import { installReferenceImageLiveWire } from '../../assets/js/modules/reference-image-live-wire-controller.js';

class Element {
  constructor(document) {
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.text = '';
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
  get parentElement() { return this.parent; }
  get previousElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) - 1] || null; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parent = this;
      this.children.push(child);
    }
  }
  appendChild(child) { this.append(child); return child; }
  prepend(child) { this.append(child); this.children.unshift(this.children.pop()); }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this);
    this.parent = null;
  }
  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.classList.contains(name));
    const attribute = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (!attribute) return false;
    const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return attribute[2] == null ? key in this.dataset : this.dataset[key] === attribute[2];
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  dispatch(name, properties = {}) {
    let stopped = false;
    const event = { target: this, preventDefault() {}, stopPropagation() { stopped = true; }, ...properties };
    for (let node = this; node; node = node.parent) {
      for (const listener of node.listeners.get(name) || []) listener(event);
      if (stopped) break;
    }
    return event;
  }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  removeEventListener(name, listener) {
    const listeners = this.listeners.get(name);
    listeners?.delete(listener);
    if (!listeners?.size) this.listeners.delete(name);
  }
}

function fixture() {
  let workspaceElement;
  const document = {
    elements: [], activeElement: null,
    querySelector: selector => selector === '.workspace' ? workspaceElement : null,
  };
  document.createElement = () => new Element(document);
  document.body = document.createElement();
  workspaceElement = document.createElement();
  workspaceElement.className = 'workspace';
  const styleValues = new Map();
  workspaceElement.style = { setProperty: (key, value) => styleValues.set(key, value) };
  workspaceElement.getBoundingClientRect = () => ({ left: 0, right: 1200, width: 1200 });
  const mapElement = document.createElement();
  mapElement.className = 'map-stage';
  const panel = document.createElement();
  panel.id = 'referenceImageSurface';
  panel.className = 'workspace-surface surface-reference ui-sheet reference-image-panel';
  workspaceElement.append(mapElement, panel);
  const launcher = document.createElement();
  launcher.id = 'referenceImageBtn';
  const resize = document.createElement();
  resize.className = 'reference-image-resize-handle';
  const header = document.createElement();
  header.className = 'surface-header reference-image-panel-header';
  const collapse = document.createElement();
  collapse.className = 'ui-button reference-image-collapse-button';
  collapse.dataset.referencePanelToggle = '';
  header.append(collapse);
  const body = document.createElement();
  body.id = 'referenceImageSurfaceBody';
  body.className = 'surface-body reference-image-body';
  const editor = document.createElement();
  body.append(editor);
  const summary = document.createElement();
  summary.className = 'surface-footer reference-image-editing-summary';
  const hint = document.createElement();
  hint.className = 'reference-image-editing-status';
  summary.append(hint);
  for (const action of ['navigation-toggle', 'undo', 'redo', 'finish', 'cancel']) {
    const button = document.createElement();
    button.className = 'ui-button btn';
    button.dataset.refAction = action;
    if (action === 'undo' || action === 'redo') {
      button.disabled = true;
      button.setAttribute('aria-label', `이미지 편집 ${action === 'undo' ? '실행 취소' : '다시 실행'}`);
    }
    summary.append(button);
  }
  const actions = document.createElement();
  actions.className = 'reference-image-workflow-actions';
  actions.dataset.refWorkflowActions = '';
  summary.append(actions);
  const auxiliary = document.createElement();
  auxiliary.className = 'reference-image-auxiliary-actions';
  auxiliary.dataset.refAuxiliaryActions = '';
  auxiliary.hidden = true;
  for (const [name, label] of [['line', '선 보강 작업'], ['live-wire', '자동 추적 작업']]) {
    const row = document.createElement();
    row.className = 'reference-image-calibration-actions';
    row.dataset[name === 'line' ? 'refLineActions' : 'refLiveWireActions'] = '';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    row.hidden = true;
    auxiliary.append(row);
  }
  summary.append(auxiliary);
  panel.append(resize, header, body, summary);
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
  return {
    panel, launcher, mapElement, onAction() {}, onAuxiliaryEditingStart() {}, editor, workspace, workspaceElement, styleValues,
    controller, heights, sync,
    setLayout(value) {
      const previous = layout;
      layout = value;
      controller.syncLayout(previous);
    },
  };
}

test('installing and reinstalling a complete surface preserves its controls and binds one launcher action', () => {
  const f = fixture();
  const document = f.panel.ownerDocument;
  const nodes = document.elements.slice();
  const parents = nodes.map(element => element.parentElement);
  let opened = 0;
  const install = () => installReferenceImageSurface({
    ...f, workspaceSurfaces: f.workspace, onOpen: () => { opened += 1; },
  });
  const adapter = install();
  assert.equal(document.elements.length, nodes.length, 'installation must bind the existing Surface, without creating wrappers or controls');
  assert.ok(nodes.every((element, index) => element.parentElement === parents[index]));
  f.launcher.dispatch('click');
  assert.equal(opened, 1);
  assert.equal(f.panel.hidden, false);
  adapter.destroy();
  const replacement = install();
  f.launcher.dispatch('click');
  assert.equal(opened, 2, 'destroy/reinstall must leave exactly one launcher callback');
  assert.equal(f.panel.hidden, false);
  assert.equal(document.elements.length, nodes.length);
  assert.ok(nodes.every((element, index) => element.parentElement === parents[index]));
  replacement.destroy();
});

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


test('desktop reference dock collapses without closing or cancelling the active mode', () => {
  const f = fixture();
  f.workspace.openSurface('reference');
  let closed = 0;
  const adapter = installReferenceImageSurface({
    ...f, workspaceSurfaces: f.workspace, onClose: () => { closed += 1; },
  });
  f.setLayout('wide');
  f.sync();
  assert.equal(f.workspaceElement.classList.contains('reference-image-docked'), true);

  adapter.setEditing(true, '이미지점 선택 중');
  const toggle = f.panel.querySelector('.reference-image-panel-header')
    .querySelector('.reference-image-collapse-button');
  const click = () => toggle.dispatch('click');
  click();
  assert.equal(f.panel.hidden, false);
  assert.equal(f.panel.classList.contains('reference-image-collapsed'), true);
  assert.equal(f.panel.classList.contains('reference-image-editing-active'), true);
  assert.equal(f.workspaceElement.classList.contains('reference-image-dock-collapsed'), true);
  assert.equal(f.panel.querySelector('.reference-image-body').inert, true);
  assert.equal(closed, 0);

  click();
  assert.equal(f.panel.classList.contains('reference-image-collapsed'), false);
  assert.equal(f.panel.classList.contains('reference-image-editing-active'), true);
  assert.equal(f.workspaceElement.classList.contains('reference-image-dock-collapsed'), false);
  assert.equal(f.panel.querySelector('.reference-image-body').inert, false);

  const resize = f.panel.querySelector('.reference-image-resize-handle');
  resize.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(f.styleValues.get('--reference-dock-width'), '352px');
  assert.equal(resize.getAttribute('aria-valuenow'), '352');

  f.workspace.closeSurface('reference');
  assert.equal(closed, 1);
  assert.equal(f.workspaceElement.classList.contains('reference-image-docked'), false);
});

test('mobile reference sheet collapse and edit expansion keep the panel open', () => {
  const f = fixture();
  f.workspace.openSurface('reference');
  let closed = 0;
  const adapter = installReferenceImageSurface({
    ...f, workspaceSurfaces: f.workspace, onClose: () => { closed += 1; },
  });
  const toggle = f.panel.querySelector('.reference-image-panel-header')
    .querySelector('.reference-image-collapse-button');
  const click = () => toggle.dispatch('click');
  const body = f.panel.querySelector('.reference-image-body');
  const summary = f.panel.querySelector('.reference-image-editing-summary');
  adapter.setEditing(true, '기준점 지정 중');
  assert.equal(body.inert, true);
  assert.equal(summary.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  click();
  assert.equal(body.inert, false);
  assert.equal(summary.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  click();
  assert.equal(body.inert, true);
  assert.equal(summary.hidden, false);
  assert.equal(f.panel.hidden, false);
  assert.equal(closed, 0);

  adapter.setEditing(false);
  click();
  assert.equal(f.panel.classList.contains('reference-image-collapsed'), true);
  assert.equal(f.heights.at(-1), 0);
  click();
  assert.equal(f.panel.classList.contains('reference-image-collapsed'), false);
  assert.equal(f.heights.at(-1), 1);
  assert.equal(closed, 0);
});

test('desktop workflow guidance remains actionable while the dock is collapsed and cleans up on clear or destroy', () => {
  const f = fixture();
  f.setLayout('wide');
  const actions = [];
  const onAction = event => actions.push(event.target.dataset.refAction);
  f.panel.addEventListener('click', onAction);
  const adapter = installReferenceImageSurface({ ...f, workspaceSurfaces: f.workspace, onAction });
  const workflow = {
    id: 'linear', title: '선 보정', steps: ['이미지 선', '지도 선', '미리보기', '적용'], step: 2,
    instruction: '변형 이미지를 확인하세요.', detail: '적용 전까지 원본 배치는 유지됩니다.',
    actions: [
      { action: 'linear-apply', label: '미리보기 적용', primary: true },
      { action: 'linear-cancel', label: '선 보정 취소' },
      { action: 'linear-map-undo', label: '마지막 점 취소', disabled: true },
    ],
  };
  adapter.setEditing(true, workflow.instruction);
  adapter.setWorkflow(workflow);
  const guide = f.mapElement.querySelector('[data-ref-workflow-guide]');
  assert.equal(guide.hidden, true);
  adapter.open();
  assert.equal(guide.hidden, false);
  assert.equal(guide.getAttribute('aria-label'), '참조 이미지 작업 안내');
  assert.equal(guide.querySelector('[data-ref-workflow-progress]').textContent, '3/4');
  const steps = guide.querySelector('.reference-image-workflow-steps').children;
  assert.equal(steps[0].classList.contains('is-complete'), true);
  assert.equal(steps[2].getAttribute('aria-current'), 'step');

  f.panel.querySelector('.reference-image-collapse-button').dispatch('click');
  assert.equal(f.panel.classList.contains('reference-image-collapsed'), true);
  assert.equal(guide.hidden, false);
  const applyButton = guide.querySelector('[data-ref-action="linear-apply"]');
  assert.equal(applyButton.type, 'button');
  assert.equal(applyButton.classList.contains('ghost'), false);
  const instruction = guide.querySelector('.reference-image-workflow-instruction');
  const writes = instruction.textWrites;
  adapter.setEditing(true, workflow.instruction);
  adapter.setWorkflow({ ...workflow });
  assert.equal(instruction.textWrites, writes);
  assert.equal(guide.querySelector('[data-ref-action="linear-apply"]'), applyButton);
  let mapEvents = 0;
  f.mapElement.addEventListener('pointerdown', () => { mapEvents += 1; });
  f.mapElement.addEventListener('click', () => { mapEvents += 1; });
  instruction.dispatch('pointerdown');
  applyButton.dispatch('click');
  guide.querySelector('[data-ref-action="linear-map-undo"]').dispatch('click');
  assert.deepEqual(actions, ['linear-apply']);
  assert.equal(mapEvents, 0);

  adapter.close();
  assert.equal(guide.hidden, true);
  adapter.setWorkflow(null);
  assert.equal(f.mapElement.querySelector('[data-ref-workflow-guide]'), null);
  assert.equal(guide.listeners.size, 0);
  adapter.open();
  adapter.setWorkflow(workflow);
  const replacement = f.mapElement.querySelector('[data-ref-workflow-guide]');
  assert.notEqual(replacement, guide);
  adapter.destroy();
  assert.equal(f.mapElement.querySelector('[data-ref-workflow-guide]'), null);
  assert.equal(replacement.listeners.size, 0);
});

test('mobile workflow actions replace generic completion while preserving navigation guidance and auxiliary editing', () => {
  const f = fixture();
  const actions = [];
  let auxiliaryStarts = 0;
  const onAction = event => actions.push(event.target.dataset.refAction);
  f.panel.addEventListener('click', onAction);
  const adapter = installReferenceImageSurface({
    ...f, workspaceSurfaces: f.workspace, onAction,
    onAuxiliaryEditingStart() {
      auxiliaryStarts += 1;
      adapter.setWorkflow(null);
      adapter.setEditing(false);
    },
  });
  adapter.open();
  const summary = f.panel.querySelector('.reference-image-editing-summary');
  const hint = summary.children[0];
  const navigation = summary.children[1];
  const undo = summary.children[2];
  const redo = summary.children[3];
  const finish = summary.children[4];
  const cancel = summary.children[5];
  const workflow = {
    id: 'linear', title: '선 보정', steps: ['이미지 선', '지도 선', '미리보기', '적용'], step: 0,
    instruction: '이미지에서 선을 따라 점을 찍으세요.', detail: '두 점 이상 지정하세요.',
    actions: [
      { action: 'linear-image-finish', label: '지도 선 지정', primary: true, disabled: true },
      { action: 'linear-cancel', label: '선 보정 취소' },
    ],
  };
  adapter.setEditing(true, workflow.instruction);
  adapter.setWorkflow(workflow);
  assert.equal(summary.hidden, false);
  assert.equal(f.mapElement.querySelector('[data-ref-workflow-guide]').hidden, true);
  assert.equal(hint.textContent, '선 보정 · 1/4 · 이미지에서 선을 따라 점을 찍으세요.');
  assert.equal(navigation.dataset.refAction, 'navigation-toggle');
  assert.equal(undo.getAttribute('aria-label'), '이미지 편집 실행 취소');
  assert.equal(redo.getAttribute('aria-label'), '이미지 편집 다시 실행');
  assert.equal(finish.hidden, true);
  assert.equal(cancel.hidden, true);
  const workflowActions = summary.querySelector('[data-ref-workflow-actions]');
  assert.equal(workflowActions.children[0].disabled, true);
  workflow.actions[0].disabled = false;
  adapter.setWorkflow(workflow);
  workflowActions.children[0].dispatch('click');
  assert.deepEqual(actions, ['linear-image-finish']);

  const navigationText = '지도 이동 중 · 이미지 편집 단계는 유지됩니다.';
  adapter.setEditing(true, navigationText);
  adapter.setWorkflow(workflow);
  assert.equal(hint.textContent, `선 보정 · 1/4 · ${navigationText}`);
  assert.equal(f.mapElement.querySelector('.reference-image-workflow-instruction').textContent, navigationText);
  const writes = hint.textWrites;
  adapter.setWorkflow({ ...workflow });
  assert.equal(hint.textWrites, writes);

  const preview = {
    ...workflow, step: 2, instruction: '변형 이미지를 확인하세요.', detail: '',
    actions: [
      { action: 'linear-apply', label: '미리보기 적용', primary: true },
      { action: 'linear-cancel', label: '선 보정 취소' },
    ],
  };
  adapter.setEditing(true, preview.instruction);
  adapter.setWorkflow(preview);
  assert.equal(hint.textContent, '선 보정 · 3/4 · 변형 이미지를 확인하세요.');
  assert.deepEqual(workflowActions.children.map(button => button.dataset.refAction), ['linear-apply', 'linear-cancel']);
  workflowActions.children[0].dispatch('click');
  assert.deepEqual(actions, ['linear-image-finish', 'linear-apply']);
  assert.equal(finish.hidden, true);

  assert.equal(auxiliaryStarts, 0);
  setReferenceImageSurfaceEditing(true, '보조선을 따라 점을 찍으세요.');
  assert.equal(auxiliaryStarts, 1);
  assert.equal(f.mapElement.querySelector('[data-ref-workflow-guide]'), null);
  assert.equal(hint.textContent, '보조선을 따라 점을 찍으세요.');
  assert.equal(summary.hidden, false);
  assert.equal(workflowActions.hidden, true);
  assert.equal(workflowActions.children.length, 0);
  assert.equal(finish.hidden, true);
  assert.equal(cancel.hidden, true);
  assert.equal(summary.children[1], navigation);
  assert.equal(summary.children[2], undo);
  assert.equal(summary.children[3], redo);
  setReferenceImageSurfaceEditing(false);
  assert.equal(auxiliaryStarts, 1);
  assert.equal(summary.hidden, true);
  assert.equal(finish.hidden, false);
  assert.equal(cancel.hidden, false);

  setReferenceImageSurfaceEditing(true, '보조 도구 조작 중');
  adapter.setEditing(true, '이미지를 드래그해 배치하세요.');
  assert.equal(summary.hidden, false);
  assert.equal(finish.hidden, false, 'direct placement editing restores its own completion action');
  assert.equal(cancel.hidden, false);
  adapter.setWorkflow(workflow);
  assert.equal(finish.hidden, true);
  assert.equal(cancel.hidden, true);
  adapter.setWorkflow(null);
  assert.equal(finish.hidden, false, 'clearing a workflow does not retain the previous auxiliary projection');
  assert.equal(cancel.hidden, false);
  adapter.destroy();
});

for (const [name, install] of [
  ['line refiner', installReferenceImageLineRefiner],
  ['live wire', installReferenceImageLiveWire],
]) {
  test(`inactive ${name} rendering preserves the surface's workflow and auxiliary completion buttons`, async t => {
    const f = fixture();
    const document = f.panel.ownerDocument;
    const adapter = installReferenceImageSurface({ ...f, workspaceSurfaces: f.workspace });
    adapter.open();
    f.editor.dataset.refEditor = '';
    const auxiliaryHost = f.panel.querySelector('[data-ref-auxiliary-actions]');
    assert.equal(auxiliaryHost.parentElement, f.panel.querySelector('.reference-image-editing-summary'));
    assert.equal(f.editor.querySelector('[data-ref-line-actions]'), null);
    assert.equal(f.editor.querySelector('[data-ref-live-wire-actions]'), null);

    document.documentElement = { dataset: {} };
    document.getElementById = id => id === 'map' ? f.mapElement : null;
    document.querySelector = selector => selector === '.reference-image-panel' ? f.panel : null;
    const createElement = document.createElement;
    document.createElement = tag => {
      const element = createElement();
      if (tag === 'canvas') element.getContext = () => ({ clearRect() {} });
      return element;
    };
    const observers = [];
    class MutationObserver {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    }
    const globals = {
      document,
      MutationObserver,
      ResizeObserver: class { observe() {} disconnect() {} },
      addEventListener() {}, removeEventListener() {},
    };
    const savedGlobals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) globalThis[key] = value;
    let controller;
    t.after(() => {
      controller?.destroy();
      adapter.destroy();
      for (const [key, descriptor] of savedGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    });

    const workflow = {
      id: 'gcp', title: '기준점 추가', steps: ['이미지점', '지도점'], step: 0,
      instruction: '이미지에서 맞출 지점을 선택하세요.',
      actions: [{ action: 'gcp-cancel', label: '기준점 추가 취소' }],
    };
    adapter.setEditing(true, workflow.instruction);
    adapter.setWorkflow(workflow);
    controller = install();
    assert.ok(controller);
    await Promise.resolve();
    const summary = f.panel.querySelector('.reference-image-editing-summary');
    const genericActions = summary.querySelectorAll('[data-ref-action="finish"], [data-ref-action="cancel"]');
    assert.equal(controller.active(), false);
    assert.equal(genericActions.length, 2);
    assert.ok(genericActions.every(button => button.hidden), 'an idle auxiliary renderer must preserve workflow completion ownership');
    assert.equal(summary.querySelector('[data-ref-workflow-actions]').hidden, false);
    assert.equal(auxiliaryHost.hidden, true, 'another workflow keeps its own footer action slot');

    adapter.setWorkflow(null);
    setReferenceImageSurfaceEditing(true, '보조 도구 조작 중');
    for (const observer of observers) observer.callback();
    await Promise.resolve();
    assert.ok(genericActions.every(button => button.hidden), 'an idle renderer must preserve another auxiliary tool\'s completion ownership');
    setReferenceImageSurfaceEditing(false);
    adapter.setEditing(true, '이미지를 드래그해 배치하세요.');
    for (const observer of observers) observer.callback();
    await Promise.resolve();
    assert.ok(genericActions.every(button => !button.hidden));
  });
}


test('P5 action groups stay in a single Surface footer through phases and layout changes', () => {
  const f = fixture();
  const adapter = installReferenceImageSurface({ ...f, workspaceSurfaces: f.workspace });
  adapter.open();
  const summary = f.panel.querySelector('.reference-image-editing-summary');
  const host = f.panel.querySelector('[data-ref-auxiliary-actions]');
  const line = host.querySelector('[data-ref-line-actions]');
  const wire = host.querySelector('[data-ref-live-wire-actions]');
  assert.equal(host.parentElement, summary);
  assert.equal(summary.hidden, true);

  setReferenceImageSurfaceActions('line', { start: { hidden: false, disabled: false } });
  const start = line.querySelector('[data-ref-line-action="start"]');
  assert.equal(start.textContent, '선 보강');
  assert.equal(start.parentElement, line);
  assert.equal(line.children.length, 4);
  assert.equal(line.hidden, false);
  assert.equal(summary.hidden, false);
  assert.equal(summary.classList.contains('is-compact'), false);
  adapter.setEditing(true, '기준점 추가');
  assert.equal(host.hidden, true, 'regular image editing suppresses the idle auxiliary toolbar');
  adapter.setEditing(false);
  assert.equal(host.hidden, false);

  setReferenceImageSurfaceActions('line', {
    apply: { hidden: false, disabled: true },
    redraw: { hidden: false },
    cancel: { hidden: false },
  });
  const apply = line.querySelector('[data-ref-line-action="apply"]');
  assert.equal(apply.disabled, true);
  assert.equal(start.hidden, true);
  assert.equal(line.querySelector('[data-ref-line-action="cancel"]').hidden, false);

  setReferenceImageSurfaceEditing(true, '선 보강 중');
  assert.equal(summary.classList.contains('is-compact'), true);
  assert.equal(f.panel.querySelector('.reference-image-body').inert, true);
  assert.equal(start, line.querySelector('[data-ref-line-action="start"]'));
  assert.equal(apply, line.querySelector('[data-ref-line-action="apply"]'));
  assert.equal(host.parentElement, summary);

  setReferenceImageSurfaceActions('live-wire', {
    finish: { hidden: false, disabled: false },
    undo: { hidden: false, disabled: true },
    cancel: { hidden: false },
  });
  assert.equal(wire.children.length, 6);
  assert.equal(wire.querySelector('[data-ref-live-wire-action="undo"]').disabled, true);

  f.setLayout('wide');
  f.sync();
  assert.equal(summary.hidden, false);
  assert.equal(summary.classList.contains('is-compact'), false);
  assert.equal(host.parentElement, summary);
  assert.equal(start.parentElement, line);
  assert.equal(apply.parentElement, line);

  setReferenceImageSurfaceEditing(false);
  setReferenceImageSurfaceActions('line');
  setReferenceImageSurfaceActions('live-wire');
  assert.equal(host.hidden, true);
  assert.equal(summary.hidden, true);
  adapter.destroy();
});
