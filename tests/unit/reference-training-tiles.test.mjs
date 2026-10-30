import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {listReviewedTrainingTiles,prepareReviewedTrainingTile} from '../../tools/reference-analysis/training-tiles.mjs';

test('training tile selection keeps supervised areas and excludes unknown padded tiles',async()=>{
  const annotation={width:600,height:16,known:{international:[[[0,0],[49,0],[49,15],[0,15]]]},lines:[],ignore:[]};
  assert.deepEqual((await listReviewedTrainingTiles(annotation)).map(row=>row.x),[0]);
  assert.deepEqual((await listReviewedTrainingTiles(annotation,{supervisedOnly:false})).map(row=>row.x),[0,448]);
});

test('native training tile matches Python tensors, masks, position and augmentation',async()=>{
  const root='tests/fixtures/reference-training-tile',annotation=JSON.parse(await readFile(root+'/label.json','utf8'));
  const expected=JSON.parse(await readFile(root+'/expected.json','utf8'));
  for(const row of expected){
    const result=await prepareReviewedTrainingTile({imagePath:root+'/map.png',annotation,x:0,y:0,augment:row.augment,epoch:row.epoch,index:row.index});
    const hashes=['tile','overview','position','target','valid'].map(name=>createHash('sha256').update(result[name]).digest('hex'));
    assert.deepEqual(hashes,row.hashes,`augment ${row.augment}, epoch ${row.epoch}`);
  }
});
