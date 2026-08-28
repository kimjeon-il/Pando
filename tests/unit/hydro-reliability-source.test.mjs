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
  const source = read('assets/js/app.js');
  assert.ok(source.includes('await gpuMapRenderer.setHydroManifest(manifest, manifestUrl)'));
  assert.ok(source.includes("state.physicalLoadState.hydroWorker = 'starting';"));
  assert.ok(source.includes("state.physicalLoadState.hydroManifest = 'loading';"));
  assert.ok(source.includes('fetchWithRetry(manifestUrl'));
  assert.ok(source.includes('fetchWithRetry(url'));
});

test('bootstrap cache revision is advanced for the reliability build', () => {
  const source = read('assets/js/bootstrap.js');
  assert.ok(source.includes("const ASSET_REVISION = '0.30.0-r8';"));
});
