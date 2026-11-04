import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapInputController } from "../../shared/frontend/js/modules/map-input-controller.js";
import { createMapInputPresentation } from "../../shared/frontend/js/modules/map-input-presentation.js";

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

function createPresentationFixture() {
  const surface = new PointerSurface(), errors = [], transforms = [];
  const noop = () => {};
  surface.classList = { add: noop, remove: noop };
  const svg = { on() { return this; } };
  const windowEvents = new globalThis.EventTarget();
  const state = {
    mapMoving: false, projectReplacing: false, spacePanActive: false, tool: 'select',
    projection: 'globe', view: { globeZoom: 1, flatZoom: 1 },
    labelPlacementMode: false,
  };
  const presentation = createMapInputPresentation({
    reservedTargetSelector: 'button,input,select,textarea,a,[contenteditable="true"]',
    window: { CustomEvent: globalThis.CustomEvent, dispatchEvent: event => windowEvents.dispatchEvent(event) },
    navigator: {},
    getRevision: () => 1,
    mapInteractionGate: {
      setForcedPan: noop, setNavigationEnabled: noop, isPandoTarget: () => false,
    },
    ports: {
      platform: {
        $: id => id === 'map' ? surface : null,
        d3: { select: () => svg, mouse: () => [0, 0], event: { target: surface } },
      },
      feedback: { reportOperationError: (error, message, code) => errors.push({ error, message, code }) },
      rendering: { gpuMapRenderer: { setHydroInteractionActive: noop, prioritizeLatest: noop } },
      projectState: { state, mapWorkScheduler: { setInteractionActive: noop } },
      domains: {
        renderingDomain: { beginInteraction: noop, endInteraction: noop, invalidateView: () => true },
        selectionDomain: { setHover: async () => false },
        projectDomain: { queueViewAutosave: noop },
      },
      renderQuality: {
        renderQualityController: { beginInteraction: noop, endInteraction: noop },
        applyAdaptiveRenderQuality: noop, queueAdaptiveRenderQualityRefresh: noop,
      },
      renderScene: { currentRenderQuality: { tier: 'full' } },
      pointerInteractionA: {
        cancelCountryHoverPick: noop, mapNavigationEnabled: () => true,
        mapClickBlocked: () => false, queueCountryHoverPick: noop,
      },
      pointerInteractionB: { suppressNextMapClick: noop },
      navigation: { dragMapBy: noop, transformMapView: value => transforms.push(value), zoomBy: noop },
      surfaces: { isMobile: () => true },
      objectPicking: { handleMapClick: noop, getTerritorialLabelRef: () => null },
      mapView: { screenToGeo: () => [0, 0] },
      interactionStateCommands: { setHoverHit: noop },
    },
    createMapInputController,
  });
  const controller = presentation.bindSvg(svg);
  return { surface, errors, transforms, controller, presentation };
}

function startPinch(surface) {
  surface.dispatchEvent(pointerEvent('pointerdown', {
    pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 20,
  }));
  surface.dispatchEvent(pointerEvent('pointerdown', {
    pointerId: 2, pointerType: 'touch', clientX: 40, clientY: 20,
  }));
}

test('project replacement blocks wheel, pinch and an already started drag until released', () => {
  const surface = new PointerSurface(), changes = [];
  let blocked = false;
  const controller = createController(surface, {
    isInputBlocked: () => blocked,
    dragBy: () => changes.push('drag'), transformView: () => changes.push('zoom'),
  });
  surface.dispatchEvent(pointerEvent('pointerdown'));
  blocked = true;
  surface.dispatchEvent(pointerEvent('pointermove', { clientX: 80 }));
  surface.dispatchEvent(pointerEvent('pointerup', { clientX: 80 }));
  surface.dispatchEvent(pointerEvent('wheel', { deltaY: -120 }));
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1 }));
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 60 }));
  surface.dispatchEvent(pointerEvent('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 100 }));
  assert.deepEqual(changes, []);
  blocked = false;
  surface.dispatchEvent(pointerEvent('wheel', { deltaY: -120 }));
  assert.deepEqual(changes, ['zoom']);
  controller.destroy();
});

test('middle button navigates when ordinary navigation is disabled', () => {
  const surface = new PointerSurface(); let moves = 0;
  const controller = createController(surface, { canNavigate: () => false, dragBy: () => { moves++; } });
  surface.dispatchEvent(pointerEvent('pointerdown', { button: 1 }));
  surface.dispatchEvent(pointerEvent('pointermove', { button: 1, clientX: 80 }));
  surface.dispatchEvent(pointerEvent('pointerup', { button: 1, clientX: 80 }));
  assert.ok(moves > 0); controller.destroy();
});

test('a second touch on an interactive target starts pinch', () => {
  const surface = new PointerSurface(), events = [];
  const controller = createController(surface, { interactiveTarget: () => true, beginMovement: () => events.push('move') });
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1 }));
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 2 }));
  assert.deepEqual(events, ['move']); controller.destroy();
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

test('viewer pinch navigates through the real presentation', t => {
  const fixture = createPresentationFixture();
  t.after(() => fixture.presentation.dispose());
  startPinch(fixture.surface);
  fixture.surface.dispatchEvent(pointerEvent('pointermove', {
    pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 30,
  }));

  assert.deepEqual(fixture.errors, []);
  assert.equal(fixture.controller.isPanning(), true);
  assert.equal(fixture.transforms.length, 1);
  assert.equal(fixture.transforms[0].source, 'pinch');
  assert.deepEqual(fixture.transforms[0].fromPoint, [20, 10]);
  assert.deepEqual(fixture.transforms[0].toPoint, [25, 15]);
  assert.ok(fixture.transforms[0].zoom > 1);
});
