import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraNavigation } from '../../assets/js/modules/app-camera-navigation.js';
import { normalizeMapSurfaceDragDelta } from '../../assets/js/modules/map-host.js';
import { equirectangularCenterForAnchor } from '../../assets/js/modules/map-layout-metrics.js';

test('continuous zoom can defer Worker settle and view persistence until the gesture ends', () => {
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
      projectDomain: { queueViewAutosave: () => events.push(['persist']) },
    },
  });

  assert.equal(owner.zoomBy(1.1, false, { settle: false, persist: false }), true);
  assert.deepEqual(events, [['cancel'], ['view', 'zoom-control-interaction']]);
  assert.equal(owner.zoomBy(1.1, false), true);
  assert.deepEqual(events, [['cancel'], ['view', 'zoom-control-interaction'], ['cancel'], ['settle', 'zoom-control-settle'], ['persist']]);
});

test('world reset cancels an outstanding focus before settling the current view', () => {
  const events = [];
  const state = { projection: 'globe', view: { globeZoom: 5 } };
  const owner = createCameraNavigation();
  owner.connect({ projectState: { state },
    rendering: { gpuMapRenderer: { cancelCountryFocus: () => events.push('cancel') } },
    mapView: { syncMapHostFromState: () => events.push(state.view.globeZoom) },
    domains: { renderingDomain: { endInteraction: () => events.push('settle') },
      projectDomain: { queueViewAutosave: () => {} } },
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
      ...(host ? { mapHost: { isReady: () => true, dragBy: (dx, dy) => owner.dragLegacyMapViewBy(dx, dy) } } : {}) },
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