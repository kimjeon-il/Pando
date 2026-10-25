import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuMapRenderer } from "../../shared/frontend/js/modules/gpu-map-renderer.js";
import { createGpuResourceLifecycle } from "../../shared/frontend/js/modules/gpu-resource-lifecycle.js";

test('disposing an awaited frame settles AbortError and a late callback is inert', async t => {
  let callback;
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
  const lifecycle = createGpuResourceLifecycle();
  const pending = lifecycle.nextFrame();
  lifecycle.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  callback(10);
  await assert.rejects(lifecycle.nextFrame(), { name: 'AbortError' });
});

test('renderer disposal is idempotent and prevents deferred initialization', async t => {
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('disposed renderer scheduled work'); });
  globalThis.Worker = class {};
  t.after(() => { delete globalThis.Worker; });
  let requestedFrames = 0;
  const renderer = createGpuMapRenderer({
    state: {}, runtimeAssetUrl: path => path,
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null,
    scheduleGpuFrame: () => requestedFrames++,
  });
  assert.equal(typeof renderer.dispose, 'function');
  renderer.dispose();
  renderer.dispose();
  assert.equal(await renderer.initialize(), false);
  assert.equal(renderer.getRenderDevice(), null);
  assert.equal(requestedFrames, 0);
});
test('timeline changes release modern preview ownership', t => {
  const previous = globalThis.window; globalThis.window = { devicePixelRatio: 1 };
  t.after(() => { globalThis.window = previous; });
  const state = { projection: 'globe', view: { globeZoom: 1 }, countryVisualPhase: 'preview',
    auditPreviewCountries: { features: [{ id: 'RUS' }] }, auditPreviewTerritorialUnits: [], auditPreviewGeometryReferences: new Map() };
  state.physicalSettings = {};
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => path,
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null, scheduleGpuFrame: () => {} });
  assert.equal(typeof renderer.invalidateCountryPreview, 'function');
  renderer.invalidateCountryPreview();
  assert.equal(renderer.getRuntimeState().previewAllowed, false);
  assert.equal(state.auditPreviewCountries, null);
  assert.equal(state.countryVisualPhase, 'canonical'); renderer.dispose();
});
