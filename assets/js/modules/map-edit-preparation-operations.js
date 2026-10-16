import { createBoundaryPreparation } from './boundary-preparation.js';
import { createTerritoryComponentPlan } from './territory-component-plan.js';
import { normalizePolygonGeometry } from './map-edit-geometry.js';

export { createBoundaryPreparation };

// These are asynchronous service adapters, not pure calculations. Services own their local caches.
export async function prepareBoundaryOperation(operation, payload, features, service, checkpoint) {
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const start = now();
  await service.sync(features, checkpoint);
  const synchronizedAt = now();
  const result = operation === 'boundary-prepare'
    ? await service.prepare(payload, checkpoint) : service.move(payload);
  if (operation !== 'boundary-prepare') return result;
  const stats = service.stats();
  return { ...result, preparationTiming: {
    sourceSyncMs: synchronizedAt - start,
    topologyAndDisplayMs: now() - synchronizedAt,
    sourceCount: stats.sourceCount,
    segmentSourceCount: stats.segmentSourceCount,
    segmentCount: stats.segmentCount,
    cachedPreparations: stats.cachedPreparations,
    cacheEstimatedBytes: stats.cacheEstimatedBytes,
    cacheBudgetBytes: stats.cacheBudgetBytes,
    cacheEvictions: stats.cacheEvictions,
  } };
}

export async function prepareComponentOperation(operation, payload, clipper, checkpoint) {
  const plan = createTerritoryComponentPlan({ clipper, normalize: normalizePolygonGeometry, checkpoint });
  const method = operation === 'territory-components' ? 'prepare' : operation === 'territory-selection' ? 'selection' : 'slivers';
  return plan[method](payload);
}
