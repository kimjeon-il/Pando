import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapInputController } from '../../assets/js/modules/map-input-controller.js';

class PointerSurface {
  captured = [];
  listeners = new Map();

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target = this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }

  setPointerCapture(pointerId) {
    this.captured.push(pointerId);
  }
}

function pointerEvent(type, overrides = {}) {
  return {
    type,
    button: 0,
    pointerId: 7,
    pointerType: 'mouse',
    clientX: 20,
    clientY: 20,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  };
}

function createController(surface, overrides = {}) {
  return createMapInputController({
    element: surface,
    interactiveTarget: () => false,
    canNavigate: () => true,
    getRevision: () => 1,
    beginMovement: () => {},
    finishMovement: () => {},
    panBy: () => {},
    scheduleViewRender: () => {},
    getZoom: () => 1,
    setZoom: () => {},
    zoomBy: () => {},
    canDirectTap: () => false,
    directTap: () => {},
    canDoubleTap: () => false,
    suppressClick: () => {},
    ...overrides,
  });
}

test('a simple pointer click keeps its original overlay target', () => {
  const surface = new PointerSurface();
  const controller = createController(surface);

  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointerup'));

  assert.deepEqual(surface.captured, []);
  controller.destroy();
});

test('pointer capture begins only after navigation crosses the drag threshold', () => {
  const surface = new PointerSurface();
  const pans = [];
  const controller = createController(surface, {
    panBy: (dx, dy) => pans.push([dx, dy]),
  });

  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 22, clientY: 22 }));
  assert.deepEqual(surface.captured, []);

  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 30, clientY: 24 }));
  assert.deepEqual(surface.captured, [7]);
  assert.deepEqual(pans, [[10, 4]]);
  controller.destroy();
});
