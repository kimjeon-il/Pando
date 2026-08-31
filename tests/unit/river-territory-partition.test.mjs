import assert from 'node:assert/strict';
import test from 'node:test';

await import('../../assets/js/vendor/polygon-clipping.min.js');
const {
  buildRiverTerritoryPartitions,
  createRiverPartitionWorkspace,
  RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION,
  RIVER_TERRITORY_PARTITION_CONFIG,
  riverTerritoryPartitionConfigFingerprint,
} = await import('../../assets/js/modules/river-territory-partition.js');

const clipper = globalThis.polygonClipping;

function donor(id, coordinates, geometryType = 'Polygon') {
  return {
    countryId: id,
    geometryRevision: 1,
    geometry: { type: geometryType, coordinates },
  };
}

function river(id, coordinates, type = 'LineString') {
  return {
    type: 'Feature', id,
    properties: { pandolab_id: id, category: 'river' },
    geometry: { type, coordinates },
  };
}

const square = donor('square', [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);

function partition(donors, rivers, options = {}) {
  return buildRiverTerritoryPartitions({ donors, riverFeatures: rivers, clipper, ...options });
}

test('one crossing river creates two disjoint donor cells', () => {
  const result = partition([square], [river('vertical', [[0.5, -1], [0.5, 2]])]);
  assert.equal(result.candidates.length, 2);
  assert.equal(new Set(result.candidates.map(candidate => candidate.key)).size, 2);
  assert.ok(result.candidates.every(candidate => candidate.donorCountryId === 'square'));
  assert.ok(result.candidates.every(candidate => candidate.riverBoundarySegments.length > 0));
  assert.equal(result.donorResults[0].status, 'ready');
});

test('all crossing rivers form one final non-overlapping subdivision', () => {
  const result = partition([square], [
    river('vertical', [[0.5, -1], [0.5, 2]]),
    river('horizontal', [[-1, 0.5], [2, 0.5]]),
  ]);
  assert.equal(result.candidates.length, 4);
  for (let left = 0; left < result.candidates.length; left += 1) for (let right = left + 1; right < result.candidates.length; right += 1) {
    const overlap = clipper.intersection(
      [result.candidates[left].geometry.coordinates],
      [result.candidates[right].geometry.coordinates],
    );
    assert.deepEqual(overlap, []);
  }
});

test('dangling, internal, and boundary-following rivers do not create candidates', () => {
  for (const feature of [
    river('one-boundary', [[0.5, -1], [0.5, 0.5]]),
    river('internal', [[0.2, 0.2], [0.8, 0.8]]),
    river('boundary', [[0, 0], [1, 0]]),
  ]) {
    const result = partition([square], [feature]);
    assert.equal(result.candidates.length, 0, feature.id);
    assert.equal(result.donorResults[0].status, 'empty');
  }
});

test('a connected branch can subdivide a cell without retaining a dangling tributary', () => {
  const result = partition([square], [
    river('trunk', [[0.5, -1], [0.5, 2]]),
    river('branch', [[0.5, 0.5], [2, 0.5]]),
    river('dangling', [[0.5, 0.7], [0.8, 0.8]]),
  ]);
  assert.equal(result.candidates.length, 3);
  assert.ok(result.diagnostics.prunedRiverEdges > 0);
  assert.ok(result.candidates.every(candidate => !candidate.sourceRiverIds.includes('dangling')));
});

test('multiple donors are partitioned independently', () => {
  const east = donor('east', [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]]);
  const result = partition([square, east], [
    river('west-river', [[0.5, -1], [0.5, 2]]),
    river('east-river', [[2.5, -1], [2.5, 2]]),
  ]);
  assert.equal(result.candidates.length, 4);
  assert.deepEqual([...new Set(result.candidates.map(candidate => candidate.donorCountryId))].sort(), ['east', 'square']);
  assert.ok(result.donorResults.every(row => row.candidateCount === 2));
});

test('only the crossed MultiPolygon component becomes selectable', () => {
  const multi = donor('multi', [
    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
  ], 'MultiPolygon');
  const result = partition([multi], [river('crossing', [[0.5, -1], [0.5, 2]])]);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every(candidate => candidate.componentKey === 'multi:0'));
});

test('input order does not change candidate keys and inputs remain immutable', () => {
  const rivers = [
    river('vertical', [[0.5, -1], [0.5, 2]]),
    river('horizontal', [[-1, 0.5], [2, 0.5]]),
  ];
  const before = JSON.parse(JSON.stringify({ square, rivers }));
  const first = partition([square], rivers);
  const second = partition([square], [...rivers].reverse());
  assert.deepEqual(first.candidates.map(candidate => candidate.key), second.candidates.map(candidate => candidate.key));
  assert.deepEqual({ square, rivers }, before);
  assert.equal(RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION, 'river-partitions-v1');
  assert.notEqual(
    riverTerritoryPartitionConfigFingerprint(RIVER_TERRITORY_PARTITION_CONFIG),
    riverTerritoryPartitionConfigFingerprint({ ...RIVER_TERRITORY_PARTITION_CONFIG, minRiverEdgeM: 20 }),
  );
});

test('metric workspace unwraps a date-line component', () => {
  const component = [[[179.5, 0], [-179.5, 0], [-179.5, 1], [179.5, 1], [179.5, 0]]];
  const workspace = createRiverPartitionWorkspace(component);
  const left = workspace.toMeters([179.5, 0]);
  const right = workspace.toMeters([-179.5, 0]);
  assert.ok(Math.abs(right[0] - left[0]) < 120000);
});
