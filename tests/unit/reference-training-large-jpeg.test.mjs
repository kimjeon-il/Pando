import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareReviewedTrainingTile } from '../../tools/reference-analysis/training-tiles.mjs';

test('reviewed large JPEG keeps original coordinates, masks, pixels and white padding', async () => {
  const imagePath='tests/fixtures/map-image/jpeg-read/training-large.jpg';
  const sourceSha256=createHash('sha256').update(await readFile(imagePath)).digest('hex');
  const annotation={width:4097,height:4097,known:{international:[[[4000,4000],[4096,4000],[4096,4096],[4000,4096]]]},lines:[],regions:[],ignore:[]};
  const result=await prepareReviewedTrainingTile({imagePath,sourceSha256,annotation,x:4000,y:4000});
  assert.ok(Math.abs(result.position.readFloatLE(0)-4000/4097)<1e-7);
  assert.ok(Math.abs(result.position.readFloatLE(8)-97/4097)<1e-7);
  assert.ok(Math.abs(result.tile.readFloatLE(0)-(125/255-.485)/.229)<1e-6);
  assert.ok(Math.abs(result.tile.readFloatLE(100*4)-(1-.485)/.229)<1e-6);
  assert.equal(result.valid.readFloatLE(0),1);
  assert.equal(result.valid.readFloatLE((100*512+100)*4),0);
  await assert.rejects(prepareReviewedTrainingTile({imagePath,sourceSha256:'0'.repeat(64),annotation,x:4000,y:4000}),/hash/i);
});
