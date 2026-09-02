import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const rpcClient = read('assets/js/modules/worker-rpc.js');
for (const marker of [
  'requestId', 'operation', 'projectRevision', 'priority', 'timeoutMs', 'AbortSignal',
  'WORKER_RPC_ERROR_CATEGORIES', 'STALE_RESULT', 'transfer', 'timing',
]) {
  expect(rpcClient.includes(marker), `worker-rpc.js is missing canonical RPC concept: ${marker}`);
}
expect(rpcClient.includes('pending = new Map()'), 'worker-rpc.js must centrally own pending requests');
expect(rpcClient.includes("type: WORKER_RPC_MESSAGE_TYPES.CANCEL"), 'worker-rpc.js must own canonical cancellation messages');
expect(rpcClient.includes("code: 'PL-WORKER-RPC-TIMEOUT'"), 'worker-rpc.js must own timeout errors');
expect(rpcClient.includes("code: 'PL-WORKER-RPC-STALE'"), 'worker-rpc.js must own stale-result rejection');
expect(rpcClient.includes('postMessage(encoded, transferables)'), 'worker-rpc.js must preserve request transferables');

const host = read('assets/js/workers/worker-rpc-host.js');
for (const marker of ['transferResult', 'durationMs', 'throwIfCancelled', 'protocolVersion', 'serializeError']) {
  expect(host.includes(marker), `worker-rpc-host.js is missing host contract: ${marker}`);
}

const pool = read('assets/js/modules/worker-rpc-pool.js');
expect(pool.includes('resolveWorkerRpcPoolSize'), 'Worker RPC pool sizing policy is missing');
expect(pool.includes('Math.min(4'), 'desktop Worker RPC pool must remain capped at 4');
expect(pool.includes('mobile'), 'Worker RPC pool must keep a mobile sizing branch');

const mapEditClient = read('assets/js/modules/map-edit-worker-client.js');
expect(mapEditClient.includes("from './worker-rpc.js'"), 'map-edit worker client must use Worker RPC');
expect(mapEditClient.includes('createWorkerRpcClient'), 'map-edit worker client must create a Worker RPC client');
expect(!mapEditClient.includes('const inFlight = new Map()'), 'map-edit worker client may not recreate a pending request map');
expect(!mapEditClient.includes('.onmessage ='), 'map-edit worker client may not own Worker message dispatch directly');
expect(mapEditClient.includes('createLatestWorkerJobScheduler'), 'map-edit must keep scheduler policy separate from RPC transport');

const importService = read('assets/js/modules/import-service.js');
expect(importService.includes('createWorkerRpcClient'), 'GIS geometry validation must use Worker RPC');
expect(!importService.includes('const pending = new Map()'), 'GIS geometry validation may not recreate pending request bookkeeping');
expect(importService.includes("request('gis.validate'"), 'GIS geometry validation must have a semantic RPC operation');

const rpcWorkers = [
  ['assets/js/workers/gpu-mesh-worker.js', 'geometry.mesh'],
  ['assets/js/workers/geometry-validation-worker.js', 'geometry.audit'],
  ['assets/js/workers/river-territory-partition-worker.js', 'river.partition'],
];
for (const [relativePath, operation] of rpcWorkers) {
  const source = read(relativePath);
  expect(source.includes('worker-rpc-host.js'), `${relativePath} must load the canonical Worker RPC host`);
  expect(source.includes(operation), `${relativePath} must expose canonical operation ${operation}`);
}

const gpuMesh = read('assets/js/workers/gpu-mesh-worker.js');
for (const buffer of [
  'mesh.positions.buffer',
  'mesh.countryIndices.buffer',
  'mesh.triangleIndices.buffer',
  'mesh.lineIndices.buffer',
  'mesh.strokeStartsEnds.buffer',
]) expect(gpuMesh.includes(buffer), `GPU mesh transferable regressed: ${buffer}`);
expect(gpuMesh.includes('transferResult(mesh, meshTransferables(mesh))'), 'GPU mesh RPC result must transfer buffers instead of cloning them');

const allowedDedicatedWorkers = Object.freeze([
  'canvas-render-worker.js',
  'data-loader-worker.js',
  'hydro-tile-worker.js',
  'map-edit-worker.js',
]);
const docs = read('docs/architecture/worker-rpc.md');
for (const worker of allowedDedicatedWorkers) {
  const label = worker.replace('-worker.js', '').replaceAll('-', '-');
  expect(docs.toLowerCase().includes(label.split('-')[0]), `Worker RPC docs must explain dedicated worker exception: ${worker}`);
}
expect(docs.includes('Do not add another compatibility codec'), 'Worker RPC docs must prohibit new compatibility codecs');

if (failures.length) {
  console.error(`Worker architecture check failed with ${failures.length} issue(s):`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Worker architecture OK: RPC owns request lifecycle, pool policy is bounded, and mesh transferables are preserved.');
