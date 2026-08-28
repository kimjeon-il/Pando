import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAssetState,
  createDiagnosticLog,
  isRetryableHttpStatus,
  retryDelay,
  withRetry,
} from '../../assets/js/modules/reliability-core.js';

test('retry classification only retries transient HTTP statuses', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) assert.equal(isRetryableHttpStatus(status), true);
  for (const status of [400, 401, 403, 404, 410, 422]) assert.equal(isRetryableHttpStatus(status), false);
});

test('withRetry eventually returns a successful result', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('temporary');
      error.retryable = true;
      throw error;
    }
    return 'ok';
  }, { maxAttempts: 3, baseDelay: 1, maxDelay: 1, jitter: 0 });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('withRetry never retries cancelled operations', async () => {
  let attempts = 0;
  await assert.rejects(() => withRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error('cancelled'), { cancelled: true });
  }, { maxAttempts: 4, baseDelay: 1 }), /cancelled/);
  assert.equal(attempts, 1);
});

test('asset state keeps cache failure independent from view state', () => {
  const asset = createAssetState();
  asset.set('manifest', 'ready');
  asset.set('worker', 'ready');
  asset.set('view', 'ready');
  asset.set('cache', 'unavailable');
  assert.deepEqual(asset.snapshot(), {
    manifest: 'ready',
    worker: 'ready',
    view: 'ready',
    cache: 'unavailable',
    lastError: null,
  });
});

test('diagnostic log is bounded', () => {
  const log = createDiagnosticLog({ limit: 2, now: (() => { let n = 0; return () => ++n; })() });
  log.push({ operation: 'a' });
  log.push({ operation: 'b' });
  log.push({ operation: 'c' });
  assert.deepEqual(log.snapshot().map(row => row.operation), ['b', 'c']);
});

test('retryDelay honors the maximum', () => {
  assert.equal(retryDelay(10, { baseDelay: 400, maxDelay: 4000, jitter: 0 }), 4000);
});

test('fetchWithRetry retries transient HTTP failures but not 404', async () => {
  const { fetchWithRetry } = await import('../../assets/js/modules/reliability-core.js');
  const originalFetch = globalThis.fetch;
  try {
    let transientCalls = 0;
    globalThis.fetch = async () => {
      transientCalls += 1;
      return transientCalls < 3
        ? new Response('', { status: 503 })
        : new Response('ok', { status: 200 });
    };
    const response = await fetchWithRetry('https://example.invalid/test', {}, {
      maxAttempts: 3, baseDelay: 1, maxDelay: 1, jitter: 0, timeoutMs: 1000,
    });
    assert.equal(response.status, 200);
    assert.equal(transientCalls, 3);

    let notFoundCalls = 0;
    globalThis.fetch = async () => {
      notFoundCalls += 1;
      return new Response('', { status: 404 });
    };
    const notFound = await fetchWithRetry('https://example.invalid/missing', {}, {
      maxAttempts: 3, baseDelay: 1, maxDelay: 1, jitter: 0, timeoutMs: 1000,
    });
    assert.equal(notFound.status, 404);
    assert.equal(notFoundCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
