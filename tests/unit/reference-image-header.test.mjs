import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {inspectNativeImageHeader} from '../../tools/map-image/native-resample.mjs';

test('image metadata preserves encoded and EXIF-oriented sizes without decoding pixels',async()=>{
  for(const format of ['png','jpeg','webp'])for(const orientation of [2,3,4,5,6,7,8]){
    const folder=`tests/fixtures/map-image/${format}-read/orientation-${orientation}`;
    const expected=JSON.parse(readFileSync(folder+'.json','utf8')).expected;
    const actual=await inspectNativeImageHeader(readFileSync(folder+'.'+(format==='jpeg'?'jpg':format)),format);
    assert.deepEqual(actual,{format,encodedSize:expected.mapping.encodedSize,orientation,
      size:[expected.originalWidth,expected.originalHeight]},`${format} orientation ${orientation}`);
  }
});
test('image metadata rejects invalid data and declared format mismatch',async()=>{
  const image=readFileSync('tests/fixtures/map-image/png-read/orientation-6.png');
  await assert.rejects(inspectNativeImageHeader(image,'jpeg'),/image|jpeg/i);
  await assert.rejects(inspectNativeImageHeader(Buffer.from('broken'),'png'),/image|png/i);
  await assert.rejects(inspectNativeImageHeader(image,'pdf'),/format/i);
});
