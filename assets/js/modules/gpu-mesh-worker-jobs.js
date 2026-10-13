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
    cancelRunning: entry => rpc?.cancel(entry.requestId, 'superseded'),
    execute: async entry => {
      const response = await ensureRpc().request('geometry.mesh', { features: entry.payload?.features || [] }, {
        requestId: entry.requestId, projectRevision: entry.targetRevision, metadata: { geometryRevision: entry.geometryRevision, targetRevision: entry.targetRevision, jobKey: entry.jobKey, payload: { token: entry.payload?.token } },
      });
      const mesh = response.result;
      outputBytes += ['positions', 'countryIndices', 'triangleIndices', 'lineIndices', 'strokeStartsEnds']
        .reduce((sum, key) => sum + Number(mesh?.[key]?.byteLength || 0), 0);
      onMesh(mesh);
      return mesh;
    },
  });
  return Object.freeze({
    rebuild, cancelRebuild,
    enqueue: entry => scheduler.enqueue(entry),
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
