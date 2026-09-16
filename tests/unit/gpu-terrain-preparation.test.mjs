import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuTerrainPreparation } from '../../assets/js/modules/gpu-terrain-preparation.js';

function fixture(t) {
  const requests = [];
  const jobs = [];
  const deleted = [];
  const gl = { createTexture: () => ({}), deleteTexture: value => deleted.push(value) };
  for (const name of ['bindTexture', 'pixelStorei', 'texParameteri', 'texImage2D']) gl[name] = () => {};
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })));
  const owner = createGpuTerrainPreparation({
    tileUrl: spec => `https://example.test/${spec.key}`,
    isMobile: () => false,
    invalidate: () => {},
    geoDistance: () => 0,
  });
  owner.setContext({ gl, ready: true, projectGeneration: 1, contextGeneration: 1,
    scheduler: { enqueueUpload: job => { jobs.push(job); return Promise.resolve(); } } });
  return { owner, requests, jobs, deleted };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

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
