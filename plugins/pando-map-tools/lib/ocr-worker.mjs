import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
process.env.PANDO_MAP_WORKSPACE=workerData.workspace;
const {recognizeInProcess}=await import('./engine.mjs');
globalThis.self=globalThis;
globalThis.self.postMessage=message=>parentPort.postMessage(message);
await import(pathToFileURL(resolve(workerData.workspace,'assets/js/workers/worker-rpc-host.js')).href);
globalThis.self.PandoLabWorkerRpc.install({handlers:{'map.ocr':(payload,context)=>recognizeInProcess(
  {...payload.image,data:Buffer.from(payload.image.data)},payload.languages,context.signal,data=>context.emitEvent('map.progress',data))}});
parentPort.on('message',data=>globalThis.self.onmessage({data}));
