import assert from 'node:assert/strict';
import test from 'node:test';
import { preparedCountrySceneKey } from '../../../src/rendering/country-mesh-codec.js';
import { createBuiltinMeshResourceLoader } from "../../../src/data/builtin-mesh-resource.js";

const identity={fills:[['A','a'.repeat(64)]],boundaries:[['A','a'.repeat(64),'A','','general']]};

test('disposing an in-flight built-in loader settles the request and ignores late delivery', async () => {
  let worker, terminations = 0;
  class FakeWorker {
    constructor() { worker = this; }
    terminate() { terminations++; }
    postMessage() { assert.fail('disposed worker posted work'); }
  }
  const loader = createBuiltinMeshResourceLoader({ runtimeAssetUrl: path => path, WorkerClass: FakeWorker });
  const pending = loader.load(identity);
  assert.equal(typeof loader.dispose, 'function');
  loader.dispose(); loader.dispose();
  worker.onmessage?.({ data: { type: 'builtin-mesh-loader-ready' } });
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(loader.load(identity), { name: 'AbortError' });
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
  const ids = ['A'];
  const first = loader.load(identity);
  const second = loader.load(identity);
  assert.equal(first, second);
  assert.match(instance.url, /workers\/data-loader-worker\.js/);
  assert.equal(instance.options.type, 'module');
  instance.emit({ type: 'builtin-mesh-loader-ready' });
  assert.deepEqual(instance.messages, [{ type: 'load-builtin-mesh', sceneIdentity: identity }]);
  const meshBuffer = new ArrayBuffer(16);
  instance.emit({ type: 'builtin-mesh-ready', meshBuffer, preparedStroke: { joins: [] }, spatialBlocks: [], identity: { hash: 'c'.repeat(64), countryIds: ids, sceneKey: preparedCountrySceneKey(identity) } });
  const result = await first;
  assert.equal(result.meshBuffer, meshBuffer);
  assert.equal(result.identity.hash, 'c'.repeat(64));
  assert.equal(await loader.load(identity),result,'retained immutable scene is reused');
  assert.equal(instance.terminated, true);
});

test('an unmatched historical scene returns no asset, but corruption rejects the load',async()=>{
 let worker;
 class Worker {constructor(){worker=this;}postMessage(){}terminate(){}}
 const loader=createBuiltinMeshResourceLoader({runtimeAssetUrl:p=>p,WorkerClass:Worker});
 const miss=loader.load(identity);worker.onmessage({data:{type:'builtin-mesh-miss'}});
 assert.equal(await miss,null);
 const other={...identity,fills:[['A','b'.repeat(64)]]};
 const corrupt=loader.load(other);worker.onmessage({data:{type:'builtin-mesh-error',message:'integrity failed'}});
 await assert.rejects(corrupt,/integrity/);
 const retry=loader.load(other);worker.onmessage({data:{type:'builtin-mesh-ready',identity:{hash:'c'.repeat(64),sceneKey:preparedCountrySceneKey(identity)}}});
 await assert.rejects(retry,/identity/);
 loader.dispose();
});

test('verified A-B-A country scenes reuse the bounded loader cache without a new Worker', async () => {
  const instances = [];
  class FakeWorker {
    constructor() { instances.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
    emit(message) { this.onmessage?.({ data: message }); }
  }
  const loader = createBuiltinMeshResourceLoader({ runtimeAssetUrl: path => path, WorkerClass: FakeWorker });
  const a = identity;
  const b = { ...identity, fills: [['A', 'b'.repeat(64)]] };
  const c = { ...identity, fills: [['A', 'c'.repeat(64)]] };
  async function admit(scene) {
    const pending = loader.load(scene);
    const worker = instances.at(-1);
    worker.emit({ type: 'builtin-mesh-loader-ready' });
    worker.emit({ type: 'builtin-mesh-ready', meshBuffer: new ArrayBuffer(32),
      preparedStroke: {}, spatialBlocks: {},
      identity: { hash: 'd'.repeat(64), sceneKey: preparedCountrySceneKey(scene) } });
    return pending;
  }
  const savedA = await admit(a);
  await admit(b);
  assert.equal(await loader.load(a), savedA, 'a dated return preserves the decoded CPU mesh');
  assert.equal(instances.length, 2);
  await admit(c);
  assert.equal(instances.length, 3);
  await admit(b);
  assert.equal(instances.length, 4, 'a third distinct scene evicts the least recently used entry');
  loader.dispose();
  assert.ok(instances.every(worker => worker.terminated));
});
