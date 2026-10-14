import { createLatestWorkerJobScheduler } from './worker-job-scheduler.js';
import { createWorkerRpcClient } from './worker-rpc.js';

// Scheduling owns latest-wins policy; RPC owns transport and request lifetime.
export function createGpuMeshWorkerJobs({ createWorker, createRebuildWorker = createWorker, isCurrent, onMesh = () => {}, onError = () => {} }) {
  let rpc = null;
  let rebuildRpc = null;
  let outputBytes = 0;
  function cancelRebuild() {
    rebuildRpc?.stop('superseded');
    rebuildRpc = null;
  }
  async function rebuild(payload, accepts = () => true) {
    cancelRebuild();
    const current = createWorkerRpcClient({
      createWorker: createRebuildWorker,
      getProjectRevision: () => Number(payload.projectGeneration || 0),
      isCurrent: ({ message }) => accepts() && Number(message.projectRevision) === Number(payload.projectGeneration || 0),
    });
    rebuildRpc = current;
    try {
      const response = await current.request('geometry.mesh', { features: payload.features || [] }, {
        projectRevision: payload.projectGeneration, metadata: { geometryRevision: payload.geometryRevision },
      });
      return response.result;
    } catch (error) {
      if (error.cancelled || !accepts()) return null;
      throw error;
    } finally {
      current.stop('completed');
      if (rebuildRpc === current) rebuildRpc = null;
    }
  }
  function ensureRpc() {
    return rpc ||= createWorkerRpcClient({
      createWorker,
      isCurrent: ({ entry, message }) => Number(message.projectRevision) === Number(entry.projectRevision) && isCurrent(entry.metadata),
      onCrash: onError,
    });
  }
  const scheduler = createLatestWorkerJobScheduler({
    maxConcurrent: 1,
    isCurrent,
    cancelRunning: () => { rpc?.stop('superseded'); rpc = null; },
    execute: async entry => {
      const operation = entry.payload?.polygonPreparation ? 'geometry.prepare' : 'geometry.mesh';
      const requestPayload = entry.payload?.polygonPreparation || { features: entry.payload?.features || [] };
      const response = await ensureRpc().request(operation, requestPayload, {
        requestId: entry.requestId, projectRevision: entry.targetRevision, metadata: { geometryRevision: entry.geometryRevision, targetRevision: entry.targetRevision, jobKey: entry.jobKey, payload: { token: entry.payload?.token } },
      });
      const mesh = response.result;
      outputBytes += ['positions', 'countryIndices', 'triangleIndices', 'lineIndices', 'strokeStartsEnds']
        .reduce((sum, key) => sum + Number(mesh?.[key]?.byteLength || 0), 0);
      if (operation === 'geometry.mesh') onMesh(mesh);
      return mesh;
    },
  });
  return Object.freeze({
    rebuild, cancelRebuild,
    enqueue: entry => scheduler.enqueue(entry),
    preparePolygons: (items, revision) => scheduler.enqueue({ jobKey: 'overlay-preparation', geometryRevision: revision,
      targetRevision: revision, payload: { polygonPreparation: { items } } }).promise,
    cancelAll(reason = 'cancelled') {
      cancelRebuild();
      scheduler.cancelAll(reason);
      rpc?.stop(reason);
      rpc = null;
    },
    stats: () => scheduler.stats(),
    outputBytes: () => outputBytes,
  });
}
