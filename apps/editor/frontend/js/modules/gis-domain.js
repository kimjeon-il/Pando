import { createWorkerRpcClient } from "../../../../../shared/frontend/js/modules/worker-rpc.js";

const cloneValue = value => {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) { /* fall through */ }
  }
  if (Array.isArray(value)) return value.map(cloneValue);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
};

const freezeValue = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezeValue(item);
  return Object.freeze(value);
};

export function createGisDomain({
  projectDomain = null,
  importService = null,
  riverPartitionWorkerFactory = null,
  riverPartitionSource = null,
  onImportPlanned = () => {},
  reportDiagnostic = () => {},
} = {}) {
  let disposed = false;
  const operationTokens = new Map();
  let riverPartitionRpc = null;
  const planImport = async (files, options = {}) => {
    if (disposed) throw new Error('GIS domain is disposed.');
    const service = typeof importService === 'function' ? await importService() : importService;
    if (!service?.openFiles) throw new Error('GIS import service is not ready.');
    const outcome = await service.openFiles(files, cloneValue(options));
    if (outcome?.status !== 'planned' || !outcome.plan) return outcome;
    const plan = freezeValue(cloneValue(outcome.plan));
    onImportPlanned({ kind: plan.kind, plan });
    return { status: 'planned', plan };
  };
  const loadRiverPartitionFeatures = async donors => {
    if (!riverPartitionSource) return { features: [], boundsList: [], failedLogicalIds: [], diagnostics: { discoveredLogicalRivers: 0, loadedRivers: 0, failedRiverLoads: 0 } };
    await riverPartitionSource.ensureReady?.();
    const boundsList = donors.flatMap(feature => riverPartitionSource.queryBounds?.(feature.geometry) || []);
    const logicalIds = new Map();
    for (const bounds of boundsList) {
      const ids = await riverPartitionSource.queryLogicalFeatures?.(bounds);
      for (const logicalId of ids || []) logicalIds.set(String(logicalId), logicalId);
    }
    const loaded = [];
    const failedLogicalIds = [];
    const queue = [...logicalIds.values()];
    const concurrency = Math.min(4, queue.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < queue.length) {
        const logicalId = queue[cursor++];
        try {
          const feature = await riverPartitionSource.loadLogicalFeature?.(logicalId);
          if (feature?.properties?.category === 'river' && feature.geometry) loaded.push(feature);
        } catch (_) { failedLogicalIds.push(logicalId); }
      }
    }));
    const editRivers = riverPartitionSource.getEditRivers?.(boundsList) || [];
    if (queue.length && !loaded.length && failedLogicalIds.length === queue.length) {
      const error = new Error('피편입국을 가로지르는 하천 데이터를 불러오지 못했습니다.');
      error.code = 'RIVER_PARTITION_SOURCE_ERROR';
      error.failedLogicalIds = failedLogicalIds.slice();
      throw error;
    }
    const featuresByKey = new Map();
    for (const feature of loaded) featuresByKey.set(riverPartitionSource.featureKey?.(feature) || String(feature.id || ''), feature);
    for (const feature of editRivers) featuresByKey.set(riverPartitionSource.featureKey?.(feature) || String(feature.id || ''), feature);
    return {
      features: [...featuresByKey.values()],
      boundsList,
      failedLogicalIds,
      diagnostics: {
        discoveredLogicalRivers: queue.length,
        loadedRivers: featuresByKey.size,
        failedRiverLoads: failedLogicalIds.length,
      },
    };
  };
  const computeRiverPartition = async payload => {
    if (disposed) throw new Error('GIS domain is disposed.');
    const operation = 'riverPartition', taskToken = Symbol(operation);
    operationTokens.set(operation, taskToken);
    const projectGeneration = projectDomain?.getGeneration?.() || 0;
    riverPartitionRpc ||= createWorkerRpcClient({ createWorker: riverPartitionWorkerFactory, defaultTimeoutMs: 60_000,
      getProjectRevision: () => projectDomain?.getGeneration?.() || 0 });
    const response = await riverPartitionRpc.request('river.partition', payload, { projectRevision: projectGeneration });
    if (operationTokens.get(operation) !== taskToken || (projectDomain?.getGeneration?.() || 0) !== projectGeneration) {
      reportDiagnostic({ type: 'stale-worker-result', operation, projectGeneration });
      return null;
    }
    return response.result;
  };
  const cancelRiverPartition = () => {
    operationTokens.delete('riverPartition');
    riverPartitionRpc?.stop('cancelled');
    riverPartitionRpc = null;
  };
  const dispose = () => {
    disposed = true;
    operationTokens.clear();
    cancelRiverPartition();
  };
  return Object.freeze({ planImport, loadRiverPartitionFeatures, computeRiverPartition, cancelRiverPartition, dispose });
}
