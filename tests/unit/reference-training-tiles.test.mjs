import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {prepareReviewedTrainingTile} from '../../tools/reference-analysis/training-tiles.mjs';

test('native training tile matches Python tensors, masks, position and augmentation',async()=>{
  const root='tests/fixtures/reference-training-tile',annotation=JSON.parse(await readFile(root+'/label.json','utf8'));
  const expected=JSON.parse(await readFile(root+'/expected.json','utf8'));
  for(const row of expected){
    const result=await prepareReviewedTrainingTile({imagePath:root+'/map.png',annotation,x:0,y:0,augment:row.augment,epoch:row.epoch,index:row.index});
    const hashes=['tile','overview','position','target','valid'].map(name=>createHash('sha256').update(result[name]).digest('hex'));
    assert.deepEqual(hashes,row.hashes,`augment ${row.augment}, epoch ${row.epoch}`);
  }
});
