import assert from 'node:assert/strict';
import test from 'node:test';
import {surfaceReflectance,classifyLandsatWater,usableScenes,
  calculateWaterMask,waterPathConnected} from '../../tools/gis/baikonur-landsat-water-mask.mjs';

const scene=(id,cloud,date='2025-07-10T00:00:00Z',collection='landsat-c2-l2')=>({
  id,collection,properties:{datetime:date,'eo:cloud_cover':cloud},
  assets:Object.fromEntries(['green','nir08','qa_pixel'].map(key=>
    [key,{href:'https://landsatlook.blob.core.windows.net/landsat/'+id+'_'+key+'.TIF'}])),
});
test('USGS L2 offsets are mandatory, not raw DN NDWI',()=>{
 assert.equal(surfaceReflectance(0),null);
 assert(Math.abs(surfaceReflectance(10000)-.075)<1e-10);
 assert(Math.abs(surfaceReflectance(20000)-.35)<1e-10);
 const water=classifyLandsatWater(11500,8200,128);
 assert.equal(water.valid,true);
 assert.equal(water.water,true);
 const land=classifyLandsatWater(12000,16800,0);
 assert.equal(land.valid,true);
 assert.equal(land.water,false);
 assert.equal(classifyLandsatWater(11500,8200,128|8).water,false);
 assert.equal(classifyLandsatWater(11500,8200,128|16).valid,false);
 assert.equal(classifyLandsatWater(11500,8200,128|32).valid,false);
 assert.equal(classifyLandsatWater(0,8200,128).valid,false);
});
test('scene discovery excludes non-public signed assets, winter and clouds before spectral work',()=>{
 const ok=scene('LC09_STAC_OK',3),winter=scene('LC08_WINTER',0,'2025-01-10T00:00:00Z'),
  cloud=scene('LC08_CLOUDS',65),external=scene('LC08_EXTERNAL',1);
 external.assets.green.href='s3://private-bucket/green.tif';
 assert.deepEqual(usableScenes([cloud,ok,external,winter]).map(x=>x.id),['LC09_STAC_OK']);
 assert.deepEqual(usableScenes([scene('LC09_OLD',1,'2019-08-01T00:00:00Z'),ok],
  '2025-05-01T00:00:00Z/2025-09-30T23:59:59Z').map(x=>x.id),['LC09_STAC_OK']);
});
test('three prealigned GDAL UTM rasters produce honest water/valid counts',()=>{
 const pack=values=>{const raw=Buffer.alloc(values.length*2);values.forEach((v,i)=>raw.writeUInt16LE(v,i*2));
 return {data:raw,info:{size:[3,2],geoTransform:[400000,30,0,5100000,0,-30]}};};
 const a=pack([11500,12000,0,11500,12000,11500]);
 const b=pack([8200,16800,0,8200,16800,8200]);
 const q=pack([128,0,0,128|8,0,128]);
 const data=calculateWaterMask(a,b,q);
 assert.equal(data.valid,4);
 assert.equal(data.water,2);
 assert.deepEqual([...data.mask],[1,0,0,0,0,1]);
 assert.equal(data.width,3);
 assert.equal(data.height,2);
 const shifted={...b,info:{...b.info,geoTransform:[400001,30,0,5100000,0,-30]}};
 assert.throws(()=>calculateWaterMask(a,shifted,q),/exactly identical/);
});
test('channel connectivity uses independent pixel water mask and 8-way continuity',()=>{
 const mask=new Uint8Array(10*6);
 for(let x=0;x<9;x++)mask[2*10+x]=1;
 mask[3*10+9]=1;
 assert.equal(waterPathConnected(mask,10,6,[0,2],[9,3]),true);
 mask[2*10+5]=0;
 assert.equal(waterPathConnected(mask,10,6,[0,2],[9,3]),false);
 assert.equal(waterPathConnected(mask,10,6,[0,2],[20,2]),false);
});
