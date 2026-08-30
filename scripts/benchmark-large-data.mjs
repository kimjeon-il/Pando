import { performance } from 'node:perf_hooks';

import { layoutLabels, layoutLabelsLegacy } from '../assets/js/modules/label-layout.js';
import { createMapObjectSpatialIndex } from '../assets/js/modules/map-object-spatial-index.js';
import { buildTerritorialInternalBoundarySegments } from '../assets/js/modules/boundary-topology.js';

function benchmarkLabels(count) {
  const candidates = Array.from({ length: count }, (_, index) => ({
    key: `label-${String(index).padStart(6, '0')}`,
    point: [(index % 200) * 90, Math.floor(index / 200) * 42],
    width: 48,
    height: 18,
    priority: index % 7,
    collisionGroup: index % 5 ? 'place' : 'country',
    pinned: index % 997 === 0,
    selected: index === count - 1,
  }));
  const legacyMetrics = {};
  const gridMetrics = {};
  const legacyStarted = performance.now();
  const legacy = layoutLabelsLegacy(candidates, { metrics: legacyMetrics });
  const legacyMs = performance.now() - legacyStarted;
  const gridStarted = performance.now();
  const grid = layoutLabels(candidates, { metrics: gridMetrics });
  const gridMs = performance.now() - gridStarted;
  if (legacy.map(item => item.key).join('|') !== grid.map(item => item.key).join('|')) throw new Error(`label output mismatch at ${count}`);
  return {
    count,
    legacyMs: Number(legacyMs.toFixed(3)),
    gridMs: Number(gridMs.toFixed(3)),
    legacyChecks: legacyMetrics.collisionCheckCount,
    gridChecks: gridMetrics.collisionCheckCount,
    gridCells: gridMetrics.gridCellCount,
  };
}

function benchmarkSpatialIndex(count) {
  const index = createMapObjectSpatialIndex();
  const started = performance.now();
  for (let item = 0; item < count; item += 1) {
    const longitude = -178 + (item * 73) % 356;
    const latitude = -84 + (item * 37) % 168;
    const large = item % 11 === 0;
    index.upsert({
      key: `territorial:${item}`,
      domain: 'territorial',
      id: String(item),
      bounds: [longitude, latitude, longitude + (large ? 120 : 1.5), Math.min(89, latitude + (large ? 70 : 1.5))],
    });
  }
  const buildMs = performance.now() - started;
  let candidates = 0;
  const queryStarted = performance.now();
  for (let query = 0; query < 100; query += 1) {
    const longitude = -180 + query * 3.6;
    candidates += index.query([longitude, -12, longitude + 24, 12], { domains: ['territorial'] }).length;
  }
  return {
    count,
    buildMs: Number(buildMs.toFixed(3)),
    query100Ms: Number((performance.now() - queryStarted).toFixed(3)),
    averageCandidates: Number((candidates / 100).toFixed(1)),
    ...index.stats(),
  };
}

function benchmarkTerritorialBoundaries(count) {
  const columns = 100;
  const units = Array.from({ length: count }, (_, index) => {
    const west = (index % columns) * 0.2 - 10;
    const south = Math.floor(index / columns) * 0.2 - 10;
    return {
      type: 'Feature',
      id: `unit-${index}`,
      properties: { unitType: index % 3 === 0 ? 'admin' : index % 3 === 1 ? 'region' : 'territory' },
      geometry: { type: 'Polygon', coordinates: [[[west, south], [west + 0.2, south], [west + 0.2, south + 0.2], [west, south + 0.2], [west, south]]] },
    };
  });
  const started = performance.now();
  const segments = buildTerritorialInternalBoundarySegments([], units);
  return {
    count,
    segmentCount: segments.length,
    topologyBuildMs: Number((performance.now() - started).toFixed(3)),
    svgPersistentPathCountWebGl: 0,
  };
}

const labelCounts = [100, 500, 1_000, 2_000, 5_000, 10_000];
const results = {
  labels: labelCounts.map(benchmarkLabels),
  spatialIndex: [500, 2_000, 5_000, 10_000].map(benchmarkSpatialIndex),
  territorialBoundaries: [500, 2_000, 5_000, 10_000].map(benchmarkTerritorialBoundaries),
};

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
