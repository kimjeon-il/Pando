import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpuMapRenderer } from '../../assets/js/modules/gpu-map-renderer.js';

function fixture(t) {
  const oldWindow = globalThis.window;
  const oldWorker = globalThis.Worker;
  const oldFrame = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.Worker = class { postMessage() {} terminate() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const state = { projection: 'globe', view: { globeZoom: 1, flatZoom: 1 }, physicalSettings: {}, pendingCountryRenderIds: new Set() };
  const retries = [];
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => path, scheduleGpuFrame: () => {}, scheduleGpuMeshRebuild: (...args) => retries.push(args),
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null,
    mapWorkScheduler: { cancel: () => {} }, isMobile: () => false, rendererUi: { setMapPreparationStatus() {} }, renderViewFrame: () => {} });
  t.after(() => { renderer.dispose(); globalThis.window = oldWindow; globalThis.Worker = oldWorker;
    globalThis.requestAnimationFrame = oldFrame; globalThis.cancelAnimationFrame = oldCancel; });
  return { state, renderer, retries };
}

test('failed boundary preparation exposes a retry through the real rebuild contract', t => {
  const { renderer, retries } = fixture(t);
  renderer.failMapPreparation(new Error('upload failed'));
  assert.equal(renderer.mapReadiness().status, 'error');
  renderer.retryMapPreparation();
  assert.deepEqual(retries, [[0, renderer.getProjectGeneration()]]);
  assert.equal(renderer.mapReadiness().status, 'boundaries');
});

test('pending precise resources cannot change the requested CSS scale band', t => {
  const { renderer } = fixture(t);
  renderer.syncCountryMeshQuality({ cssScale: 700 });
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  assert.equal(renderer.getRuntimeState().canonicalMeshReady, false);
  renderer.syncCountryMeshQuality({ cssScale: 504 });
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
});

test('focus and property editing retain precise geometry until explicitly released', async t => {
  const { renderer } = fixture(t);
  renderer.requestCountryFocus();
  await renderer.rebuildFromCountries([]);
  renderer.syncCountryMeshQuality({ cssScale: 300 });
  renderer.commitVisualFrame({ frameId: 1 });
  assert.equal(renderer.getRuntimeState().countryFocusPending, true);
  assert.equal(renderer.getRuntimeState().activeMeshQuality, 'canonical');
  renderer.cancelCountryFocus();
  renderer.setCountryPropertyEditingActive(true);
  renderer.syncCountryMeshQuality({ cssScale: 300 });
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  renderer.setCountryPropertyEditingActive(false);
  renderer.syncCountryMeshQuality({ cssScale: 300 });
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
  assert.equal(renderer.getRuntimeState().activeMeshQuality, 'canonical', 'uncertified startup mesh is never readmitted');
});

test('project replacement and projection changes reset the transition band to precise', async t => {
  const { state, renderer } = fixture(t);
  state.auditPreviewCountries = { features: [{ id: 'A' }] };
  renderer.syncCountryMeshQuality({ cssScale: 300 });
  renderer.syncCountryMeshQuality({ cssScale: 570 });
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'preview');
  state.projection = 'flat';
  renderer.syncCountryMeshQuality({ cssScale: 570, projection: 'flat' });
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
  renderer.requestCountryFocus();
  renderer.resetProjectRenderState();
  renderer.syncCountryMeshQuality({ cssScale: 570 });
  assert.equal(renderer.getRuntimeState().countryFocusPending, false);
  assert.equal(renderer.getRuntimeState().desiredCountryMeshQuality, 'canonical');
});
