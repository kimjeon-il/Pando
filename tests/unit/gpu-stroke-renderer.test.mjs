import { describe as contractSuite } from 'node:test';
import * as __gpu_dep0 from "node:assert/strict";
import * as __gpu_dep1 from "node:test";
import * as __gpu_dep2 from "../../src/rendering/gpu-stroke-renderer.js";
import * as __gpu_dep3 from "../../src/rendering/map-render-coordinator.js";
import * as __gpu_dep4 from "../../src/rendering/render-scene.js";
contractSuite("gpu-stroke-renderer", () => {
const assert = __gpu_dep0.default;
const test = __gpu_dep1.default;
const { buildGpuStrokeInstances, resolveGpuStrokeRanges } = __gpu_dep2;


test('instanced stroke geometry keeps finite non-degenerate segments only', () => {
  const result = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 1, 0,
    Number.NaN, 0, 2, 0,
    2, 0, 3, 1,
  ]));
  assert.equal(result.segmentCount, 2);
  assert.equal(result.invalidSegmentCount, 2);
  assert.equal(result.instances.length > 0, true);
  assert.equal(result.nodes.length > 0, true);
  assert.equal([...result.instances, ...result.nodes].every(Number.isFinite), true);
});

test('owner ranges remain compact after invalid country boundary segments are removed', () => {
  const result = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 1, 0,
    10, 0, 11, 0,
  ]), null, {
    DEU: { first: 0, count: 2 },
    FRA: { first: 2, count: 1 },
  });
  assert.deepEqual(result.ownerRanges, {
    DEU: { first: 0, count: 1 },
    FRA: { first: 1, count: 1 },
  });
  assert.deepEqual(result.ownerNodeRanges, {
    DEU: { first: 0, count: 2 },
    FRA: { first: 2, count: 2 },
  });
});

test('explicit chain phases survive the shared stroke packet conversion', () => {
  const result = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 2, 0,
  ]), new Float32Array([12, 28]));
  assert.equal(result.instances[8], 12);
  assert.equal(result.instances[18], 28);
});

test('connected segments produce shared join topology instead of independent caps', () => {
  const result = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 2, 1,
    2, 1, 3, 1,
  ]));
  assert.equal(result.segmentCount, 3);
  assert.equal(result.joinCount, 2);
  assert.equal(result.capCount, 2);
  assert.equal(result.nodeCount, 4);
  assert.equal(result.instances.length > 0, true);
  assert.equal(result.nodes.length > 0, true);
});

test('owner-filtered drawing resolves only finite non-empty ranges inside uploaded buffers', () => {
  const resource = {
    instanceCount: 5,
    ownerRanges: {
      DEU: { first: 0, count: 2 },
      FRA: { first: 2, count: 99 },
      EMPTY: { first: 4, count: 0 },
      OUTSIDE: { first: 8, count: 1 },
    },
  };
  assert.deepEqual(resolveGpuStrokeRanges(resource, ['DEU', 'DEU', 'FRA', 'EMPTY', 'OUTSIDE', 'MISSING']), [
    { first: 0, count: 2 },
    { first: 2, count: 3 },
  ]);
  assert.deepEqual(resolveGpuStrokeRanges(resource, ['MISSING']), []);
  assert.deepEqual(resolveGpuStrokeRanges(resource), [{ first: 0, count: 5 }]);
});

test('node owner ranges use the same scoped range resolver', () => {
  const resource = {
    nodeCount: 6,
    ownerNodeRanges: {
      DEU: { first: 0, count: 4 },
      FRA: { first: 4, count: 2 },
    },
  };
  assert.deepEqual(resolveGpuStrokeRanges(resource, ['FRA'], 'ownerNodeRanges', 'nodeCount'), [{ first: 4, count: 2 }]);
});
});
contractSuite("renderer-v2", () => {
const assert = __gpu_dep0.default;
const test = __gpu_dep1.default;
const { GPU_STROKE_FLAGS, buildGpuStrokeInstances } = __gpu_dep2;
const { createMapRenderCoordinator, MAP_RENDER_DIRTY, MAP_RENDER_MASKS } = __gpu_dep3;
const { createRenderSceneBuilder } = __gpu_dep4;

test('connected stroke preprocessing emits neighbor topology, joins and terminal caps', () => {
  const geometry = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 2, 1,
  ]));
  assert.equal(geometry.segmentCount, 2);
  assert.equal(geometry.joinCount, 1);
  assert.equal(geometry.capCount, 2);
  assert.equal(geometry.nodeCount, 3);
  const firstFlags = geometry.instances[9];
  const secondFlags = geometry.instances[19];
  assert.equal((firstFlags & GPU_STROKE_FLAGS.HAS_NEXT) !== 0, true);
  assert.equal((firstFlags & GPU_STROKE_FLAGS.CHAIN_START) !== 0, true);
  assert.equal((secondFlags & GPU_STROKE_FLAGS.HAS_PREVIOUS) !== 0, true);
  assert.equal((secondFlags & GPU_STROKE_FLAGS.CHAIN_END) !== 0, true);
  assert.deepEqual([...geometry.instances.slice(6, 8)], [2, 1]);
  assert.deepEqual([...geometry.instances.slice(10, 12)], [0, 0]);
});
test('closed stroke chains have joins at every vertex and never create endpoint caps', () => {
  const geometry = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 1, 1,
    1, 1, 0, 0,
  ]));
  assert.equal(geometry.closedChainCount, 1);
  assert.equal(geometry.joinCount, 3);
  assert.equal(geometry.capCount, 0);
  assert.equal(geometry.nodeCount, 3);
  const instanceStride = geometry.instances.length / geometry.segmentCount;
  for (let offset = instanceStride - 1; offset < geometry.instances.length; offset += instanceStride) {
    assert.equal((geometry.instances[offset] & GPU_STROKE_FLAGS.CLOSED_CHAIN) !== 0, true);
  }
});

test('RenderScene geometry packets are reused when only the view revision changes', () => {
  const builder = createRenderSceneBuilder();
  const geometry = { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 1]] };
  const common = {
    strokes: [{ key: 'territorial:a', geometryRevision: 9, geometry, style: { color: '#334455', width: 2 } }],
  };
  const first = builder.build({ ...common, revision: 1, revisions: { geometry: 9, view: 1 } });
  const second = builder.build({ ...common, revision: 2, revisions: { geometry: 9, view: 2 } });
  assert.equal(first.strokes[0].startsEnds, second.strokes[0].startsEnds);
  assert.equal(builder.stats().strokeCacheHits > 0, true);
});

test('view-only coordinator frames do not invoke scene geometry rendering', () => {
  const calls = [];
  const gpuFrameResult = { succeeded: true, selection: { succeeded: true } };
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => callback(),
    prepareView: () => ({ revision: 5 }),
    renderers: {
      view: () => { calls.push('view'); return gpuFrameResult; },
      countries: () => calls.push('countries'),
      selectionView: () => calls.push('selection-view'),
      territorialLabelPositions: () => calls.push('country-labels'),
      userLabelPositions: () => calls.push('user-labels'),
    },
  });
  coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'renderer-v2-view');
  assert.equal(calls.includes('view'), true);
  assert.equal(calls.includes('selection-view'), true);
  assert.equal(calls.includes('countries'), false);
  assert.equal(coordinator.getStats().lastDirtyMask & MAP_RENDER_DIRTY.SELECTION_VIEW, 0);
});
});
