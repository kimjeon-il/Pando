import { parentPort } from 'node:worker_threads';

// Execute the browser module Worker and canonical RPC host in a real Node thread.
globalThis.self = globalThis;
globalThis.self.postMessage = message => parentPort.postMessage(message);
await import('../../assets/js/workers/place-worker.js');
parentPort.on('message', data => globalThis.self.onmessage({ data }));
parentPort.postMessage({ ready: true });
