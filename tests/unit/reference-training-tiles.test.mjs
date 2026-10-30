import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {listRasterTrainingTiles,listReviewedTrainingTiles,prepareRasterTrainingTile,prepareReviewedTrainingTile} from '../../tools/reference-analysis/training-tiles.mjs';
import {readNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';

test('training tile selection keeps supervised areas and excludes unknown padded tiles',async()=>{
  const annotation={width:600,height:16,known:{international:[[[0,0],[49,0],[49,15],[0,15]]]},lines:[],ignore:[]};
  assert.deepEqual((await listReviewedTrainingTiles(annotation)).map(row=>row.x),[0]);
  assert.deepEqual((await listReviewedTrainingTiles(annotation,{supervisedOnly:false})).map(row=>row.x),[0,448]);
});

test('native training tile matches Python tensors, masks, position and augmentation',async()=>{
  const root='tests/fixtures/reference-training-tile',annotation=JSON.parse(await readFile(root+'/label.json','utf8'));
  const expected=JSON.parse(await readFile(root+'/expected.json','utf8'));
  const sourceSha256=createHash('sha256').update(await readFile(root+'/map.png')).digest('hex');
  for(const row of expected){
    const result=await prepareReviewedTrainingTile({imagePath:root+'/map.png',sourceSha256,annotation,x:0,y:0,augment:row.augment,epoch:row.epoch,index:row.index});
    const hashes=['tile','overview','position','target','valid'].map(name=>createHash('sha256').update(result[name]).digest('hex'));
    assert.deepEqual(hashes,row.hashes,`augment ${row.augment}, epoch ${row.epoch}`);
  }
});
test('source-bound raster supervision matches original training tensors',async()=>{
  const root='tests/fixtures/reference-training-raster',annotation=JSON.parse(await readFile(root+'/label.json','utf8'));
  const expected=JSON.parse(await readFile(root+'/expected.json','utf8'));
  const sourceSha256=createHash('sha256').update(await readFile(root+'/map.png')).digest('hex');
  assert.deepEqual((await listRasterTrainingTiles({root,annotation})).map(row=>[row.x,row.y]),[[0,0]]);
  for(const row of expected){const result=await prepareRasterTrainingTile({root,imagePath:'map.png',sourceSha256,annotation,x:0,y:0,augment:row.augment,epoch:row.epoch,index:row.index});
    const hashes=['tile','overview','position','target','valid'].map(name=>createHash('sha256').update(result[name]).digest('hex'));
    assert.deepEqual(hashes,row.hashes,`raster augment ${row.augment}, epoch ${row.epoch}`);}
  const invalid=structuredClone(annotation);invalid.raster.sha256='0'.repeat(64);
  await assert.rejects(prepareRasterTrainingTile({root,imagePath:'map.png',sourceSha256,annotation:invalid,x:0,y:0}),/hash/i);
  await assert.rejects(prepareRasterTrainingTile({root,imagePath:'map.png',sourceSha256:'0'.repeat(64),annotation,x:0,y:0}),/hash/i);
});
test('training masks use raw grayscale pixels without EXIF rotation and reject RGB',async()=>{
  const root='tests/fixtures/reference-training-raster',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const png=await readFile(root+'/oriented-mask.png'),mask=await readNativeTrainingMask(png,hash(png));
  assert.deepEqual([mask.width,mask.height],[3,2]);assert.deepEqual(mask.data,Buffer.from([1,2,3,4,5,6]));
  const rgb=await readFile(root+'/map.png');await assert.rejects(readNativeTrainingMask(rgb,hash(rgb)),/grayscale/i);
});
