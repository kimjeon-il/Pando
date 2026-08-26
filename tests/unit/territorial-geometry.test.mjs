import test from 'node:test';
import assert from 'node:assert/strict';
import '../../assets/js/vendor/polygon-clipping.min.js';
import { createTerritorialGeometryKernel } from '../../assets/js/modules/territorial-geometry.js';

const polygonClipping = globalThis.polygonClipping;

const square = (id, x0, y0, x1, y1) => ({
  type: 'Feature', id, properties: {}, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
});

test('territorial geometry kernel merges, transfers, and validates partitions', () => {
  const kernel = createTerritorialGeometryKernel(polygonClipping);
  const left = square('left', 0, 0, 5, 10);
  const right = square('right', 5, 0, 10, 10);
  const container = square('container', 0, 0, 10, 10);
  assert.equal(kernel.areAdjacent(left, right), true);
  const merged = kernel.mergeUnits(left, [right]);
  assert.deepEqual(merged.removedIds, ['right']);
  assert.equal(kernel.validatePartition(container, [left, right]).ok, true);
  const transferred = kernel.transferGeometry(container, square('target', 10, 0, 15, 10), right.geometry);
  assert.ok(transferred.source);
  assert.ok(transferred.target);
});

test('split validation rejects geometry that changes total coverage', () => {
  const kernel = createTerritorialGeometryKernel(polygonClipping);
  const source = square('source', 0, 0, 10, 10);
  assert.throws(() => kernel.splitUnit(source, [square('a', 0, 0, 4, 10).geometry, square('b', 5, 0, 10, 10).geometry]), /전체 면적/);
  const parts = kernel.splitUnit(source, [square('a', 0, 0, 5, 10).geometry, square('b', 5, 0, 10, 10).geometry]);
  assert.equal(parts.length, 2);
});
