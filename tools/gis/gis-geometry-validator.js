// Canonical GIS Worker RPC validation, independent of the retired graphical editor.
import {WORKER_RPC_ERROR_CATEGORIES,createWorkerRpcClient} from "../../src/runtime/worker-rpc.js";

export const GIS_GEOMETRY_TIMEOUT_MS = 60_000;

const text = value => String(value ?? '');

export function createGisGeometryValidator({ createWorker, timeoutMs = GIS_GEOMETRY_TIMEOUT_MS }) {
  let rpc = null;

  function ensureRpc() {
    if (rpc) return rpc;
    rpc = createWorkerRpcClient({
      createWorker,
      defaultTimeoutMs: timeoutMs,
      restartOnCrash: true,
    });
    return rpc;
  }

  function dispose() {
    rpc?.stop('disposed');
    rpc = null;
  }

  async function validate(collection, affectedIds = null, options = undefined) {
    const scopedIds = affectedIds
      ? [...new Set([...affectedIds].map(text).filter(Boolean))]
      : null;
    try {
      const overlapAffectedIds = Array.isArray(options?.overlapAffectedIds) && options.overlapAffectedIds.length
        ? [...new Set(options.overlapAffectedIds.map(text).filter(Boolean))] : null;
      const response = await ensureRpc().request('gis.validate', {
        collection,
        affectedIds: scopedIds?.length ? scopedIds : null,
        ...(overlapAffectedIds?.length ? { overlapAffectedIds } : {}),
      }, { timeoutMs, priority: 300 });
      return response.result;
    } catch (error) {
      if (error?.category === WORKER_RPC_ERROR_CATEGORIES.TIMEOUT) dispose();
      throw error;
    }
  }

  return Object.freeze({ dispose, validate, stats: () => rpc?.stats?.() || Object.freeze({ pendingCount: 0, workerActive: false }) });
}
