import assert from 'node:assert/strict';
import test from 'node:test';
import { createTooltipController } from '../../assets/js/modules/tooltip-controller.js';
import { editorNode } from './helpers/editor-dom-fixture.mjs';

function fixture() {
  const tooltip = editorNode(); tooltip.id = 'uiTooltip';
  const document = editorNode(); document.createElement = editorNode; document.getElementById = () => null;
  document.documentElement = editorNode();
  const window = { ...editorNode(), innerWidth: 390, innerHeight: 844, setTimeout, clearTimeout, matchMedia: () => ({ matches: true }) };
  const controller = createTooltipController({ document, window, tooltip, clamp: (v, min, max) => Math.max(min, Math.min(v, max)) });
  controller.bind();
  return { controller, tooltip, document, window };
}

test('map hover uses safe flag/name nodes, clamps to the viewport and owns no actions', () => {
  const { controller, tooltip, document } = fixture();
  document.dispatch('pointermove', { clientX: 389, clientY: 843, pointerType: 'mouse', target: { closest: selector => selector === '#map' ? {} : null } });
  controller.setMapHover({ name: '<img onerror=attack>', flagUrl: '/flag.svg' });
  assert.equal(tooltip.classList.contains('hidden'), false);
  assert.equal(tooltip.children[0].tagName, 'img');
  assert.equal(tooltip.children[1].textContent, '<img onerror=attack>');
  assert.equal(tooltip.children.length, 2);
  assert.equal(tooltip.style.left, '262px');
  assert.equal(tooltip.style.top, '803px');
  assert.equal(tooltip.dataset.kind, 'country');
  assert.equal(tooltip.dataset.ownerId, undefined);
});

for (const type of ['keydown', 'resize', 'pandolab:project-changed', 'pandolab:interaction-state']) test(`map tooltip hides on ${type}`, () => {
  const { controller, tooltip, document, window } = fixture();
  document.dispatch('pointermove', { clientX: 100, clientY: 100, pointerType: 'mouse', target: { closest: selector => selector === '#map' ? {} : null } });
  controller.setMapHover({ name: 'Country', flagUrl: null });
  (type === 'keydown' ? document : window).dispatch(type, { key: 'Escape' });
  assert.equal(tooltip.classList.contains('hidden'), true);
});

test('touch and a pointer outside the map cannot display country hover', () => {
  const { controller, tooltip, document } = fixture();
  controller.hide();
  document.dispatch('pointermove', { clientX: 100, clientY: 100, pointerType: 'touch', target: { closest: selector => selector === '#map' ? {} : null } });
  controller.setMapHover({ name: 'Country' });
  assert.equal(tooltip.classList.contains('hidden'), true);
  document.dispatch('pointermove', { pointerType: 'mouse', target: { closest: () => null } });
  controller.setMapHover({ name: 'Country' });
  assert.equal(tooltip.classList.contains('hidden'), true);
});

for (const dismissal of ['pointerdown', 'resize', 'keydown']) test(`fresh same-country movement resumes after ${dismissal} without a new domain hover change`, async () => {
  const { createSelectionDomain } = await import('../../assets/js/modules/selection-domain.js');
  const state = fixture();
  const domain = createSelectionDomain({ onHoverChanged: snapshot => state.controller.setMapHover(snapshot.hover ? { name: snapshot.hover.id } : null) });
  const move = (x, extra = {}) => state.document.dispatch('pointermove', { clientX: x, clientY: 100, pointerType: 'mouse', buttons: 0, target: { closest: selector => selector === '#map' ? {} : null }, ...extra });
  const ref = { domain: 'territorial', type: 'entity', id: 'A' };
  move(100); domain.setHover(ref, { source: 'map' });
  const before = domain.snapshot();
  assert.equal(state.tooltip.classList.contains('hidden'), false);
  (dismissal === 'resize' ? state.window : state.document).dispatch(dismissal, { key: 'Escape' });
  assert.equal(state.tooltip.classList.contains('hidden'), true);
  move(100); assert.equal(state.tooltip.classList.contains('hidden'), true, 'stationary pointer does not undo dismissal');
  move(101); domain.setHover(ref, { source: 'map' });
  assert.equal(state.tooltip.classList.contains('hidden'), false);
  assert.equal(domain.snapshot(), before, 'canonical same-ref hover remains deduplicated');
  assert.equal(domain.size(), 0);
  domain.setHover(null, { source: 'map' }); assert.equal(state.tooltip.classList.contains('hidden'), true);
  move(102); domain.setHover(ref, { source: 'map' }); assert.equal(state.tooltip.classList.contains('hidden'), false);
});

test('dismissed map hover stays suppressed during buttons, gestures, touch and overlays', () => {
  const { controller, tooltip, document, window } = fixture();
  const move = (x, extra = {}) => document.dispatch('pointermove', { clientX: x, clientY: 100, buttons: 0, pointerType: 'mouse', target: { closest: selector => selector === '#map' ? {} : null }, ...extra });
  move(100); controller.setMapHover({ name: 'A' }); document.dispatch('pointerdown');
  move(101, { buttons: 1 }); assert.equal(tooltip.classList.contains('hidden'), true);
  window.dispatch('pandolab:interaction-state', { detail: { active: true } });
  move(102); assert.equal(tooltip.classList.contains('hidden'), true);
  window.dispatch('pandolab:interaction-state', { detail: { active: false } });
  assert.equal(tooltip.classList.contains('hidden'), true);
  move(103, { pointerType: 'touch' }); assert.equal(tooltip.classList.contains('hidden'), true);
  move(104, { target: { closest: () => ({}) } }); assert.equal(tooltip.classList.contains('hidden'), true);
  move(105); assert.equal(tooltip.classList.contains('hidden'), false);
  window.dispatch('pandolab:project-changed'); move(106);
  assert.equal(tooltip.classList.contains('hidden'), true, 'project change invalidates cached presentation');
});

function transitionFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const button = editorNode('button'), svg = editorNode('svg'), use = editorNode('use');
  button.id = 'focusSelectedObjectBtn'; button.dataset.tooltip = '선택 객체로 이동';
  button.setAttribute('aria-describedby', 'existing-help');
  button.contains = target => [button, svg, use].includes(target);
  button.matches = selector => selector === ':hover' && button.hovered;
  button.closest = selector => ['[data-tooltip]', '.map-overlay-layer, button, input, select, textarea'].includes(selector) ? button : null;
  svg.closest = use.closest = selector => button.closest(selector);
  const map = { closest: selector => selector === '#map' ? map : null };
  f.document.getElementById = id => id === button.id ? button : null;
  const move = target => f.document.dispatch('pointermove', { target, pointerType: 'mouse', buttons: 0, clientX: 100, clientY: 100 });
  const enter = (target = use, relatedTarget = map) => {
    button.hovered = true;
    f.document.dispatch('pointerover', { target, relatedTarget, pointerType: 'mouse' });
  };
  const leave = (target = use, relatedTarget = map) => {
    button.hovered = button.contains(relatedTarget);
    f.document.dispatch('pointerout', { target, relatedTarget, pointerType: 'mouse' });
  };
  move(map); f.controller.setMapHover({ name: '독일' });
  return { ...f, button, svg, use, map, move, enter, leave };
}

for (const order of ['map-leave-first', 'control-entry-first', 'pointermove-first']) test(`country to button tooltip preserves the original delay (${order})`, t => {
  const f = transitionFixture(t);
  if (order === 'map-leave-first') f.controller.setMapHover(null);
  f.enter();
  if (order === 'control-entry-first') f.controller.setMapHover(null);
  f.move(f.use);
  if (order === 'pointermove-first') f.controller.setMapHover(null);
  t.mock.timers.tick(419);
  assert.equal(f.tooltip.classList.contains('hidden'), true);
  t.mock.timers.tick(1);
  assert.equal(f.tooltip.classList.contains('hidden'), false);
  assert.equal(f.tooltip.textContent, '선택 객체로 이동');
  assert.equal(f.tooltip.dataset.ownerId, f.button.id);
  assert.equal(f.tooltip.dataset.kind, undefined);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help uiTooltip');
});

test('nested SVG movement neither cancels nor restarts the pending button tooltip', t => {
  const f = transitionFixture(t);
  f.enter(f.use); f.move(f.use);
  t.mock.timers.tick(200);
  f.leave(f.use, f.svg); f.enter(f.svg, f.use); f.move(f.svg);
  t.mock.timers.tick(220);
  assert.equal(f.tooltip.textContent, '선택 객체로 이동');
  assert.equal(f.tooltip.classList.contains('hidden'), false);
  f.leave(f.svg, f.use); f.enter(f.use, f.svg); f.move(f.use);
  assert.equal(f.tooltip.classList.contains('hidden'), false);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help uiTooltip');
});

test('returning to the country cancels a pending control and releases visible control aria ownership', t => {
  const f = transitionFixture(t);
  f.enter(); f.move(f.use); t.mock.timers.tick(200);
  f.leave(); f.move(f.map); f.controller.setMapHover({ name: '프랑스' });
  t.mock.timers.tick(420);
  assert.equal(f.tooltip.dataset.kind, 'country');
  assert.equal(f.tooltip.children[0].textContent, '프랑스');
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
  f.enter(); f.move(f.use); t.mock.timers.tick(420);
  assert.equal(f.tooltip.dataset.ownerId, f.button.id);
  f.leave(); f.move(f.map);
  assert.equal(f.tooltip.dataset.kind, 'country');
  assert.equal(f.tooltip.dataset.ownerId, undefined);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
});

test('keyboard tooltip takes ownership from country hover until fresh map movement', t => {
  const f = transitionFixture(t);
  f.document.documentElement.classList.add('keyboard-navigation');
  f.document.dispatch('focusin', { target: f.button });
  assert.equal(f.tooltip.dataset.ownerId, f.button.id);
  f.controller.setMapHover({ name: '프랑스' });
  assert.equal(f.tooltip.dataset.ownerId, f.button.id, 'a delayed map publication cannot displace keyboard focus');
  f.move(f.map);
  assert.equal(f.tooltip.dataset.kind, 'country');
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
  f.document.dispatch('focusin', { target: f.button });
  f.document.dispatch('focusout', { target: f.button });
  assert.equal(f.tooltip.classList.contains('hidden'), true);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
});

for (const dismissal of ['pointerdown', 'keydown', 'pandolab:project-changed']) test(`pending button tooltip remains dismissed after ${dismissal}`, t => {
  const f = transitionFixture(t);
  f.enter(); f.move(f.use);
  (dismissal === 'pandolab:project-changed' ? f.window : f.document).dispatch(dismissal, { key: 'Escape' });
  t.mock.timers.tick(420);
  assert.equal(f.tooltip.classList.contains('hidden'), true);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
});
