import {parentPort} from 'node:worker_threads';
globalThis.self=globalThis;self.postMessage=message=>parentPort.postMessage(message);
await import("../../shared/frontend/js/workers/map-display-worker.js");
parentPort.on('message',data=>self.onmessage({data}));
