// Use the production Hydro worker decoder for privately generated packs.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {buildFrontendIndex,frontendAsset} from '../../scripts/lib/frontend-layout.mjs';
import {pythonRound} from './hydro-numeric.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
// A caller supplies complete selected logical systems, not a global catalogue.
export function verifyHydroRiverGroups(features){
  if(!Array.isArray(features)||!features.length)throw Error('Selected Hydro river systems required');
  const groups=new Map(),fids=new Set(),allowed=new Set(['sea','lake','confluence','endorheic']);let terminals=0;
  const equal=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  for(const row of features){const meta=row?.metadata,geometry=row?.geometry;
    if(meta?.category!=='river'||!Number.isSafeInteger(meta.fid)||!Number.isSafeInteger(meta.logicalFid)||
      typeof meta.awId!=='string'||!meta.awId||fids.has(meta.fid))throw Error('Invalid or duplicate river identity');
    fids.add(meta.fid);
    if(!Number.isSafeInteger(meta.fragmentIndex)||!Number.isSafeInteger(meta.fragmentCount)||meta.fragmentIndex<0||
      meta.fragmentCount<1||meta.fragmentIndex>=meta.fragmentCount)throw Error('Invalid river fragment');
    if(!['mainstem','tributary'].includes(meta.role))throw Error('Invalid river role');
    const parts=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:null;
    if(!Array.isArray(parts)||!parts.length||parts.some(part=>!Array.isArray(part)||!part.length||part.some(point=>
      !Array.isArray(point)||point.length!==2||point.some(value=>!Number.isFinite(value)))))throw Error('Invalid river part geometry');
    for(let i=1;i<parts.length;i++)if(!equal(parts[i-1].at(-1),parts[i][0]))throw Error('River part connection differs');
    if(!Array.isArray(row.widths)||row.widths.length!==parts.length||row.widths.some((widths,part)=>!Array.isArray(widths)||widths.length!==parts[part].length||
      widths.some((width,i)=>!Number.isFinite(width)||width<0.55||width>2.6||(i>0&&width+1e-6<widths[i-1]))))
      throw Error('Invalid river width profile');
    if(meta.terminal){const terminal=meta.terminal,endpoint=terminal.renderEndpoint;
      if(!allowed.has(terminal.class)||!Array.isArray(endpoint)||endpoint.length!==2||endpoint.some(value=>!Number.isFinite(value))||
        !equal(parts.at(-1).at(-1),endpoint.map(value=>pythonRound(value*1000000,0)/1000000)))throw Error('Invalid river terminal');
      terminals++;}
    const group=groups.get(meta.logicalFid)||[];group.push({meta,parts});groups.set(meta.logicalFid,group);
  }
  for(const group of groups.values()){
    group.sort((a,b)=>a.meta.fragmentIndex-b.meta.fragmentIndex);const first=group[0].meta;
    if(group.some(row=>row.meta.awId!==first.awId))throw Error('Inconsistent logical river identity');
    if(group.length!==first.fragmentCount||group.some((row,index)=>row.meta.fragmentCount!==group.length||row.meta.fragmentIndex!==index))
      throw Error('Incomplete river fragments');
    if(group.filter(row=>row.meta.role==='mainstem'&&row.meta.terminal).length!==1)throw Error('River mainstem terminal must occur once');
    for(let i=1;i<group.length;i++){const left=group[i-1],right=group[i];
      if(!left.meta.terminal&&!equal(left.parts.at(-1).at(-1),right.parts[0][0]))throw Error('River fragment connection differs');}
  }
  return {systems:groups.size,fragments:features.length,terminals};
}
export function createHydroWorkerDecoder(manifest,{root=defaultRoot}={}){
  const context=vm.createContext({TextDecoder,URL,performance,structuredClone,inputManifest:manifest});
  context.self=context;context.onmessage=null;context.importScripts=()=>{};
  const index=buildFrontendIndex(root);
  for(const file of ['vendor/earcut.min.js','workers/geographic-boundary-core.js','workers/hydro-tile-worker.js']){
    const item=frontendAsset(root,'assets/js/'+file,{index});vm.runInContext(item.bytes.toString('utf8'),context,{filename:item.sourcePath});
  }
  vm.runInContext('manifest = inputManifest',context);
  return vm.runInContext('({readGlobalIndex,readFeatureMetadata,readPack,packSpecs,logicalPacks,featureMetadata})',context);
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

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--verify-river-groups')throw Error('Expected --verify-river-groups');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;
      if(size>128*1024*1024)throw Error('Selected river systems exceed byte budget');chunks.push(chunk);}
    console.log(JSON.stringify(verifyHydroRiverGroups(JSON.parse(Buffer.concat(chunks,size).toString('utf8')))));
  }catch(error){console.error('Hydro river groups:',error.message);process.exitCode=1;}
}
