import { createWorkerRpcClient } from './worker-rpc.js';
import { createLatestWorkerJobScheduler } from './worker-job-scheduler.js';
import { workerAssetUrl } from './worker-asset-url.js';

export function createReferenceAnalysisClient({ getGeneration, onProgress = () => {}, createWorker = null } = {}) {
  if (typeof getGeneration !== 'function') throw new TypeError('Reference analysis project generation is required.');
  const resources = {
    assetBase: new URL('../../vendor/reference-analysis/', import.meta.url).href,
    languageBase: new URL('../../data/reference-analysis/v1/ocr/', import.meta.url).href,
    dataBase: new URL('../../data/reference-analysis/v1/', import.meta.url).href,
    coreBase: new URL('../../wasm/', import.meta.url).href,
  };
  const rpc = createWorkerRpcClient({ createWorker: createWorker || (() => new Worker(workerAssetUrl(new URL('../workers/reference-image-analysis-worker.js', import.meta.url)), { name: 'reference-image-analysis' })),
    defaultTimeoutMs: 240_000, getProjectRevision: getGeneration, onEvent: event => { if (event.operation === 'reference.analysis-progress') onProgress(event.payload); } });
  const scheduler = createLatestWorkerJobScheduler({ maxConcurrent: 1,
    isCurrent: entry => entry.geometryRevision === getGeneration(), cancelRunning: () => rpc.cancelAll('superseded'),
    execute: async entry => (await rpc.request(entry.metadata.operation, entry.payload, { projectRevision: entry.geometryRevision, signal: entry.metadata.signal })).result,
  });
  return Object.freeze({
    run: (operation, payload, { signal = null } = {}) => scheduler.enqueue({ jobKey: 'reference-analysis', geometryRevision: getGeneration(),
      payload: { ...payload, resources }, signal, metadata: { operation, signal } }).promise,
    cancel: () => scheduler.cancelAll('cancelled'),
    dispose: () => { scheduler.close();rpc.stop(); },
  });
}
