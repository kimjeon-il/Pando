import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuTerrainPreparation } from '../../assets/js/modules/gpu-terrain-preparation.js';

function fixture(t, onUnusable = () => {}, { mobile = false, geoDistance = () => 0 } = {}) {
  const requests = [];
  const jobs = [];
  const deleted = [];
  const gl = { createTexture: () => ({}), deleteTexture: value => deleted.push(value) };
  for (const name of ['bindTexture', 'pixelStorei', 'texParameteri', 'texImage2D']) gl[name] = () => {};
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })));
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
const mobileView = enhanced => ({
  visible: true, enhanced, physicalStyle: 'political', projection: 'globe',
  width: 390, height: 844, dpr: 1, devicePixelRatio: 2,
  cacheBudgetBytes: 128 * 1024 * 1024,
});

test('mobile globe starts both coarse coverage requests before target DEM tiles', t => {
  const { owner, requests } = fixture(t, () => {}, { mobile: true });
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame(), mobileView(true));
  assert.equal(owner.stats().terrainLevel, 2);
  assert.equal(owner.stats().terrainFetchConcurrency, 2);
  assert.deepEqual(requests.map(request => new URL(request.url).pathname), ['/0/0-0', '/0/1-0']);
  owner.dispose();
});

test('ready DEM selects camera target LOD before canonical country mesh is enhanced', t => {
  const { owner } = fixture(t, () => {}, { mobile: true });
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame(), mobileView(false));
  assert.equal(owner.stats().terrainLevel, 2);
  owner.dispose();
});

test('rotating the mobile globe drops queued tiles from the old view', async t => {
  const longitudeDistance = (left, right) => Math.abs((((left[0] - right[0]) + 540) % 360) - 180) * Math.PI / 180;
  const { owner, requests, jobs } = fixture(t, () => {}, { mobile: true, geoDistance: longitudeDistance });
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 1024, close() {} });
  t.after(() => { delete globalThis.createImageBitmap; });
  owner.setManifest(mobileManifest);
  owner.prepare(mobileFrame([-90, 0]), mobileView(true));
  owner.prepare(mobileFrame([90, 0]), mobileView(true));
  for (let index = 0; index < 8; index += 1) {
    assert.ok(requests[index], `request ${index} must have started`);
    requests[index].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    for (const job of jobs.splice(0)) job.step();
  }
  const laterPaths = requests.slice(2).map(request => new URL(request.url).pathname);
  assert.ok(laterPaths.some(path => /^\/1\/[01]-[01]$/.test(path)), 'new-view parents must start');
  assert.deepEqual(laterPaths.filter(path => /^\/(?:1\/[23]|2\/[4567])-/.test(path)), [], 'old-view queued tiles must not start');
  owner.dispose();
});

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
