import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {prepareNativeTrainingTile,prepareNativeTrainingTilePieces,readNativeImage,readNativeTrainingRaster} from '../../tools/map-image/native-resample.mjs';

test('streamed PNG training pixels preserve color, alpha and EXIF orientation',async()=>{
  for(const name of ['rgb','rgba','gray-alpha','gray-alpha16','gray1','gray16','gray16-key','gray-key','palette-alpha','rgb-key','rgb16','rgba16',
    'orientation-2','orientation-3','orientation-4','orientation-5','orientation-6','orientation-7','orientation-8']){
    const path=`tests/fixtures/map-image/png-read/${name}.png`,bytes=await readFile(path),expectedSha256=createHash('sha256').update(bytes).digest('hex');
    const image=await readNativeImage({path,format:'png',maxPixels:16777216,expectedSha256});
    const actual=await readNativeTrainingRaster({path,format:'png',expectedSha256});
    assert.equal(actual.width,image.originalWidth,name+' width');assert.equal(actual.height,image.originalHeight,name+' height');
    const targetBits=Buffer.alloc(512*512),knownBits=Buffer.alloc(512*512,3);targetBits[0]=1;
    const original=await prepareNativeTrainingTile({image,targetBits,knownBits,x:0,y:0});
    const streamed=await prepareNativeTrainingTilePieces({image:actual,targetBits,knownBits,x:0,y:0});
    for(const field of ['tile','overview','position','target','valid'])assert.deepEqual(streamed[field],original[field],name+' '+field);
  }
});
test('training PNG supports interlace within the existing budget and rejects changed originals',async()=>{
  const path='tests/fixtures/map-image/png-read/adam7.png',bytes=await readFile(path),expectedSha256=createHash('sha256').update(bytes).digest('hex');
  const image=await readNativeImage({path,format:'png',maxPixels:16777216,expectedSha256});
  const streamed=await readNativeTrainingRaster({path,format:'png',expectedSha256});
  const targetBits=Buffer.alloc(512*512),knownBits=Buffer.alloc(512*512,3);
  const original=await prepareNativeTrainingTile({image,targetBits,knownBits,x:0,y:0});
  const actual=await prepareNativeTrainingTilePieces({image:streamed,targetBits,knownBits,x:0,y:0});
  for(const field of ['tile','overview','position','target','valid'])assert.deepEqual(actual[field],original[field],field);
  await assert.rejects(readNativeTrainingRaster({path,format:'png',expectedSha256:'0'.repeat(64)}),/hash/i);
});
test('streamed PNG handles a source above 16MP with alpha and edge padding',async()=>{
  const path='tests/fixtures/map-image/png-read/training-large.png',bytes=await readFile(path),expectedSha256=createHash('sha256').update(bytes).digest('hex');
  const actual=await readNativeTrainingRaster({path,format:'png',expectedSha256,x:4000,y:4000});
  const expected=await readNativeImage({path:'tests/fixtures/map-image/png-read/training-large-overview.png',format:'png',maxPixels:16777216});
  assert.equal(actual.width,4097);assert.equal(actual.height,4097);assert.deepEqual(actual.data,expected.data);
  assert.equal(createHash('sha256').update(actual.tile).digest('hex'),'570623f72781109f0c0519d0ecc45771a9ff9210c1e694536cd5aa28044b8406');
});
test('large Adam7 PNG preserves Pillow composite, overview and tile',async()=>{
  const path='tests/fixtures/map-image/png-read/training-large-adam7.png',bytes=await readFile(path),expectedSha256=createHash('sha256').update(bytes).digest('hex');
  const actual=await readNativeTrainingRaster({path,format:'png',expectedSha256,x:4000,y:4000});
  const expected=await readNativeImage({path:'tests/fixtures/map-image/png-read/training-large-adam7-overview.png',format:'png',maxPixels:16777216});
  assert.equal(actual.width,4097);assert.equal(actual.height,4097);assert.equal(Buffer.compare(actual.data,expected.data),0);
  assert.equal(createHash('sha256').update(actual.tile).digest('hex'),'72ad5058355a30ef0477b24d7b97906602b5abb9b8324e6fe6ea6916703a3e28');
});
