import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKER_RPC_ERROR_CATEGORIES,
  WORKER_RPC_PROTOCOL,
  WORKER_RPC_PROTOCOL_VERSION,
  createWorkerRpcClient,
} from '../../assets/js/modules/worker-rpc.js';

function fakeWorker(responder = null) {
  return {
    messages: [],
    transfers: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message, transfer = []) {
      this.messages.push(message);
      this.transfers.push(transfer);
      responder?.(message, this);
    },
    terminate() { this.terminated = true; },
  };
}

function resultFor(message, result, overrides = {}) {
  return {
    rpc: WORKER_RPC_PROTOCOL,
    protocolVersion: WORKER_RPC_PROTOCOL_VERSION,
    type: 'result',
    requestId: message.requestId,
    operation: message.operation,
    projectRevision: message.projectRevision,
    ok: true,
    result,
    timing: { durationMs: 4 },
    ...overrides,
  };
}

test('RPC client sends canonical request metadata and preserves transferables', async () => {
  const buffer = new ArrayBuffer(8);
  const worker = fakeWorker((message, current) => {
    if (message.type !== 'request') return;
    Promise.resolve().then(() => current.onmessage({ data: resultFor(message, { ok: 1 }) }));
  });
  const client = createWorkerRpcClient({ createWorker: () => worker, getProjectRevision: () => 7 });
  const response = await client.request('geometry.mesh', { count: 2 }, { priority: 90, transfer: [buffer] });
  assert.equal(worker.messages[0].requestId, 1);
  assert.equal(worker.messages[0].operation, 'geometry.mesh');
  assert.equal(worker.messages[0].projectRevision, 7);
  assert.equal(worker.messages[0].priority, 90);
  assert.deepEqual(worker.transfers[0], [buffer]);
  assert.deepEqual(response.result, { ok: 1 });
  assert.equal(response.timing.durationMs, 4);
  assert.equal(client.stats().transferredRequests, 1);
});

test('RPC timeout cancels the worker request and reports a typed error', async () => {
  let timeoutCallback = null;
  const worker = fakeWorker();
  const client = createWorkerRpcClient({
    createWorker: () => worker,
    defaultTimeoutMs: 10,
    schedule: callback => { timeoutCallback = callback; return 1; },
    clearSchedule: () => {},
  });
  const pending = client.request('geometry.audit', {});
  timeoutCallback();
  await assert.rejects(pending, error => error.category === WORKER_RPC_ERROR_CATEGORIES.TIMEOUT && error.code === 'PL-WORKER-RPC-TIMEOUT');
  assert.equal(worker.messages.at(-1).type, 'cancel');
  assert.equal(client.stats().timedOut, 1);
});

test('AbortSignal cancellation uses the same cancel path', async () => {
  const controller = new globalThis.AbortController();
  const worker = fakeWorker();
  const client = createWorkerRpcClient({ createWorker: () => worker, defaultTimeoutMs: 0 });
  const pending = client.request('geometry.audit', {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.category === WORKER_RPC_ERROR_CATEGORIES.CANCELLED && error.name === 'AbortError');
  assert.equal(worker.messages.at(-1).type, 'cancel');
});

test('stale project revisions are discarded centrally', async () => {
  let revision = 3;
  const worker = fakeWorker();
  const client = createWorkerRpcClient({ createWorker: () => worker, getProjectRevision: () => revision, defaultTimeoutMs: 0 });
  const pending = client.request('geometry.audit', {});
  const request = worker.messages[0];
  revision = 4;
  worker.onmessage({ data: resultFor(request, { stale: true }) });
  await assert.rejects(pending, error => error.category === WORKER_RPC_ERROR_CATEGORIES.STALE_RESULT);
  assert.equal(client.stats().staleDiscarded, 1);
});

test('worker crashes reject pending requests and the next request recreates the worker', async () => {
  const workers = [];
  const client = createWorkerRpcClient({
    createWorker: () => {
      const worker = fakeWorker((message, current) => {
        if (workers.length > 1 && message.type === 'request') Promise.resolve().then(() => current.onmessage({ data: resultFor(message, 'recovered') }));
      });
      workers.push(worker);
      return worker;
    },
    defaultTimeoutMs: 0,
  });
  const first = client.request('geometry.mesh', {});
  workers[0].onerror({ message: 'boom' });
  await assert.rejects(first, error => error.category === WORKER_RPC_ERROR_CATEGORIES.WORKER && error.retryable === true);
  const second = await client.request('geometry.mesh', {});
  assert.equal(second.result, 'recovered');
  assert.equal(workers.length, 2);
  assert.equal(client.stats().restarted, 1);
});
