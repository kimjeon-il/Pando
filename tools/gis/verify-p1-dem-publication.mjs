#!/usr/bin/env node
// Byte-for-byte whole published DEM audit. Native pixel/seam/original checks run separately.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {summarizeTerrainAssets} from './terrain-dem-assets.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyPublishedDem({directory}={}){
  assert(typeof directory==='string'&&directory,'Explicit full published DEM directory required');
  const root=resolve(directory),manifestBytes=await readFile(join(root,'manifest.json')),manifest=JSON.parse(manifestBytes);
  assert.equal(manifest.version,'0.13.3');
  assert.equal(manifest.representation,'dem-relief-v1');
  assert.equal(manifest.sources?.[0]?.sha256,'8630abc401cc6bdd30b507a68d3eb9eda5b65f5636f7199e4b1eefd476b5a9e2');
  assert.equal(manifest.sources[0].bytes,1585813987);
  assert.deepEqual(manifest.levels.map(l=>[l.id,l.columns,l.rows]),[[0,2,1],[1,3,2],[2,6,3],[3,11,6],[4,22,11],[5,43,22]]);
  assert.equal(manifest.tint.sha256,'1ae4c70e05494917c11d3c6b32869db61bf4f9e7e4b0239f9b4bd2b9bec582f3');
  const expected=new Set(['manifest.json','tint.webp',...manifest.levels.map(l=>String(l.id))]);
  assert.deepEqual(new Set(await readdir(root)),expected,'Unexpected published DEM root members');
  let expectedTiles=0;
  for(const level of manifest.levels){
    const actual=new Set(await readdir(join(root,String(level.id)))),files=new Set();
    for(let y=0;y<level.rows;y++)for(let x=0;x<level.columns;x++)files.add(x+'-'+y+'.webp');
    assert.deepEqual(actual,files,'Missing or unexpected DEM tiles at LOD '+level.id);
    expectedTiles+=files.size;
  }
  assert.equal(expectedTiles,1280,'DEM must audit every published tile');
  const audit=await summarizeTerrainAssets(root,manifest.levels);
  assert.equal(audit.assetsSha256,manifest.assetsSha256,'DEM complete asset aggregate differs');
  const tint=await readFile(join(root,'tint.webp'));
  assert.equal(sha(tint),manifest.tint.sha256,'DEM tint changed');
  const totalBytes=audit.reports.reduce((s,r)=>s+r.bytes,0)+tint.length+manifestBytes.length;
  assert(totalBytes<900*1024*1024,'DEM publication budget exceeded');
  assert.equal((await stat(join(root,'manifest.json'))).size,manifestBytes.length);
  return {schema:'pando-p1-dem-real-publication-v1',sourceCategory:'published-real-data',
    version:manifest.version,manifestSha256:sha(manifestBytes),assetDigest:audit.assetsSha256,
    sourceEtopoSha256Declared:manifest.sources[0].sha256,
    levels:manifest.levels.length,tiles:expectedTiles,tintBytes:tint.length,totalBytes,reports:audit.reports,
    allPublishedBytesAndPathsChecked:true,originalEtopoCompared:false,allNativePixelSeamsChecked:false,
    entireOriginalDemRegenerated:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{directory:{type:'string'},output:{type:'string'}}});
    assert(!positionals.length&&values.directory&&values.output,'Usage: --directory DIR --output NEW-REPORT.json');
    const result=await verifyPublishedDem({directory:values.directory});
    await writeFile(resolve(values.output),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('P1_DEM_PUBLISHED='+JSON.stringify(result));
  }catch(error){console.error('P1 DEM real publication validation failed: '+error.stack);process.exitCode=1;}
}
