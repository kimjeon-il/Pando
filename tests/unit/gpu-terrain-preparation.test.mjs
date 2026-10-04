import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuTerrainPreparation } from '../../assets/js/modules/gpu-terrain-preparation.js';

function fixture(t, onUnusable = () => {}, { mobile = false, geoDistance = () => 0 } = {}) {
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
    tileUrl: spec => `https://example.test/${spec.key}`,
    onUnusable,
    isMobile: () => mobile,
    invalidate: () => {},
    geoDistance,
  });
  owner.setContext({ gl, ready: true, projectGeneration: 1, contextGeneration: 1,
    scheduler: { enqueueUpload: job => { jobs.push(job); return Promise.resolve(); } } });
  return { owner, requests, jobs, deleted };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

const mobileManifest = {
  representation: 'dem-relief-v1', gutter: 0,
  levels: [
    { id: 0, width: 2048, height: 1024, columns: 2, rows: 1, tileSize: 1024 },
    { id: 1, width: 4096, height: 2048, columns: 4, rows: 2, tileSize: 1024 },
    { id: 2, width: 8192, height: 4096, columns: 8, rows: 4, tileSize: 1024 },
  ],
};
const mobileFrame = (rotation = [0, 0]) => ({
  mode: 0, scale: 1200, viewport: [390, 844],
  viewState: { projection: 'globe', rotation },
});
const mobileView = (meshQuality = 'canonical') => ({
  visible: true, meshQuality, physicalStyle: 'political', projection: 'globe',
  width: 390, height: 844, dpr: 1, devicePixelRatio: 2,
  cacheBudgetBytes: 128 * 1024 * 1024,
});

test('startup map preview requests the improved coarse level even at a detailed camera zoom', t => {
  const { owner, requests } = fixture(t, () => {}, { mobile: true });
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame(), mobileView('preview'));
  assert.equal(owner.stats().terrainLevel, 1);
  assert.equal(owner.stats().terrainFetchConcurrency, 2);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => new URL(request.url).pathname.startsWith('/1/')));
  owner.dispose();
});

test('canonical map requests camera target terrain directly without intermediate levels', t => {
  const { owner, requests } = fixture(t, () => {}, { mobile: true });
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame(), mobileView());
  assert.equal(owner.stats().terrainLevel, 2);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => new URL(request.url).pathname.startsWith('/2/')));
  owner.dispose();
});

test('canonical promotion keeps loaded terrain until all target tiles are ready', async t => {
  const { owner, requests, jobs } = fixture(t, () => {}, { mobile: true });
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame(), mobileView('preview'));
  for (const request of requests) request.resolve({ ok: true, blob: async () => ({}) });
  await settle();
  for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain the real upload owner. */ }
  assert.equal(owner.prepare(mobileFrame(), mobileView('preview')).length, 2);
  assert.equal(owner.stats().terrainRenderedLevel, 1);
  const priorRequestCount = requests.length;
  const promoted = owner.prepare(mobileFrame(), mobileView());
  assert.equal(promoted.length, 2, 'loaded terrain must cover the view while detail is pending');
  assert.ok(promoted.every(tile => tile.spec.level === 1));
  assert.equal(owner.stats().terrainRenderedLevel, 1);
  assert.equal(owner.stats().terrainLevel, 2);
  await settle();
  assert.ok(requests.slice(priorRequestCount).every(request => new URL(request.url).pathname.startsWith('/2/')));
  requests[priorRequestCount].resolve({ ok: true, blob: async () => ({}) });
  await settle();
  for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain the real upload owner. */ }
  const ready = owner.prepare(mobileFrame(), mobileView());
  assert.equal(ready.length, 3, 'partial detail must paint over the retained terrain');
  assert.deepEqual(ready.map(tile => tile.spec.level), [1, 1, 2]);
  assert.equal(owner.stats().terrainRenderedLevel, 2);
  for (let index = priorRequestCount + 1; index < requests.length; index++) {
    requests[index].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain target uploads. */ }
  }
  const complete = owner.prepare(mobileFrame(), mobileView());
  assert.equal(owner.stats().terrainTargetTilesLoaded, owner.stats().terrainTargetTileCount);
  assert.ok(complete.length > 0);
  assert.ok(complete.every(tile => tile.spec.level === 2), 'ready target tiles replace the retained terrain');
  owner.dispose();
});

test('rotating the mobile globe drops queued tiles from the old view', async t => {
  const longitudeDistance = (left, right) => Math.abs((((left[0] - right[0]) + 540) % 360) - 180) * Math.PI / 180;
  const { owner, requests, jobs } = fixture(t, () => {}, { mobile: true, geoDistance: longitudeDistance });
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame([-90, 0]), mobileView());
  owner.prepare(mobileFrame([90, 0]), mobileView());
  for (let index = 0; index < 8; index += 1) {
    assert.ok(requests[index], `request ${index} must have started`);
    requests[index].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    for (const job of jobs.splice(0)) job.step();
  }
  const laterPaths = requests.slice(2).map(request => new URL(request.url).pathname);
  assert.ok(laterPaths.some(path => /^\/2\/[0123]-/.test(path)), 'new-view detail must start');
  assert.deepEqual(laterPaths.filter(path => /^\/2\/[567]-/.test(path)), [], 'old-view queued tiles must not start');
  owner.dispose();
});

test('a new viewport starts its requests without waiting for obsolete in-flight downloads', async t => {
  const longitudeDistance = (left, right) => Math.abs((((left[0] - right[0]) + 540) % 360) - 180) * Math.PI / 180;
  const { owner, requests } = fixture(t, () => {}, { mobile: true, geoDistance: longitudeDistance });
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame([-90, 0]), mobileView());
  assert.equal(requests.length, 2);
  owner.prepare(mobileFrame([90, 0]), mobileView());
  await settle();
  assert.ok(requests.length >= 4, 'new-view downloads must start while old responses remain unresolved');
  assert.ok(requests.slice(0, 2).every(request => request.options.signal.aborted));
  assert.equal(owner.stats().terrainFailureCount, 0, 'view cancellation is not a failed tile');
  owner.dispose();
});

test('a request batch starts center tiles before viewport-edge tiles', t => {
  const { owner, requests } = fixture(t);
  owner.setManifest(mobileManifest);
  const frame = { mode: 1, scale: 1200, viewport: [3000, 2000], viewState: { projection: 'flat', projectionCenter: [0, 0] } };
  owner.prepare(frame, { ...mobileView(), devicePixelRatio: 1, projection: 'flat', flatCenter: [0, 0] });
  const first = requests.slice(0, 4).map(request => new URL(request.url).pathname).sort();
  assert.deepEqual(first, ['/2/3-1', '/2/3-2', '/2/4-1', '/2/4-2']);
  owner.dispose();
});

test('desktop starts six visible downloads while missing current tiles; mobile remains at two', t => {
  const { owner, requests } = fixture(t);
  owner.setManifest(mobileManifest);
  owner.prepare({ mode: 1, scale: 1200, viewport: [3000, 2000],
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
  const { owner, requests, jobs } = fixture(t);
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.setManifest(mobileManifest);
  const frame = { mode: 1, scale: 1200, viewport: [1000, 800], viewState: { projection: 'flat', projectionCenter: [0, 0] } };
  const view = { ...mobileView(), devicePixelRatio: 1, projection: 'flat', flatCenter: [0, 0] };
  owner.prepare(frame, view);
  for (let index = 0; index < 4; index++) {
    requests[index].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain uploads. */ }
  }
  const before = requests.length;
  assert.equal(before, 10, 'four visible tiles followed by six neighbouring downloads');
  owner.prepare({ ...frame, viewState: { ...frame.viewState, projectionCenter: [0, 30] } }, view);
  await settle();
  assert.ok(requests.length >= before + 2, 'both missing visible tiles must start before neighbouring responses finish');
  assert.equal(owner.stats().terrainFailureCount, 0);
  owner.dispose();
});

for (const [previousLevel, nextLevel, nextScale] of [[1, 2, 1200], [2, 1, 500]]) {
  test(`zoom transition ${previousLevel} to ${nextLevel} preserves loaded detail until replacement arrives`, async t => {
    const { owner, requests, jobs } = fixture(t);
    globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
    t.after(() => { delete globalThis.createImageBitmap; });
    owner.setManifest(mobileManifest);
    const view = { ...mobileView(), devicePixelRatio: 1 };
    const previousFrame = { ...mobileFrame(), scale: previousLevel === 1 ? 500 : 1200 };
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
    const nextFrame = { ...mobileFrame(), scale: nextScale };
    const waiting = owner.prepare(nextFrame, view);
    assert.equal(owner.stats().terrainLevel, nextLevel);
    assert.ok(waiting.length > 0, 'loaded detail must keep painting during the zoom transition');
    assert.ok(waiting.every(tile => tile.spec.level === previousLevel));
    assert.ok(requests.slice(priorRequestCount).every(request => new URL(request.url).pathname.startsWith(`/${nextLevel}/`)));
    requests[priorRequestCount].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain uploads. */ }
    const partial = owner.prepare(nextFrame, view);
    assert.ok(partial.some(tile => tile.spec.level === previousLevel));
    assert.equal(partial.at(-1).spec.level, nextLevel, 'newly ready target tiles paint over retained detail');
    for (let index = priorRequestCount + 1; index < requests.length; index++) {
      requests[index].resolve({ ok: true, blob: async () => ({}) });
      await settle();
      for (const job of jobs.splice(0)) while (!job.step().done) { /* Drain uploads. */ }
    }
    const completed = owner.prepare(nextFrame, view);
    assert.ok(completed.every(tile => tile.spec.level === nextLevel));
    assert.equal(owner.stats().terrainTargetTilesLoaded, owner.stats().terrainTargetTileCount);
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

test('DEM tint upload is counted in the same budget and released on reset', async t => {
  const { owner, requests, jobs, deleted } = fixture(t);
  // The fixture has no tint URL. Exercise the same owner through the explicit
  // tint hook with a fresh instance instead of introducing a second cache.
  owner.dispose();
  const renderer = createGpuTerrainPreparation({
    tileUrl: () => '', tintUrl: () => 'https://example.test/tint.webp',
    isMobile: () => false, invalidate: () => {}, geoDistance: () => 0,
  });
  const gl = { createTexture: () => ({}), deleteTexture: value => deleted.push(value) };
  for (const name of ['bindTexture', 'pixelStorei', 'texParameteri', 'texImage2D']) gl[name] = () => {};
  renderer.setContext({ gl, ready: true, projectGeneration: 1, contextGeneration: 1,
    scheduler: { enqueueUpload: job => { jobs.push(job); return Promise.resolve(); } } });
  renderer.setManifest({ representation: 'dem-relief-v1', levels: [{ id: 0 }], tint: { width: 2, height: 2 } });
  globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  renderer.prepare(null, { visible: true, physicalStyle: 'political', cacheBudgetBytes: 32 * 1024 * 1024 });
  assert.equal(requests.length, 0, 'grayscale DEM must not decode unused tint');
  renderer.prepare(null, { visible: true, physicalStyle: 'physical', cacheBudgetBytes: 32 * 1024 * 1024 });
  requests[0].resolve({ ok: true, blob: async () => ({}) });
  await settle();
  jobs[0].step();
  assert.equal(renderer.stats().terrainCacheBytes, 16);
  assert.equal(renderer.stats().terrainTintReady, true);
  renderer.reset();
  assert.equal(renderer.stats().terrainCacheBytes, 0);
  assert.equal(deleted.length, 1);
  renderer.dispose();
});
