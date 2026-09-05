import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GPU_STROKE_FLAGS,
  buildGpuStrokeInstances,
} from '../../assets/js/modules/gpu-stroke-renderer.js';
import { createMapRenderCoordinator, MAP_RENDER_DIRTY, MAP_RENDER_MASKS } from '../../assets/js/modules/map-render-coordinator.js';
import { createRenderSceneBuilder } from '../../assets/js/modules/render-scene.js';
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
      countryLabelPositions: () => calls.push('country-labels'),
      userLabelPositions: () => calls.push('user-labels'),
    },
  });
  coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'renderer-v2-view');
  assert.equal(calls.includes('view'), true);
  assert.equal(calls.includes('selection-view'), true);
  assert.equal(calls.includes('countries'), false);
  assert.equal(coordinator.getStats().lastDirtyMask & MAP_RENDER_DIRTY.SELECTION_VIEW, 0);
});
