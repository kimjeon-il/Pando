import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGpuStrokeInstances } from '../../../src/rendering/gpu-stroke-geometry.js';
import { resolveGpuStrokeRanges, resolveVisibleGpuStrokeRanges } from '../../../src/rendering/gpu-stroke-renderer.js';
import { prepareGpuStrokeVisibilityBlocks, mergeAdjacentStrokeRanges,
  strokeVisibilityBlockIntersectsFrame } from '../../../src/rendering/gpu-stroke-visibility.js';

const flat = (center = 0, offsets = [0]) => ({
  mode: 1, cssViewport: [800, 600], cssTranslate: [400, 300], cssScale: 1000,
  flatCenter: [center * Math.PI / 180, 0], worldOffsets: offsets,
});
const globe = () => ({
  mode: 0, cssViewport: [800, 600], cssTranslate: [400, 300], cssScale: 1000,
  rowX: [0, 1, 0], rowY: [0, 0, 1], rowZ: [1, 0, 0],
});
function resources() {
  const source = new Float32Array([
    0, 0, 1, 0,
    1, 0, 2, 0,
    100, 0, 101, 0,
    -179.8, 0, -179.6, 0,
  ]);
  const geometry = buildGpuStrokeInstances(source, null, {
    near: { first: 0, count: 2 }, far: { first: 2, count: 1 },
    dateline: { first: 3, count: 1 },
  });
  const index = prepareGpuStrokeVisibilityBlocks(geometry, { blockSize: 1 });
  return { ...geometry, instanceCount: geometry.segmentCount, visibilityBlocks: index };
}
test('source geometry and per-owner segment/node block envelope remain unchanged', () => {
  const resource = resources();
  assert.equal(resource.visibilityBlocks.version, 1);
  assert.ok(resource.visibilityBlocks.blockCount >= resource.segmentCount);
  assert.equal(resource.visibilityBlocks.segments.near.blocks.length, 2);
  assert.equal(resource.visibilityBlocks.nodes.far.first >= 0, true);
  assert.deepEqual(resource.visibilityBlocks.segments.near.blocks.map(b => b.first), [0, 1]);
  assert.equal(resource.visibilityBlocks.estimatedBytes > 0, true);
  assert.equal(resource.instances.length, resource.instanceCount * 10);
});
test('flat camera culls distant owners and preserves screen edge segments and caps', () => {
  const resource = resources(), frame = flat();
  assert.deepEqual(resolveVisibleGpuStrokeRanges(resource, ['near', 'far', 'dateline'], frame),
    [{ first: 0, count: 1 }, { first: 1, count: 1 }]);
  assert.deepEqual(resolveVisibleGpuStrokeRanges(resource, ['far'], frame), []);
  assert.ok(resolveVisibleGpuStrokeRanges(resource, ['near'], frame,
    'ownerNodeRanges', 'nodeCount').length > 0);
  assert.equal(mergeAdjacentStrokeRanges(resolveVisibleGpuStrokeRanges(resource,
    ['near', 'far', 'dateline'], frame)).length, 1);
});
test('globe rejects rear hemisphere without erasing front-edge strokes', () => {
  const resource = resources();
  const front = resolveVisibleGpuStrokeRanges(resource, ['near', 'far', 'dateline'], globe());
  assert.ok(front.some(r => r.first === 0));
  assert.ok(front.every(r => r.first < 2));
});
test('wrapped flat world retains visible dateline owners', () => {
  const resource = resources();
  const ranges = resolveVisibleGpuStrokeRanges(resource, ['near', 'far', 'dateline'],
    flat(179.8, [0, 2 * Math.PI]));
  assert.deepEqual(ranges, [{ first: 3, count: 1 }]);
});
test('unknown frame and incompatible owner index revert to complete ranges', () => {
  const resource = resources(), selected = ['near', 'far', 'dateline'];
  assert.deepEqual(resolveVisibleGpuStrokeRanges({ ...resource, visibilityBlocks: null }, selected, flat()),
    resolveGpuStrokeRanges(resource, selected));
  assert.deepEqual(resolveVisibleGpuStrokeRanges(resource, selected, { mode: 2 }),
    resolveGpuStrokeRanges(resource, selected));
  assert.deepEqual(resolveVisibleGpuStrokeRanges({ ...resource, visibilityBlocks: {
    ...resource.visibilityBlocks, segments: { ...resource.visibilityBlocks.segments,
      far: { ...resource.visibilityBlocks.segments.far, first: 99 } },
  } }, ['far'], flat()), [{ first: 2, count: 1 }]);
  assert.equal(strokeVisibilityBlockIntersectsFrame(null, flat()), true);
});
test('adjacent identical-style ranges merge without bridging unselected owners', () => {
  const merged = mergeAdjacentStrokeRanges([{ first: 12, count: 2 }, { first: 4, count: 3 },
    { first: 0, count: 4 }, { first: 9, count: 1 }, { first: 13, count: 2 }]);
  assert.deepEqual(merged, [{ first: 0, count: 7 }, { first: 9, count: 1 }, { first: 12, count: 3 }]);
  assert.deepEqual(mergeAdjacentStrokeRanges([{ first: 0, count: 2 }]), [{ first: 0, count: 2 }]);
});
