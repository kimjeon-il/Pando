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
    dragBy: () => {},
    invalidateView: () => {},
    getZoom: () => 1,
    transformView: () => {},
    zoomBy: () => {},
    canDirectTap: () => false,
    directTap: () => {},
    canDoubleTap: () => false,
    suppressClick: () => {},
    ...overrides,
  });
}

test('image placement owns the gesture before map drawing or navigation starts', () => {
  const surface = new PointerSurface();
  const events = [];
  const controller = createController(surface, {
    beginExternalGesture: () => ({ kind: 'exclusive', move: () => events.push('image-move'), end: () => events.push('image-end') }),
    canDrawStroke: () => true, beginStroke: () => events.push('draw'),
    dragBy: () => events.push('map'),
  });
  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 80 }));
  surface.dispatchEvent(pointerEvent('pointerup', { clientX: 80 }));
  assert.deepEqual(events, ['image-move', 'image-end']);
  controller.destroy();
});

test('image point taps commit on release, while a drag pans without committing a point', () => {
  const surface = new PointerSurface(); const events = [];
  const controller = createController(surface, {
    beginExternalGesture: () => ({ kind: 'tap', end: () => events.push('point'), cancel: () => events.push('cancel') }),
    dragBy: () => events.push('pan'),
  });
  surface.dispatchEvent(pointerEvent('pointerdown'));
  assert.deepEqual(events, []);
  surface.dispatchEvent(pointerEvent('pointerup'));
  assert.deepEqual(events, ['point']);
  events.length = 0;
  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 80 }));
  surface.dispatchEvent(pointerEvent('pointerup', { clientX: 80 }));
  assert.deepEqual(events, ['pan', 'cancel']);
  controller.destroy();
});

test('second touch and pointercancel roll back image input rather than committing it', () => {
  const surface = new PointerSurface(); const events = [];
  const controller = createController(surface, {
    beginExternalGesture: () => ({ kind: 'exclusive', end: () => events.push('commit'), cancel: () => events.push('rollback') }),
    beginMovement: () => events.push('pinch'),
  });
  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointercancel'));
  assert.deepEqual(events, ['rollback']);
  events.length = 0;
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1 }));
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 2 }));
  assert.deepEqual(events, ['rollback', 'pinch']);
  controller.destroy();
});

test('middle button navigates without starting the active drawing tool', () => {
  const surface = new PointerSurface(); let draws = 0, moves = 0;
  const controller = createController(surface, { canNavigate: () => false, canDrawStroke: () => true, beginStroke: () => { draws++; }, dragBy: () => { moves++; } });
  surface.dispatchEvent(pointerEvent('pointerdown', { button: 1 }));
  surface.dispatchEvent(pointerEvent('pointermove', { button: 1, clientX: 80 }));
  surface.dispatchEvent(pointerEvent('pointerup', { button: 1, clientX: 80 }));
  assert.equal(draws, 0); assert.ok(moves > 0); controller.destroy();
});

test('second touch cancels the editing gesture before starting pinch', () => {
  const surface = new PointerSurface(), events = [];
  const controller = createController(surface, { interactiveTarget: () => true, cancelStroke: () => events.push('cancel'), beginMovement: () => events.push('move') });
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1 }));
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 2 }));
  assert.deepEqual(events, ['cancel', 'move']); controller.destroy();
});

test('a simple pointer click keeps its original overlay target', () => {
  const surface = new PointerSurface();
  const controller = createController(surface);

  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointerup'));

  assert.deepEqual(surface.captured, []);
  controller.destroy();
});

test('native browser gestures are prevented only on the map surface', () => {
  const surface = new PointerSurface();
  const controller = createController(surface);

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    const event = pointerEvent(type, { cancelable: true });
    surface.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }

  controller.destroy();
  const afterDestroy = pointerEvent('gesturestart', { cancelable: true });
  surface.dispatchEvent(afterDestroy);
  assert.equal(afterDestroy.defaultPrevented, false);
});

test('pointer capture begins only after navigation crosses the drag threshold', () => {
  const surface = new PointerSurface();
  const pans = [];
  const controller = createController(surface, {
    dragBy: (dx, dy) => pans.push([dx, dy]),
  });

  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 22, clientY: 22 }));
  assert.deepEqual(surface.captured, []);

  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 30, clientY: 24 }));
  assert.deepEqual(surface.captured, [7]);
  assert.deepEqual(pans, [[10, 4]]);
  controller.destroy();
});

test('pointer drag forwards left and upward surface deltas without sign conversion', () => {
  const surface = new PointerSurface();
  const drags = [];
  const controller = createController(surface, {
    dragBy: (dx, dy) => drags.push([dx, dy]),
  });

  surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 40, clientY: 40 }));
  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 24, clientY: 30 }));

  assert.deepEqual(drags, [[-16, -10]]);
  controller.destroy();
});

test('interactive draft handles do not begin map panning', () => {
  const surface = new PointerSurface();
  surface.isDraftHandle = true;
  const pans = [];
  const controller = createController(surface, {
    interactiveTarget: target => target.isDraftHandle === true,
    dragBy: (dx, dy) => pans.push([dx, dy]),
  });

  surface.dispatchEvent(pointerEvent('pointerdown'));
  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 50, clientY: 50 }));
  surface.dispatchEvent(pointerEvent('pointerup', { clientX: 50, clientY: 50 }));

  assert.deepEqual(surface.captured, []);
  assert.deepEqual(pans, []);
  controller.destroy();
});

test('genericFeature owns a drag, emits local coalesced samples, and does not pan', () => {
  const surface = new PointerSurface();
  const events = [];
  const pans = [];
  const controller = createController(surface, {
    canDrawStroke: () => true,
    beginStroke: (point, event) => { events.push(['begin', point, event.pointerType]); return true; },
    moveStroke: points => events.push(['move', points]),
    endStroke: point => events.push(['end', point]),
    dragBy: (dx, dy) => pans.push([dx, dy]),
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
  const transforms = [];
  const controller = createController(surface, {
    canDrawStroke: () => true,
    beginStroke: () => true,
    cancelStroke: () => { cancelled += 1; },
    transformView: value => transforms.push(value),
  });

  surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 20 }));
  surface.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 }));
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 40, clientY: 20 }));
  surface.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 30 }));

  assert.equal(cancelled, 1);
  assert.equal(transforms.length, 1);
  assert.deepEqual(transforms[0].fromPoint, [25, 10]);
  assert.deepEqual(transforms[0].toPoint, [30, 15]);
  assert.equal(transforms[0].source, 'pinch');
  assert.ok(transforms[0].zoom > 1);
  controller.destroy();
});

test('wheel zoom uses the pointer as a stable focal point', () => {
  const surface = new PointerSurface();
  const transforms = [];
  const controller = createController(surface, {
    getZoom: () => 2,
    transformView: value => transforms.push(value),
  });

  const event = pointerEvent('wheel', { clientX: 45, clientY: 70, deltaY: -120 });
  surface.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(transforms.length, 1);
  assert.deepEqual(transforms[0].fromPoint, [40, 60]);
  assert.deepEqual(transforms[0].toPoint, [40, 60]);
  assert.equal(transforms[0].source, 'wheel');
  assert.ok(transforms[0].zoom > 2);
  controller.destroy();
});
