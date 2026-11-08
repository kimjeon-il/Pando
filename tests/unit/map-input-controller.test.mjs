import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../shared/frontend/js/modules/map-input-controller.js";
import * as __dep3 from "../../shared/frontend/js/modules/map-input-presentation.js";
import * as __dep4 from "../../shared/frontend/js/modules/camera-navigation.js";
import * as __dep5 from "../../shared/frontend/js/modules/map-host.js";
import * as __dep6 from "../../shared/frontend/js/modules/map-layout-metrics.js";
import * as __dep7 from "../../shared/frontend/js/modules/camera-pan.js";
import * as __dep8 from "../helpers/source-functions.mjs";
import * as __dep9 from "../helpers/read-frontend-source.mjs";
import * as __dep10 from "../../shared/frontend/js/modules/map-interaction-style.js";
contractSuite("map-input-controller", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { createMapInputController } = __dep2;
const { createMapInputPresentation } = __dep3;


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

test('interactive labels do not begin map panning', () => {
  const surface = new PointerSurface();
  surface.isLabel = true;
  const pans = [];
  const controller = createController(surface, {
    interactiveTarget: target => target.isLabel === true,
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
});
contractSuite("camera-navigation", () => {
const { describe : featureDescribe } = __dep1;
const __suiteDependency0 = __dep0;
const __suiteDependency1 = __dep1;
const __suiteDependency2 = __dep4;
const __suiteDependency3 = __dep5;
const __suiteDependency4 = __dep6;
const __suiteDependency5 = __dep1;
const __suiteDependency6 = __dep0;
const __suiteDependency7 = __dep7;
featureDescribe("camera-navigation", () => {
  const assert = __suiteDependency0.default;
  const test = __suiteDependency1.default;
  const {  createCameraNavigation  } = __suiteDependency2;
  const {  normalizeMapSurfaceDragDelta  } = __suiteDependency3;
  const {  equirectangularCenterForAnchor  } = __suiteDependency4;
test('continuous zoom can defer Worker settle until the gesture ends', () => {
  const events = [];
  const owner = createCameraNavigation();
  owner.connect({
    projectState: { state: { projection: 'flat', view: { flatZoom: 1, globeZoom: 1 } } },
    rendering: { gpuMapRenderer: { cancelCountryFocus: () => events.push(['cancel']) } },
    platform: { clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)) },
    mapNavigation: {
      ZOOM_LIMITS: {
        flat: { min: 0.5, max: 32 },
        globe: { min: 0.5, max: 32 },
      },
    },
    domains: {
      renderingDomain: {
        endInteraction: reason => events.push(['settle', reason]),
        invalidateView: reason => events.push(['view', reason]),
      },
    },
  });

  assert.equal(owner.zoomBy(1.1, { settle: false }), true);
  assert.deepEqual(events, [['cancel'], ['view', 'zoom-control-interaction']]);
  assert.equal(owner.zoomBy(1.1, false), true);
  assert.deepEqual(events, [['cancel'], ['view', 'zoom-control-interaction'], ['cancel'], ['settle', 'zoom-control-settle']]);
});

test('world reset cancels an outstanding focus before settling the current view', () => {
  const events = [];
  const state = { projection: 'globe', view: { globeZoom: 5 } };
  const owner = createCameraNavigation();
  owner.connect({ projectState: { state },
    rendering: { gpuMapRenderer: { cancelCountryFocus: () => events.push('cancel') } },
    mapView: { syncMapHostFromState: () => events.push(state.view.globeZoom) },
    domains: { renderingDomain: { endInteraction: () => events.push('settle') } },
  });
  owner.resetView();
  assert.deepEqual(events, ['cancel', 1, 'settle']);
});

function focusNavigationFixture({ host = false } = {}) {
  const events = [];
  const state = { projection: 'flat', size: { width: 200, height: 200 },
    view: { flatZoom: 1.25, globeZoom: 1.25, flatCenter: [0, 0], globeRotation: [0, 0, 0] } };
  const owner = createCameraNavigation();
  const projection = coordinate => [100 + (coordinate[0] - state.view.flatCenter[0]) * Math.PI / 180 * 100 * state.view.flatZoom,
    100 - (coordinate[1] - state.view.flatCenter[1]) * Math.PI / 180 * 100 * state.view.flatZoom];
  const renderer = { requestCountryFocus: () => events.push('focus'), cancelCountryFocus: () => events.push('cancel') };
  owner.connect({ projectState: { state }, rendering: { gpuMapRenderer: renderer },
    platform: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)), d3: { geo: { centroid: () => [10, 10] } } },
    countries: { validLabelAnchor: coordinate => Array.isArray(coordinate) && coordinate.length === 2 && coordinate.every(Number.isFinite) },
    surfaces: { isMobile: () => false },
    mapNavigation: { normalizeMapSurfaceDragDelta, equirectangularCenterForAnchor, FLAT_LATITUDE_LIMIT: 89,
      ZOOM_LIMITS: { flat: { min: 0.5, max: 32 }, globe: { min: 0.5, max: 32 } } },
    mapView: { updateProjection: () => {}, syncMapHostFromState: () => {}, activeProjection: () => projection,
      screenToGeo: point => point.every(Number.isFinite)
        ? [state.view.flatCenter[0] + (point[0] - 100) * 180 / (Math.PI * 100 * state.view.flatZoom),
          state.view.flatCenter[1] - (point[1] - 100) * 180 / (Math.PI * 100 * state.view.flatZoom)] : null,
      flatProjection: { scale: () => 100 * state.view.flatZoom }, path: { bounds: () => [[0, 0], [100, 100]] },
      projectionLayoutMetrics: () => ({ centerX: 100, centerY: 100, flatBaseScale: 100,
        fitInsets: { left: 0, right: 0, top: 0, bottom: 0 } }),
      ...(host ? { mapHost: { isReady: () => true, dragBy: (dx, dy) => owner.panMapViewBy(dx, dy) } } : {}) },
    domains: { renderingDomain: { invalidateView: () => {}, endInteraction: () => {} }, projectDomain: { queueViewAutosave: () => {} } },
  });
  return { owner, state, events };
}

for (const source of ['wheel', 'pinch']) {
  test(`${source} cancels focus only after a valid user camera change`, () => {
    const { owner, state, events } = focusNavigationFixture();
    owner.focusCoordinate([10, 10], 1.25);
    assert.equal(owner.transformMapView({ zoom: state.view.flatZoom, fromPoint: [100, 100], toPoint: [100, 100], source }), false);
    assert.deepEqual(events, ['focus']);
    assert.equal(owner.transformMapView({ zoom: state.view.flatZoom * 1.1, fromPoint: [100, 100], toPoint: [100, 100], source }), true);
    assert.deepEqual(events, ['focus', 'cancel']);
  });
}

test('pinch translation cancels focus without a zoom change', () => {
  const { owner, state, events } = focusNavigationFixture();
  owner.focusCoordinate([10, 10], 1.25);
  assert.equal(owner.transformMapView({ zoom: state.view.flatZoom, fromPoint: [100, 100], toPoint: [105, 100], source: 'pinch' }), true);
  assert.deepEqual(events, ['focus', 'cancel']);
});

for (const host of [false, true]) {
  test(`pointer pan ${host ? 'through ready host' : 'before host readiness'} cancels focus only for finite movement`, () => {
    const { owner, events } = focusNavigationFixture({ host });
    owner.focusCoordinate([10, 10], 1.25);
    assert.equal(owner.dragMapBy(0, 0), false);
    assert.equal(owner.dragMapBy(Number.NaN, Infinity), false);
    assert.deepEqual(events, ['focus']);
    assert.equal(owner.dragMapBy(5, 0), true);
    assert.deepEqual(events, ['focus', 'cancel']);
  });
}

test('invalid and clamped zoom attempts preserve the focus session and camera', () => {
  const { owner, state, events } = focusNavigationFixture();
  owner.focusCoordinate([10, 10], 1.25);
  for (const factor of [1, Number.NaN, Infinity, -1]) assert.equal(owner.zoomBy(factor), false);
  assert.equal(state.view.flatZoom, 1.25);
  assert.deepEqual(events, ['focus']);
  state.view.flatZoom = 32;
  assert.equal(owner.zoomBy(2), false);
  assert.deepEqual(events, ['focus']);
});

test('object focus internal fitting and anchor alignment preserve their new focus session', () => {
  const { owner, events } = focusNavigationFixture();
  owner.fitMapToFeature({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [10, 10] } });
  assert.deepEqual(events, ['focus']);
});
test('clamped latitude-only pans preserve focus in flat and globe views', () => {
  for (const projection of ['flat', 'globe']) {
    const { owner, state, events } = focusNavigationFixture();
    state.projection = projection;
    owner.focusCoordinate([0, 89], 1.25);
    assert.equal(owner.dragMapBy(0, 5), false);
    assert.deepEqual(events, ['focus']);
  }
});
});
featureDescribe("camera-pan", () => {
  const { test } = __suiteDependency5;
  const assert = __suiteDependency6.default;
  const { panCameraView } = __suiteDependency7;
test('both hosts share globe sensitivity, flat longitude wrapping and latitude clamps',()=>{
 const view={globeRotation:[0,0,0],globeZoom:4,flatCenter:[179,0]};
 assert.equal(panCameraView(view,'globe',100,100),true);
 assert.deepEqual(view.globeRotation,[11,-11,0]);
 panCameraView(view,'globe',0,10000);assert.equal(view.globeRotation[1],-89);
 panCameraView(view,'flat',-10,1000,{scale:180/Math.PI});
 assert.deepEqual(view.flatCenter,[-171,85]);
 assert.equal(panCameraView(view,'flat',0,0,{scale:1}),false);
});
});
});
contractSuite("map-layout-metrics", () => {
const { applicationFunctionSource } = __dep8;
const assert = __dep0.default;
const test = __dep1.default;
const { readFrontendSources } = __dep9;
const { createMapLayoutMetricsSnapshot, equirectangularCenterForAnchor } = __dep6;


const appSource = readFrontendSources('map-projection','camera-navigation','map-workspace-host','workspace-surfaces');

const functionSource = name => applicationFunctionSource(appSource, name);

test('layout snapshot derives stable projection metrics without accessors', () => {
  const snapshot = createMapLayoutMetricsSnapshot({
    width: 1200,
    height: 800,
    dpr: 2,
    safeInsets: { left: 120, right: 80, top: 20, bottom: 40 },
    fitInsets: { left: 120, right: 260, top: 20, bottom: 40 },
    revision: 7,
    reason: 'panel-layout',
  });

  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.safe), true);
  assert.deepEqual(snapshot.safe, { left: 120, right: 80, top: 20, bottom: 40 });
  assert.deepEqual(snapshot.fitInsets, { left: 120, right: 260, top: 20, bottom: 40 });
  assert.equal(snapshot.contentWidth, 1000);
  assert.equal(snapshot.contentHeight, 740);
  assert.equal(snapshot.centerX, 620);
  assert.equal(snapshot.centerY, 390);
  assert.equal(snapshot.revision, 7);
  assert.equal(snapshot.reason, 'panel-layout');
});

test('flat equirectangular anchor center is solved exactly in one step', () => {
  const coordinate = [37.75, 64.5];
  const screenPoint = [815, 215];
  const translate = [600, 400];
  const scale = 420;
  const center = equirectangularCenterForAnchor({ coordinate, screenPoint, translate, scale });

  assert.ok(center);
  const projectedX = translate[0] + scale * (coordinate[0] - center[0]) * Math.PI / 180;
  const projectedY = translate[1] - scale * (coordinate[1] - center[1]) * Math.PI / 180;
  assert.ok(Math.abs(projectedX - screenPoint[0]) < 1e-9);
  assert.ok(Math.abs(projectedY - screenPoint[1]) < 1e-9);
});

test('flat anchor keeps periodic longitude and latitude safety bounds', () => {
  const center = equirectangularCenterForAnchor({
    coordinate: [-179.5, 89.8],
    screenPoint: [780, 800],
    translate: [600, 400],
    scale: 300,
    latitudeLimit: 89.999,
  });

  assert.ok(center[0] >= -180 && center[0] < 180);
  assert.equal(center[1], 89.999);
});

test('render and anchor paths consume cached layout while event paths refresh it', () => {
  const safeInsets = functionSource('currentMapSafeInsets', 'updateProjection');
  assert.doesNotMatch(safeInsets, /getComputedStyle|querySelector|getBoundingClientRect/);
  assert.match(safeInsets, /projectionLayoutMetrics\(\)\.safe/);
  const projectionLayout = functionSource('projectionLayoutMetrics', 'currentMapSafeInsets');
  assert.doesNotMatch(projectionLayout, /getComputedStyle|querySelector|getBoundingClientRect/);

  const anchor = functionSource('alignGeographicAnchor', 'transformMapView');
  assert.match(anchor, /equirectangularCenterForAnchor/);
  assert.match(anchor, /attempt < 4/);
  assert.doesNotMatch(anchor, /attempt < 12/);

  const resizeQueue = functionSource('queueMapResize', 'watchDevicePixelRatio');
  assert.match(resizeQueue, /refreshMapLayoutMetrics/);
  assert.match(appSource, /queueMapResize\('resize-observer'\)/);
  assert.match(appSource, /queueMapResize\('visual-viewport-resize'\)/);
  assert.match(appSource, /queueMapResize\('panel-layout'\)/);
  assert.match(appSource, /queueMapResize\('orientation-change'\)/);
  assert.match(appSource, /queueMapResize\('dpr-change'\)/);
  assert.equal((appSource.match(/(?<!get )refreshMapLayoutMetrics\(/g) || []).length, 3);
});
});
contractSuite("map-interaction-style", () => {
const test = __dep1.default;
const assert = __dep0.default;
const { resolveMapStrokeStyle, interactionStrokeScale, resolveMapInteractionStyle, scaleInteractionStroke } = __dep10;

const darkTokens = { accent: '#cda95d', textStrong: '#f2f4f6' };
const lightTokens = { accent: '#315e9d', textStrong: '#11161c' };

test('interaction style resolves theme accents and derives hover from the effective selection color', () => {
  const dark = resolveMapInteractionStyle({ theme: 'dark', selectionColor: null, fillStrength: 0.35, tokens: darkTokens });
  assert.equal(dark.selection.color, '#cda95d');
  assert.deepEqual(dark.hover, { color: '#cda95d', width: 1.5, alpha: 0.85, fillAlpha: 0.10 * 0.35 });

  const light = resolveMapInteractionStyle({ theme: 'light', selectionColor: null, fillStrength: 0.35, tokens: lightTokens });
  assert.equal(light.selection.color, '#315e9d');
  assert.deepEqual(light.hover, { color: '#315e9d', width: 1.5, alpha: 0.85, fillAlpha: 0.08 * 0.35 });
});

test('interaction style keeps custom colors across themes and limits hover fill strength', () => {
  const dark = resolveMapInteractionStyle({ theme: 'dark', selectionColor: '#8b5cf6', fillStrength: 1, tokens: darkTokens });
  assert.equal(dark.selection.color, '#8b5cf6');
  assert.equal(dark.hover.color, '#8b5cf6');
  assert.equal(dark.hover.fillAlpha, 0.10);
  assert.deepEqual(dark.selection.primary, { innerWidth: 2.5, innerAlpha: 1, fillAlpha: 0.30 });
  assert.deepEqual(dark.selection.secondary, { innerWidth: 1.5, innerAlpha: 0.72, fillAlpha: 0.18 });

  const light = resolveMapInteractionStyle({ theme: 'light', selectionColor: '#8b5cf6', fillStrength: 0.5, tokens: lightTokens });
  assert.equal(light.selection.color, '#8b5cf6');
  assert.equal(light.hover.color, '#8b5cf6');
  assert.equal(light.hover.fillAlpha, 0.04);
  assert.equal(light.selection.primary.fillAlpha, 0.12);
  assert.equal(light.selection.secondary.fillAlpha, 0.07);
});

test('disabled selection outlines leave selection fills intact without disabling hover outlines', () => {
  const variants = [
    resolveMapInteractionStyle({ theme: 'dark', selectionColor: '#000000', outlineVisible: true, fillStrength: 0, tokens: darkTokens }),
    resolveMapInteractionStyle({ theme: 'dark', selectionColor: '#ffffff', outlineVisible: false, fillStrength: 0.8, tokens: darkTokens }),
  ];
  assert.equal(variants[0].hover.color, '#000000');
  assert.equal(variants[1].hover.color, '#ffffff');
  assert.ok(variants.every(style => style.hover.width === 1.5 && style.hover.alpha === 0.85));
  assert.equal(variants[0].selection.primary.fillAlpha, 0);
  assert.equal(variants[1].selection.primary.innerAlpha, 0);
  assert.equal(variants[1].selection.primary.fillAlpha, 0.24);
  assert.deepEqual(variants[0].drawOrder, ['candidate', 'hover', 'secondary-inner', 'primary-inner']);
});

test('interaction outlines recede together at map minimum zoom without changing normal-scale widths', () => {
  const normalFrame = { projection: 'flat', size: { width: 1200, height: 700 }, safeInset: { bottom: 26 }, scale: 1200 / (2 * Math.PI) };
  const overviewFrame = { ...normalFrame, scale: normalFrame.scale * 0.75 };
  assert.equal(interactionStrokeScale(normalFrame), 1);
  assert.ok(interactionStrokeScale(overviewFrame) < 0.5);
  const scaled = scaleInteractionStroke({ width: 2.5, innerCutout: 2.5, scaleWithView: true,
    casing: { width: 4, alpha: 0.72 } }, overviewFrame);
  assert.ok(scaled.width < 1.25);
  assert.ok(scaled.casing.width < 2);
  assert.equal(scaled.innerCutout, scaled.width);
});

test('interaction anti-aliasing is explicit style state instead of a DOM lookup', () => {
  const smooth = resolveMapInteractionStyle({ antiAlias: true });
  const crisp = resolveMapInteractionStyle({ antiAlias: false });
  assert.equal(smooth.antiAlias, true);
  assert.equal(crisp.antiAlias, false);
  for (const role of ['candidate', 'hover', 'secondary', 'primary']) {
    assert.equal(resolveMapStrokeStyle(smooth, role).antiAlias, true);
    assert.equal(resolveMapStrokeStyle(crisp, role).antiAlias, false);
  }
});

test('hover and selection request union coverage while preserving their ink and anti-aliasing', () => {
  for (const antiAlias of [true, false]) {
    const interaction = resolveMapInteractionStyle({ selectionColor: '#315e9d', antiAlias });
    for (const [role, width, alpha] of [['hover', 1.5, 0.85], ['secondary', 1.5, 0.72], ['primary', 2.5, 1]]) {
      const style = resolveMapStrokeStyle(interaction, role);
      assert.equal(style.coverage, 'union', role);
      assert.equal(style.color, '#315e9d', role);
      assert.equal(style.width, width, role);
      assert.equal(style.alpha, alpha, role);
      assert.equal(style.antiAlias, antiAlias, role);
    }
    assert.notEqual(resolveMapStrokeStyle(interaction, 'candidate').coverage, 'union');
    assert.throws(() => resolveMapStrokeStyle(interaction, 'edit-target'), /Unknown stroke role/);
  }
});
});
