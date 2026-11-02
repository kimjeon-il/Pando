// Load only the source sections needed for explicit Hydro systems or a geographic extent.
import {createHash} from 'node:crypto';
import {open,readFile,realpath,stat} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHydroWorkerDecoder,decodeHydroSelectedPack} from './hydro-pack-decoder.mjs';

async function localSource(root,url){
  if(typeof url!=='string'||!url||isAbsolute(url)||url.includes('\\')||url.split('/').some(part=>!part||part==='.'||part==='..'))
    throw Error('Invalid Hydro resource path');
  const path=await realpath(join(root,url)),rel=relative(root,path);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Hydro resource leaves its source directory');return path;
}
async function readResource(root,spec,signal){
  signal?.throwIfAborted();if(!spec||!Number.isSafeInteger(spec.bytes)||spec.bytes<0||spec.bytes>128*1024*1024||
    !Number.isSafeInteger(spec.offset??0)||(spec.offset??0)<0||!/^[a-f0-9]{64}$/.test(spec.sha256||''))throw Error('Invalid Hydro resource specification');
  const path=await localSource(root,spec.url),before=await stat(path),offset=spec.offset??0;
  if(!before.isFile()||offset+spec.bytes>before.size)throw Error('Hydro resource range exceeds source');
  const handle=await open(path,'r'),data=Buffer.alloc(spec.bytes);try{let done=0;
    while(done<data.length){signal?.throwIfAborted();const part=await handle.read(data,done,data.length-done,offset+done);
      if(!part.bytesRead)throw Error('Truncated Hydro resource');done+=part.bytesRead;}}
  finally{await handle.close();}
  const after=await stat(path);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||before.dev!==after.dev||
    createHash('sha256').update(data).digest('hex')!==spec.sha256)throw Error('Hydro resource changed or hash differs');return data;
}
export async function loadSelectedHydroFeatures({directory,bounds,logicalFids,signal}={}){
  signal?.throwIfAborted();if(typeof directory!=='string'||!directory||(bounds===undefined)===(logicalFids===undefined))
    throw Error('Explicit Hydro directory and one selection scope required');
  if(bounds!==undefined&&(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[2]<=bounds[0]||bounds[3]<=bounds[1]))
    throw Error('Invalid Hydro selection bounds');
  if(logicalFids!==undefined&&(!Array.isArray(logicalFids)||!logicalFids.length||logicalFids.some(id=>!Number.isSafeInteger(id)||id<0)||
    new Set(logicalFids).size!==logicalFids.length))throw Error('Explicit unique Hydro logical IDs required');
  const root=await realpath(resolve(directory)),manifestPath=await localSource(root,'manifest.json'),manifestBytes=await readFile(manifestPath,{signal});
  if(manifestBytes.length>1024*1024)throw Error('Hydro manifest exceeds byte budget');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));if(!manifest?.index||!manifest.metadata?.core||!manifest.metadata?.detail||
    !Array.isArray(manifest.shards)||!Array.isArray(manifest.stages)||manifest.stages.length!==4)throw Error('Invalid Hydro manifest');
  const files=new Map();for(const spec of [manifest.index,manifest.metadata.core,manifest.metadata.detail])
    files.set(spec.sha256,await readResource(root,spec,signal));
  const index=gunzipSync(files.get(manifest.index.sha256),{maxOutputLength:64*1024*1024}),
    core=gunzipSync(files.get(manifest.metadata.core.sha256),{maxOutputLength:64*1024*1024}),decoder=createHydroWorkerDecoder({stages:manifest.stages});
  decoder.readGlobalIndex(index);decoder.readFeatureMetadata(core);
  const ids=logicalFids??[...new Set([...decoder.featureMetadata.values()].filter(row=>{const b=row.bounds;
    if(!Array.isArray(b)||b.length!==4||b.some(value=>!Number.isFinite(value)))throw Error('Invalid Hydro selection metadata bounds');
    return !(b[2]/1e6<bounds[0]||b[0]/1e6>bounds[2]||b[3]/1e6<bounds[1]||b[1]/1e6>bounds[3]);}).map(row=>row.logicalFid))];
  if(!ids.length)throw Error('Selected Hydro scope has no features');
  const shardIds=new Set();for(const id of ids){const packs=decoder.logicalPacks.get(id);if(!packs?.length)throw Error('Selected Hydro logical ID missing');
    for(const pack of packs){const spec=decoder.packSpecs.get(pack);if(!spec)throw Error('Selected Hydro pack missing');shardIds.add(spec.shard);}}
  const shards=manifest.shards.filter(spec=>shardIds.has(spec.id));if(shards.length!==shardIds.size)throw Error('Selected Hydro shard missing');
  for(const spec of shards)files.set(spec.sha256,await readResource(root,spec,signal));
  const features=decodeHydroSelectedPack({files,layout:{...manifest,shards},stages:manifest.stages,logicalFids:ids});
  signal?.throwIfAborted();return {features,logicalFids:ids,shards:shards.map(row=>row.id)};
}
