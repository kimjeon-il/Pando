export function createMapEditWorkerClient({
  createWorker,
  getFeatures,
  getFeatureById,
  now = () => performance.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  readyTimeoutMs = 3000,
}) {
  let worker = null;
  let sequence = 0;
  let dataRevision = 0;
  let ready = false;
  let activeRequestId = 0;
  const pending = new Map();

  function cancelledError(message) {
    return Object.assign(new Error(message), { cancelled: true });
  }

  function stop(error = null) {
    if (error) for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
    ready = false;
    activeRequestId = 0;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'ready') {
        ready = true;
        return;
      }
      if (message.type !== 'result') return;
      const requestId = Number(message.requestId);
      const request = pending.get(requestId);
      if (!request) return;
      pending.delete(requestId);
      if (activeRequestId === requestId) activeRequestId = 0;
      if (Number(message.dataRevision) !== dataRevision) {
        request.reject(cancelledError('지도 상태가 바뀌어 오래된 계산 결과를 폐기했습니다.'));
        return;
      }
      if (message.ok) request.resolve(message.result);
      else if (message.cancelled) request.reject(cancelledError('작업을 취소했습니다.'));
      else request.reject(new Error(message.message || '지도 편집 계산에 실패했습니다.'));
    };
    worker.onerror = event => stop(new Error(event.message || '지도 편집 Worker를 사용할 수 없습니다.'));
    return worker;
  }

  function rebase(features = getFeatures()) {
    if (activeRequestId || pending.size) stop(cancelledError('지도 상태가 바뀌어 이전 계산을 취소했습니다.'));
    dataRevision += 1;
    ready = false;
    ensureWorker().postMessage({ type: 'rebase', dataRevision, features });
  }

  function syncPatch(rawIds) {
    if (!worker || !ready) return;
    const ids = [...new Set([...rawIds].map(String).filter(Boolean))];
    const features = ids.map(getFeatureById).filter(Boolean);
    const removedIds = ids.filter(id => !getFeatureById(id));
    dataRevision += 1;
    worker.postMessage({ type: 'sync-patch', dataRevision, features, removedIds });
  }

  async function waitForReady() {
    await new Promise(resolve => {
      const started = now();
      const poll = () => ready || now() - started > readyTimeoutMs ? resolve() : schedule(poll, 16);
      poll();
    });
  }

  async function prepareWorker() {
    if (!worker || !ready) {
      rebase();
      await waitForReady();
    }
    if (!ready) throw new Error('지도 편집 Worker를 준비하지 못했습니다. 잠시 후 다시 시도하세요.');
    if (!activeRequestId) return;
    stop(cancelledError('새 작업을 시작해 이전 계산을 취소했습니다.'));
    rebase();
    await waitForReady();
    if (!ready) throw new Error('지도 편집 Worker를 다시 준비하지 못했습니다. 잠시 후 다시 시도하세요.');
  }

  async function execute(operation, payload) {
    await prepareWorker();
    const requestId = ++sequence;
    activeRequestId = requestId;
    const promise = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    worker.postMessage({ type: 'execute', operation, requestId, dataRevision, ...payload });
    const result = await promise;
    return { requestId, result };
  }

  function commit(requestId) {
    worker?.postMessage({ type: 'commit', requestId });
    dataRevision += 1;
  }

  function discard(requestId) {
    worker?.postMessage({ type: 'discard', requestId });
  }

  function cancel() {
    if (!activeRequestId && !pending.size) return;
    stop(cancelledError('작업을 취소했습니다.'));
    rebase();
  }

  return Object.freeze({ cancel, commit, discard, execute, rebase, stop, syncPatch });
}
