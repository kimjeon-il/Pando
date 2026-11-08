import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:test";
import * as __contract_dep2 from "node:worker_threads";
import * as __contract_dep3 from "../../src/runtime/worker-rpc.js";
import * as __contract_dep4 from "../../src/rendering/country-mesh-transfer.js";
import * as __contract_dep5 from "../../src/rendering/gpu-mesh-worker-jobs.js";
contractSuite("gpu-mesh-transfer", () => {
const assert = __contract_dep0.default;
const test = __contract_dep1.default;
const { Worker } = __contract_dep2;
const { WORKER_RPC_PROTOCOL, WORKER_RPC_PROTOCOL_VERSION } = __contract_dep3;
const { packCountryMeshFeatures } = __contract_dep4;

test('actual mesh Worker transfers every output buffer and detaches its originals', { timeout: 5000 }, async t => {
  const transportModule = new URL('../helpers/source-worker-transport.mjs', import.meta.url).href;
  const worker = new Worker(`
    (async () => {
    const { parentPort } = require('node:worker_threads');
    const vm = require('node:vm');
    const { sourceWorkerTransport } = await import(${JSON.stringify(transportModule)});
    const transport = sourceWorkerTransport('assets/js/workers/gpu-mesh-worker.js', { buildMeta: {
      assetRevision: 'mesh-transfer-test', dataRevision: 'synthetic-mesh-input', resourceProfile: 'test-fixture',
    } });
    global.self = global;
    self.location = transport.location;
    global.importScripts = (...urls) => urls.forEach(url => vm.runInThisContext(
      '(function(module,exports){' + transport.read(url) + '\\n}).call(globalThis,undefined,undefined)'));
    self.postMessage = (data, transfer = []) => {
      parentPort.postMessage({ data, transferCount: transfer.length }, transfer);
      parentPort.postMessage({ detached: transfer.every(buffer => buffer.byteLength === 0) });
    };
    vm.runInThisContext(transport.read(self.location), {
      filename: self.location.href,
      importModuleDynamically: specifier => import(transport.sourceUrl(specifier)),
    });
    parentPort.on('message', data => self.onmessage({ data }));
    })();
  `, { eval: true, execArgv: ['--experimental-vm-modules'] });
  t.after(() => worker.terminate());
  const result = new Promise((resolve, reject) => {
    let response;
    worker.on('error', reject);
    worker.on('message', value => {
      if (value.data?.type === 'result') response = value;
      if (response && Object.hasOwn(value, 'detached')) resolve({ ...response, detached: value.detached });
    });
  });
  const payload = await packCountryMeshFeatures([{
      type: 'Feature', id: 'AAA', properties: {}, geometry: { type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    }]);
  worker.postMessage({ rpc: WORKER_RPC_PROTOCOL, protocolVersion: WORKER_RPC_PROTOCOL_VERSION,
    type: 'request', requestId: 1, operation: 'geometry.mesh', payload }, [payload.coordinates.buffer]);
  const response = await result;
  assert.equal(response.data.ok, true, response.data.error?.message);
  assert.deepEqual(response.data.result.countryIds, ['AAA']);
  const buffers = new Set();
  const visit = value => {
    if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(response.data.result);
  assert.ok(buffers.size > 0);
  assert.equal(response.transferCount, buffers.size, 'every typed mesh output must cross as a transferable');
  assert.equal(response.detached, true, 'original Worker buffers must be detached');
});
});
contractSuite("gpu-mesh-worker-jobs", () => {
const test = __contract_dep1.default;
const assert = __contract_dep0.default;
const { createGpuMeshWorkerJobs } = __contract_dep5;

test('polygon preparation accepts finite progress across a long batch but still times out a stalled batch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [], worker = { postMessage: message => sent.push(message), terminate() {} };
  const jobs = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => worker });
  const request = jobs.preparePolygons([{ cacheKey: 'a' }, { cacheKey: 'b' }], 1)
    .then(value => ({ value }), error => ({ error }));
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const envelope = sent.find(message => message.type === 'request');
  const progress = completed => worker.onmessage({ data: { ...envelope, type: 'event',
    operation: 'geometry.prepare-progress', payload: { requestId: envelope.requestId, completed, total: 3 } } });
  t.mock.timers.tick(25000); progress(1);
  t.mock.timers.tick(25000); progress(2);
  t.mock.timers.tick(25000); progress(3);
  worker.onmessage({ data: { ...envelope, type: 'result', ok: true, result: { packets: [] } } });
  assert.deepEqual(await request, { value: { packets: [] } });
  const stalled = jobs.preparePolygons([{ cacheKey: 'stalled' }], 2)
    .then(() => assert.fail('stalled preparation must time out'), error => error);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  t.mock.timers.tick(30000);
  assert.equal((await stalled).code, 'PL-WORKER-RPC-TIMEOUT');
  jobs.cancelAll();
});

test('full rebuild owner settles replaced, stale and disposed requests and preserves payload', async () => {
  const workers = [], sent = [];
  const owner = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => {
    const worker = { postMessage: message => sent.push(message), terminate() {} };
    workers.push(worker); return worker;
  } });
  const first = owner.rebuild({ token: 1, projectGeneration: 2, geometryRevision: 3, features: [] });
  const second = owner.rebuild({ token: 2, projectGeneration: 2, geometryRevision: 4, features: [] });
  assert.equal(await first, null);
  workers[0].onmessage?.({ data: { ...sent[0], type: 'result', ok: true, result: 'late' } });
  workers[1].onmessage({ data: { ...sent.find(x => x.type === 'request' && x.metadata.geometryRevision === 4), type: 'result', projectRevision: 1, ok: true, result: 'old-project' } });
  assert.equal(await second, null);
  const third = owner.rebuild({ token: 3, projectGeneration: 2, geometryRevision: 4, features: [] });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  workers[1].onmessage({ data: { ...sent.at(-1), type: 'result', ok: true, result: 'current' } });
  assert.equal(await third, 'current');
  assert.equal(workers.length, 2, 'idle rebuild Worker retains prepared geometry');
  owner.cancelAll('prepare-full-rebuild', { preserveIdleRebuild: true });
  const fourth = owner.rebuild({ token: 4 });
  assert.equal(workers.length, 2); owner.cancelAll();
  assert.equal(await fourth, null);
  assert.equal(sent[0].operation, 'geometry.mesh');
  assert.equal(sent[0].projectRevision, 2);
  assert.deepEqual(sent[0].payload, { rows: [], coordinates: new Float64Array() });
});

test('newer polygon preparation terminates busy refinement and adopts only its reply', async () => {
  const workers = [], sent = [];
  const jobs = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => {
    const worker = { terminated: false, postMessage: message => sent.push(message), terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  } });
  const first = jobs.preparePolygons([{ cacheKey: 'old' }], 1);
  const rejected = assert.rejects(first, error => error.cancelled);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const latest = jobs.preparePolygons([{ cacheKey: 'new' }], 2);
  await rejected;
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(workers[0].terminated, true);
  const request = sent.find(message => message.type === 'request' && message.metadata.geometryRevision === 2);
  assert.equal(request.operation, 'geometry.prepare');
  assert.deepEqual(request.payload, { items: [{ cacheKey: 'new' }] });
  workers[1].onmessage({ data: { ...request, type: 'result', ok: true, result: { packets: ['latest'] } } });
  assert.deepEqual(await latest, { packets: ['latest'] });
  jobs.cancelAll();
});

test('patch worker owner preserves payload shape and ignores late replies after cancellation', async () => {
  const workers = [], sent = [];
  const owner = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => {
    const worker = { postMessage: message => sent.push(message), terminate() {} };
    workers.push(worker); return worker;
  } });
  const ticket = owner.enqueue({ jobKey: 'patch', geometryRevision: 4, targetRevision: 4, payload: { token: 7, features: [] } });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(sent[0].operation, 'geometry.mesh');
  assert.deepEqual(sent[0].metadata, { geometryRevision: 4, targetRevision: 4, jobKey: 'patch', payload: { token: 7 } });
  owner.cancelAll('reset');
  workers[0].onmessage?.({ data: { ...sent[0], type: 'result', ok: true, result: { positions: new ArrayBuffer(100) } } });
  await assert.rejects(ticket.promise);
  assert.equal(owner.outputBytes(), 0);
});
});
