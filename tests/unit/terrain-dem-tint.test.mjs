import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {sampleNativeDemTint} from '../../tools/gis/terrain-dem-tint.mjs';
const fixture=resolve('tests/fixtures/terrain-dem-tint');
const oracle=JSON.parse(await readFile(join(fixture,'oracle.json'),'utf8'));
test('native GDAL tint matches frozen Python small-island and ice pixels',async t=>{
  const root=await mkdtemp(join(tmpdir(),'dem-tint-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const request={source:join(fixture,'source.tif'),ice:join(fixture,'ice.geojson'),land:join(fixture,'land.geojson'),
    temporary:join(root,'masked.tif'),width:oracle.width,height:oracle.height};
  const result=await sampleNativeDemTint(request);
  assert.deepEqual([...result.rgb],oracle.rgb);assert.equal(result.validCells,oracle.report.validCells);
  assert.equal(result.regionalFillCells,oracle.report.regionalFillCells);
  await assert.rejects(sampleNativeDemTint(request),/exists|original/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(sampleNativeDemTint({...request,temporary:join(root,'unused.tif')},{signal:controller.signal}),{name:'AbortError'});
});
