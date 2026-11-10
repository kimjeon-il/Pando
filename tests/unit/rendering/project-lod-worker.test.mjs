import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { WORKER_RPC_PROTOCOL, WORKER_RPC_PROTOCOL_VERSION } from '../../../src/runtime/worker-rpc.js';
import { packCountryMeshFeatures } from '../../../src/rendering/country-mesh-transfer.js';
import { resolveScreenLodBucket } from '../../../src/rendering/render-lod.js';
import { MAP_PROJECT_ROLES } from '../../../src/data/map-project-manifest.js';

function actualWorker(t) {
  const transportModule = new URL('../../helpers/source-worker-transport.mjs', import.meta.url).href;
  const sourceModule = new URL('../../../src/rendering/workers/gpu-mesh-worker.js', import.meta.url).href;
  const resources=Object.fromEntries(MAP_PROJECT_ROLES.map(role=>[role,
    {catalog:`assets/data/synthetic/${role==='lakes'?'rivers':role}.json`}]));
  const mapProject={format:'pandolab-map-project-manifest',schemaVersion:1,projectId:'synthetic-lod',
    documentFormat:'pandolab-project-state',resources};
  const projectCatalogs={preparedMeshes:{catalog:resources.preparedMeshes.catalog,sha256:'a'.repeat(64),bytes:1}};
  const worker = new Worker(`(async () => {
    const { parentPort } = require('node:worker_threads');
    const vm = require('node:vm');
    const { sourceWorkerTransport } = await import(${JSON.stringify(transportModule)});
    const transport = sourceWorkerTransport('assets/js/workers/gpu-mesh-worker.js', { buildMeta: {
      assetRevision: 'project-lod-test', dataRevision: 'synthetic-lod', resourceProfile: 'test-fixture',
      mapProject:${JSON.stringify(mapProject)},projectCatalogs:${JSON.stringify(projectCatalogs)},
    } });
    global.self = global; self.location = transport.location;
    global.importScripts = (...urls) => urls.forEach(url => vm.runInThisContext(
      '(function(module,exports){' + transport.read(url) + '\\n}).call(globalThis,undefined,undefined)'));
    self.postMessage = (data, transfer = []) => parentPort.postMessage(data, transfer);
    vm.runInThisContext(transport.read(self.location), { filename: self.location.href,
      importModuleDynamically: specifier => import(new URL(specifier, ${JSON.stringify(sourceModule)})) });
    parentPort.on('message', data => self.onmessage({ data }));
  })();`, { eval: true, execArgv: ['--experimental-vm-modules'] });
  t.after(() => worker.terminate());
  let requestId = 0;
  return payload => new Promise((resolve, reject) => {
    const id = ++requestId;
    const receive = data => {
      if (data.type !== 'result' || data.requestId !== id) return;
      worker.off('message', receive); worker.off('error', reject); resolve(data);
    };
    worker.on('message', receive); worker.once('error', reject);
    worker.postMessage({ rpc: WORKER_RPC_PROTOCOL, protocolVersion: WORKER_RPC_PROTOCOL_VERSION,
      type: 'request', requestId: id, operation: 'geometry.mesh', payload });
  });
}
const feature = (id, rings) => ({ type: 'Feature', id, properties: {},
  geometry: { type: 'Polygon', coordinates: rings } });

test('actual LOD Worker retains one full-source topology index while visibility changes', { timeout: 10000 }, async t => {
  const request = actualWorker(t);
  const shared = [[10,0],[10.1,2],[10,4],[10.1,6],[10,8],[10,10]];
  const left = feature('left', [[[0,0], ...shared, [0,10],[0,0]]]);
  const right = feature('right', [[...shared.toReversed(),[20,0],[20,10],shared.at(-1)],
    [[12,2],[12,4],[14,4],[14,2],[12,2]]]);
  const island = feature('island', [[[30,0],[31,0],[31,1],[30,1],[30,0]]]);
  const packed = await packCountryMeshFeatures([left, right, island]);
  const payload = { ...packed, sourceKey: 'synthetic-source', lod: resolveScreenLodBucket({cssScale: 10}),
    visibleIds: ['left'] };
  const first = await request(payload);
  assert.equal(first.ok, true, first.error?.message);
  assert.equal(first.result.lod.topologyReused, false);
  assert.equal(first.result.lod.topologyFeatureCount, 3);
  assert.equal(first.result.displayFeatures[1].geometry, null);
  for (const point of shared) assert.ok(first.result.displayFeatures[0].geometry.coordinates[0]
    .some(p => p[0] === point[0] && p[1] === point[1]), 'offscreen hole owner protects shared point');
  assert.ok(first.result.displaySourceIndices[0][0][0].length > 0);
  const second = await request({ sourceKey: payload.sourceKey, lod: payload.lod,
    useCachedSource: true, visibleIds: ['island'] });
  assert.equal(second.ok, true, second.error?.message);
  assert.equal(second.result.lod.simplified, true, second.result.lod.failure);
  assert.equal(second.result.lod.topologyReused, true);
  assert.equal(second.result.lod.topologyFeatureCount, 3);
  assert.equal(second.result.displayFeatures[0].geometry, null);
  assert.deepEqual(second.result.displayFeatures[2].geometry, island.geometry);
});

test('capped LOD failure is an explicit error, never a successful canonical fallback', { timeout: 10000 }, async t => {
  const request = actualWorker(t);
  const packed = await packCountryMeshFeatures([feature('bad', [[[0,0],[1,0],[1,1],[0,1]]])]);
  const result = await request({ ...packed, sourceKey: 'invalid-source',
    lod: { key: 'capped', upperScale: 10, errorPx: 10, capped: true } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PL-LOD-TOPOLOGY');
});

test('physical masks share country topology but never become country mesh slots', { timeout: 10000 }, async t => {
  const request=actualWorker(t);
  const country=feature('country',[[[0,0],[4,0],[4,1],[3,1.01],[2,1],[1,.99],[0,1],[0,0]]]);
  const land=feature('physical-land',structuredClone(country.geometry.coordinates));
  const packed=await packCountryMeshFeatures([country,land]);
  const response=await request({...packed,sourceKey:'country-and-land',countryFeatureCount:1,
    lod:resolveScreenLodBucket({cssScale:20}),visibleIds:['country']});
  assert.equal(response.ok,true,response.error?.message);
  assert.equal(response.result.lod.simplified,true,response.result.lod.failure);
  assert.deepEqual(response.result.countryIds,['country']);
  assert.equal(response.result.displayFeatures.length,1);
  assert.equal(response.result.displayPhysicalFeatures.length,1);
  assert.equal(response.result.displayPhysicalFeatures[0].id,'physical-land');
  assert.deepEqual(response.result.displayFeatures[0].geometry,response.result.displayPhysicalFeatures[0].geometry);
  assert.deepEqual(response.result.displaySourceIndices[0],response.result.displayPhysicalSourceIndices[0]);
  const physical=response.result.displayPhysicalPackets[0];
  assert.equal(physical.id,'physical-land');
  assert.ok(physical.packet.positions.length>0);
  assert.ok(physical.packet.indices.length>0);
  assert.deepEqual([...physical.packet.ringCoordinates],response.result.displayPhysicalFeatures[0].geometry.coordinates.flat(2));
});
