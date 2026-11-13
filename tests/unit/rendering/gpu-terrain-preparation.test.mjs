import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuTerrainPreparation } from "../../../src/rendering/gpu-terrain-preparation.js";
import { fetchTerrainTile } from '../../../src/data/terrain-manifest.js';
import { createMapVisualFrame } from "../../../src/rendering/map-visual-frame.js";

test('GPU and Canvas share one tile geometry, neighbours and viewport selection algorithm', () => {
  const core=globalThis.PandoLabTerrainTileSelection;
  assert.ok(core && typeof core.tileSpec==='function' && typeof core.visible==='function');
  const level={id:'2',width:360,height:180,tileSize:180,columns:2,rows:1};
  const first=core.tileSpec(level,0,0),neighbours=core.neighbours(level,[first]);
  assert.deepEqual(first.bounds,[-180,90,0,-90]);
  assert.deepEqual(neighbours.map(row=>row.key),['2/1-0']);
  assert.equal(first.level,'2');
  assert.equal(core.tileSpec(level,0,0,true).level,2,'Canvas keeps its numeric level');
  const input={includeAll:true,viewport:[800,600],scale:400,projection:'flat',flatCenter:[0,0]};
  assert.deepEqual(core.visible(level,input).map(row=>row.key),['2/0-0','2/1-0']);
  assert.deepEqual(core.visible(level,{...input,numericLevel:true}).map(row=>row.bounds),
    core.visible(level,input).map(row=>row.bounds));
});

function fixture(t, onUnusable = () => {}, { mobile = false, geoDistance = () => 0, tintUrl, onTileFailure = () => {}, invalidate = () => {} } = {}) {
  const requests = [];
  const jobs = [];
  const deleted = [];
  const gl = { createTexture: () => ({}), deleteTexture: value => deleted.push(value), createBuffer: () => ({}) };
  for (const name of ['bindTexture', 'pixelStorei', 'texParameteri', 'texImage2D', 'bindBuffer', 'bufferData', 'deleteBuffer']) gl[name] = () => {};
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, resolve, reject });
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const owner = createGpuTerrainPreparation({
    readTile: (spec, signal) => fetchTerrainTile({url:`https://example.test/${spec.key}`}, {signal}),
    tintUrl,
    onUnusable,
    onTileFailure,
    isMobile: () => mobile,
    invalidate,
    geoDistance,
  });
  owner.setContext({ gl, ready: true, projectGeneration: 1, contextGeneration: 1,
    scheduler: { enqueueUpload: job => new Promise(resolve => {
      // A scheduler job settles only after its final GPU upload step.
      const step = job.step;
      jobs.push({ ...job, step: (...args) => {
        const result = step(...args);
        if (result.done) resolve();
        return result;
      } });
    }) } });
  return { owner, requests, jobs, deleted };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function primeBase({ owner, requests, jobs }, frame, view) {
  const previousBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  try {
    owner.prepare({ ...frame, scale: 50 }, view);
    await settle();
    for (const request of requests.filter(request => /\/0\//.test(request.url))) {
      request.resolve({ ok: true, blob: async () => ({}) });
      await settle();
      for (const job of jobs.splice(0)) while (!job.step().done) { /* Upload world base. */ }
    }
    owner.prepare(frame, view);
  } finally {
    if (previousBitmap) globalThis.createImageBitmap = previousBitmap;
    else delete globalThis.createImageBitmap;
  }
}

const mobileManifest = {
  representation: 'dem-relief-v1', gutter: 0,
  levels: [
    { id: 0, width: 2048, height: 1024, columns: 2, rows: 1, tileSize: 1024 },
    { id: 1, width: 4096, height: 2048, columns: 4, rows: 2, tileSize: 1024 },
    { id: 2, width: 8192, height: 4096, columns: 8, rows: 4, tileSize: 1024 },
  ],
};
const mobileFrame = (rotation = [0, 0]) => ({
  mode: 0, scale: 1200, dpr: 1, viewport: [390, 844],
  viewState: { projection: 'globe', rotation },
});
const mobileView = () => ({
  visible: true, physicalStyle: 'political', projection: 'globe',
  width: 390, height: 844, devicePixelRatio: 2,
  cacheBudgetBytes: 128 * 1024 * 1024,
});

function assertWorldCoverage(prepared) {
  for (let lat = -80; lat <= 80; lat += 20) for (let lon = -170; lon <= 170; lon += 20) {
    assert.ok(prepared.some(({ spec: { bounds: [west, north, east, south] } }) =>
      lon >= west && lon <= east && lat >= south && lat <= north), `uncovered terrain at ${lon},${lat}`);
  }
}

for (const representation of ['dem-relief-v1', 'raster-rgba-v1']) {
  test(representation + ' publishes current detail without downloading the offscreen world reserve', async t => {
    const { owner, requests, jobs } = fixture(t);
    t.after(() => owner.dispose());
    globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
    t.after(() => { delete globalThis.createImageBitmap; });
    owner.setManifest({ ...mobileManifest, representation });
    const frame = { mode: 1, scale: 1200, dpr: 1, viewport: [1000, 800], viewState: { projection: 'flat', projectionCenter: [0, 0] } };
    const view = { ...mobileView(), projection: 'flat', flatCenter: [0, 0], devicePixelRatio: 1 };
    assert.deepEqual(owner.prepare(frame, view), []);
    assert.ok(requests.slice(0, owner.stats().terrainTargetTileCount).every(request => request.url.includes('/2/')), 'visible target owns all initial fetch slots');
    for (const request of requests.filter(request => request.url.includes('/2/'))) {
      request.resolve({ ok: true, blob: async () => ({}) }); await settle();
      for (const job of jobs.splice(0)) while (!job.step().done) { /* Upload visible tiles. */ }
    }
    const ready = owner.prepare(frame, view);
    assert.equal(ready.length, owner.stats().terrainTargetTileCount);
    assert.ok(ready.every(tile => tile.spec.level === 2));
    assert.equal(owner.stats().terrainReady, true);
    const targetKey = owner.stats().terrainTargetKey;
    const distant = owner.prepare({ ...frame, viewState: { ...frame.viewState, projectionCenter: [160, 60] } }, { ...view, flatCenter: [160, 60] });
    assert.deepEqual(distant, []);
    assert.equal(owner.stats().terrainReady, false);
    assert.notEqual(owner.stats().terrainTargetKey, targetKey);
  });
}

test('visible DEM uploads take precedence over optional strokes without exceeding the shared upload scheduler',async t=>{
  const {owner,requests,jobs}=fixture(t);
  t.after(()=>owner.dispose());
  globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
  t.after(()=>{delete globalThis.createImageBitmap;});
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame(),mobileView());
  requests[0].resolve({ok:true,blob:async()=>({})});await settle();
  assert.equal(jobs.length,1);
  assert.ok(jobs[0].priority>60,'a current-view DEM upload must not queue behind optional stroke staging');
  assert.equal(jobs[0].allowDuringInteraction,true);
  assert.equal(owner.stats().terrainPendingDecodedBytes,4*1024*1024);
  jobs[0].step({byteBudget:256*1024});
  assert.equal(owner.stats().terrainPendingDecodedBytes,0);
});

test('late DEM decode shares one upload owner and rearms after settlement',async t=>{
  const {owner,requests,jobs}=fixture(t);
  t.after(()=>owner.dispose());
  globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
  t.after(()=>{delete globalThis.createImageBitmap;});
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame(),mobileView());
  assert.ok(requests.length>=2);
  requests[0].resolve({ok:true,blob:async()=>({})});
  await settle();
  requests[1].resolve({ok:true,blob:async()=>({})});
  await settle();
  assert.equal(jobs.length,1,'concurrent decodes must share a single scheduler owner');
  while(!jobs[0].step().done){ /* Drain the shared upload owner. */ }
  await settle();
  assert.equal(owner.stats().terrainPendingDecodedBytes,0);
});

test('country detail cannot bypass the shared DEM visible-memory limit', async t => {
  const setup = fixture(t, () => {}, { mobile: true });
  const { owner, requests } = setup;
  owner.setManifest(mobileManifest);
  await primeBase(setup, mobileFrame(), mobileView());
  assert.equal(owner.stats().terrainLevel, 1);
  assert.equal(owner.stats().terrainFetchConcurrency, 2);
  assert.ok(requests.length > 0);
  const detail = requests.slice(2);
  assert.ok(detail.length > 0);
  assert.ok(detail.every(request => new URL(request.url).pathname.startsWith('/1/')));
  owner.dispose();
});

test('terrain camera LOD uses the visual frame DPR when the backing canvas lowers its DPR', t => {
  const { owner } = fixture(t, () => {}, { mobile: true });
  t.after(() => owner.dispose());
  owner.setManifest({ ...mobileManifest, levels: [
    { id: 0, width: 1350, height: 675, columns: 2, rows: 1, tileSize: 1024 },
    { id: 1, width: 2700, height: 1350, columns: 3, rows: 2, tileSize: 1024 },
    { id: 2, width: 5400, height: 2700, columns: 6, rows: 3, tileSize: 1024 },
  ] });
  for (const dpr of [2, 1.5, 1]) {
    const frame = createMapVisualFrame({ frameId: 1, viewRevision: 1,
      viewState: { projection: 'globe', dpr, scale: 177.45, translate: [195, 409],
        size: { width: 390, height: 844 }, rotation: [-15, -25, 0] } });
    owner.prepare(frame, mobileView());
    assert.equal(owner.stats().terrainLevel, 1, '177.45 CSS px and source DPR 2 require 2700px, independent of backing canvas');
  }
});

test('terrain readiness requires uploaded world reserve and reports the source resolution limit', async t => {
  const setup = fixture(t);
  const { owner } = setup;
  t.after(() => owner.dispose());
  owner.setManifest(mobileManifest);
  const frame = mobileFrame(), view = mobileView();
  owner.prepare(frame, view);
  assert.equal(owner.stats().terrainReady, false);
  await primeBase(setup, frame, view);
  assert.equal(owner.stats().terrainReady, false, 'world base alone does not complete detailed terrain');
  assert.equal(owner.stats().terrainResolutionLimited, true);
  const key = owner.stats().terrainTargetKey;
  owner.prepare({ ...frame, scale: 100 }, view);
  assert.notEqual(owner.stats().terrainTargetKey, key);
  assert.equal(owner.stats().terrainReady, true, 'uploaded base is sufficient at small screen scale');
  assert.equal(owner.stats().terrainResolutionLimited, false);
  owner.reset();
  assert.equal(owner.stats().terrainReady, false);
});

for (const failDetail of [false, true]) {
test(`exhausted target${failDetail ? ' and reserve' : ''} failures preserve usable tiles and report detail failure until retry`, async t => {
  const failures = [], detailFailures = [];
  const { owner, requests, jobs } = fixture(t, reason => failures.push(reason), { onTileFailure: reason => detailFailures.push(reason) });
  t.after(() => owner.dispose());
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  owner.setManifest(mobileManifest);
  const frame = mobileFrame(), view = mobileView();
  owner.prepare(frame, view);
  const unavailable = ['/1/0-0'];
  if (failDetail) unavailable.push('/0/0-0');
  const failedRequests = new Set(), responded = new Set();
  for (let attempt = 0; attempt < 4; attempt++) {
    for (let index = 0; index < requests.length; index++) {
      const request = requests[index];
      if (responded.has(request)) continue;
      responded.add(request);
      if (unavailable.includes(new URL(request.url).pathname)) {
        failedRequests.add(request);
        request.resolve({ ok: false, status: 503 });
      } else request.resolve({ ok: true, blob: async () => ({}) });
      await settle();
      for (const job of jobs.splice(0)) while (!job.step().done) { /* Upload usable coverage. */ }
    }
    await settle();
    owner.prepare(frame, view);
    if (attempt < 3) { now += 5000; t.mock.timers.tick(5000); await settle(); }
  }
  assert.ok(owner.prepare(frame, view).length > 0, 'ready coverage stays visible despite an exhausted target');
  assert.equal(failedRequests.size, unavailable.length * 4, 'unavailable coverage paths exhaust their real retries');
  assert.equal(failures.length, 0, 'do not replace a source while usable coverage is present');
  assert.equal(detailFailures.length, 1);
  assert.equal(owner.stats().terrainReady, false, 'retry exhaustion cannot be readiness');
  assert.equal(owner.stats().terrainFailed, true);
  assert.match(detailFailures[0], /1\/0-0: 지형 타일 HTTP 503/, 'preserve the failing tile and technical cause');
  owner.prepare(frame, view);
  assert.equal(detailFailures.length, 1, 'report once until retry');
  owner.request({ key: 'malformed', pixelWidth: 2, pixelHeight: 2 });
  requests.at(-1).resolve({ ok: true, blob: async () => ({}) });
  await settle();
  assert.equal(failures.length, 1, 'a later invalid DEM must still reach the source failure boundary');
  assert.match(failures[0], /DEM tile dimensions differ/);
  owner.retry();
  assert.equal(owner.stats().terrainFailed, false);
  assert.ok(owner.prepare(frame, view).length > 0);
});
}

test('after world base the camera requests target terrain directly without intermediate detail levels', async t => {
  const setup = fixture(t, () => {}, { mobile: true });
  const { owner, requests } = setup;
  owner.setManifest(mobileManifest);
  await primeBase(setup, mobileFrame(), mobileView());
  assert.equal(owner.stats().terrainLevel, 1);
  assert.ok(requests.length > 0);
  const detail = requests.slice(2);
  assert.ok(detail.length > 0);
  assert.ok(detail.every(request => new URL(request.url).pathname.startsWith('/1/')));
  owner.dispose();
});

test('complete world base stays protected while GPU-ready detail replaces visible regions', async t => {
  const { owner, requests, jobs, deleted } = fixture(t);
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; owner.dispose(); });
  owner.setManifest(mobileManifest);
  const view = { ...mobileView(), devicePixelRatio: 1, projection: 'flat', flatCenter: [0, 0], cacheBudgetBytes: 8 * 1024 * 1024 };
  const frame = { mode: 1, scale: 100, dpr: 1, viewport: [5000, 5000], viewState: { projection: 'flat', projectionCenter: [0, 0] } };
  const drain = () => { for (const job of jobs.splice(0)) while (!job.step().done) { /* Real uploads. */ } };
  owner.prepare(frame, view);
  for (const request of requests) request.resolve({ ok: true, blob: async () => ({}) });
  await settle(); drain();
  const coarse = owner.prepare(frame, view);
  assert.deepEqual(coarse.map(tile => tile.spec.key), ['0/0-0', '0/1-0']);
  const detailedFrame = { ...frame, scale: 500 };
  assert.equal(owner.prepare(detailedFrame, view).length, 2);
  // Upload the four western target tiles. Eastern downloads remain stalled.
  for (const request of requests.filter(request => /\/1\/[01]-[01]$/.test(request.url))) {
    request.resolve({ ok: true, blob: async () => ({}) });
    await settle(); drain();
  }
  const partial = owner.prepare(detailedFrame, view);
  assert.equal(owner.stats().terrainTargetTilesLoaded, 4);
  assert.equal(owner.stats().terrainTargetTileCount, 8);
  assert.deepEqual(partial.filter(tile => tile.spec.level === 0).map(tile => tile.spec.key), ['0/0-0', '0/1-0']);
  assertWorldCoverage(partial);
  owner.request({ key: 'pressure', pixelWidth: 1024, pixelHeight: 1024 });
  requests.find(request => request.url.endsWith('/pressure')).resolve({ ok: true, blob: async () => ({}) });
  await settle(); drain();
  assert.ok(!deleted.includes(coarse[0].texture), 'world coverage reserve survives even where current detail is ready');
  assert.ok(!deleted.includes(coarse[1].texture), 'fallback still drawing eastern coverage must survive cache pressure');
  assert.ok(owner.prepare(detailedFrame, view).some(tile => tile.texture === coarse[1].texture));
});

test('rotating the mobile globe drops queued tiles from the old view', async t => {
  const longitudeDistance = (left, right) => Math.abs((((left[0] - right[0]) + 540) % 360) - 180) * Math.PI / 180;
  const setup = fixture(t, () => {}, { mobile: true, geoDistance: longitudeDistance });
  const { owner, requests, jobs } = setup;
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.setManifest(mobileManifest);
  await primeBase(setup, mobileFrame([-90, 0]), mobileView());
  owner.prepare(mobileFrame([90, 0]), mobileView());
  await settle();
  assert.ok(requests.slice(2, 4).every(request => request.options.signal.aborted));
  for (let index = 4; index < 12; index += 1) {
    assert.ok(requests[index], `request ${index} must have started`);
    requests[index].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    for (const job of jobs.splice(0)) job.step();
  }
  const laterPaths = requests.slice(4).map(request => new URL(request.url).pathname);
  assert.ok(laterPaths.some(path => /^\/2\/[0123]-/.test(path)), 'new-view detail must start');
  assert.deepEqual(laterPaths.filter(path => /^\/2\/[567]-/.test(path)), [], 'old-view queued tiles must not start');
  owner.dispose();
});

test('a new viewport starts its requests without waiting for obsolete in-flight downloads', async t => {
  const longitudeDistance = (left, right) => Math.abs((((left[0] - right[0]) + 540) % 360) - 180) * Math.PI / 180;
  const setup = fixture(t, () => {}, { mobile: true, geoDistance: longitudeDistance });
  const { owner, requests } = setup;
  owner.setManifest(mobileManifest);
  await primeBase(setup, mobileFrame([-90, 0]), mobileView());
  assert.equal(requests.length, 4);
  owner.prepare(mobileFrame([90, 0]), mobileView());
  await settle();
  assert.ok(requests.length >= 6, 'new-view downloads must start while old responses remain unresolved');
  assert.ok(requests.slice(2, 4).every(request => request.options.signal.aborted));
  assert.ok(requests.slice(0, 2).every(request => !request.options.signal.aborted), 'base is retained across views');
  assert.equal(owner.stats().terrainFailureCount, 0, 'view cancellation is not a failed tile');
  owner.dispose();
});

test('a request batch starts center tiles before viewport-edge tiles', t => {
  const { owner, requests } = fixture(t);
  owner.setManifest(mobileManifest);
  const frame = { mode: 1, scale: 1200, dpr: 1, viewport: [3000, 2000], viewState: { projection: 'flat', projectionCenter: [0, 0] } };
  owner.prepare(frame, { ...mobileView(), devicePixelRatio: 1, projection: 'flat', flatCenter: [0, 0] });
  const first = requests.slice(0, 4).map(request => new URL(request.url).pathname).sort();
  assert.deepEqual(first, ['/1/1-0', '/1/1-1', '/1/2-0', '/1/2-1']);
  owner.dispose();
});

test('desktop starts six visible downloads while missing current tiles; mobile remains at two', t => {
  const { owner, requests } = fixture(t);
  owner.setManifest(mobileManifest);
  owner.prepare({ mode: 1, scale: 1200, dpr: 1, viewport: [3000, 2000],
    viewState: { projection: 'flat', projectionCenter: [0, 0] } },
  { ...mobileView(), devicePixelRatio: 1, projection: 'flat', flatCenter: [0, 0] });
  assert.equal(owner.stats().terrainFetchConcurrency, 6);
  assert.equal(requests.length, 6);
  owner.dispose();
  const mobile = fixture(t, () => {}, { mobile: true });
  mobile.owner.setManifest(mobileManifest);
  mobile.owner.prepare(mobileFrame(), mobileView());
  assert.equal(mobile.owner.stats().terrainFetchConcurrency, 2);
  assert.equal(mobile.requests.length, 2);
  mobile.owner.dispose();
});

test('in-flight neighbouring prefetch cannot block queued tiles in the current viewport', async t => {
  const setup = fixture(t);
  const { owner, requests, jobs } = setup;
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.setManifest(mobileManifest);
  const frame = { mode: 1, scale: 1200, dpr: 1, viewport: [1000, 800], viewState: { projection: 'flat', projectionCenter: [0, 0] } };
  const view = { ...mobileView(), devicePixelRatio: 1, projection: 'flat', flatCenter: [0, 0] };
  await primeBase(setup, frame, view);
  for (let index = 2; index < 6; index++) {
    requests[index].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain uploads. */ }
  }
  owner.prepare(frame, view); // The upload invalidates a frame before speculative work starts.
  const before = requests.length;
  assert.equal(before, 10, 'complete current coverage returns speculation to four background download slots');
  owner.prepare({ ...frame, viewState: { ...frame.viewState, projectionCenter: [0, 30] } }, view);
  await settle();
  assert.ok(requests.length >= before + 2, 'both missing visible tiles must start before neighbouring responses finish');
  assert.equal(owner.stats().terrainFailureCount, 0);
  owner.dispose();
});

for (const [previousLevel, nextLevel, nextScale] of [[1, 2, 1200], [2, 1, 500]]) {
  test(`zoom transition ${previousLevel} to ${nextLevel} keeps coverage while replacement uploads at every scale`, async t => {
    const { owner, requests, jobs } = fixture(t);
    globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
    t.after(() => { delete globalThis.createImageBitmap; });
    owner.setManifest(mobileManifest);
    const view = { ...mobileView(), projection: 'flat', flatCenter:[0,0], devicePixelRatio: 1, cacheBudgetBytes: 256 * 1024 * 1024 };
    const focusedFrame=scale=>({mode:1,scale,dpr:1,viewport:[1000,800],viewState:{projection:'flat',projectionCenter:[0,0]}});
    const visibleCoverage=prepared=>{for(const lat of [-15,0,15])for(const lon of [-20,0,20])assert.ok(prepared.some(({spec:{bounds:[w,n,e,s]}})=>lon>=w&&lon<=e&&lat>=s&&lat<=n));};
    const previousFrame = focusedFrame(previousLevel === 1 ? 500 : 1200);
    owner.prepare(previousFrame, view);
    for (let index = 0; index < requests.length; index++) {
      requests[index].resolve({ ok: true, blob: async () => ({}) });
      await settle();
      for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain uploads. */ }
    }
    const before = owner.prepare(previousFrame, view);
    assert.ok(before.length > 0);
    assert.ok(before.every(tile => tile.spec.level === previousLevel));
    const priorRequestCount = requests.length;
    const nextFrame = focusedFrame(nextScale);
    const waiting = owner.prepare(nextFrame, view);
    assert.equal(owner.stats().terrainLevel, nextLevel);
    assert.ok(waiting.length > 0);
    assert.ok(before.every(old => waiting.some(tile => tile.texture === old.texture)));
    visibleCoverage(waiting);
    assert.equal(owner.stats().terrainReady, false, 'coverage is independent of target detail readiness');
    assert.ok(requests.slice(priorRequestCount).every(request => new URL(request.url).pathname.startsWith(`/${nextLevel}/`)));
    requests[priorRequestCount].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain uploads. */ }
    const partial = owner.prepare(nextFrame, view);
    assert.ok(partial.some(tile => tile.spec.level === previousLevel));
    assert.equal(partial.at(-1).spec.level, nextLevel);
    visibleCoverage(partial);
    assert.equal(owner.stats().terrainReady, false);
    for (let index = priorRequestCount + 1; index < requests.length; index++) {
      requests[index].resolve({ ok: true, blob: async () => ({}) });
      await settle();
      for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain uploads. */ }
    }
    const completed = owner.prepare(nextFrame, view);
    assert.ok(completed.every(tile => tile.spec.level === nextLevel));
    assert.equal(owner.stats().terrainTargetTilesLoaded, owner.stats().terrainTargetTileCount);
    for (const scale of [503, 505, 641, 643, 1200, 643, 641, 505, 503]) {
      const painted = owner.prepare({ ...nextFrame, scale }, view);
      assert.ok(painted.length, `warm terrain must remain visible at ${scale}`);
      visibleCoverage(painted);
      // A changed footprint may admit additional source tiles at the same level.
      // Cached coverage is immediately paintable; readiness follows their uploads.
      for (let index=0;index<requests.length;index++) {
        requests[index].resolve({ok:true,blob:async()=>({})}); await settle();
        for(const job of jobs.splice(0)) while(!job.step().done) { /* Admit newly visible source tiles. */ }
      }
      owner.prepare({...nextFrame,scale},view);
      assert.equal(owner.stats().terrainReady, true);
    }
    owner.dispose();
  });
}

test('an already queued tile gains current-view priority instead of keeping its prefetch priority', async t => {
  const { owner, requests } = fixture(t, () => {}, { mobile: true });
  globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  for (const key of ['active-a', 'active-b']) owner.request({ key }, 30_000);
  owner.request({ key: 'promoted' }, 1_000);
  owner.request({ key: 'other' }, 15_000);
  owner.request({ key: 'promoted' }, 20_000);
  requests[0].resolve({ ok: true, blob: async () => ({}) });
  await settle();
  assert.equal(new URL(requests[2].url).pathname, '/promoted');
  owner.dispose();
});

test('project reset rejects old terrain failures without retry or replacement request corruption', async t => {
  const { owner, requests } = fixture(t);
  owner.request({ key: 'same', pixelWidth: 2, pixelHeight: 3 });
  owner.reset();
  owner.request({ key: 'same', pixelWidth: 2, pixelHeight: 3 });
  requests[0].reject(new Error('old project failure'));
  await settle();
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(owner.stats().terrainTilesLoading, 1);
  assert.equal(owner.stats().terrainFailureCount, 0);
  owner.dispose();
});

test('context loss closes a late decoded bitmap and never queues it for upload', async t => {
  const { owner, requests, jobs } = fixture(t);
  let decode;
  let closed = 0;
  globalThis.createImageBitmap = () => new Promise(resolve => { decode = resolve; });
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.request({ key: 'tile' });
  requests[0].resolve({ ok: true, blob: async () => ({}) });
  await settle();
  owner.reset();
  decode({ width: 2, height: 3, close: () => closed++ });
  await settle();
  assert.equal(closed, 1);
  assert.equal(jobs.length, 0);
  owner.dispose();
});

test('terrain upload measures the decoded bitmap before close and deduplicates requests', async t => {
  const { owner, requests, jobs, deleted } = fixture(t);
  const bitmap = { width: 8, height: 6, close() { this.width = 0; this.height = 0; } };
  globalThis.createImageBitmap = async () => bitmap;
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.request({ key: 'tile' }); owner.request({ key: 'tile' });
  assert.equal(requests.length, 1);
  requests[0].resolve({ ok: true, blob: async () => ({}) });
  await settle();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].step().bytes, 192);
  assert.equal(owner.stats().terrainCacheBytes, 192);
  assert.equal(bitmap.width, 0);
  owner.dispose(); owner.dispose();
  assert.equal(deleted.length, 1);
});

test('terrain cache evicts the least recently used unretained tile when the byte budget is exceeded', async t => {
  const { owner, requests, jobs, deleted } = fixture(t);
  owner.prepare(null, { cacheBudgetBytes: 8 * 1024 * 1024 });
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  for (let index = 0; index < 3; index++) {
    owner.request({ key: String(index) });
    requests[index].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    jobs[index].step();
  }
  assert.equal(owner.stats().terrainCacheBytes, 8 * 1024 * 1024);
  assert.equal(owner.stats().terrainTilesLoaded, 2);
  assert.equal(deleted.length, 1);
  owner.dispose();
  assert.equal(deleted.length, 3);
});

test('DEM decoding never retries with color-managed bitmap defaults', async t => {
  const failures = [];
  const { owner, requests } = fixture(t, reason => failures.push(reason));
  owner.setManifest({ representation: 'dem-relief-v1', levels: [{ id: 0 }] });
  let decodeCalls = 0;
  globalThis.createImageBitmap = async () => { decodeCalls += 1; throw new Error('options unsupported'); };
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.request({ key: 'dem', pixelWidth: 2, pixelHeight: 2 });
  requests[0].resolve({ ok: true, blob: async () => ({}) });
  await settle();
  assert.equal(decodeCalls, 1);
  assert.equal(owner.stats().terrainFailureCount, 1);
  assert.deepEqual(failures, ['options unsupported']);
  owner.dispose();
});

test('numerical DEM never fetches tint and ready height tiles suffice for physical style', async t => {
  const {owner,requests,jobs}=fixture(t,()=>{}, {tintUrl:()=> 'https://example.test/tint.webp'});
  t.after(()=>owner.dispose());
  globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
  t.after(()=>{delete globalThis.createImageBitmap;});
  owner.setManifest({...mobileManifest,tint:{width:1024,height:1024}});
  const frame={...mobileFrame(),scale:100},view={...mobileView(),physicalStyle:'physical',devicePixelRatio:1};
  owner.prepare(frame,view);
  assert.ok(requests.length>0);
  assert.ok(requests.every(request=>!request.url.includes('tint')));
  for(const request of requests) {request.resolve({ok:true,blob:async()=>({})});await settle();}
  for(const job of jobs.splice(0))while(!job.step().done) { /* Upload requested numerical tiles. */ }
  owner.prepare(frame,view);
  assert.equal(owner.stats().terrainReady,true);
  assert.equal(owner.stats().terrainCacheBytes,requests.length*1024*1024*4);
});

test('offscreen DEM world-reserve uploads never invalidate the current camera', async t => {
  const changes = [];
  const { owner, requests, jobs } = fixture(t, () => {}, { invalidate: reason => changes.push(reason) });
  t.after(() => owner.dispose());
  const previousBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width:1024, height:1024, close() {} });
  t.after(() => {
    if (previousBitmap) globalThis.createImageBitmap = previousBitmap;
    else delete globalThis.createImageBitmap;
  });
  const manifest = { representation:'dem-relief-v1', gutter:0,
    levels:[{id:0,width:4096,height:2048,columns:4,rows:2,tileSize:1024}] };
  owner.setManifest(manifest);
  const frame = { mode:1,scale:2000,dpr:1,viewport:[500,400],
    viewState:{projection:'flat',projectionCenter:[0,0]} };
  const view = { visible:true,physicalStyle:'political',projection:'flat',
    flatCenter:[0,0],width:500,height:400,devicePixelRatio:1,
    cacheBudgetBytes:128*1024*1024 };
  owner.prepare(frame,view);
  const visible = new Set(globalThis.PandoLabTerrainTileSelection.visible(manifest.levels[0],{
    includeAll:false,viewport:frame.viewport,scale:frame.scale,projection:'flat',flatCenter:[0,0],
  }).map(spec=>spec.key));
  const offscreen = requests.find(row => !visible.has(new URL(row.url).pathname.slice(1)));
  assert.ok(offscreen, 'world base reserve includes a queued tile outside this viewport');
  offscreen.resolve({ok:true,blob:async()=>({})});
  await settle();
  for(const job of jobs.splice(0))while(!job.step().done) { /* Focused simulated GPU upload. */ }
  assert.equal(changes.includes('terrain-tile-ready'),false);
  assert.ok(owner.stats().terrainIgnoredOffscreenCompletionCount > 0);
  await settle();
  const current = requests.find(row => visible.has(new URL(row.url).pathname.slice(1)));
  assert.ok(current, 'at least one current-view tile was requested');
  current.resolve({ok:true,blob:async()=>({})});
  await settle();
  for(const job of jobs.splice(0))while(!job.step().done) { /* Focused visible upload. */ }
  assert.ok(changes.includes('terrain-tile-ready'), 'current-view DEM remains admitted');
});
