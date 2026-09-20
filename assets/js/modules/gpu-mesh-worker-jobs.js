import { createLatestWorkerJobScheduler, createWorkerCancellationError } from './worker-job-scheduler.js';

// Owns patch and full-rebuild transport, pending RPCs, cancellation and recovery. Consumers
// decide whether geometry may be committed and install returned mesh resources.
export function createGpuMeshWorkerJobs({ createWorker, createRebuildWorker = createWorker, isCurrent, onMesh = () => {}, onError = () => {} }) {
  let worker = null;
  let rebuildRequest = null;
  function cancelRebuild() {
    if (!rebuildRequest) return;
    const pending = rebuildRequest;
    rebuildRequest = null;
    pending.worker.terminate();
    pending.resolve(null);
  }
  function rebuild(payload, accepts = () => true) {
    cancelRebuild();
    return new Promise((resolve, reject) => {
      const current = createRebuildWorker();
      const pending = { worker: current, resolve };
      rebuildRequest = pending;
      const finish = (value, error) => {
        if (rebuildRequest !== pending) return;
        rebuildRequest = null;
        current.terminate();
        if (error) reject(error); else resolve(value);
      };
      current.onmessage = ({ data }) => {
        if (rebuildRequest !== pending) return;
        if (data?.token !== payload.token || Number(data?.projectGeneration ?? payload.projectGeneration) !== Number(payload.projectGeneration) || !accepts()) {
          finish(null); return;
        }
        if (!data.ok) { finish(null, new Error(data.message || '동적 지도 메시를 준비하지 못했습니다.')); return; }
        finish(data.mesh);
      };
      current.onerror = event => finish(null, accepts() ? new Error(event.message || '동적 지도 메시 Worker 오류') : null);
      try { current.postMessage(payload); } catch (error) { finish(null, error); }
    });
  }
  const requests = new Map();
  let outputBytes = 0;
  const scheduler = createLatestWorkerJobScheduler({
    maxConcurrent: 1,
    isCurrent,
    execute: entry => new Promise((resolve, reject) => {
      const current = ensureWorker(), payload = entry.payload || {};
      requests.set(Number(payload.token), { resolve, reject });
      try {
        current.postMessage({ token: Number(payload.token), geometryRevision: Number(entry.geometryRevision),
          targetRevision: Number(entry.targetRevision), jobKey: entry.jobKey, features: payload.features || [] });
      } catch (error) { requests.delete(Number(payload.token)); reject(error); }
    }),
  });
  function ensureWorker() {
    if (worker) return worker;
    const current = createWorker();
    worker = current;
    current.onmessage = event => {
      if (worker !== current) return;
      const message = event.data || {}, token = Number(message.token || 0), pending = requests.get(token);
      if (!pending) return;
      requests.delete(token);
      if (!message.ok) { pending.reject(new Error(message.message || '변경 국가 메시를 만들지 못했습니다.')); return; }
      const mesh = message.mesh;
      outputBytes += ['positions', 'countryIndices', 'triangleIndices', 'lineIndices', 'strokeStartsEnds']
        .reduce((sum, key) => sum + Number(mesh?.[key]?.byteLength || 0), 0);
      onMesh(mesh);
      pending.resolve(mesh);
    };
    current.onerror = event => {
      if (worker !== current) return;
      const error = new Error(event.message || '변경 국가 메시 Worker 오류');
      for (const pending of requests.values()) pending.reject(error);
      requests.clear(); current.terminate(); worker = null;
      onError(event);
    };
    return current;
  }
  return Object.freeze({
    rebuild, cancelRebuild,
    enqueue: entry => scheduler.enqueue(entry),
    cancelAll(reason = 'cancelled') {
      cancelRebuild();
      scheduler.cancelAll(reason);
      const error = createWorkerCancellationError('국가 메시 계산을 취소했습니다.', reason);
      for (const request of requests.values()) request.reject(error);
      requests.clear(); worker?.terminate(); worker = null;
    },
    stats: () => scheduler.stats(),
    outputBytes: () => outputBytes,
  });
}
