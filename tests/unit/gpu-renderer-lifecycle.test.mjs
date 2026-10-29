import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuMapRenderer,physicalSceneMatchesContext } from "../../shared/frontend/js/modules/gpu-map-renderer.js";
import { createGpuResourceLifecycle } from "../../shared/frontend/js/modules/gpu-resource-lifecycle.js";

test('physical presentation requires the selected land and water revisions, including no water',()=>{
  const polygon=(role,geometryRevision)=>({role,geometryRevision});
  const target={ready:true,landRevision:'historical-land',waterRevision:'historical-water'};
  assert.equal(physicalSceneMatchesContext({polygons:[polygon('physical-land','modern-land')]},target),false);
  assert.equal(physicalSceneMatchesContext({polygons:[polygon('physical-land','historical-land')]},target),false);
  const scene={polygons:[polygon('physical-land','historical-land'),polygon('physical-water','historical-water')]};
  assert.equal(physicalSceneMatchesContext(scene,target),true);
  assert.equal(physicalSceneMatchesContext(scene,{...target,ready:false}),false);
  assert.equal(physicalSceneMatchesContext(scene,{...target,waterRevision:null}),false);
  assert.equal(physicalSceneMatchesContext({polygons:[scene.polygons[0]]},{...target,waterRevision:null}),true);
});

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

test('temporal presentation wait is cancelled by a newer generation and rejects stale requests',async t=>{
  const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
  t.after(()=>{globalThis.window=previous;});
  const renderer=createGpuMapRenderer({state:{physicalSettings:{},pendingCountryRenderIds:new Set()},rendererUi:{},isMobile:()=>false,mapWorkScheduler:{cancel(){}},runtimeAssetUrl:path=>path,
    renderCountryBoundaryFeatures:()=>[],countryBoundaryStyleById:()=>null,scheduleGpuFrame:()=>{}});
  renderer.resetProjectRenderState({generation:1,presentation:'temporal'});
  assert.equal(renderer.canPresentVisualFrame({frameId:1,projectGeneration:1}),false);
  assert.equal(renderer.canPresentVisualFrame({frameId:1,projectGeneration:0},{succeeded:true}),false);
  const pending=renderer.waitForTemporalPresentation();
  renderer.resetProjectRenderState({generation:2});
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(await renderer.waitForTemporalPresentation(),true);
  renderer.resetProjectRenderState({generation:3,presentation:'temporal',isCurrent:()=>false});
  await assert.rejects(renderer.waitForTemporalPresentation(),{name:'AbortError',cancelled:true});
  renderer.dispose();
});
