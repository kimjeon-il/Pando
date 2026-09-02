import { createLatestWorkerJobScheduler } from './worker-job-scheduler.js';
import {
  WORKER_RPC_ERROR_CATEGORIES,
  createWorkerRpcClient,
} from './worker-rpc.js';

function createMapEditWorkerCodec() {
  return Object.freeze({
    encodeRequest(envelope) {
      const metadata = envelope.metadata || {};
      return {
        type: 'execute',
        operation: envelope.operation,
        requestId: envelope.requestId,
        jobKey: String(metadata.jobKey || ''),
        dataRevision: Number(metadata.dataRevision || 0),
        geometryRevision: Number(metadata.geometryRevision || metadata.dataRevision || 0),
        targetRevision: Number(envelope.projectRevision || 0),
        priority: Number(envelope.priority || 0),
        ...(envelope.payload || {}),
      };
    },
    encodeCancel(envelope) {
      return {
        type: 'cancel',
        requestId: envelope.requestId,
        targetRevision: Number(envelope.projectRevision || 0),
        reason: envelope.reason || 'cancelled',
      };
    },
    encodeEvent(envelope) {
      const legacyTypes = {
        'map-edit.rebase': 'rebase',
        'map-edit.sync-patch': 'sync-patch',
        'map-edit.commit': 'commit',
        'map-edit.discard': 'discard',
      };
      return {
        type: legacyTypes[envelope.operation] || envelope.operation,
        ...(envelope.payload || {}),
      };
    },
    decodeMessage(message) {
      if (message?.type === 'ready') {
        return {
          kind: 'event',
          operation: 'map-edit.ready',
          payload: message,
          projectRevision: Number(message.targetRevision || 0),
        };
      }
      if (message?.type !== 'result') return null;
      return {
        kind: 'result',
        requestId: Number(message.requestId || 0),
        operation: '',
        projectRevision: Number(message.targetRevision || 0),
        ok: message.ok === true,
        result: message.result,
        error: message.ok === true ? null : {
          category: message.cancelled ? WORKER_RPC_ERROR_CATEGORIES.CANCELLED : WORKER_RPC_ERROR_CATEGORIES.OPERATION,
          code: message.cancelled ? 'PL-MAP-EDIT-CANCELLED' : 'PL-MAP-EDIT-WORKER',
          message: message.message || '지도 편집 계산에 실패했습니다.',
        },
        timing: message.timing || null,
      };
    },
  });
}

export function createMapEditWorkerClient({
  createWorker,
  getFeatures,
  getFeatureById,
  getTargetRevision = null,
  now = () => performance.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  readyTimeoutMs = 3000,
  requestTimeoutMs = 60_000,
}) {
  let rpc = null;
  let dataRevision = 0;
  let ready = false;
  const currentTargetRevision = () => typeof getTargetRevision === 'function'
    ? Number(getTargetRevision())
    : dataRevision;

  function ensureRpc() {
    if (rpc) return rpc;
    rpc = createWorkerRpcClient({
      createWorker,
      codec: createMapEditWorkerCodec(),
      defaultTimeoutMs: requestTimeoutMs,
      getProjectRevision: currentTargetRevision,
      isCurrent: ({ entry }) => Number(entry.metadata?.geometryRevision) === dataRevision
        && Number(entry.projectRevision) === currentTargetRevision(),
      onEvent: event => {
        if (event.operation !== 'map-edit.ready') return;
        const message = event.payload || {};
        const readyRevision = message.dataRevision == null ? dataRevision : Number(message.dataRevision);
        if (readyRevision === dataRevision) ready = true;
      },
      onCrash: () => { ready = false; },
      now,
    });
    return rpc;
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
    return ensureRpc().request(entry.payload.operation, entry.payload.payload, {
      requestId: entry.requestId,
      projectRevision: entry.targetRevision,
      priority: entry.priority,
      timeoutMs: requestTimeoutMs,
      metadata: {
        jobKey: entry.jobKey,
        dataRevision: entry.geometryRevision,
        geometryRevision: entry.geometryRevision,
        targetRevision: entry.targetRevision,
      },
    }).then(response => response.result);
  }

  const scheduler = createLatestWorkerJobScheduler({
    maxConcurrent: 1,
    now,
    execute: sendExecute,
    cancelRunning: entry => ensureRpc().cancel(entry.requestId, 'superseded'),
    discardResult: (_result, entry) => ensureRpc().notify('map-edit.discard', {
      requestId: entry.requestId,
      dataRevision,
      targetRevision: entry.targetRevision,
    }, { projectRevision: entry.targetRevision }),
    isCurrent: entry => Number(entry.geometryRevision) === dataRevision
      && Number(entry.targetRevision) === currentTargetRevision(),
  });

  function rebase(features = getFeatures()) {
    scheduler.cancelAll('rebase');
    dataRevision += 1;
    ready = false;
    ensureRpc().notify('map-edit.rebase', {
      dataRevision,
      geometryRevision: dataRevision,
      targetRevision: currentTargetRevision(),
      features,
    }, { projectRevision: currentTargetRevision(), priority: 1000 });
    return dataRevision;
  }

  function syncPatch(rawIds) {
    if (!rpc || !ready) return false;
    const ids = [...new Set([...rawIds].map(String).filter(Boolean))];
    if (!ids.length) return false;
    scheduler.cancelAll('state-changed');
    const features = ids.map(getFeatureById).filter(Boolean);
    const removedIds = ids.filter(id => !getFeatureById(id));
    dataRevision += 1;
    ensureRpc().notify('map-edit.sync-patch', {
      dataRevision,
      geometryRevision: dataRevision,
      targetRevision: currentTargetRevision(),
      features,
      removedIds,
    }, { projectRevision: currentTargetRevision(), priority: 900 });
    return true;
  }

  async function prepareWorker() {
    if (!rpc) rebase();
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
    ensureRpc().notify('map-edit.commit', { requestId, dataRevision, nextDataRevision }, {
      projectRevision: currentTargetRevision(),
      priority: 1000,
    });
    dataRevision = nextDataRevision;
  }

  function discard(requestId) {
    scheduler.cancel(requestId, 'discarded');
    ensureRpc().notify('map-edit.discard', { requestId, dataRevision }, {
      projectRevision: currentTargetRevision(),
      priority: 1000,
    });
  }

  function cancel() {
    scheduler.cancelAll('cancelled');
    rpc?.cancelAll('cancelled');
  }

  function stop() {
    scheduler.cancelAll('stopped');
    rpc?.stop('stopped');
    rpc = null;
    ready = false;
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
      role: 'stateful-dedicated-rpc',
      dataRevision,
      targetRevision: currentTargetRevision(),
      ready,
      ...(rpc?.stats?.() || { pendingCount: 0, workerActive: false }),
      ...scheduler.stats(),
    }),
  });
}
