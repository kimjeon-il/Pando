#!/usr/bin/env node
// Compare all nine official HydroRIVERS shapefile originals with the release's per-member digests.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const regions=['af','ar','as','au','eu','gr','na','sa','si'];
const types=['shp','shx','dbf','prj'];
async function digest(path){
  const before=await stat(path),sha=createHash('sha256');let bytes=0;
  assert(before.isFile()&&before.size>0,'Real Hydro original missing: '+path);
  for await(const chunk of createReadStream(path)){sha.update(chunk);bytes+=chunk.length;}
  const after=await stat(path);
  assert.equal(bytes,before.size,'Original source changed while reading');
  assert.equal(after.size,before.size,'Original source size changed');
  assert.equal(after.mtimeMs,before.mtimeMs,'Original source timestamp changed');
  return {bytes,sha256:sha.digest('hex')};
}
export async function auditHydroOriginals({manifest,originals}={}){
  assert(manifest&&typeof originals==='string','Pinned Hydro release and explicitly unpacked original root required');
  const source=manifest.sources?.hydroRivers;
  assert(Array.isArray(source)&&source.length===regions.length,'Hydro source region count changed');
  assert.deepEqual(source.map(r=>r.datasetCode),regions);
  let total=0;const rows=[];
  for(const region of source){
    assert(Array.isArray(region.files)&&region.files.length===4,'All four source members required: '+region.datasetCode);
    const audited=[];
    for(const type of types){
      const name='HydroRIVERS_v10_'+region.datasetCode+'.'+type;
      const reference=region.files.find(f=>f.file===name);
      assert(reference,'Hydro source receipt missing: '+name);
      const actual=await digest(join(resolve(originals),region.datasetCode,name));
      assert.equal(actual.sha256,reference.sha256,'Official Hydro original differs: '+name);
      audited.push({name,...actual});total+=actual.bytes;
    }
    rows.push({region:region.datasetCode,members:audited});
  }
  return {schema:'pando-p1-hydrorivers-nine-region-originals-v1',
    source:'HydroSHEDS official HydroRIVERS v1 shapefile archives',regions:regions.length,members:36,originalBytes:total,
    sourceMemberSha256Match:true,sourceBytesChanged:false,comparisons:rows,
    wholeRiverNetworkRegenerated:false,naturalEarthOriginalsAvailable:false,drainageMaskAvailable:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{manifest:{type:'string'},originals:{type:'string'},output:{type:'string'}}});
    assert(!positionals.length&&values.manifest&&values.originals&&values.output,'Usage: --manifest MANIFEST --originals DIR --output NEW-REPORT.json');
    const result=await auditHydroOriginals({manifest:JSON.parse(await readFile(resolve(values.manifest),'utf8')),originals:values.originals});
    await writeFile(resolve(values.output),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('P1_HYDRO_ORIGINALS='+JSON.stringify({regions:result.regions,members:result.members,originalBytes:result.originalBytes,matched:result.sourceMemberSha256Match}));
  }catch(error){console.error('P1 official HydroRIVERS originals validation failed: '+error.stack);process.exitCode=1;}
}
