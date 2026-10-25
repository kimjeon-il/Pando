import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { WORKER_RPC_PROTOCOL, WORKER_RPC_PROTOCOL_VERSION } from "../../shared/frontend/js/modules/worker-rpc.js";

test('actual mesh Worker transfers every output buffer and detaches its originals', { timeout: 5000 }, async t => {
  const script = new URL("../../shared/frontend/js/workers/gpu-mesh-worker.js", import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const fs = require('node:fs'), vm = require('node:vm');
    global.self = global;
    self.location = new URL(${JSON.stringify(script)});
    global.importScripts = (...urls) => urls.forEach(url => vm.runInThisContext(
      '(function(module,exports){' + fs.readFileSync(new URL(url, self.location), 'utf8') + '\\n}).call(globalThis,undefined,undefined)'));
    self.postMessage = (data, transfer = []) => {
      parentPort.postMessage({ data, transferCount: transfer.length }, transfer);
      parentPort.postMessage({ detached: transfer.every(buffer => buffer.byteLength === 0) });
    };
    vm.runInThisContext(fs.readFileSync(self.location, 'utf8'), {
      filename: self.location.href,
      importModuleDynamically: specifier => import(new URL(specifier, self.location).href),
    });
    parentPort.on('message', data => self.onmessage({ data }));
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
  worker.postMessage({ rpc: WORKER_RPC_PROTOCOL, protocolVersion: WORKER_RPC_PROTOCOL_VERSION,
    type: 'request', requestId: 1, operation: 'geometry.mesh', payload: { features: [{
      type: 'Feature', id: 'AAA', properties: {}, geometry: { type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    }] } });
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
