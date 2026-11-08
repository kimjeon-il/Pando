import { parentPort, workerData } from 'node:worker_threads';

// Execute the browser module Worker and canonical RPC host in a real Node thread.
globalThis.self = globalThis;
globalThis.self.postMessage = message => parentPort.postMessage(message);
if (typeof workerData?.assetRevision !== 'string' || !workerData.assetRevision)
  throw new TypeError('Place Worker fixture requires its asset revision');
const entry = new URL("../../src/data/workers/place-worker.js", import.meta.url);
entry.searchParams.set('v', workerData.assetRevision);
await import(entry.href);
parentPort.on('message', data => globalThis.self.onmessage({ data }));
parentPort.postMessage({ ready: true });

