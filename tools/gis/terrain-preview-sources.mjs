// Pinned source and cache management for the DEM-derived terrain preview.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {containedPath} from '../library-content.mjs';

export const TERRAIN_LAND_MASK_SHA256='52590ce133a779fc678496844c844137aeaa0dca41ceca1621cd7c50169f5efb';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function pin(spec){return Number.isSafeInteger(spec?.bytes)&&spec.bytes>0&&spec.bytes<=32000000&&/^[a-f0-9]{64}$/.test(spec.sha256||'');}
export function validateTerrainPreviewSources({dem,inventory,countryBytes,landMaskSha256=TERRAIN_LAND_MASK_SHA256}){
  if(dem?.version!=='0.13.3'||dem.representation!=='dem-relief-v1'||!(countryBytes instanceof Uint8Array)||sha(countryBytes)!==landMaskSha256)
    throw Error('DEM or land mask pin changed');
  if(!Array.isArray(dem.levels)||dem.levels.length<2||!Array.isArray(inventory?.assets))throw Error('Preview DEM source pins are incomplete');
  const required=new Set(['terrain/v0.13.3/tint.webp']);
  for(const [index,level] of dem.levels.slice(0,2).entries()){
    if(level.id!==index||![level.rows,level.columns].every(value=>Number.isSafeInteger(value)&&value>0&&value<=1000))
      throw Error('Invalid preview DEM levels');
    for(let row=0;row<level.rows;row++)for(let column=0;column<level.columns;column++)required.add(`terrain/v0.13.0/${level.id}/${column}-${row}.webp`);
  }
  const assets=new Map();for(const item of inventory.assets){if(!pin(item)||!required.has(item.path)||assets.has(item.path))
      throw Error('Preview DEM source pins are incomplete or invalid');assets.set(item.path,item);}
  if(assets.size!==required.size)throw Error('Preview DEM source pins are incomplete');
  if(dem.tint?.sha256!==assets.get('terrain/v0.13.3/tint.webp').sha256)throw Error('DEM tint pin changed');
  return {dem,assets,countries:JSON.parse(Buffer.from(countryBytes).toString('utf8'))};
}
export async function readPinnedTerrainAsset({cache,path,url,spec,fetcher=fetch,signal}){
  signal?.throwIfAborted();
  if(typeof cache!=='string'||!cache||typeof path!=='string'||!path||path.includes('\\')||!/^https:\/\//.test(url||'')||!pin(spec)||typeof fetcher!=='function')
    throw Error('Explicit pinned terrain source and cache path required');
  const target=containedPath(cache,path);
  if(existsSync(target)){
    const info=lstatSync(target);if(!info.isFile()||info.size!==spec.bytes)throw Error('Cached DEM source differs from its pin: '+path);
    const data=readFileSync(target);if(sha(data)!==spec.sha256)throw Error('Cached DEM source differs from its pin: '+path);return data;
  }
  const timeout=AbortSignal.timeout(60000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await fetcher(url,{headers:{'User-Agent':'Pando-terrain-preview-builder/1'},signal:requestSignal});
  if(!response.ok||!response.body)throw Error('Terrain source download failed: '+response.status);
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){signal?.throwIfAborted();const item=await reader.read();if(item.done)break;
    length+=item.value.length;if(length>spec.bytes)throw Error('Terrain source exceeds pinned size');chunks.push(Buffer.from(item.value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const data=Buffer.concat(chunks,length);if(data.length!==spec.bytes||sha(data)!==spec.sha256)throw Error('Downloaded DEM source differs from its pin: '+path);
  signal?.throwIfAborted();mkdirSync(dirname(target),{recursive:true});if(containedPath(cache,path)!==target)throw Error('Terrain cache path changed');
  writeFileSync(target,data,{flag:'wx'});return data;
}
