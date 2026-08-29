import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('hydro worker reports typed init/view completion and failures', () => {
  const source = read('assets/js/workers/hydro-tile-worker.js');
  for (const token of ["type: 'ready'", "type: 'init-error'", "type: 'view-ready'", "type: 'view-error'"]) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
});

test('hydro worker probes Range with GET and can abort background cache', () => {
  const source = read('assets/js/workers/hydro-tile-worker.js');
  assert.ok(source.includes("Range: 'bytes=0-0'"));
  assert.ok(!source.includes("method: 'HEAD'"));
  assert.ok(source.includes('new AbortController()'));
  assert.ok(source.includes('abortBackgroundCache()'));
  assert.ok(source.includes('if (mobileSession && !force) return;'));
});

test('renderer separates requested and loaded hydro views and treats cache failure as unavailable', () => {
  const source = read('assets/js/modules/gpu-map-renderer.js');
  assert.ok(source.includes("let hydroViewRequestedKey = '';"));
  assert.ok(source.includes("let hydroViewLoadedKey = '';"));
  assert.ok(source.includes("let hydroViewRetryKey = '';"));
  assert.ok(source.includes("state.physicalLoadState.hydroCache = 'unavailable';"));
  assert.ok(source.includes("message.retryable !== false"));
  assert.ok(!source.includes("hydroViewKey = key"));
});

test('app waits for actual hydro worker readiness and retries manifests', () => {
  const app = read('assets/js/app.js');
  const service = read('assets/js/modules/physical-layer-service.js');
  assert.ok(app.includes('await gpuMapRenderer.setHydroManifest(manifest, manifestUrl)'));
  assert.ok(app.includes("state.physicalLoadState.hydroWorker = 'starting';"));
  assert.ok(app.includes("state.physicalLoadState.hydroManifest = 'loading';"));
  assert.ok(service.includes('fetchWithRetry(url'));
  assert.ok(service.includes('maxAttempts: 3'));
  assert.ok(service.includes('timeoutMs: 15000'));
});

test('bootstrap cache revision is advanced for the reliability build', () => {
  const source = read('assets/js/bootstrap.js');
  assert.ok(source.includes("const ASSET_REVISION = '0.30.0-r9';"));
});
