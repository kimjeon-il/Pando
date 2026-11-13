import test from 'node:test';
import assert from 'node:assert/strict';
import { createInlineCanvasWorker } from '../../../src/rendering/canvas-inline-worker.js';

const drain = () => new Promise(resolve => setImmediate(resolve));
async function waitForAsyncManifest(predicate) {
  const limit = Date.now() + 5000;
  while (Date.now() < limit) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Inline DEM manifest did not enter the canonical fetch pipeline');
}
const runtimeUrl = 'https://example.test/assets/js/workers/canvas-render-worker.js?v=test';

test('inline Canvas uses the shared worker protocol and isolates submitted scene data', async () => {
  const previous = globalThis.d3;
  globalThis.d3 = {geo:{distance: () => 0}};
  const worker = createInlineCanvasWorker({runtimeUrl}), messages = [], errors = [];
  worker.onmessage = event => messages.push(event.data);
  worker.onerror = event => errors.push(event.error);
  try {
    worker.postMessage({type:'init',terrainEnabled:false,features:[],projectGeneration:1});
    const change = {type:'replace-data',projectGeneration:1,geometryRevision:2,ids:['country:A'],features:[]};
    worker.postMessage(change);
    change.ids[0] = 'mutated-after-send';
    await drain();
    assert.deepEqual(errors,[]);
    assert.equal(messages[0].type,'ready');
    assert.deepEqual(messages[1].ids,['country:A']);
    assert.equal(messages[1].geometryRevision,2);
    worker.postMessage({type:'replace-data',projectGeneration:0,geometryRevision:9,features:[]});
    await drain();
    assert.equal(messages.length,2,'old project messages cannot update the shared runtime');
  } finally { worker.terminate(); globalThis.d3 = previous; }
});

test('terminating inline Canvas aborts pending manifest work and queued delivery', async () => {
  const previousD3 = globalThis.d3, previousFetch = globalThis.fetch;
  globalThis.d3 = {geo:{distance: () => 0}};
  let signal;
  globalThis.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve,reject) => signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError'))));
  };
  const worker = createInlineCanvasWorker({runtimeUrl}), received = [];
  worker.onmessage = event => received.push(event.data);
  try {
    worker.postMessage({type:'init',features:[],terrainDemManifestUrl:'https://example.test/dem.json'});
    await waitForAsyncManifest(() => !!signal);
    assert.equal(signal.aborted,false);
    worker.postMessage({type:'replace-data',features:[],ids:['late']});
    worker.terminate(); worker.terminate();
    assert.equal(signal.aborted,true);
    await drain();
    assert.deepEqual(received.map(message=>message.type),['ready']);
  } finally { worker.terminate(); globalThis.fetch=previousFetch; globalThis.d3=previousD3; }
});

test('project catalog replacement aborts an older pending numerical source', async () => {
  const previousD3 = globalThis.d3, previousFetch = globalThis.fetch;
  globalThis.d3 = {geo:{distance: () => 0}};
  const requests=[];
  globalThis.fetch = (url, options) => {
    requests.push({url,signal:options.signal});
    return new Promise((_resolve,reject) => options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError'))));
  };
  const worker=createInlineCanvasWorker({runtimeUrl});
  try {
    worker.postMessage({type:'init',projectGeneration:1,features:[],terrainDemManifestUrl:'https://example.test/a.json'});
    await waitForAsyncManifest(() => requests.length === 1);
    worker.postMessage({type:'reset-generation',projectGeneration:2});
    worker.postMessage({type:'terrain-source',projectGeneration:2,terrainDemManifestUrl:'https://example.test/b.json'});
    await waitForAsyncManifest(() => requests.length === 2);
    assert.deepEqual(requests.map(request=>request.url),['https://example.test/a.json','https://example.test/b.json']);
    assert.equal(requests[0].signal.aborted,true);
    assert.equal(requests[1].signal.aborted,false);
    const update={type:'terrain-source',projectGeneration:2,terrainDemManifestUrl:'https://example.test/b.json',terrainAssetsSha256:'changed-content'};
    worker.postMessage(update);
    await waitForAsyncManifest(() => requests.length === 3);
    assert.equal(requests[1].signal.aborted,true,'same URL with another content identity invalidates old work');
    assert.equal(requests[2].url,'https://example.test/b.json?v=changed-content');
    worker.postMessage(update);
    await drain();
    assert.equal(requests.length,3,'unchanged content reuses its pending manifest');
  } finally { worker.terminate(); globalThis.fetch=previousFetch; globalThis.d3=previousD3; }
});
