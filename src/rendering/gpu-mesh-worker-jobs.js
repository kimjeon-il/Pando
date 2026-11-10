import { createLatestWorkerJobScheduler } from "../runtime/worker-job-scheduler.js";
import { createWorkerRpcClient } from "../runtime/worker-rpc.js";
import { packCountryMeshFeatures } from "./country-mesh-transfer.js";

// Scheduling owns latest-wins policy; RPC owns transport and request lifetime.
export function createGpuMeshWorkerJobs({ createWorker, createRebuildWorker = createWorker, isCurrent, onMesh = () => {}, onError = () => {} }) {
  let rpc = null;
  let rebuildRpc = null;
  let lodRpc = null;
  let lodSourceInWorker = '';
  let lodQueue = Promise.resolve();
  let rebuildBusy = false;
  let outputBytes = 0;
  const lodMetrics = { requests: 0, sourceTransfers: 0, sourceReuses: 0,
    transferredCoordinateBytes: 0, generatedMeshBytes: 0 };
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
  function cancelDisplayLod() {
    lodRpc?.stop('superseded-screen-lod');
    lodRpc = null; lodSourceInWorker = '';
  }
  // Display LOD never cancels the canonical rebuild or the edit-patch queue.
  // A separate worker can retain one topology index for repeated zoom buckets.
  async function executeDisplayLod(payload, accepts) {
    const current = lodRpc ||= createWorkerRpcClient({
      createWorker,
      isCurrent: ({ entry, message }) => Number(message.projectRevision) === Number(entry.projectRevision),
    });
    try {
      const reuseSource = lodSourceInWorker === payload.sourceKey;
      const countryFeatures = payload.features || [];
      const extraPhysicalFeatures = payload.extraPhysicalFeatures || [];
      const packed = reuseSource ? null : await packCountryMeshFeatures([...countryFeatures, ...extraPhysicalFeatures], {
        isCurrent: () => lodRpc === current && accepts(),
      });
      lodMetrics.requests += 1;
      if (packed) {
        lodMetrics.sourceTransfers += 1;
        lodMetrics.transferredCoordinateBytes += packed.coordinates.byteLength;
      } else lodMetrics.sourceReuses += 1;
      const response = await current.request('geometry.mesh', {
        ...(packed || {}),
        useCachedSource: reuseSource,
        countryFeatureCount: countryFeatures.length,
        lod: payload.lod, sourceKey: payload.sourceKey,
        visibleIds: payload.visibleIds ?? null,
        visibleTiles: payload.visibleTiles ?? [],
      }, {
        transfer: packed ? [packed.coordinates.buffer] : [],
        projectRevision: payload.projectGeneration,
        metadata: { geometryRevision: payload.geometryRevision, sourceKey: payload.sourceKey },
      });
      if (lodRpc !== current) return null;
      // Even a stale viewport result can certify the immutable source already
      // loaded by this same living Worker. It cannot certify a display frame.
      lodSourceInWorker = response.result?.lod?.sourceCached === true ? payload.sourceKey : '';
      if (accepts()) lodMetrics.generatedMeshBytes += ['positions', 'countryIndices',
        'triangleIndices', 'lineIndices'].reduce(
        (sum, field) => sum + Number(response.result?.[field]?.byteLength || 0), 0);
      return accepts() ? response.result : null;
    } catch (error) {
      if (error.cancelled || error.name === 'AbortError' || lodRpc !== current || !accepts()) return null;
      // A restarted Worker cannot satisfy an old source token. Force a fresh
      // transfer on the next request rather than silently reusing stale data.
      if (lodRpc === current) cancelDisplayLod();
      throw error;
    }
  }
  function prepareDisplayLod(payload, accepts = () => true) {
    if (!Number.isFinite(payload?.lod?.upperScale) || payload.lod.upperScale <= 0
      || !Number.isFinite(payload?.lod?.errorPx) || payload.lod.errorPx <= 0
      || typeof payload.sourceKey !== 'string' || !payload.sourceKey)
      return Promise.reject(new TypeError('Display LOD needs a source identity and screen-error bucket.'));
    // Serialize requests on the SAME Worker. Obsolete viewports are skipped
    // before transmission, while an in-flight response may still establish the
    // current immutable source cache. This prevents losing large-country tile
    // caches on rapid panning.
    const pending = lodQueue.catch(() => {}).then(() =>
      accepts() ? executeDisplayLod(payload, accepts) : null);
    lodQueue = pending;
    return pending;
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
    rebuild, cancelRebuild, prepareDisplayLod, cancelDisplayLod,
    enqueue: entry => scheduler.enqueue(entry),
    preparePolygons: (items, revision) => scheduler.enqueue({ jobKey: 'overlay-preparation', geometryRevision: revision,
      targetRevision: revision, payload: { polygonPreparation: { items } } }).promise,
    cancelAll(reason = 'cancelled', { preserveIdleRebuild = false } = {}) {
      if (!preserveIdleRebuild || rebuildBusy) cancelRebuild();
      scheduler.cancelAll(reason);
      cancelDisplayLod();
      rpc?.stop(reason);
      rpc = null;
    },
    stats: () => Object.freeze({ ...scheduler.stats(), displayLod: Object.freeze({
      ...lodMetrics, sourceCached: !!lodSourceInWorker, workerActive: !!lodRpc,
    }) }),
    outputBytes: () => outputBytes,
  });
}
