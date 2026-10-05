import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { createGpuMapRenderer } from '../../assets/js/modules/gpu-map-renderer.js';
import { createMapHost } from '../../assets/js/modules/app-map-host.js';

const frame = () => createMapVisualFrame({ frameId: 8, viewRevision: 3,
  viewState: { projection: 'flat', size: { width: 300, height: 200 }, translate: [150, 100], scale: 40, dpr: 2 },
  projectPath: () => 'snapshot-path' });

test('frame preparation snapshots the renderer DPR cap separately from source terrain DPR', t => {
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 3 };
  t.after(() => { globalThis.window = previousWindow; });
  const state = { projection: 'globe', size: { width: 300, height: 200 },
    view: { globeRotation: [0, 0, 0], flatCenter: [0, 0], globeZoom: 1, flatZoom: 1 } };
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: value => value, isMobile: () => false,
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null,
    mapWorkScheduler: { cancel() {} } });
  t.after(() => renderer.dispose());
  renderer.setRenderQuality({ dprCap: 1.5 });
  const host = createMapHost();
  host.connect({ projectState: { state }, rendering: { gpuMapRenderer: renderer },
    platformConfigurationA: { FLAT_PROJECTION_KIND: 'equirectangular' },
    projectionView: { currentMapSafeInsets: () => ({}) },
    mapView: { activeProjection: () => ({ translate: () => [150, 100], scale: () => 90 }), screenToGeo: () => [0, 0] } });
  const viewState = host.projectionViewSnapshot();
  const captured = createMapVisualFrame({ frameId: 1, viewState });
  assert.equal(captured.dpr, 1.5);
  assert.equal(captured.viewState.sourceDpr, 3);
  assert.deepEqual(captured.gpuViewport, [450, 300]);
});

test('projected SVG paths require a frame instead of reading a live path fallback', t => {
  const values = [];
  const queued = [];
  let current = null;
  const layer = { selectAll: () => ({ attr: (_name, path) => { values.push(path({ type: 'Sphere' })); } }) };
  const domain = createRenderingDomain({ requestFrame: callback => queued.push(callback), prepareView: () => current,
    projectedOverlayResources: { layers: [layer],
    path: () => 'live-path' } });
  t.after(() => domain.dispose());
  domain.invalidateView();
  assert.throws(() => queued.shift()(), /MapVisualFrame/);
  current = frame();
  domain.invalidateView(); queued.shift()();
  assert.ok(values.length > 0);
  assert.ok(values.every(value => value === 'snapshot-path'));
});

test('editing coordinates never evaluate live projection even when a frame is present', t => {
  const coordinate = [0, 0];
  const element = { parentNode: null, style: {}, tagName: 'circle', removeAttribute() {},
    setAttribute(name, value) { this[name] = value; } };
  const chain = {};
  for (const method of ['data', 'exit', 'remove', 'enter', 'append', 'attr']) chain[method] = () => chain;
  const layer = { node: () => null, selectAll: selector => ({ ...chain, each(callback) {
    if (selector.startsWith('g,')) callback.call(element, { coordinate });
  } }) };
  const queued = [];
  const domain = createRenderingDomain({ requestFrame: callback => queued.push(callback), prepareView: frame,
    getEditingRenderPacket: () => ({ snap: { coordinate } }), interactionResources: { snapLayer: layer,
    activeProjection: () => { throw new Error('live projection evaluated'); } } });
  t.after(() => domain.dispose());
  domain.invalidateEditingOverlays(); queued.shift()();
  assert.deepEqual([element.cx, element.cy], frame().projectVisibleCoordinate(coordinate));
});
