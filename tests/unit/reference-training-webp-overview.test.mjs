import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {prepareNativeTrainingTile,prepareNativeTrainingTilePieces,readNativeImage,readNativeTrainingRaster} from '../../tools/map-image/native-resample.mjs';
import {prepareReviewedTrainingTile} from '../../tools/reference-analysis/training-tiles.mjs';

test('WebP training pixels retain color, first animation frame and EXIF orientation',async()=>{
  for(const name of ['rgb','rgba','lossy-alpha','animated','training-stripes','orientation-2','orientation-3','orientation-4','orientation-5','orientation-6','orientation-7','orientation-8']){
    const path=`tests/fixtures/map-image/webp-read/${name}.webp`,bytes=await readFile(path),expectedSha256=createHash('sha256').update(bytes).digest('hex');
    const image=await readNativeImage({path,format:'webp',maxPixels:16777216,expectedSha256});
    const streamed=await readNativeTrainingRaster({path,format:'webp',expectedSha256});
    assert.equal(streamed.width,image.originalWidth,name+' width');assert.equal(streamed.height,image.originalHeight,name+' height');
    const targetBits=Buffer.alloc(512*512),knownBits=Buffer.alloc(512*512,3);targetBits[0]=1;
    const original=await prepareNativeTrainingTile({image,targetBits,knownBits,x:0,y:0,augment:true,epoch:1,index:2});
    const actual=await prepareNativeTrainingTilePieces({image:streamed,targetBits,knownBits,x:0,y:0,augment:true,epoch:1,index:2});
    for(const field of ['tile','overview','position','target','valid'])assert.equal(Buffer.compare(actual[field],original[field]),0,name+' '+field);
  }
});

test('lossy WebP stripe boundaries preserve original source pixels',async()=>{
  const path='tests/fixtures/map-image/webp-read/training-stripes.webp',bytes=await readFile(path),expectedSha256=createHash('sha256').update(bytes).digest('hex');
  const image=await readNativeImage({path,format:'webp',maxPixels:16777216,expectedSha256});
  const streamed=await readNativeTrainingRaster({path,format:'webp',expectedSha256,x:0,y:448});
  let count=0,first;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++)for(let c=0;c<3;c++){
    const actual=streamed.tile[(y*512+x)*4+c],expected=image.data[((y+448)*image.width+x)*4+c];
    if(actual!==expected){count++;first??={x,y:y+448,channel:c,actual,expected};}
  }
  assert.equal(count,0,JSON.stringify(first));
});

test('lossless WebP above 16MP matches the original PNG overview and tile',async()=>{
  const path='tests/fixtures/map-image/webp-read/training-large.webp',bytes=await readFile(path),expectedSha256=createHash('sha256').update(bytes).digest('hex');
  const actual=await readNativeTrainingRaster({path,format:'webp',expectedSha256,x:4000,y:4000});
  const expected=await readNativeImage({path:'tests/fixtures/map-image/png-read/training-large-overview.png',format:'png',maxPixels:16777216});
  assert.equal(actual.width,4097);assert.equal(actual.height,4097);assert.equal(Buffer.compare(actual.data,expected.data),0,'overview pixels');
  assert.equal(createHash('sha256').update(actual.tile).digest('hex'),'570623f72781109f0c0519d0ecc45771a9ff9210c1e694536cd5aa28044b8406');
  const annotation={width:4097,height:4097,known:{international:[[[4000,4000],[4096,4000],[4096,4096],[4000,4096]]]},lines:[],regions:[],ignore:[]};
  const tile=await prepareReviewedTrainingTile({imagePath:path,sourceSha256:expectedSha256,annotation,x:4000,y:4000});
  assert.ok(Math.abs(tile.position.readFloatLE(0)-4000/4097)<1e-7);
  assert.equal(tile.valid.readFloatLE(0),1);assert.equal(tile.valid.readFloatLE((100*512+100)*4),0);
  await assert.rejects(readNativeTrainingRaster({path,format:'webp',expectedSha256:'0'.repeat(64)}),/hash/i);
});
