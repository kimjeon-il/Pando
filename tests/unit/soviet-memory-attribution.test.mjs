import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  classifyChromiumRole, parseSmapsRollup, chromiumProcessPss,
  createWorkerMemoryProbe, summarizeMemoryPhases,
} from '../browser/helpers/soviet-memory-attribution.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Linux smaps_rollup parses PSS rather than total RSS and classifies subprocesses', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pando-pss-test-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const data = [
    [1234, 'chromium', '/opt/chromium --type=renderer \0\0', 102400, 56789],
    [1235, 'chromium', '/opt/chromium --type=gpu-process \0\0', 204800, 120000],
    [1236, 'node', '/usr/bin/node --type=renderer', 99999, 99999],
  ];
  for (const [pid, comm, cmdline, rss, pss] of data) {
    const dir = join(root, String(pid));
    await mkdir(dir);
    await writeFile(join(dir, 'comm'), comm + '\n');
    await writeFile(join(dir, 'cmdline'), cmdline.replaceAll('\\0', '\0'));
    await writeFile(join(dir, 'smaps_rollup'),
      `Rss: ${rss} kB\nPss: ${pss} kB\nPss_Anon: 200 kB\nPss_File: 400 kB\nPrivate_Dirty: 3 kB\n`);
  }
  const result = await chromiumProcessPss({ procRoot: root, platform: 'linux' });
  assert.equal(result.pssKiB, 176789);
  assert.equal(result.roles.renderer.count, 1);
  assert.equal(result.roles.gpu.count, 1);
  assert.equal(result.processes.length, 2);
  assert.equal(classifyChromiumRole('--type=utility'), 'utility');
  assert.equal(parseSmapsRollup('Pss: 42 kB\n').pssKiB, 42);
  const unsupported = await chromiumProcessPss({ procRoot: root, platform: 'win32' });
  assert.equal(unsupported.available, false);
});

test('Worker CDP probe attributes independent V8 and live WASM memory without touching products', async () => {
  class FakeCdp extends EventEmitter {
    async send(method, params = {}) {
      if (method === 'Target.getTargets') return { targetInfos: [
        { type: 'worker', targetId: 'w1', url: 'http://127.0.0.1:4173/assets/js/workers/core-session-worker.js' },
        { type: 'worker', targetId: 'w2', url: 'http://127.0.0.1:4173/assets/js/workers/hydro-tile-worker.js' },
        { type: 'page', targetId: 'page', url: 'http://127.0.0.1:4173/' },
      ] };
      if (method === 'Target.attachToTarget') return { sessionId: params.targetId };
      if (method === 'Target.sendMessageToTarget') {
        const call = JSON.parse(params.message);
        let result = {};
        if (call.method === 'Runtime.getHeapUsage') result = { usedSize: params.sessionId === 'w1' ? 1024 : 512,
          totalSize: 4096, embedderHeapUsedSize: 123 };
        if (call.method === 'Runtime.evaluate') result = { result: { objectId: 'proto' } };
        if (call.method === 'Runtime.queryObjects') result = { objects: { objectId: 'instances' } };
        if (call.method === 'Runtime.callFunctionOn') result = { result: { value: params.sessionId === 'w1' ? [65536, 131072] : [] } };
        Promise.resolve().then(() => this.emit('Target.receivedMessageFromTarget', {
          sessionId: params.sessionId, message: JSON.stringify({ id: call.id, result }),
        }));
        return {};
      }
      return {};
    }
  }
  const client = new FakeCdp();
  const probe = await createWorkerMemoryProbe(client, { origin: 'http://127.0.0.1:4173' });
  try {
    const sample = await probe.sample();
    assert.equal(sample.count, 2);
    assert.equal(sample.jsUsedBytes, 1536);
    assert.equal(sample.wasmAllocatedBytes, 196608);
    assert.equal(sample.jsComplete, true);
    assert.equal(sample.wasmComplete, true);
    assert.equal(sample.workers[0].wasmLinearMemory.instanceCount, 2);
  } finally { await probe.dispose(); }
});

test('memory delta reports unknown measurements as unavailable instead of zero', () => {
  const phases = [
    { label: 'startup-modern', chromium: { pssMiB: 1800 }, mainJsHeap: { usedBytes: 10 },
      workerMemory: { jsUsedBytes: null, wasmAllocatedBytes: 30 }, gpu: { trackedBytes: 7 } },
    { label: 'returned-modern-1', chromium: { pssMiB: 2000 }, mainJsHeap: { usedBytes: 13 },
      workerMemory: { jsUsedBytes: null, wasmAllocatedBytes: 40 }, gpu: { trackedBytes: 10 } },
    { label: 'idle-modern-1-30s', chromium: { pssMiB: 1900 }, mainJsHeap: { usedBytes: 12 },
      workerMemory: { jsUsedBytes: null, wasmAllocatedBytes: 40 }, gpu: { trackedBytes: 10 } },
    { label: 'returned-modern-3', chromium: { pssMiB: 2200 }, mainJsHeap: { usedBytes: 15 },
      workerMemory: { jsUsedBytes: null, wasmAllocatedBytes: 50 }, gpu: { trackedBytes: 9 } },
    { label: 'idle-modern-3-30s', chromium: { pssMiB: 2100 }, mainJsHeap: { usedBytes: 14 },
      workerMemory: { jsUsedBytes: null, wasmAllocatedBytes: 50 }, gpu: { trackedBytes: 9 } },
  ];
  const result = summarizeMemoryPhases(phases);
  assert.equal(result.initialToFinal.chromiumPssMiB, 300);
  assert.equal(result.initialToFinal.workerJsUsedBytes, null);
  assert.equal(result.initialToFinal.workerWasmLinearBytes, 20);
  assert.equal(result.returnToReturn.chromiumPssMiB, 200);
  assert.equal(result.idle30Trend.chromiumPssMiB, 200);
  assert.equal(result.lastReturnToIdle30.chromiumPssMiB, -100);
});
