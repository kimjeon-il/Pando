import assert from 'node:assert/strict';
import test from 'node:test';
import { auditWorkerArchitecture } from '../../scripts/check-worker-architecture.mjs';
import { auditSchemaOwners, auditVersionDisplays } from '../../scripts/check-version-architecture.mjs';
import { assertProjectLifecycleFacade } from '../../scripts/lib/application-source.mjs';
import { readFileSync } from 'node:fs';

const rpc = 'assets/js/modules/worker-rpc.js';
const host = 'assets/js/workers/worker-rpc-host.js';
const workerSources = client => new Map([[rpc, 'export function createWorkerRpcClient() {}'],
  [host, 'self.transport = {};'], ['assets/js/modules/renamed-client.js', client]]);

test('project lifecycle guard checks the current domain facade and rejects a missing command',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/project-domain.js',import.meta.url),'utf8');
  assert.doesNotThrow(()=>assertProjectLifecycleFacade(source));
  assert.throws(()=>assertProjectLifecycleFacade('return Object.freeze({ load, save, undo, redo });'),/createProject/);
});

test('RPC architecture accepts aliases, formatting and comment-only private implementation markers', () => {
  const sources = workerSources("import { createWorkerRpcClient as createTransport } from './worker-rpc.js';\n// worker.onmessage = handler; pending = new Map();\nconst client = createTransport({});\nclient.request('operation', {});");
  assert.deepEqual(auditWorkerArchitecture(sources), []);
});

test('RPC architecture rejects actual direct message handling and transport bypass', () => {
  const sources = workerSources("import { createWorkerRpcClient as createTransport } from './worker-rpc.js';\nconst client = createTransport({}); worker['onmessage'] = handler; worker.postMessage({});");
  const failures = auditWorkerArchitecture(sources);
  assert.equal(failures.length, 2);
  assert.ok(failures.some(failure => failure.includes('onmessage')));
  assert.ok(failures.some(failure => failure.includes('postMessage')));
});

test('removing an RPC import or using a barrel cannot disable message ownership guards', () => {
  for (const source of ['worker.onmessage = handler;', "import { createWorkerRpcClient } from './barrel.js'; worker.postMessage({});"])
    assert.equal(auditWorkerArchitecture(workerSources(source)).length, 1);
  assert.deepEqual(auditWorkerArchitecture(workerSources('// @worker-transport dedicated: persistent rendering channel owns its protocol\nworker.postMessage({});')), []);
  assert.match(auditWorkerArchitecture(workerSources('// @worker-transport dedicated:\nworker.postMessage({});')).join('\n'), /dedicated.*reason/);
});

test('RPC workers cannot use the host without loading it', () => {
  const sources = workerSources("import { createWorkerRpcClient } from './worker-rpc.js'; createWorkerRpcClient({});");
  sources.set('assets/js/workers/renamed-worker.js', 'const diagnostic = "./worker-rpc-host.js"; self.PandoLabWorkerRpc.install({ handlers: {} });');
  assert.match(auditWorkerArchitecture(sources).join('\n'), /renamed-worker.*host/);
  sources.set('assets/js/workers/renamed-worker.js', "importScripts(withRevision('./worker-rpc-host.js')); self.PandoLabWorkerRpc.install({ handlers: {} });");
  assert.deepEqual(auditWorkerArchitecture(sources), []);
});

test('schema ownership follows imports and exported bindings rather than declaration spelling', () => {
  const sources = new Map([
    ['assets/js/modules/version-contract.js', 'export const CURRENT_SCHEMA_VERSION = 10;'],
    ['assets/js/modules/renamed-state.js', "import { CURRENT_SCHEMA_VERSION as version } from './version-contract.js'; export { version as CURRENT_SCHEMA_VERSION }; // export const CURRENT_SCHEMA_VERSION = 99;"],
  ]);
  assert.deepEqual(auditSchemaOwners(sources, ['CURRENT_SCHEMA_VERSION']), []);
  sources.set('assets/js/modules/duplicate.js', 'const copied = 10; export { copied as CURRENT_SCHEMA_VERSION };');
  assert.match(auditSchemaOwners(sources, ['CURRENT_SCHEMA_VERSION']).join('\n'), /duplicate.*CURRENT_SCHEMA_VERSION/);
});

test('version displays follow the current package version without pinning its value or quote style', () => {
  const fixture = { version: '7.8.9', readme: '# Renamed product v7.8.9\n', html: "<body data-app-version = '7.8.9'>" };
  assert.deepEqual(auditVersionDisplays(fixture), []);
  assert.deepEqual(auditVersionDisplays({ ...fixture, version: '7.8.10' }), [
    'README display version differs from package.json', 'HTML display version differs from package.json',
  ]);
});

test('schema re-exports can cross renamed modules without creating another schema owner', () => {
  const sources = new Map([
    ['assets/js/modules/version-contract.js', 'export const CURRENT_SCHEMA_VERSION = 10;'],
    ['assets/js/modules/bridge.js', "export { CURRENT_SCHEMA_VERSION as revision } from './version-contract.js?v=current';"],
    ['assets/js/modules/consumer.js', "import { revision as value } from './bridge.js'; export { value as CURRENT_SCHEMA_VERSION };"],
  ]);
  assert.deepEqual(auditSchemaOwners(sources, ['CURRENT_SCHEMA_VERSION']), []);
  sources.set('assets/js/modules/bridge.js', 'export const revision = 10;');
  assert.match(auditSchemaOwners(sources, ['CURRENT_SCHEMA_VERSION']).join('\n'), /consumer.*CURRENT_SCHEMA_VERSION/);
});
