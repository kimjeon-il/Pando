import { describe as contractSuite } from 'node:test';
import { deferredResult } from "../../helpers/async-test-ports.mjs";
import * as __canvas_dep0 from "node:assert/strict";
import * as __canvas_dep1 from "node:fs";
import * as __canvas_dep2 from "node:vm";
import * as __canvas_dep3 from "node:timers";
import * as __canvas_dep4 from "node:test";
import * as __canvas_dep5 from "../../../src/runtime/worker-rpc.js";
import * as __canvas_dep6 from "../../../src/runtime/worker-job-scheduler.js";

// Original feature contract: worker-rpc.test.mjs
contractSuite("worker-rpc", () => {
const assert = __canvas_dep0.default;
const { readFileSync } = __canvas_dep1;
const vm = __canvas_dep2.default;
const { setImmediate } = __canvas_dep3;
const test = __canvas_dep4.default;
const { WORKER_RPC_ERROR_CATEGORIES, WORKER_RPC_PROTOCOL, WORKER_RPC_PROTOCOL_VERSION, createWorkerRpcClient } = __canvas_dep5;


function workerHost(handlers) {
  const replies=[];
  const scope={AbortController:globalThis.AbortController,performance,postMessage:message=>replies.push(message)};
  vm.runInNewContext(readFileSync(new URL("../../../src/rendering/workers/worker-rpc-host.js",import.meta.url),'utf8'),{self:scope});
  scope.PandoLabWorkerRpc.install({handlers});
  const send=(type,requestId=1)=>scope.onmessage({data:{rpc:WORKER_RPC_PROTOCOL,protocolVersion:WORKER_RPC_PROTOCOL_VERSION,type,requestId,operation:'place.viewport'}});
  return {send,replies};
}
const hostTick=()=>new Promise(resolve=>setImmediate(resolve));

test('RPC host cancellation aborts the operation signal and releases the request', async () => {
  let signal;
  const host=workerHost({'place.viewport':(_payload,context)=>new Promise((_resolve,reject)=>{
    signal=context.signal;
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  })});
  host.send('request');host.send('cancel');await hostTick();
  assert.equal(signal.aborted,true);assert.equal(host.replies[0].ok,false);
  assert.equal(host.replies[0].error.category,'CANCELLED');
});
test('unknown cancellation cannot poison a later request with the same ID', async () => {
  const host=workerHost({'place.viewport':()=>42});
  host.send('cancel');host.send('request');await hostTick();
  assert.equal(host.replies[0].ok,true);assert.equal(host.replies[0].result,42);
});
test('failed operation aborts sibling fetch signals instead of retaining batch work', async () => {
  let siblingAborted=false;
  const host=workerHost({'place.viewport':(_payload,context)=>Promise.all([
    Promise.reject(new Error('offline')),
    new Promise((_resolve,reject)=>context.signal.addEventListener('abort',()=>{siblingAborted=true;reject(context.signal.reason);},{once:true})),
  ])});
  host.send('request');await hostTick();
  assert.equal(siblingAborted,true);assert.equal(host.replies[0].ok,false);
  assert.equal(host.replies[0].error.message,'offline');
});

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

test('operation error keeps the worker technical stack as its cause',async()=>{
  const worker=fakeWorker((message,current)=>{
    if(message.type==='request') Promise.resolve().then(()=>current.onmessage({data:resultFor(message,null,{ok:false,error:{message:'OCR failed',code:'OCR',category:'OPERATION',stack:'remote-stack: recognizeInProcess'}})}));
  });
  const client=createWorkerRpcClient({createWorker:()=>worker});
  await assert.rejects(client.request('map.ocr',{}),error=>error.code==='OCR' && error.cause?.stack==='remote-stack: recognizeInProcess');
  client.stop();
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

test('a retired worker error cannot reject or terminate its replacement', async t => {
  const workers = [];
  const crashes = [];
  const client = createWorkerRpcClient({
    createWorker: () => { const worker = fakeWorker(); workers.push(worker); return worker; },
    onCrash: error => crashes.push(error),
    defaultTimeoutMs: 0,
  });
  t.after(() => client.stop());
  const first = client.request('geometry.mesh');
  const retiredError = workers[0].onerror;
  const firstRejected = assert.rejects(first, { code: 'PL-WORKER-RPC-CRASH', message: 'first crash' });
  retiredError({ message: 'first crash' });
  await firstRejected;
  const replacement = client.request('geometry.audit');
  replacement.catch(() => {});
  retiredError({ message: 'late retired crash' });
  assert.equal(client.stats().pendingCount, 1);
  assert.equal(workers[1].terminated, false);
  assert.equal(client.stats().crashes, 1);
  assert.equal(crashes.length, 1);
  assert.equal(workers.length, 2);
  workers[1].onmessage({ data: resultFor(workers[1].messages[0], 'replacement result') });
  assert.equal((await replacement).result, 'replacement result');
});

test('retired messages cannot deliver events or resolve a reused request ID', async t => {
  const workers = [];
  const events = [];
  const client = createWorkerRpcClient({
    createWorker: () => { const worker = fakeWorker(); workers.push(worker); return worker; },
    getProjectRevision: () => 7,
    onEvent: event => events.push(event),
    defaultTimeoutMs: 0,
  });
  t.after(() => client.stop());
  const first = client.request('geometry.mesh', null, { requestId: 17 });
  const retiredMessage = workers[0].onmessage;
  const firstRejected = assert.rejects(first, { code: 'PL-WORKER-RPC-CRASH' });
  workers[0].onerror({ message: 'crash' });
  await firstRejected;
  const replacement = client.request('geometry.mesh', null, { requestId: 17 });
  replacement.catch(() => {});
  retiredMessage({ data: {
    rpc: WORKER_RPC_PROTOCOL, protocolVersion: WORKER_RPC_PROTOCOL_VERSION,
    type: 'event', operation: 'ready', projectRevision: 7,
  } });
  retiredMessage({ data: resultFor(workers[0].messages[0], 'retired result') });
  assert.equal(events.length, 0);
  assert.equal(client.stats().pendingCount, 1);
  workers[1].onmessage({ data: resultFor(workers[1].messages[0], 'replacement result') });
  assert.equal((await replacement).result, 'replacement result');
});

test('closed RPC ignores captured callbacks without creating another worker', async () => {
  const worker = fakeWorker();
  const events = [];
  const crashes = [];
  let creations = 0;
  const client = createWorkerRpcClient({
    createWorker: () => { creations += 1; return worker; },
    onEvent: event => events.push(event),
    onCrash: error => crashes.push(error),
    defaultTimeoutMs: 0,
  });
  const pending = client.request('geometry.mesh');
  const closedMessage = worker.onmessage;
  const closedError = worker.onerror;
  const cancelled = assert.rejects(pending, { code: 'PL-WORKER-RPC-CANCELLED' });
  client.stop();
  await cancelled;
  closedMessage({ data: {
    rpc: WORKER_RPC_PROTOCOL, protocolVersion: WORKER_RPC_PROTOCOL_VERSION,
    type: 'event', operation: 'ready', projectRevision: 0,
  } });
  closedError({ message: 'late closed crash' });
  assert.equal(events.length, 0);
  assert.equal(crashes.length, 0);
  assert.equal(client.stats().crashes, 0);
  assert.equal(client.stats().workerActive, false);
  assert.equal(creations, 1);
});

test('idle active worker crashes retain the native diagnostic when no operation can report them', () => {
  const worker = fakeWorker(), crashes = [];
  const client = createWorkerRpcClient({ createWorker: () => worker, onCrash: error => crashes.push(error) });
  client.notify('map-edit.rebase');
  let prevented = false;
  worker.onerror({ message: 'idle import failure', preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0].message, 'idle import failure');
  assert.equal(worker.terminated, true);
  client.stop();
});

test('active worker import failures remain visible and reject the pending operation', async () => {
  const worker = fakeWorker();
  const crashes = [];
  let prevented = false;
  const client = createWorkerRpcClient({ createWorker: () => worker, onCrash: error => crashes.push(error), defaultTimeoutMs: 0 });
  const pending = client.request('geometry.mesh');
  const rejected = assert.rejects(pending, error => error.code === 'PL-WORKER-RPC-CRASH'
    && error.category === WORKER_RPC_ERROR_CATEGORIES.WORKER && error.retryable === true
    && error.message === 'NetworkError: importScripts failed');
  worker.onerror({ message: 'NetworkError: importScripts failed', preventDefault: () => { prevented = true; } });
  await rejected;
  assert.equal(prevented, true, 'the operation boundary reports the crash once');
  assert.equal(worker.terminated, true);
  assert.equal(crashes[0].message, 'NetworkError: importScripts failed');
});

for (const retirement of ['crash', 'stop']) {
  test(`RPC ${retirement} detaches native handlers before termination`, async () => {
    const worker = fakeWorker();
    const events = [];
    const client = createWorkerRpcClient({ createWorker: () => worker, onEvent: event => events.push(event), defaultTimeoutMs: 0 });
    const pending = client.request('geometry.mesh');
    const capturedMessage = worker.onmessage;
    let handlersAtTermination;
    worker.terminate = () => {
      handlersAtTermination = [worker.onmessage, worker.onerror];
      capturedMessage({ data: {
        rpc: WORKER_RPC_PROTOCOL, protocolVersion: WORKER_RPC_PROTOCOL_VERSION,
        type: 'event', operation: 'ready', projectRevision: 0,
      } });
    };
    const rejected = assert.rejects(pending, {
      code: retirement === 'crash' ? 'PL-WORKER-RPC-CRASH' : 'PL-WORKER-RPC-CANCELLED',
    });
    if (retirement === 'crash') worker.onerror({ message: 'current crash' });
    else client.stop();
    await rejected;
    assert.equal(handlersAtTermination[0], null);
    let contained = false;
    handlersAtTermination[1]({ preventDefault() { contained = true; } });
    assert.equal(contained, true);
    assert.equal(events.length, 0, 'captured callbacks also lose ownership before termination');
  });
}

test('retiring RPC workers contains import errors while genuine crashes still reject', async () => {
  const worker = fakeWorker();
  let suppressed = 0;
  worker.terminate = () => worker.onerror?.({ preventDefault() { suppressed++; } });
  const client = createWorkerRpcClient({ createWorker: () => worker });
  const pending = client.request('geometry.prepare', {});
  const rejected = assert.rejects(pending, { code: 'PL-WORKER-RPC-CRASH' });
  worker.onerror({ message: 'genuine import failure', preventDefault() { suppressed++; } });
  await rejected;
  assert.equal(suppressed, 2, 'handled crash and termination event must not reach the global handler');
  client.stop();
});

test('bounded monotonic progress renews an idle deadline; repeats and foreign progress cannot', async () => {
  let serial = 0; const timers = new Map();
  const worker = fakeWorker();
  const client = createWorkerRpcClient({ createWorker: () => worker, schedule: callback => { timers.set(++serial, callback); return serial; }, clearSchedule: id => timers.delete(id) });
  const pending = client.request('geometry.mesh', {}, { projectRevision: 2,
    progress: { operation: 'geometry.mesh-progress', total: 3 } });
  const request = worker.messages[0];
  const progress = (completed, overrides = {}) => worker.onmessage({ data: { rpc: WORKER_RPC_PROTOCOL, protocolVersion: 1,
    type: 'event', operation: 'geometry.mesh-progress', projectRevision: 2,
    payload: { requestId: request.requestId, completed, total: 3 }, ...overrides } });
  progress(1); assert.equal(serial, 2);
  progress(1); progress(4); progress(2, { projectRevision: 1 });
  progress(2, { operation: 'foreign-progress' });
  assert.equal(serial, 2);
  progress(2); assert.equal(serial, 3);
  timers.get(3)(); await assert.rejects(pending, { code: 'PL-WORKER-RPC-TIMEOUT' });
  assert.equal(timers.size, 0); client.stop();
});
});

// Original feature contract: worker-job-scheduler.test.mjs
contractSuite("worker-job-scheduler", () => {
const assert = __canvas_dep0.default;
const test = __canvas_dep4.default;
const { createLatestWorkerJobScheduler } = __canvas_dep6;


const deferred = deferredResult;

test('latest worker scheduler keeps one running job and the newest successor per key', async () => {
  const executions = [];
  const gates = [];
  const scheduler = createLatestWorkerJobScheduler({
    execute: entry => {
      executions.push(entry.targetRevision);
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    },
  });

  const first = scheduler.enqueue({ jobKey: 'mesh:country:AAA', geometryRevision: 1, targetRevision: 1 });
  const firstCancelled = assert.rejects(first.promise, error => error.cancelled && error.reason === 'coalesced');
  const second = scheduler.enqueue({ jobKey: 'mesh:country:AAA', geometryRevision: 2, targetRevision: 2 });
  const secondCancelled = assert.rejects(second.promise, error => error.cancelled && error.reason === 'coalesced');
  const third = scheduler.enqueue({ jobKey: 'mesh:country:AAA', geometryRevision: 3, targetRevision: 3 });

  await Promise.resolve();
  assert.deepEqual(executions, [1]);
  gates[0].resolve({ revision: 1 });
  await firstCancelled;
  await secondCancelled;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(executions, [1, 3]);
  gates[1].resolve({ revision: 3 });
  assert.deepEqual(await third.promise, { revision: 3 });
  assert.equal(scheduler.stats().coalesced, 2);
  assert.equal(scheduler.stats().maxQueueDepth, 1);
});

test('latest worker scheduler discards a result whose target revision is stale', async () => {
  let currentRevision = 4;
  const discarded = [];
  const gate = deferred();
  const scheduler = createLatestWorkerJobScheduler({
    execute: () => gate.promise,
    isCurrent: entry => entry.targetRevision === currentRevision,
    discardResult: value => discarded.push(value),
  });
  const ticket = scheduler.enqueue({ jobKey: 'validate:feature:1', targetRevision: 4 });
  currentRevision = 5;
  gate.resolve({ revision: 4 });
  await assert.rejects(ticket.promise, error => error.cancelled && error.reason === 'stale');
  assert.deepEqual(discarded, [{ revision: 4 }]);
  assert.equal(scheduler.stats().staleDiscarded, 1);
});

test('latest worker scheduler recognizes AbortSignal without starting queued work', async () => {
  const blocker = deferred();
  const scheduler = createLatestWorkerJobScheduler({ execute: entry => entry.jobKey === 'active' ? blocker.promise : true });
  const active = scheduler.enqueue({ jobKey: 'active' });
  const controller = new globalThis.AbortController();
  const queued = scheduler.enqueue({ jobKey: 'queued', signal: controller.signal });
  controller.abort();
  await assert.rejects(queued.promise, error => error.cancelled && error.reason === 'aborted');
  blocker.resolve(true);
  await active.promise;
  assert.equal(scheduler.stats().cancelled, 1);
});
});
