import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpuMapRenderer } from '../../assets/js/modules/gpu-map-renderer.js';

function fixture(t) {
  const oldWindow = globalThis.window;
  const oldWorker = globalThis.Worker;
  const oldFrame = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.Worker = class {};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const state = { projection: 'globe', view: { globeZoom: 1, flatZoom: 1 }, physicalSettings: {}, pendingCountryRenderIds: new Set() };
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => path, scheduleGpuFrame: () => {},
    mapWorkScheduler: { cancel: () => {} }, isMobile: () => false, rendererUi: {}, renderViewFrame: () => {} });
  t.after(() => { renderer.dispose(); globalThis.window = oldWindow; globalThis.Worker = oldWorker;
    globalThis.requestAnimationFrame = oldFrame; globalThis.cancelAnimationFrame = oldCancel; });
  return { state, renderer };
}

test('pending canonical availability never replaces the latest zoom request', t => {
  const { state, renderer } = fixture(t);
  assert.equal(typeof renderer.syncCountryMeshQuality, 'function');
  state.view.globeZoom = 2.2;
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  assert.equal(renderer.getRuntimeState().canonicalMeshReady, false);
  state.view.globeZoom = 2;
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
  state.view.globeZoom = 1.8;
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
});

test('a focus session survives precise frames and view publication until user navigation resumes', async t => {
  const { state, renderer } = fixture(t);
  state.auditPreviewCountries = { features: [{ id: 'A' }] };
  renderer.requestCountryFocus();
  await renderer.rebuildFromCountries([]);
  assert.equal(renderer.getRuntimeState().activeMeshQuality, 'canonical');
  renderer.commitVisualFrame({ frameId: 1 });
  assert.equal(renderer.getRuntimeState().countryFocusPending, true);
  renderer.syncCountryMeshQuality();
  renderer.commitVisualFrame({ frameId: 2 });
  assert.equal(renderer.getRuntimeState().activeMeshQuality, 'canonical');
  assert.equal(renderer.getRuntimeState().countryFocusPending, true);
  renderer.cancelCountryFocus();
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().activeMeshQuality, 'preview');
});

test('an open property editor holds canonical independently of the active map tool', t => {
  const { renderer } = fixture(t);
  assert.equal(typeof renderer.setCountryPropertyEditingActive, 'function');
  renderer.setCountryPropertyEditingActive(true);
  renderer.setCountryEditingActive(false);
  renderer.requestCountryFocus();
  renderer.cancelCountryFocus();
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  renderer.setCountryPropertyEditingActive(false);
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
});

test('editing survives mode changes and releases without latching at world zoom', t => {
  const { state, renderer } = fixture(t);
  assert.equal(typeof renderer.setCountryEditingActive, 'function');
  renderer.setCountryEditingActive(true);
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  state.projection = 'flat';
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  renderer.setCountryEditingActive(false);
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
});

test('focus waits for an exact frame and project replacement clears its lifetime', t => {
  const { renderer } = fixture(t);
  assert.equal(typeof renderer.requestCountryFocus, 'function');
  renderer.requestCountryFocus();
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().countryFocusPending, true);
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  renderer.commitVisualFrame({ frameId: 1 });
  assert.equal(renderer.getRuntimeState().countryFocusPending, true);
  renderer.resetProjectRenderState();
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().countryFocusPending, false);
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
});

test('cancelled focus and projection changes cannot revive pending exact work', t => {
  const { state, renderer } = fixture(t);
  renderer.requestCountryFocus();
  renderer.cancelCountryFocus();
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
  renderer.requestCountryFocus();
  state.projection = 'flat';
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().countryFocusPending, false);
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
});

test('a replacement project in the band cannot inherit the old canonical history', async t => {
  const { state, renderer } = fixture(t);
  state.view.globeZoom = 3;
  await renderer.rebuildFromCountries([]);
  assert.equal(renderer.getRuntimeState().activeMeshQuality, 'canonical');
  renderer.resetProjectRenderState();
  state.view.globeZoom = 2;
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
});

test('cancelled focus cannot revive when canonical finishes loading later', async t => {
  const { state, renderer } = fixture(t);
  state.auditPreviewCountries = { features: [{ id: 'A' }] };
  renderer.requestCountryFocus();
  renderer.syncCountryMeshQuality();
  assert.equal(renderer.getRuntimeState().canonicalMeshReady, false);
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  renderer.cancelCountryFocus();
  await renderer.rebuildFromCountries([]);
  renderer.commitVisualFrame({ frameId: 1 });
  assert.equal(renderer.getRuntimeState().countryFocusPending, false);
  assert.equal(renderer.getRuntimeState().activeMeshQuality, 'preview');
});
