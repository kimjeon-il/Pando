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

  getBoundingClientRect() {
    return { left: 5, top: 10 };
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

test('interactive draft handles do not begin map panning', () => {
  const surface = new PointerSurface();
  surface.isDraftHandle = true;
  const pans = [];
  const controller = createController(surface, {
    interactiveTarget: target => target.isDraftHandle === true,
    panBy: (dx, dy) => pans.push([dx, dy]),
  });

  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 50, clientY: 50 }));
  surface.dispatchEvent(pointerEvent('pointerup', { clientX: 50, clientY: 50 }));

  assert.deepEqual(surface.captured, []);
  assert.deepEqual(pans, []);
  controller.destroy();
});

test('drawing owns a drag, emits local coalesced samples, and does not pan', () => {
  const surface = new PointerSurface();
  const events = [];
  const pans = [];
  const controller = createController(surface, {
    canDrawStroke: () => true,
    beginStroke: (point, event) => { events.push(['begin', point, event.pointerType]); return true; },
    moveStroke: points => events.push(['move', points]),
    endStroke: point => events.push(['end', point]),
    panBy: (dx, dy) => pans.push([dx, dy]),
  });

  surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 20, clientY: 30 }));
  surface.dispatchEvent(pointerEvent('pointermove', {
    clientX: 35,
    clientY: 45,
    getCoalescedEvents: () => [
      { clientX: 28, clientY: 38 },
      { clientX: 35, clientY: 45 },
    ],
  }));
  surface.dispatchEvent(pointerEvent('pointerup', { clientX: 40, clientY: 50 }));

  assert.deepEqual(surface.captured, [7]);
  assert.deepEqual(events, [
    ['begin', [15, 20], 'mouse'],
    ['move', [[23, 28], [30, 35]]],
    ['end', [35, 40]],
  ]);
  assert.deepEqual(pans, []);
  controller.destroy();
});

test('a second touch cancels an unfinished stroke and starts centroid pan and pinch', () => {
  const surface = new PointerSurface();
  let cancelled = 0;
  const pans = [];
  const zooms = [];
  const controller = createController(surface, {
    canDrawStroke: () => true,
    beginStroke: () => true,
    cancelStroke: () => { cancelled += 1; },
    panBy: (dx, dy) => pans.push([dx, dy]),
    setZoom: value => zooms.push(value),
  });

  surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 20 }));
  surface.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 }));
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 40, clientY: 20 }));
  surface.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 30 }));

  assert.equal(cancelled, 1);
  assert.deepEqual(pans, [[5, 5]]);
  assert.equal(zooms.length, 1);
  controller.destroy();
});
