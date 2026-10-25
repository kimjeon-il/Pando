import { parentPort, workerData } from 'node:worker_threads';
import { loadNodeCore } from '../../tools/load-node-core.mjs';
import { createCoreWorkerRuntime } from "../../shared/frontend/js/modules/core-worker-runtime.js";
import { validateWebFlagDataUrl } from "../../shared/frontend/js/modules/country-flags.js";

globalThis.self = globalThis;
globalThis.self.postMessage = message => parentPort.postMessage(message);
await import("../../shared/frontend/js/workers/worker-rpc-host.js");
const runtime = createCoreWorkerRuntime({ validateFlagDataUrl: validateWebFlagDataUrl,
  loadModule: () => loadNodeCore({ modulePath: workerData.modulePath }) });
globalThis.self.PandoLabWorkerRpc.install({ handlers: Object.fromEntries(runtime.operations.map(operation =>
  [operation, (payload, context) => runtime.dispatch(operation, payload, context)])) });
parentPort.on('message', data => globalThis.self.onmessage({ data }));
