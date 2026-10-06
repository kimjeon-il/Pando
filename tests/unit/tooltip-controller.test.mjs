import assert from 'node:assert/strict';
import test from 'node:test';
import { createTooltipController } from '../../assets/js/modules/tooltip-controller.js';
import { editorNode } from './helpers/editor-dom-fixture.mjs';

function fixture() {
  const tooltip = editorNode(); tooltip.id = 'uiTooltip';
  const document = editorNode(); document.createElement = editorNode; document.getElementById = () => null;
  document.documentElement = editorNode();
  const window = { ...editorNode(), innerWidth: 390, innerHeight: 844, clearTimeout() {}, matchMedia: () => ({ matches: true }) };
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
