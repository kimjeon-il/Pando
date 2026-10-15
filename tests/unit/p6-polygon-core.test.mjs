import assert from 'node:assert/strict';
import test from 'node:test';
import { loadVerifiedCore } from '../helpers/node-core-wasm-loader.mjs';

const box = (x, y, w, h) => [[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]];
test('shared polygon operation owns multi-operand union, holes and empty intersection', async () => {
  const core = await loadVerifiedCore();
  const a = box(0,0,2,2), b = box(1,0,2,2);
  const union = core.polygonOperation('union', [a,b], false);
  assert.deepEqual(union, [[[[0,0],[3,0],[3,2],[0,2],[0,0]]]]);
  const hole = core.polygonOperation('difference', [box(0,0,5,5),box(1,1,1,1)], false);
  assert.equal(hole.length,1);
  assert.equal(hole[0].length,2);
  assert.deepEqual(core.polygonOperation('intersection',[a,box(10,10,1,1)],false),[]);
  assert.deepEqual(a,box(0,0,2,2));
});
