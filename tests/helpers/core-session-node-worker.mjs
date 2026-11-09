import { parentPort, workerData } from 'node:worker_threads';
import { loadNodeCore } from "../../tools/build/load-node-core.mjs";
import { createCoreWorkerRuntime } from "../../src/runtime/core-worker-runtime.js";
import { validateWebFlagDataUrl } from "../../src/ui/country-flags.js";

globalThis.self = globalThis;
globalThis.self.postMessage = message => parentPort.postMessage(message);
await import("../../src/runtime/workers/worker-rpc-host.js");
const runtime = createCoreWorkerRuntime({ validateFlagDataUrl: validateWebFlagDataUrl,
  loadModule: () => loadNodeCore({ modulePath: workerData.modulePath }) });
globalThis.self.PandoLabWorkerRpc.install({ handlers: Object.fromEntries(runtime.operations.map(operation =>
  [operation, (payload, context) => runtime.dispatch(operation, payload, context)])) });
parentPort.on('message', data => globalThis.self.onmessage({ data }));
