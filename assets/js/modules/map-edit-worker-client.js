import {
  createLatestWorkerJobScheduler,
  createWorkerCancellationError,
} from './worker-job-scheduler.js';

export function createMapEditWorkerClient({
  createWorker,
  getFeatures,
  getFeatureById,
  getTargetRevision = null,
  now = () => performance.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  readyTimeoutMs = 3000,
}) {
  let worker = null;
  let dataRevision = 0;
  let ready = false;
  const inFlight = new Map();
  const currentTargetRevision = () => typeof getTargetRevision === 'function'
    ? Number(getTargetRevision())
    : dataRevision;

  function rejectWorkerRequests(error) {
    for (const request of inFlight.values()) request.reject(error);
    inFlight.clear();
  }

  function terminateWorker(error = null) {
    if (error) rejectWorkerRequests(error);
    worker?.terminate();
    worker = null;
    ready = false;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'ready') {
        const readyRevision = message.dataRevision == null ? dataRevision : Number(message.dataRevision);
        if (readyRevision === dataRevision) ready = true;
        return;
      }
      if (message.type !== 'result') return;
      const requestId = Number(message.requestId || 0);
      const request = inFlight.get(requestId);
      if (!request) return;
      inFlight.delete(requestId);
      if (message.ok) request.resolve(message.result);
      else if (message.cancelled) request.reject(createWorkerCancellationError('작업을 취소했습니다.', 'worker-cancelled'));
      else request.reject(new Error(message.message || '지도 편집 계산에 실패했습니다.'));
    };
    worker.onerror = event => {
      const error = new Error(event.message || '지도 편집 Worker를 사용할 수 없습니다.');
      scheduler.cancelAll('worker-error');
      terminateWorker(error);
    };
    return worker;
  }

  async function waitForReady() {
    await new Promise(resolve => {
      const started = now();
      const poll = () => ready || now() - started > readyTimeoutMs ? resolve() : schedule(poll, 16);
      poll();
    });
    if (!ready) throw new Error('지도 편집 Worker를 준비하지 못했습니다. 잠시 후 다시 시도하세요.');
  }

  function sendExecute(entry) {
    return new Promise((resolve, reject) => {
      inFlight.set(entry.requestId, { resolve, reject });
      ensureWorker().postMessage({
        type: 'execute',
        operation: entry.payload.operation,
        requestId: entry.requestId,
        jobKey: entry.jobKey,
        dataRevision: entry.geometryRevision,
        geometryRevision: entry.geometryRevision,
        targetRevision: entry.targetRevision,
        ...entry.payload.payload,
      });
    });
  }

  const scheduler = createLatestWorkerJobScheduler({
    maxConcurrent: 1,
    now,
    execute: sendExecute,
    cancelRunning: entry => worker?.postMessage({
      type: 'cancel', requestId: entry.requestId, jobKey: entry.jobKey, targetRevision: entry.targetRevision,
    }),
    discardResult: (_result, entry) => worker?.postMessage({
      type: 'discard', requestId: entry.requestId, jobKey: entry.jobKey, targetRevision: entry.targetRevision,
    }),
    isCurrent: entry => Number(entry.geometryRevision) === dataRevision
      && Number(entry.targetRevision) === currentTargetRevision(),
  });

  function rebase(features = getFeatures()) {
    scheduler.cancelAll('rebase');
    dataRevision += 1;
    ready = false;
    ensureWorker().postMessage({
      type: 'rebase',
      dataRevision,
      geometryRevision: dataRevision,
      targetRevision: currentTargetRevision(),
      features,
    });
    return dataRevision;
  }

  function syncPatch(rawIds) {
    if (!worker || !ready) return false;
    const ids = [...new Set([...rawIds].map(String).filter(Boolean))];
    if (!ids.length) return false;
    scheduler.cancelAll('state-changed');
    const features = ids.map(getFeatureById).filter(Boolean);
    const removedIds = ids.filter(id => !getFeatureById(id));
    dataRevision += 1;
    worker.postMessage({
      type: 'sync-patch',
      dataRevision,
      geometryRevision: dataRevision,
      targetRevision: currentTargetRevision(),
      features,
      removedIds,
    });
    return true;
  }

  async function prepareWorker() {
    if (!worker) rebase();
    if (!ready) await waitForReady();
  }

  async function execute(operation, payload, {
    jobKey = `map-edit:${operation}`,
    targetRevision = null,
    priority = 100,
    signal = null,
  } = {}) {
    await prepareWorker();
    const geometryRevision = dataRevision;
    const resolvedTargetRevision = targetRevision == null ? currentTargetRevision() : Number(targetRevision);
    const ticket = scheduler.enqueue({
      jobKey,
      geometryRevision,
      targetRevision: resolvedTargetRevision,
      priority,
      signal,
      payload: { operation, payload },
    });
    const result = await ticket.promise;
    return {
      requestId: ticket.requestId,
      jobKey: String(jobKey),
      geometryRevision,
      targetRevision: resolvedTargetRevision,
      result,
    };
  }

  function commit(requestId) {
    const nextDataRevision = dataRevision + 1;
    worker?.postMessage({ type: 'commit', requestId, dataRevision, nextDataRevision });
    dataRevision = nextDataRevision;
  }

  function discard(requestId) {
    scheduler.cancel(requestId, 'discarded');
    worker?.postMessage({ type: 'discard', requestId, dataRevision });
  }

  function cancel() {
    scheduler.cancelAll('cancelled');
  }

  function stop(error = null) {
    scheduler.cancelAll('stopped');
    terminateWorker(error || createWorkerCancellationError('지도 편집 Worker를 종료했습니다.', 'stopped'));
  }

  return Object.freeze({
    cancel,
    commit,
    discard,
    execute,
    rebase,
    stop,
    syncPatch,
    stats: () => Object.freeze({
      role: 'stateful-dedicated',
      dataRevision,
      targetRevision: currentTargetRevision(),
      ready,
      inFlightCount: inFlight.size,
      ...scheduler.stats(),
    }),
  });
}
