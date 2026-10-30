import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareNativeTrainingTile, prepareNativeTrainingTilePieces, readNativeImage, readNativeTrainingJpegOverview, resizeNativeOpaqueBilinear } from '../../tools/map-image/native-resample.mjs';

test('streamed JPEG training overview preserves orientation and original Pillow pixels', async () => {
  for(const name of ['rgb','progressive','orientation-2','orientation-3','orientation-4','orientation-5','orientation-6','orientation-7','orientation-8','gray','cmyk']){
    const path=`tests/fixtures/map-image/jpeg-read/${name}.jpg`,bytes=await readFile(path);
    const expectedSha256=createHash('sha256').update(bytes).digest('hex');
    const image=await readNativeImage({path,format:'jpeg',maxPixels:16777216,expectedSha256});
    const expected=await resizeNativeOpaqueBilinear(image,[256,256]);
    const actual=await readNativeTrainingJpegOverview({path,expectedSha256});
    assert.equal(actual.width,image.originalWidth,name+' width');assert.equal(actual.height,image.originalHeight,name+' height');
    assert.deepEqual(actual.data,expected.data,name+' pixels');
    const targetBits=Buffer.alloc(512*512),knownBits=Buffer.alloc(512*512,3);
    targetBits[0]=1;
    const original=await prepareNativeTrainingTile({image,targetBits,knownBits,x:0,y:0,augment:true,epoch:1,index:2});
    const streamed=await prepareNativeTrainingTilePieces({image:actual,targetBits,knownBits,x:0,y:0,augment:true,epoch:1,index:2});
    for(const field of ['tile','overview','position','target','valid'])assert.deepEqual(streamed[field],original[field],name+' '+field);
  }
});

test('streamed JPEG rejects changed originals', async () => {
  const path='tests/fixtures/map-image/jpeg-read/orientation-6.jpg',bytes=await readFile(path);
  const expectedSha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal((await readNativeTrainingJpegOverview({path,expectedSha256})).orientation,6);
  await assert.rejects(readNativeTrainingJpegOverview({path,expectedSha256:'0'.repeat(64)}),/hash/i);
});

test('streamed JPEG reads a source above 16MP without changing its bytes', async () => {
  const path='tests/fixtures/map-image/jpeg-read/training-large.jpg',before=await readFile(path);
  const expectedSha256=createHash('sha256').update(before).digest('hex');
  const result=await readNativeTrainingJpegOverview({path,expectedSha256,x:4000,y:4000});
  assert.equal(result.width,4097);assert.equal(result.height,4097);
  assert.deepEqual(result.data,await readFile('tests/fixtures/map-image/jpeg-read/training-large-overview.rgba'));
  assert.equal(createHash('sha256').update(result.tile).digest('hex'),'60b03c89e90dd89325c6c59068844c8157d2ec90b1bc8389ff4e12af341d46f3');
  assert.deepEqual(await readFile(path),before);
});

test('streamed JPEG rotates a source above 16MP before computing its overview', async t => {
  const directory=await mkdtemp(join(tmpdir(),'pando-large-rotated-'));t.after(()=>rm(directory,{recursive:true}));
  const original=await readFile('tests/fixtures/map-image/jpeg-read/training-large.jpg');
  const exif=Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000','hex');
  const marker=Buffer.alloc(4);marker[0]=255;marker[1]=225;marker.writeUInt16BE(exif.length+2,2);
  const bytes=Buffer.concat([original.subarray(0,2),marker,exif,original.subarray(2)]),path=join(directory,'rotated.jpg');
  await writeFile(path,bytes);const expectedSha256=createHash('sha256').update(bytes).digest('hex');
  const result=await readNativeTrainingJpegOverview({path,expectedSha256,x:4000,y:4000});
  assert.equal(result.orientation,6);assert.equal(result.width,4097);assert.equal(result.height,4097);
  assert.deepEqual(result.data,await readFile('tests/fixtures/map-image/jpeg-read/training-large-rotated-overview.rgba'));
  assert.equal(createHash('sha256').update(result.tile).digest('hex'),'c120a76c554320e0b5151bf6ccb107f8ec7457e5ce01bd7d3dc0024acfc7bc17');
  assert.deepEqual(await readFile(path),bytes);
});
