// Verify an explicitly selected DEM dataset without modifying its source or outputs.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {readNativeRawWebp} from './map-image/native-resample.mjs';
import {verifyTerrainDemLevel} from './gis/terrain-dem-check.mjs';
import {sampleGdalDem} from './gis/terrain-dem-source.mjs';

const digest=data=>createHash('sha256').update(data).digest();
async function digestFile(path,signal){const hash=createHash('sha256'),stream=createReadStream(path,{highWaterMark:4*1024*1024,signal});
  for await(const chunk of stream){signal?.throwIfAborted();hash.update(chunk);}return hash.digest('hex');}
async function readBounded(path,limit,signal){const info=await stat(path);
  if(!info.isFile()||info.size<1||info.size>limit)throw Error('DEM asset exceeds its byte budget: '+path);
  const bytes=await readFile(path,{signal});if(bytes.length!==info.size)throw Error('DEM asset changed during reading: '+path);return bytes;}
export async function verifyTerrainDem({output,etopo,referenceOutput,gdalBinary,demDirectory,imageDirectory,signal}){
  signal?.throwIfAborted();if(typeof output!=='string'||!output||typeof etopo!=='string'||!etopo)throw Error('Explicit DEM output and source required');
  const root=resolve(output),source=resolve(etopo),manifestBytes=await readBounded(resolve(root,'manifest.json'),16*1024*1024,signal),
    manifest=JSON.parse(manifestBytes),sourceInfo=await stat(source);
  if(manifest?.representation!=='dem-relief-v1'||manifest.version!=='0.13.3'||manifest.shade?.quantizationStep!==4||
    !Array.isArray(manifest.levels)||!manifest.levels.length||!/^[a-f0-9]{64}$/.test(manifest.sources?.[0]?.sha256||'')||
    !/^[a-f0-9]{64}$/.test(manifest.tint?.sha256||'')||!/^[a-f0-9]{64}$/.test(manifest.assetsSha256||''))
    throw Error('Unexpected DEM manifest or source pins');
  if(await digestFile(source,signal)!==manifest.sources[0].sha256)throw Error('DEM source checksum mismatch');
  const options={...(demDirectory?{directory:demDirectory}:{}),signal},imageOptions={...(imageDirectory?{directory:imageDirectory}:{}),signal};
  const levelIds=new Set(),aggregate=createHash('sha256'),reports=[];
  for(const level of manifest.levels){
    if(levelIds.has(level.id))throw Error('Duplicate DEM level');levelIds.add(level.id);
    const readTile=async(column,row)=>{const path=resolve(root,String(level.id),`${column}-${row}.webp`),encoded=await readBounded(path,32*1024*1024,signal);
      return {...await readNativeRawWebp(encoded,imageOptions),encoded};};
    const readReference=referenceOutput?async(column,row)=>{
      const bytes=await readBounded(resolve(referenceOutput,String(level.id),`${column}-${row}.webp`),32*1024*1024,signal);return readNativeRawWebp(bytes,imageOptions);
    }:undefined;
    const result=await verifyTerrainDemLevel({level,readTile,readReference,shadeStep:4,
      sourceSample:(x,y)=>sampleGdalDem({source,x,y,...(gdalBinary?{binary:gdalBinary}:{}),signal})},options);
    for(const asset of result.assets)aggregate.update(asset.path,'utf8').update(Buffer.from(asset.sha256,'hex'));
    reports.push({level:result.level,tiles:result.tiles,bytes:result.bytes,maxTileBytes:result.maxTileBytes});
  }
  const tint=await readBounded(resolve(root,'tint.webp'),32*1024*1024,signal);
  if(digest(tint).toString('hex')!==manifest.tint.sha256)throw Error('DEM tint checksum mismatch');
  const tintImage=await readNativeRawWebp(tint,imageOptions);
  if(tintImage.width!==4096||tintImage.height!==2048)throw Error('Wrong DEM tint size');
  aggregate.update(digest(tint));if(aggregate.digest('hex')!==manifest.assetsSha256)throw Error('DEM asset checksum mismatch');
  const totalBytes=reports.reduce((sum,row)=>sum+row.bytes,0)+tint.length+manifestBytes.length;
  if(totalBytes>900*1024*1024)throw Error('DEM exceeds 900 MiB publication budget');
  const after=await stat(source);if(sourceInfo.size!==after.size||sourceInfo.mtimeMs!==after.mtimeMs)throw Error('DEM source changed during verification');
  return {verified:true,levels:reports,totalBytes};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values}=parseArgs({options:{output:{type:'string'},etopo:{type:'string'},'reference-output':{type:'string'},gdal:{type:'string'}}});
    const result=await verifyTerrainDem({...values,referenceOutput:values['reference-output'],gdalBinary:values.gdal,
      demDirectory:process.env.PANDO_TERRAIN_DEM_CHECK_DIRECTORY,imageDirectory:process.env.PANDO_MAP_IMAGE_ARTIFACT});
    console.log(JSON.stringify(result,null,2));}
  catch(error){console.error('terrain-dem-verify: '+error.message);process.exitCode=1;}
}
