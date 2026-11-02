import assert from 'node:assert/strict';
import {copyFile,mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {prepareHydroRiverSources} from '../../tools/gis/hydro-calibration-input.mjs';

test('river source discovery fingerprints requested original members and rejects duplicates',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-input-'));t.after(()=>rm(root,{recursive:true}));
  const source=join(root,'source');await mkdir(source);
  for(const ext of ['shp','shx','dbf'])await copyFile(`tests/fixtures/hydro-selection-oracle.${ext}`,join(source,`HydroRIVERS_v10_eu.${ext}`));
  await writeFile(join(source,'HydroRIVERS_v10_eu.prj'),'test projection');
  const result=await prepareHydroRiverSources({riverRoots:[root],codes:['eu']});
  assert.equal(result.length,1);assert.equal(result[0].specification.datasetCode,'eu');
  assert.deepEqual(result[0].sourceFiles.map(row=>row.file),['HydroRIVERS_v10_eu.shp','HydroRIVERS_v10_eu.shx',
    'HydroRIVERS_v10_eu.dbf','HydroRIVERS_v10_eu.prj']);
  assert.ok(result[0].sourceFiles.every(row=>/^[a-f0-9]{64}$/.test(row.sha256)));
  const duplicate=join(root,'duplicate');await mkdir(duplicate);
  await copyFile(join(source,'HydroRIVERS_v10_eu.shp'),join(duplicate,'HydroRIVERS_v10_eu.shp'));
  await assert.rejects(prepareHydroRiverSources({riverRoots:[root],codes:['eu']}),/exactly one/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(prepareHydroRiverSources({riverRoots:[root],codes:['eu'],signal:controller.signal}),{name:'AbortError'});
});
