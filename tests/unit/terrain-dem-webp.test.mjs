import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';
import {encodeDemWebp} from '../../tools/gis/terrain-dem-webp.mjs';

test('DEM WebP preserves all RGBA values including transparent RGB',async()=>{
  const image={width:3,height:2,data:Buffer.from([0,0,0,0,21,45,67,0,0,255,23,255,12,34,56,128,255,255,255,255,42,35,28,1])};
  const first=await encodeDemWebp(image),second=await encodeDemWebp(image);
  assert.deepEqual(first,second);
  const decoded=await readNativeRawWebp(first);
  assert.equal(decoded.width,image.width);assert.equal(decoded.height,image.height);assert.deepEqual(decoded.data,image.data);
  await assert.rejects(encodeDemWebp({...image,data:Buffer.alloc(4)}),/length|dimensions/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(encodeDemWebp(image,{signal:controller.signal}),{name:'AbortError'});
});
