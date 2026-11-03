#!/usr/bin/env node
// Verify exact original bytes from a separately hosted mirror only against pinned HydroRIVERS v1 hashes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
const SHA=/^[0-9a-f]{64}$/;
async function digest(file){
  const first=await stat(file);assert(first.isFile()&&first.size>0,'Missing original');
  let size=0;const h=createHash('sha256');
  for await(const bytes of createReadStream(file)){size+=bytes.length;h.update(bytes);}
  const after=await stat(file);assert(size===first.size&&after.size===first.size&&after.mtimeMs===first.mtimeMs,'Changed original');
  return {bytes:size,sha256:h.digest('hex')};
}
async function fetchJson(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  assert(response.ok,'Source listing HTTP '+response.status);
  return response.json();
}
export async function inspectHydroEuropeanMirror({manifest,directory}={}){
  const region=manifest?.sources?.hydroRivers?.find(r=>r.datasetCode==='eu');
  assert(region?.files?.length===4,'Expected pinned EU original source receipts');
  const tree=await fetchJson('https://huggingface.co/api/datasets/cassini-team-todo/hydro-rivers-europe/tree/main?recursive=true');
  assert(Array.isArray(tree),'Public mirror file listing required');
  const files=[],source=[];
  for(const type of ['shp','shx','dbf','prj']){
    const name='HydroRIVERS_v10_eu.'+type,entry=region.files.find(f=>f.file===name);
    assert(entry&&SHA.test(entry.sha256),'Pinned EU source receipt missing');
    const selected=tree.filter(x=>x?.type==='file'&&basename(x.path||'')===name);
    assert(selected.length===1,'Unambiguous EU mirror source required: '+name);
    source.push({filename:name,path:selected[0].path,sha256:entry.sha256,mirrorUrl:'https://huggingface.co/datasets/cassini-team-todo/hydro-rivers-europe/resolve/main/'+selected[0].path+'?download=true'});
  }
  const list={schema:'pando-p1-eu-source-mirror-list-v1',files:source};
  if(!directory)return list;
  for(const item of source){
    const path=join(resolve(directory),item.filename),actual=await digest(path);
    assert.equal(actual.sha256,item.sha256,'Independent mirror differs from pinned official HydroRIVERS original: '+item.filename);
    files.push({name:item.filename,...actual,mirrorPath:item.path});
  }
  return {schema:'pando-p1-hydro-original-mirror-europe-v1',region:'eu',exactPinnedSourceMembers:4,
    unchangedOriginBytes:true,source:'Third-party public mirror; validated against 4 previously pinned official SHA-256 receipts',
    files,otherEightRegionsCompared:false,allNineRegionsCompared:false,releaseFilesModified:false};
}
if(import.meta.url==='file://'+process.argv[1]){
  // This comparison is explicitly not treated as official archive availability.
  try{
    const {values}=parseArgs({options:{manifest:{type:'string'},output:{type:'string'},directory:{type:'string'}}});
    assert(values.manifest&&values.output,'--manifest and --output required');
    const manifest=JSON.parse(await readFile(resolve(values.manifest),'utf8'));
    const result=await inspectHydroEuropeanMirror({manifest,directory:values.directory});
    await mkdir(resolve(values.output,'..'),{recursive:true});
    await writeFile(resolve(values.output),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('P1_EU_MIRROR='+JSON.stringify(result));
  }catch(error){console.error('P1 EU mirror: '+error.stack);process.exitCode=1;}
}
