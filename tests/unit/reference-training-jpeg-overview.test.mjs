import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readNativeImage, readNativeTrainingJpegOverview, resizeNativeOpaqueBilinear } from '../../tools/map-image/native-resample.mjs';

test('streamed JPEG training overview preserves orientation and original Pillow pixels', async () => {
  for(const name of ['rgb','progressive','orientation-2','orientation-3','orientation-4','gray','cmyk']){
    const path=`tests/fixtures/map-image/jpeg-read/${name}.jpg`,bytes=await readFile(path);
    const expectedSha256=createHash('sha256').update(bytes).digest('hex');
    const image=await readNativeImage({path,format:'jpeg',maxPixels:16777216,expectedSha256});
    const expected=await resizeNativeOpaqueBilinear(image,[256,256]);
    const actual=await readNativeTrainingJpegOverview({path,expectedSha256});
    assert.equal(actual.width,image.originalWidth,name+' width');assert.equal(actual.height,image.originalHeight,name+' height');
    assert.deepEqual(actual.data,expected.data,name+' pixels');
  }
});

test('streamed JPEG explicitly rejects unimplemented rotation and changed originals', async () => {
  const path='tests/fixtures/map-image/jpeg-read/orientation-6.jpg',bytes=await readFile(path);
  const expectedSha256=createHash('sha256').update(bytes).digest('hex');
  await assert.rejects(readNativeTrainingJpegOverview({path,expectedSha256}),/orientation/i);
  await assert.rejects(readNativeTrainingJpegOverview({path,expectedSha256:'0'.repeat(64)}),/hash/i);
});

test('streamed JPEG reads a source above 16MP without changing its bytes', async () => {
  const path='tests/fixtures/map-image/jpeg-read/training-large.jpg',before=await readFile(path);
  const expectedSha256=createHash('sha256').update(before).digest('hex');
  const result=await readNativeTrainingJpegOverview({path,expectedSha256});
  assert.equal(result.width,4097);assert.equal(result.height,4097);
  assert.deepEqual(result.data,await readFile('tests/fixtures/map-image/jpeg-read/training-large-overview.rgba'));
  assert.deepEqual(await readFile(path),before);
});
