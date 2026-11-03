import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {auditHydroOriginals} from '../../tools/gis/verify-p1-hydro-originals.mjs';

const regions=['af','ar','as','au','eu','gr','na','sa','si'];
const kinds=['shp','shx','dbf','prj'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('P1 official nine-region audit compares every one of 36 source members',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pando-p1-hydro-originals-'));
  try{
    const receipts=[];
    for(const code of regions){
      await mkdir(join(root,code));
      const files=[];
      for(const kind of kinds){
        const name='HydroRIVERS_v10_'+code+'.'+kind,content=Buffer.from('immutable source '+code+' '+kind);
        await writeFile(join(root,code,name),content,{flag:'wx'});
        files.push({file:name,sha256:sha(content)});
      }
      receipts.push({datasetCode:code,files});
    }
    const manifest={sources:{hydroRivers:receipts}};
    const passed=await auditHydroOriginals({manifest,originals:root});
    assert.equal(passed.regions,9);
    assert.equal(passed.members,36);
    assert.equal(passed.sourceMemberSha256Match,true);
    assert.equal(passed.wholeRiverNetworkRegenerated,false);
    await writeFile(join(root,'eu','HydroRIVERS_v10_eu.dbf'),'different bytes');
    await assert.rejects(auditHydroOriginals({manifest,originals:root}),/Official Hydro original differs/);
    await assert.rejects(auditHydroOriginals({manifest:{sources:{hydroRivers:receipts.slice(1)}},originals:root}),/region count/);
  }finally{await rm(root,{recursive:true,force:true});}
});
