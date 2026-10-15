import { sharedCalculationCore } from './temporal.js';

export const RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION = 'river-partitions-v2';
export const RIVER_TERRITORY_PARTITION_CONFIG = Object.freeze({
  minRiverEdgeM: 10,
  riverEndpointSnapM: 50,
  nodeMergeToleranceM: 0.5,
  boundaryCoincidenceToleranceM: 5,
  spatialGridCellM: 25000,
  minCandidateAreaM2: 1000,
  coverageToleranceM2: 1000,
});

function calculate(operation, input) {
  const core = sharedCalculationCore;
  if (typeof core.riverPartitionCalculate !== 'function') {
    throw Object.assign(new Error('공통 C++ 수계 계산을 사용할 수 없습니다.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  return JSON.parse(core.riverPartitionCalculate(operation, JSON.stringify(input)));
}

export function composeRiverBoundaryTerritoryComponents(input = {}) {
  return calculate('compose', input);
}

export function createRiverPartitionWorkspace(component) {
  const snapshot = structuredClone(component);
  const workspace = calculate('workspace', { component: snapshot });
  return Object.freeze({
    centerLongitude: workspace.centerLongitude,
    centerLatitude: workspace.centerLatitude,
    toMeters: point => calculate('workspace', { component: snapshot, points: [point] }).points[0],
    toLonLat: point => calculate('workspace', { component: snapshot, points: [point], direction: 'toLonLat' }).points[0],
  });
}

export function riverTerritoryPartitionConfigFingerprint(config = RIVER_TERRITORY_PARTITION_CONFIG) {
  return Object.keys(config).sort().map(key => `${key}:${Number(config[key])}`).join('|');
}

export function riverTerritoryAreaKm2(geometry) {
  return calculate('area', geometry);
}

export function buildRiverTerritoryPartitions(input = {}) {
  const { donors = [], riverFeatures = [], config = null,
    algorithmRevision = RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION, hydroRevision = '' } = input;
  return calculate('build', { donors, riverFeatures, config, algorithmRevision, hydroRevision });
}
