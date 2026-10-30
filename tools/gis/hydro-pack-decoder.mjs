// Use the production Hydro worker decoder for privately generated packs.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {buildFrontendIndex,frontendAsset} from '../../scripts/lib/frontend-layout.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export function createHydroWorkerDecoder(manifest,{root=defaultRoot}={}){
  const context=vm.createContext({TextDecoder,URL,performance,structuredClone,inputManifest:manifest});
  context.self=context;context.onmessage=null;context.importScripts=()=>{};
  const index=buildFrontendIndex(root);
  for(const file of ['vendor/earcut.min.js','workers/geographic-boundary-core.js','workers/hydro-tile-worker.js']){
    const item=frontendAsset(root,'assets/js/'+file,{index});vm.runInContext(item.bytes.toString('utf8'),context,{filename:item.sourcePath});
  }
  vm.runInContext('manifest = inputManifest',context);
  return vm.runInContext('({readGlobalIndex,readFeatureMetadata,readPack,packSpecs,featureMetadata})',context);
}
export function decodeHydroGeneratedPack({files,layout,stages},{root=defaultRoot}={}){
  if(!(files instanceof Map)||!layout?.index||!layout.metadata?.core||!layout.metadata?.detail||
    !Array.isArray(layout.shards)||!Array.isArray(stages)||stages.length!==4)throw Error('Explicit Hydro pack files and layout required');
  const sha=data=>createHash('sha256').update(data).digest('hex');
  function read(spec){const data=files.get(spec.url);
    if(!Buffer.isBuffer(data)||data.length!==spec.bytes||sha(data)!==spec.sha256)throw Error('Hydro pack asset hash differs: '+spec.url);return data;}
  const decoder=createHydroWorkerDecoder({stages},{root});
  decoder.readGlobalIndex(gunzipSync(read(layout.index)));decoder.readFeatureMetadata(gunzipSync(read(layout.metadata.core)));
  const details=JSON.parse(gunzipSync(read(layout.metadata.detail)).toString('utf8'));
  if(details.version!==5||!Array.isArray(details.features))throw Error('Invalid Hydro detail metadata');
  const detailIds=new Set();for(const row of details.features){const meta=decoder.featureMetadata.get(row.fid);
    if(!meta||detailIds.has(row.fid))throw Error('Unknown or duplicate Hydro detail identity');detailIds.add(row.fid);Object.assign(meta,row);}
  if(detailIds.size!==decoder.featureMetadata.size)throw Error('Missing Hydro detail metadata');
  const shards=new Map(layout.shards.map(spec=>[spec.id,read(spec)])),seen=new Set(),features=[];
  for(const spec of decoder.packSpecs.values()){
    const shard=shards.get(spec.shard);if(!shard||spec.offset<0||spec.offset+spec.length>shard.length)throw Error('Invalid Hydro pack range');
    for(const feature of decoder.readPack(gunzipSync(shard.subarray(spec.offset,spec.offset+spec.length)),spec.id).features){
      const fid=feature.properties.__fid;if(seen.has(fid))throw Error('Duplicate Hydro feature identity');seen.add(fid);
      features.push({metadata:decoder.featureMetadata.get(fid),geometry:feature.geometry,widths:feature.properties.stroke_widths});
    }
  }
  if(seen.size!==layout.metadata.featureCount||seen.size!==decoder.featureMetadata.size)throw Error('Missing Hydro features');
  features.sort((a,b)=>a.metadata.fid-b.metadata.fid);return structuredClone(features);
}
