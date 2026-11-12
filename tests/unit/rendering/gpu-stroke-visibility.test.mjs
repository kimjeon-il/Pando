import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGpuStrokeInstances } from '../../../src/rendering/gpu-stroke-geometry.js';
import { visibleGpuStrokeOwners, mergeGpuStrokeDrawRanges } from '../../../src/rendering/gpu-stroke-visibility.js';

const frame = Object.freeze({
  mode: 0, viewport: [800, 600], translate: [400, 300], scale: 1600,
  rowX: [0, 1, 0], rowY: [0, 0, 1], rowZ: [1, 0, 0],
  worldOffsets: [0], dpr: 1,
});

test('32x globe country stroke culling excludes far side but keeps intersecting coast owners', () => {
  const geometry = buildGpuStrokeInstances(new Float32Array([
    -1, 0, 0, 0,
    0, 0, 1, 0,
    120, 0, 121, 0,
    60, 0, 61, 0,
  ]), null, {
    A: { first: 0, count: 1 },
    B: { first: 1, count: 1 },
    BACK: { first: 2, count: 1 },
    OFFSCREEN: { first: 3, count: 1 },
  });
  assert.deepEqual(visibleGpuStrokeOwners(geometry, ['A','B','BACK','OFFSCREEN'], frame),
    ['A','B']);
  assert.deepEqual(visibleGpuStrokeOwners(geometry, ['A','B','BACK','OFFSCREEN'],
    { ...frame, mode: 2 }), ['A','B','BACK','OFFSCREEN'],
    'unknown projection is never culled');
});

test('unknown or incomplete owner geometry is preserved, not silently lost', () => {
  const owners = ['A','B'];
  assert.strictEqual(visibleGpuStrokeOwners({}, owners, frame), owners);
  assert.deepEqual(visibleGpuStrokeOwners({
    instances: new Float32Array([0,0]), ownerRanges:{A:{first:0,count:1}},
  }, owners, frame), owners);
  const geometry = buildGpuStrokeInstances(new Float32Array([1,0,2,0]),null,{A:{first:0,count:1}});
  assert.deepEqual(visibleGpuStrokeOwners(geometry, owners, frame), owners);
});

test('flat-world wrap offsets keep visible border owners and reject offscreen ranges', () => {
  const g = buildGpuStrokeInstances(new Float32Array([
    -179,0,-178,0,
    20,0,21,0,
  ]),null,{ANTIMERIDIAN:{first:0,count:1},FAR:{first:1,count:1}});
  const flat = { ...frame, mode: 1, viewport: [800,600], scale: 7000,
    translate:[400,300], flatCenter:[Math.PI,0],worldOffsets:[0,Math.PI*2,-Math.PI*2] };
  assert.deepEqual(visibleGpuStrokeOwners(g,['ANTIMERIDIAN','FAR'],flat),
    ['ANTIMERIDIAN']);
});

test('contiguous ranges merge only within an already style-grouped draw', () => {
  assert.deepEqual(mergeGpuStrokeDrawRanges([
    {first:8,count:2},{first:0,count:4},{first:4,count:4},{first:12,count:2},
  ]), [{first:0,count:10},{first:12,count:2}]);
  assert.deepEqual(mergeGpuStrokeDrawRanges([{first:0,count:2},{first:5,count:1}]),
    [{first:0,count:2},{first:5,count:1}]);
  assert.deepEqual(mergeGpuStrokeDrawRanges([]), []);
});
