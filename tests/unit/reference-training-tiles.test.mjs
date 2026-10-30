import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {listRasterTrainingTiles,listReviewedTrainingTiles,prepareRasterTrainingTile,prepareReviewedTrainingTile} from '../../tools/reference-analysis/training-tiles.mjs';
import {countNativeTrainingSupervision,readNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';

test('native supervision counts only target pixels inside known regions',async()=>{
  const target={width:3,height:1,data:Buffer.from([1,2,127])},known={width:3,height:1,data:Buffer.from([1,3,0])};
  assert.deepEqual(await countNativeTrainingSupervision(target,known),[[2,1],[1,1],[0,0],[0,0],[0,0],[0,0],[0,0]]);
  await assert.rejects(countNativeTrainingSupervision(target,{...known,width:2}),/Matching/);
});

test('training tile selection keeps supervised areas and excludes unknown padded tiles',async()=>{
  const annotation={width:600,height:16,known:{international:[[[0,0],[49,0],[49,15],[0,15]]]},lines:[],ignore:[]};
  assert.deepEqual((await listReviewedTrainingTiles(annotation)).map(row=>row.x),[0]);
  assert.deepEqual((await listReviewedTrainingTiles(annotation,{supervisedOnly:false})).map(row=>row.x),[0,448]);
});

test('Python dataset index uses full-sheet rounding at fractional tile edges',async()=>{
  const annotation={width:600,height:16,known:{international:[[[447.1,0],[447.9,0],[447.9,10],[447.1,10]]]},lines:[],ignore:[]};
  assert.deepEqual((await listReviewedTrainingTiles(annotation,{fullSheetCoordinates:true})).map(row=>row.x),[0]);
  assert.deepEqual((await listReviewedTrainingTiles(annotation)).map(row=>row.x),[0,448]);
  const run=spawnSync(process.execPath,['tools/reference-analysis/training-tiles.mjs','--index'],
    {input:JSON.stringify({annotation,width:600,height:16,supervisedOnly:true}),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),[{x:0,y:0}]);
  const invalid=spawnSync(process.execPath,['tools/reference-analysis/training-tiles.mjs','--index'],
    {input:JSON.stringify({annotation,width:601,height:16,supervisedOnly:true}),encoding:'utf8'});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/dimensions/i);
});

test('reviewed training index handles a source wider than a native image window',async()=>{
  const annotation={width:16385,height:2,known:{international:[[[16380,0],[16384,0],[16384,1],[16380,1]]]},lines:[],ignore:[]};
  assert.deepEqual((await listReviewedTrainingTiles(annotation,{fullSheetCoordinates:true})).map(({x,y})=>[x,y]),[[16128,0]]);
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
  const repeat=await prepareReviewedTrainingTile({imagePath:root+'/map.png',sourceSha256,annotation,x:0,y:0,augment:true,epoch:0,index:0});
  for(const [i,name] of ['tile','overview','position','target','valid'].entries())
    assert.equal(createHash('sha256').update(repeat[name]).digest('hex'),expected[1].hashes[i]);
  for(const name of ['tile','overview'])for(let offset=0;offset<repeat[name].length;offset+=4)
    assert(Number.isFinite(repeat[name].readFloatLE(offset)),'Augmented training inputs must be finite');
});
test('training sample stream returns the source-bound native tensors',async()=>{
  const root='tests/fixtures/reference-training-tile',annotation=JSON.parse(await readFile(root+'/label.json','utf8'));
  const expected=JSON.parse(await readFile(root+'/expected.json','utf8'))[0],sha256=createHash('sha256').update(await readFile(root+'/map.png')).digest('hex');
  const args=['tools/reference-analysis/training-tiles.mjs','--sample'];
  const request={root,sheet:{image:'map.png',sha256},annotation,x:0,y:0,augment:false,epoch:0,index:0};
  const run=spawnSync(process.execPath,args,{input:JSON.stringify(request),maxBuffer:32*1024*1024});
  assert.equal(run.status,0,run.stderr.toString());
  const sizes=[3*512*512*4,3*256*256*4,4*4,7*512*512*4,7*512*512*4];let offset=0;
  const hashes=sizes.map(size=>{const result=createHash('sha256').update(run.stdout.subarray(offset,offset+size)).digest('hex');offset+=size;return result;});
  assert.equal(run.stdout.length,offset);assert.deepEqual(hashes,expected.hashes);
  const invalid=spawnSync(process.execPath,args,{input:JSON.stringify({...request,sheet:{...request.sheet,sha256:'0'.repeat(64)}}),maxBuffer:32*1024*1024});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr.toString(),/hash/i);
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
  const edge=await prepareRasterTrainingTile({root,imagePath:'map.png',sourceSha256,annotation,x:23,y:15});
  assert.ok(Math.abs(edge.position.readFloatLE(8)-1/24)<1e-7);
  assert.ok(Math.abs(edge.position.readFloatLE(12)-1/16)<1e-7);
  assert.equal(edge.valid.readFloatLE(4),0);
  await assert.rejects(prepareRasterTrainingTile({root,imagePath:'map.png',sourceSha256,annotation,x:24,y:0}),/outside/i);
});
test('training masks use raw grayscale pixels without EXIF rotation and reject RGB',async()=>{
  const root='tests/fixtures/reference-training-raster',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const png=await readFile(root+'/oriented-mask.png'),mask=await readNativeTrainingMask(png,hash(png));
  assert.deepEqual([mask.width,mask.height],[3,2]);assert.deepEqual(mask.data,Buffer.from([1,2,3,4,5,6]));
  const rgb=await readFile(root+'/map.png');await assert.rejects(readNativeTrainingMask(rgb,hash(rgb)),/grayscale/i);
});
