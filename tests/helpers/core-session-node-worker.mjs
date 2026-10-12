import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createCoreWorkerRuntime } from '../../assets/js/modules/core-worker-runtime.js';
import { validateWebFlagDataUrl } from '../../assets/js/modules/country-flags.js';

globalThis.self = globalThis;
globalThis.self.postMessage = message => parentPort.postMessage(message);
await import('../../assets/js/workers/worker-rpc-host.js');
const runtime = createCoreWorkerRuntime({ validateFlagDataUrl: validateWebFlagDataUrl, loadModule: async () => {
  const { default: createCore } = await import(pathToFileURL(workerData.modulePath));
  const core = await createCore({ wasmBinary: await readFile(workerData.modulePath.replace(/\.js$/, '.wasm')) });
  if (core.coreAbiVersion !== 1 || core.coreCompilerVersion !== '4.0.20'
    || typeof core.coreSourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(core.coreSourceSha256))
    throw new Error('Compiled core ABI, source digest or compiler does not match the required contract.');
  return core;
} });
globalThis.self.PandoLabWorkerRpc.install({ handlers: Object.fromEntries(runtime.operations.map(operation =>
  [operation, (payload, context) => runtime.dispatch(operation, payload, context)])) });
parentPort.on('message', data => globalThis.self.onmessage({ data }));
