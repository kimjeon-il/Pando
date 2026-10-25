import { sharedCalculationCore } from "../../../../../shared/frontend/js/modules/temporal.js";

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
  const encoded = JSON.stringify(input, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw Object.assign(new TypeError('RIVER_NONFINITE_INPUT'), { code: 'PL-RIVER-CALCULATION' });
    }
    return value;
  });
  return JSON.parse(core.riverPartitionCalculate(operation, encoded));
}

export function composeRiverBoundaryTerritoryComponents(input = {}) {
  return calculate('compose', input);
}

export function createRiverPartitionWorkspace(component) {
  const workspace = Object.freeze(calculate('workspace', { component }));
  return Object.freeze({
    centerLongitude: workspace.centerLongitude,
    centerLatitude: workspace.centerLatitude,
    toMeters: point => calculate('transform', { workspace, point }),
    toLonLat: point => calculate('transform', { workspace, point, direction: 'toLonLat' }),
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
