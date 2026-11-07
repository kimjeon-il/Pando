import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import test from 'node:test';
import {sampleGdalDem} from '../../tools/gis/terrain-dem-source.mjs';

test('DEM source samples require explicit finite pixel coordinates',async()=>{
  await assert.rejects(sampleGdalDem({source:'fixture',x:-1,y:0}),/coordinate/i);
  await assert.rejects(sampleGdalDem({source:'fixture',x:0,y:NaN}),/coordinate/i);
});
test('GDAL reads the selected source pixel without opening a QGIS window',{
  skip:!process.env.PANDO_GDAL_LOCATIONINFO,
},async()=>{
  const source=resolve('tests/fixtures/terrain-dem/synthetic-elevation.tif');
  assert.equal(await sampleGdalDem({source,x:1,y:1}),2);
  await assert.rejects(sampleGdalDem({source,x:100,y:100}),/sample|outside|numeric/i);
});
