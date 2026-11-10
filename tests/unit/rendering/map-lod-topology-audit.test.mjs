import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectMapLodTopology } from '../../../tools/checks/audit-map-lod-topology.mjs';

const country = (id, ring) => ({
  type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [ring] },
});
const west = country('A', [[0,0],[2,0],[2,2],[0,2],[0,0]]);
const east = country('B', [[2,0],[4,0],[4,2],[2,2],[2,0]]);

test('canonical shared edges need two opposing owners, coast remains unpaired', () => {
  const report = inspectMapLodTopology([west, east], {
    physicalLand: { type: 'MultiPolygon', coordinates: [west.geometry.coordinates] },
  });
  assert.equal(report.valid, true);
  assert.equal(report.sharedEdges, 1);
  assert.equal(report.nonManifoldEdges, 0);
  assert.equal(report.sharedWindingConflicts, 0);
  assert.ok(report.exactPhysicalCoastEdges > 0);
  assert.ok(report.coastCandidateEdges > 0);
});

test('bad ring closure and duplicate edges are reported, not automatically fixed', () => {
  const unclosed = country('open', [[0,0],[1,0],[1,1],[0,1]]);
  const repeated = country('dup', [[0,0],[2,0],[2,2],[0,2],[0,0],[2,0],[0,0]]);
  const report = inspectMapLodTopology([unclosed,repeated]);
  assert.equal(report.valid,false);
  assert.ok(report.issues.some(issue => issue.code === 'unclosed-ring'));
  assert.ok(report.repeatedEdges > 0);
});

test('same shared edge direction is rejected and three-country nonmanifold is rejected', () => {
  const reversed = country('B', [...east.geometry.coordinates[0]].reverse());
  const conflict = inspectMapLodTopology([west, reversed]);
  assert.equal(conflict.sharedWindingConflicts, 1);
  assert.equal(conflict.valid, false);
  const third = country('C', [[2,0],[5,0],[5,-2],[2,-2],[2,0]]);
  const nonmanifold = inspectMapLodTopology([west, east, third]);
  assert.equal(nonmanifold.nonManifoldEdges, 1);
  assert.equal(nonmanifold.valid, false);
});
