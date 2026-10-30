import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {countNativeEncodedTrainingSupervision,countNativeTrainingSupervision,readNativeTrainingMask,readNativeTrainingMaskWindow,scanNativeTrainingMaskTiles} from '../../tools/map-image/native-resample.mjs';
import {listRasterTrainingTiles,prepareRasterTrainingTile} from '../../tools/reference-analysis/training-tiles.mjs';

test('large source-bound mask returns only the selected raw grayscale window',async()=>{
  const bytes=await readFile('tests/fixtures/reference-training-raster/large-valid.png');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const result=await readNativeTrainingMaskWindow(bytes,sha256,{x:4000,y:4000});
  assert.equal(result.width,4097);assert.equal(result.height,4097);assert.equal(result.data.length,512*512);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++)assert.equal(result.data[y*512+x],x<97&&y<97?3:0);
  await assert.rejects(readNativeTrainingMaskWindow(bytes,'0'.repeat(64),{x:0,y:0}),/hash/i);
  await assert.rejects(readNativeTrainingMaskWindow(bytes,sha256,{x:4097,y:0}),/outside/i);
  const rgb=await readFile('tests/fixtures/reference-training-raster/map.png');
  await assert.rejects(readNativeTrainingMaskWindow(rgb,createHash('sha256').update(rgb).digest('hex'),{x:0,y:0}),/grayscale/i);
  const oriented=await readFile('tests/fixtures/reference-training-raster/oriented-mask.png');
  const raw=await readNativeTrainingMaskWindow(oriented,createHash('sha256').update(oriented).digest('hex'),{x:0,y:0});
  assert.deepEqual([raw.width,raw.height],[3,2]);
  assert.deepEqual([...raw.data.subarray(0,3)],[1,2,3]);assert.deepEqual([...raw.data.subarray(512,515)],[4,5,6]);
});

test('large raster supervision and source image share original coordinates',async()=>{
  const root='tests/fixtures',imagePath='map-image/png-read/training-large.png',maskPath='reference-training-raster/large-valid.png';
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const sourceSha256=hash(await readFile(`${root}/${imagePath}`)),sha256=hash(await readFile(`${root}/${maskPath}`));
  const annotation={origin:'macro-vector-supervision',width:4097,height:4097,raster:{path:maskPath,sha256},validRaster:{path:maskPath,sha256}};
  const result=await prepareRasterTrainingTile({root,imagePath,sourceSha256,annotation,x:4000,y:4000});
  assert.equal(result.target.readFloatLE(0),1);assert.equal(result.valid.readFloatLE(0),1);
  assert.equal(result.target.readFloatLE((100*512+100)*4),0);assert.equal(result.valid.readFloatLE((100*512+100)*4),0);
  const tiles=await listRasterTrainingTiles({root,annotation});
  assert.deepEqual(tiles.map(({x,y})=>[x,y]),[[3584,3584],[4032,3584],[3584,4032],[4032,4032]]);
  assert.equal((await listRasterTrainingTiles({root,annotation},{supervisedOnly:false})).length,100);
});

test('large encoded mask supervision counts only shared known pixels',async()=>{
  const bytes=await readFile('tests/fixtures/reference-training-raster/large-valid.png'),sha256=createHash('sha256').update(bytes).digest('hex');
  const result=await countNativeEncodedTrainingSupervision({bytes,sha256},{bytes,sha256});
  assert.deepEqual([result.width,result.height],[4097,4097]);
  assert.deepEqual(result.counts,[[9409,9409],[9409,9409],[0,0],[0,0],[0,0],[0,0],[0,0]]);
  await assert.rejects(countNativeEncodedTrainingSupervision({bytes,sha256:'0'.repeat(64)},{bytes,sha256}),/hash/i);
  const small=await readFile('tests/fixtures/reference-training-raster/oriented-mask.png'),smallHash=createHash('sha256').update(small).digest('hex');
  await assert.rejects(countNativeEncodedTrainingSupervision({bytes,sha256},{bytes:small,sha256:smallHash}),/matching/i);
  const target=await readFile('tests/fixtures/reference-training-raster/raster.png'),known=await readFile('tests/fixtures/reference-training-raster/valid.png');
  const hash=value=>createHash('sha256').update(value).digest('hex'),targetHash=hash(target),knownHash=hash(known);
  const expected=await countNativeTrainingSupervision(await readNativeTrainingMask(target,targetHash),await readNativeTrainingMask(known,knownHash));
  assert.deepEqual((await countNativeEncodedTrainingSupervision({bytes:target,sha256:targetHash},{bytes:known,sha256:knownHash})).counts,expected);
});

test('large Adam7 grayscale masks keep window, tile coverage and supervision',async()=>{
  const load=async name=>{const bytes=await readFile(`tests/fixtures/reference-training-raster/${name}.png`);return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')};};
  const plain=await load('large-valid'),adam7=await load('large-valid-adam7');
  const [a,b]=await Promise.all([readNativeTrainingMaskWindow(plain.bytes,plain.sha256,{x:4000,y:4000}),readNativeTrainingMaskWindow(adam7.bytes,adam7.sha256,{x:4000,y:4000})]);
  assert.deepEqual([a.width,a.height],[b.width,b.height]);assert.equal(Buffer.compare(a.data,b.data),0);
  const [plainTiles,adamTiles]=await Promise.all([scanNativeTrainingMaskTiles(plain.bytes,plain.sha256),scanNativeTrainingMaskTiles(adam7.bytes,adam7.sha256)]);
  assert.deepEqual(plainTiles,adamTiles);
  const result=await countNativeEncodedTrainingSupervision(adam7,plain);
  assert.deepEqual(result.counts,[[9409,9409],[9409,9409],[0,0],[0,0],[0,0],[0,0],[0,0]]);
});
