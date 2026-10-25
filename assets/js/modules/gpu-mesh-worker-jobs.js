import { createLatestWorkerJobScheduler } from './worker-job-scheduler.js';
import { createWorkerRpcClient } from './worker-rpc.js';
import { packCountryMeshFeatures } from './country-mesh-transfer.js';

// Scheduling owns latest-wins policy; RPC owns transport and request lifetime.
export function createGpuMeshWorkerJobs({ createWorker, createRebuildWorker = createWorker, isCurrent, onMesh = () => {}, onError = () => {} }) {
  let rpc = null;
  let rebuildRpc = null;
  let rebuildBusy = false;
  let outputBytes = 0;
  function cancelRebuild() {
    rebuildRpc?.stop('superseded');
    rebuildRpc = null; rebuildBusy = false;
  }
  async function rebuild(payload, accepts = () => true) {
    if (rebuildBusy) cancelRebuild();
    const current = rebuildRpc ||= createWorkerRpcClient({
      createWorker: createRebuildWorker,
      isCurrent: ({ entry, message }) => Number(message.projectRevision) === entry.projectRevision,
    });
    rebuildBusy = true;
    try {
      const packed = payload.features?.length
        ? await packCountryMeshFeatures(payload.features, { isCurrent: () => rebuildRpc === current && accepts() })
        : { rows: [], coordinates: new Float64Array() };
      const response = await current.request('geometry.mesh', packed, {
        transfer: [packed.coordinates.buffer],
        projectRevision: payload.projectGeneration, metadata: { geometryRevision: payload.geometryRevision },
        progress: { operation: 'geometry.mesh-progress', total: (payload.features || []).length + 3 },
      });
      return accepts() ? response.result : null;
    } catch (error) {
      if (error.code === 'PL-WORKER-RPC-TIMEOUT' && rebuildRpc === current) cancelRebuild();
      if (error.cancelled || error.name === 'AbortError' || !accepts()) return null;
      throw error;
    } finally {
      if (rebuildRpc === current) rebuildBusy = false;
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
      const requestPayload = entry.payload?.polygonPreparation || await packCountryMeshFeatures(entry.payload?.features || [], { isCurrent: () => isCurrent(entry) });
      const response = await ensureRpc().request(operation, requestPayload, {
        requestId: entry.requestId, projectRevision: entry.targetRevision,
        transfer: operation === 'geometry.mesh' ? [requestPayload.coordinates.buffer] : [],
        progress: operation === 'geometry.mesh'
          ? { operation: 'geometry.mesh-progress', total: requestPayload.rows.length + 3 }
          : { operation: 'geometry.prepare-progress', total: requestPayload.items.length + 1 },
        metadata: { geometryRevision: entry.geometryRevision, targetRevision: entry.targetRevision, jobKey: entry.jobKey, payload: { token: entry.payload?.token } },
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
    cancelAll(reason = 'cancelled', { preserveIdleRebuild = false } = {}) {
      if (!preserveIdleRebuild || rebuildBusy) cancelRebuild();
      scheduler.cancelAll(reason);
      rpc?.stop(reason);
      rpc = null;
    },
    stats: () => scheduler.stats(),
    outputBytes: () => outputBytes,
  });
}
