#!/usr/bin/env node
// Read-only prerequisite audit for an *exact* HydroRIVERS 9-region full reconstruction.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {gunzipSync} from 'node:zlib';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function auditHydroReconstructionInputs({manifest,archive,archiveRoot}={}){
  assert(manifest?.version==='0.13.4','Approved full Hydro version required');
  assert(archive?.files&&typeof archive.files==='object','A pinned compressed archive index is required');
  assert(typeof archiveRoot==='string','Pinned archive blob root required');
  const source=manifest.sources||{},refs=[...source.naturalEarthNameReference,
    {file:source.drainageFreeWaterMask?.file,sha256:source.drainageFreeWaterMask?.sha256}];
  const rows=[];
  for(const item of refs){
    assert(item&&typeof item.file==='string'&&/^[0-9a-f]{64}$/.test(item.sha256),'Invalid source identity receipt');
    const indexed=Object.entries(archive.files).filter(([name])=>name.endsWith('/'+item.file));
    const exact=indexed.find(([_,value])=>value.sha256===item.sha256);
    const orphan=join(resolve(archiveRoot),item.sha256+'.gz'),hasUnindexedBlob=existsSync(orphan);
    let orphanValid=false;
    if(hasUnindexedBlob){
      const raw=gunzipSync(await readFile(orphan));
      orphanValid=sha(raw)===item.sha256;
    }
    rows.push({original:item.file,sha256:item.sha256,indexedSourceMatches:!!exact,indexedSourceCandidates:indexed.map(([path,value])=>({path,sha256:value.sha256})),
      unindexedArchiveBlobVerified:orphanValid,canRecoverExactContent:!!exact||orphanValid});
  }
  const members=source.hydroRivers?.flatMap(r=>r.files.map(f=>({region:r.datasetCode,name:f.file,sha256:f.sha256})));
  assert(Array.isArray(members)&&members.length===36,'Expected exactly 36 HydroRIVERS original member receipts');
  const pinnedNames=new Set(Object.keys(archive.files));
  const memberStatuses=members.map(row=>({...row,presentInIndexedArchive:[...pinnedNames].some(k=>k.endsWith('/'+row.name)&&archive.files[k].sha256===row.sha256)}));
  return {schema:'pando-p1-hydro-reconstruction-inputs-v1',release:'0.13.4',
    baseInputStatuses:rows,expectedHydroRegionMembers:members.length,
    pinnedArchiveOfficialMembers:memberStatuses.filter(x=>x.presentInIndexedArchive).length,
    officialMemberStatuses:memberStatuses,completeSourceSetAvailable:rows.every(x=>x.canRecoverExactContent)&&memberStatuses.every(x=>x.presentInIndexedArchive),
    allNineRegionsReconstructed:false,publishedDataModified:false,limitations:[
      'Indexed archive and exact orphan blobs are not equivalent to a verified official archive download.',
      'No full reconstruction should run without all 36 original members and every original mask/reference hash.',
    ]};
}
if(import.meta.url==='file://'+process.argv[1]){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{manifest:{type:'string'},archive:{type:'string'},'archive-root':{type:'string'},output:{type:'string'}}});
    assert(!positionals.length&&values.manifest&&values.archive&&values['archive-root']&&values.output);
    const result=await auditHydroReconstructionInputs({manifest:JSON.parse(await readFile(resolve(values.manifest),'utf8')),
      archive:JSON.parse(await readFile(resolve(values.archive),'utf8')),archiveRoot:values['archive-root']});
    await writeFile(resolve(values.output),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('P1_HYDRO_RECONSTRUCTION_INPUTS='+JSON.stringify({
      sourceMatches:result.baseInputStatuses.filter(x=>x.canRecoverExactContent).length,
      sourceNeeded:result.baseInputStatuses.length,officialMembers:result.pinnedArchiveOfficialMembers,
      complete:result.completeSourceSetAvailable}));
  }catch(error){console.error('P1 Hydro source preflight failed: '+error.stack);process.exitCode=1;}
}
