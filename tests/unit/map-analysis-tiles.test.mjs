import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceImageTilePlan, createReferenceTileAccumulator, validateReferenceBoundaryTensorContract } from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';

test('tensor validation is separate from release approval without inventing approval fields',()=>{
  const pending={schemaVersion:1,evaluationStatus:'pending',releaseApproved:false,classes:['international','administrative','coast','hydro','transport','text','frame'],tileSize:512,overlap:64,overviewSize:256,model:{url:'boundary.onnx',sha256:'a'.repeat(64),bytes:123}};
  assert.equal(validateReferenceBoundaryTensorContract(pending),pending);
  assert.equal(pending.releaseApproved,false);
});

test('unobserved coast logits cannot inflate confidence in supervised border candidates',()=>{
  const accumulator=createReferenceTileAccumulator(1,1,{tileSize:2,overlap:0,confidenceChannels:[0,1]});
  const logits=new Float32Array(7*4).fill(-20);
  logits[0]=Math.log(.6/.4);logits[2*4]=20;
  accumulator.add({x:0,y:0,width:1,height:1},logits);accumulator.finishRow(0,1);
  assert.ok(Math.abs(accumulator.result().confidence[0]-.6)<1e-6);
});

test('overlap blending writes every source pixel once without losing the last short tile', () => {
  const tiles = referenceImageTilePlan(7, 5, { tileSize: 4, overlap: 1 });
  assert.deepEqual(tiles.map(({ x, y }) => [x, y]), [[0, 0], [3, 0], [6, 0], [0, 3], [3, 3], [6, 3]]);
  const accumulator = createReferenceTileAccumulator(7, 5, { tileSize: 4, overlap: 1 });
  const logits = new Float32Array(7 * 4 * 4).fill(-10);
  logits.fill(10, 0, 16);
  let currentY = 0;
  for (const tile of tiles) {
    if (tile.y !== currentY) { accumulator.finishRow(currentY, tile.y); currentY = tile.y; }
    accumulator.add(tile, logits);
  }
  accumulator.finishRow(currentY, 5);
  const result = accumulator.result();
  assert.equal(result.labels.length, 35);
  assert.ok(result.labels.every(value => value === 1));
  assert.ok(result.confidence.every(value => value > .99));
});
