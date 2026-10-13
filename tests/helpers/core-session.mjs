import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreDocumentClient } from '../../assets/js/modules/core-document-client.js';

function createNodeCoreWorker() {
  const worker = new Worker(new URL('./core-session-node-worker.mjs', import.meta.url), { workerData: {
    modulePath: resolve(process.env.PANDOEDITOR_WASM_MODULE || fileURLToPath(new URL('../../assets/wasm/pandoeditor-core.js',import.meta.url))),
  } });
  const port = { postMessage: message => worker.postMessage(message), terminate: () => worker.terminate() };
  worker.on('message', data => port.onmessage?.({ data }));
  worker.on('error', error => port.onerror?.(error));
  // Atomic requests intentionally have no timeout timer. Keep the actual
  // Worker referenced until dispose() so Node cannot exit before its ACK.
  return port;
}

export function createNodeCoreDocument(options = {}) {
  return createCoreDocumentClient({ ...options, createWorker: createNodeCoreWorker });
}
