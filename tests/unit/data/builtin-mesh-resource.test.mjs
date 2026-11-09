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
  assert.match(instance.url, /mode=builtin-mesh-only/);
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
