import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuiltinMeshResourceLoader } from '../../assets/js/modules/builtin-mesh-resource.js';

test('disposing an in-flight built-in loader settles the request and ignores late delivery', async () => {
  let worker, terminations = 0;
  class FakeWorker {
    constructor() { worker = this; }
    terminate() { terminations++; }
    postMessage() { assert.fail('disposed worker posted work'); }
  }
  const loader = createBuiltinMeshResourceLoader({ runtimeAssetUrl: path => path, WorkerClass: FakeWorker });
  const pending = loader.load(['A']);
  assert.equal(typeof loader.dispose, 'function');
  loader.dispose(); loader.dispose();
  worker.onmessage?.({ data: { type: 'builtin-mesh-loader-ready' } });
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(loader.load(['A']), { name: 'AbortError' });
  assert.equal(terminations, 1);
});

test('built-in mesh loader shares one worker request and releases it after a verified response', async () => {
  let instance = null;
  class FakeWorker {
    constructor(url, options) {
      this.url = String(url);
      this.options = options;
      instance = this;
    }
    postMessage(message) { this.messages ||= []; this.messages.push(message); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage?.({ data }); }
  }
  const loader = createBuiltinMeshResourceLoader({
    runtimeAssetUrl: path => new URL(`https://example.test/${path}`),
    WorkerClass: FakeWorker,
  });
  const ids = Array.from({ length: 258 }, (_, index) => `country-${index}`);
  const first = loader.load(ids);
  const second = loader.load(ids);
  assert.equal(first, second);
  assert.match(instance.url, /mode=builtin-mesh-only/);
  assert.equal(instance.options.type, 'module');
  instance.emit({ type: 'builtin-mesh-loader-ready' });
  assert.deepEqual(instance.messages, [{ type: 'load-builtin-mesh', countryIds: ids }]);
  const meshBuffer = new ArrayBuffer(16);
  instance.emit({ type: 'builtin-mesh-ready', meshBuffer, preparedStroke: { joins: [] }, spatialBlocks: [], identity: { hash: 'mesh' } });
  const result = await first;
  assert.equal(result.meshBuffer, meshBuffer);
  assert.equal(result.identity.hash, 'mesh');
  assert.equal(instance.terminated, true);
});
