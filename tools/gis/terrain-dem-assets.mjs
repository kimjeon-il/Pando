import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

export function terrainAssetDigest(){
  const hash=createHash('sha256');
  return {
    add(path,sha256){if(typeof path!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid DEM asset digest');
      hash.update(path,'utf8').update(Buffer.from(sha256,'hex'));},
    finish(tintSha256){if(!/^[a-f0-9]{64}$/.test(tintSha256))throw Error('Invalid DEM tint digest');
      return hash.update(Buffer.from(tintSha256,'hex')).digest('hex');},
  };
}

async function fileDigest(path,signal){
  const before=await stat(path);if(!before.isFile())throw Error('DEM asset must be a file: '+path);
  const hash=createHash('sha256'),stream=createReadStream(path,{highWaterMark:1024*1024,signal});let bytes=0;
  for await(const chunk of stream){signal?.throwIfAborted();bytes+=chunk.length;hash.update(chunk);}
  const after=await stat(path);
  if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('DEM asset changed while reading: '+path);
  return {bytes,sha256:hash.digest('hex')};
}

export async function summarizeTerrainAssets(output,levels,{signal}={}){
  signal?.throwIfAborted();if(typeof output!=='string'||!output||!Array.isArray(levels)||!levels.length)throw Error('Explicit DEM output and levels required');
  const root=resolve(output),digest=terrainAssetDigest(),reports=[],seen=new Set();
  for(const level of levels){
    if(!Number.isSafeInteger(level?.id)||level.id<0||seen.has(level.id)||
      ![level.rows,level.columns].every(value=>Number.isSafeInteger(value)&&value>0&&value<=10000)||level.rows*level.columns>1000000)
      throw Error('Invalid DEM level');
    seen.add(level.id);let bytes=0,maxTileBytes=0;
    for(let row=0;row<level.rows;row++)for(let column=0;column<level.columns;column++){
      const path=`${level.id}/${column}-${row}.webp`,file=await fileDigest(resolve(root,path),signal);
      bytes+=file.bytes;maxTileBytes=Math.max(maxTileBytes,file.bytes);digest.add(path,file.sha256);
    }
    reports.push({level:level.id,tileCount:level.rows*level.columns,bytes,maxTileBytes});
  }
  const tint=await fileDigest(resolve(root,'tint.webp'),signal);
  return {assetsSha256:digest.finish(tint.sha256),reports};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values}=parseArgs({options:{output:{type:'string'},levels:{type:'string'}}});
    if(!values.output||!values.levels)throw Error('Expected --output and --levels');
    console.log(JSON.stringify(await summarizeTerrainAssets(values.output,JSON.parse(values.levels))));
  }catch(error){console.error('terrain-dem-assets: '+error.message);process.exitCode=1;}
}
