// Plan Hydro v4 pack ownership and raw binary layout without touching runtime assets.
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {encodeHydroGzip,prepareHydroEncodingFeatures} from './hydro-encoding-native.mjs';

const grids=[[8,4],[16,8],[32,16],[64,32]],packLimit=512*1024;
const key=(stage,x,y)=>`${stage},${x},${y}`;
const order=(a,b)=>a.stage-b.stage||a.x-b.x||a.y-b.y;
const clamp=(value,max)=>Math.min(max-1,Math.max(0,Math.trunc(value)));
function coordinateCount(geometry){
  const {type,coordinates:c}=geometry||{};
  if(type==='LineString'&&Array.isArray(c))return c.length;
  if((type==='MultiLineString'||type==='Polygon')&&Array.isArray(c))return c.reduce((sum,line)=>sum+line.length,0);
  if(type==='MultiPolygon'&&Array.isArray(c))return c.reduce((sum,polygon)=>sum+polygon.reduce((n,line)=>n+line.length,0),0);
  throw Error('Supported Hydro geometry required');
}
export function planHydroPackGroups({features,encoded,changedFeatureIds}){
  if(!Array.isArray(features)||!features.length||!Array.isArray(encoded)||encoded.length!==features.length)
    throw Error('Matching Hydro features and encoded bytes required');
  const prepared=prepareHydroEncodingFeatures(features,changedFeatureIds),groups=new Map(),memberships=new Map();
  const categoryCounts={},layerCounts={},stageCounts={};let coordinates=0;
  for(let i=0;i<prepared.length;i++){
    const feature=prepared[i],meta=features[i].metadata,item=encoded[i],stage=feature.stage;
    if(!Number.isInteger(stage)||!grids[stage]||!item||item.fid!==feature.fid||item.logicalFid!==feature.logical_fid||
      !Buffer.isBuffer(item.feature)||item.feature.length<44||item.feature.readUInt32LE(0)!==feature.fid||
      item.feature.readUInt32LE(4)!==feature.logical_fid||item.feature.readUInt8(9)!==stage||
      !Number.isSafeInteger(item.logicalFid)||item.logicalFid<0||item.logicalFid>0xffffffff||
      typeof meta.layerId!=='string')throw Error('Hydro encoded feature identity or stage differs');
    const [width,height]=grids[stage],[west,south,east,north]=feature.bounds;
    const x=clamp(((west+east)/2+180)/360*width,width),y=clamp((90-(south+north)/2)/180*height,height),id=key(stage,x,y);
    if(!groups.has(id))groups.set(id,{stage,x,y,rows:[]});groups.get(id).rows.push(item);
    const minX=clamp((west+180)/360*width,width),maxX=clamp((east+180-1e-9)/360*width,width);
    const minY=clamp((90-north)/180*height,height),maxY=clamp((90-south-1e-9)/180*height,height);
    for(let tileY=minY;tileY<=maxY;tileY++)for(let tileX=minX;tileX<=maxX;tileX++){
      const tileKey=key(stage,tileX,tileY);if(!memberships.has(tileKey))memberships.set(tileKey,{stage,x:tileX,y:tileY,fids:new Set()});
      memberships.get(tileKey).fids.add(feature.fid);
    }
    coordinates+=coordinateCount(feature.geometry);categoryCounts[feature.category]=(categoryCounts[feature.category]||0)+1;
    layerCounts[meta.layerId]=(layerCounts[meta.layerId]||0)+1;const stageKey=feature.category+':'+stage;stageCounts[stageKey]=(stageCounts[stageKey]||0)+1;
  }
  const packs=[];
  function emit(group,rows){const header=Buffer.alloc(12);header.write('AWHF',0,'ascii');header.writeUInt16LE(4,4);
    header.writeUInt16LE(group.stage,6);header.writeUInt32LE(rows.length,8);
    packs.push({id:packs.length,stage:group.stage,owner:[group.x,group.y],fids:rows.map(row=>row.fid),
      logicalFids:rows.map(row=>row.logicalFid),raw:Buffer.concat([header,...rows.map(row=>row.feature)])});}
  for(const group of [...groups.values()].sort(order)){
    let rows=[],size=0;for(const row of group.rows){if(rows.length&&size+row.feature.length>packLimit){emit(group,rows);rows=[];size=0;}
      rows.push(row);size+=row.feature.length;}if(rows.length)emit(group,rows);
  }
  return {packs,memberships:[...memberships.values()].sort(order),coordinateCount:coordinates,categoryCounts,layerCounts,stageCounts,prepared};
}

function halfEven(value){const lower=Math.floor(value),fraction=value-lower;
  const result=lower+(fraction>0.5||(fraction===0.5&&lower%2!==0)?1:0);return result===0?0:result;}
function present(value){return value!==null&&value!==undefined&&value!==false&&value!==''&&
  !(Array.isArray(value)&&!value.length)&&!(typeof value==='object'&&!Array.isArray(value)&&!Object.keys(value).length);}
export function buildHydroMetadata(features,prepared){
  if(!Array.isArray(features)||!Array.isArray(prepared)||features.length!==prepared.length)throw Error('Matching Hydro metadata and prepared features required');
  const rows=features.map((feature,i)=>{const meta=feature?.metadata,encoded=prepared[i];
    if(!meta||!encoded||meta.fid!==encoded.fid||typeof meta.awId!=='string'||typeof meta.name!=='string'||
      typeof meta.layerId!=='string'||typeof meta.category!=='string'||!Number.isFinite(meta.width))throw Error('Invalid Hydro feature metadata');
    const row={fid:meta.fid,logicalFid:meta.logicalFid,awId:meta.awId,name:meta.name,
      sourceId:meta.sourceId??'',source:meta.source??'',layerId:meta.layerId,category:meta.category,
      bounds:encoded.bounds.map(value=>halfEven(value*1000000)),stage:meta.stage,flags:meta.flags,
      fragmentIndex:meta.fragmentIndex,fragmentCount:meta.fragmentCount,width:meta.width};
    for(const name of ['systemId','mainstemNameKo','role','aliases','tributaryNames','osmRelationIds','terminal'])
      if(present(meta[name]))row[name]=structuredClone(meta[name]);
    return row;
  }).sort((a,b)=>a.fid-b.fid);
  const detailNames=new Set(['sourceId','source','aliases','tributaryNames','osmRelationIds']);
  const core=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([name])=>!detailNames.has(name))));
  const detail=rows.map(row=>({fid:row.fid,...Object.fromEntries(Object.entries(row).filter(([name])=>detailNames.has(name)))}));
  return {core:{version:5,features:core},detail:{version:5,features:detail}};
}

async function compressHydro(inputs,{gzip=encodeHydroGzip,signal,...options}={}){
  const output=[];for(let at=0;at<inputs.length;at+=128){signal?.throwIfAborted();
    const block=inputs.slice(at,at+128),compressed=await gzip(block,{signal,...options});
    if(!Array.isArray(compressed)||compressed.length!==block.length)throw Error('Invalid Hydro gzip result');
    for(let i=0;i<block.length;i++){if(!Buffer.isBuffer(compressed[i]))throw Error('Invalid Hydro gzip bytes');
      let decoded;try{decoded=gunzipSync(compressed[i],{maxOutputLength:Math.max(1,block[i].length)});}catch(error){throw Error('Invalid Hydro gzip output',{cause:error});}
      if(!decoded.equals(block[i]))throw Error('Hydro gzip output differs');output.push(compressed[i]);}}
  return output;
}
export async function finalizeHydroPackGroups(plan,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(plan?.packs)||!plan.packs.length||!Array.isArray(plan.memberships)||
    (options.gzip!==undefined&&typeof options.gzip!=='function'))throw Error('Explicit Hydro pack plan and compressor required');
  const compressed=await compressHydro(plan.packs.map(pack=>pack.raw),options),shards=[],rows=[],fidPack=new Map(),logicalPacks=new Map();
  let shardParts=[],shardSize=0;
  const flush=()=>{if(shardParts.length){shards.push({id:shards.length,data:Buffer.concat(shardParts,shardSize),packs:shardParts.length});shardParts=[];shardSize=0;}};
  for(let i=0;i<plan.packs.length;i++){
    const pack=plan.packs[i],bytes=compressed[i];if(pack.id!==i||!Array.isArray(pack.fids)||pack.fids.length!==pack.logicalFids.length)
      throw Error('Hydro pack plan order differs');
    if(shardParts.length&&shardSize+bytes.length>4*1024*1024)flush();
    rows.push({id:i,stage:pack.stage,owner:pack.owner,features:pack.fids.length,bytes:bytes.length,shard:shards.length,offset:shardSize,length:bytes.length});
    shardParts.push(bytes);shardSize+=bytes.length;
    for(let j=0;j<pack.fids.length;j++){
      const fid=pack.fids[j],logical=pack.logicalFids[j];if(fidPack.has(fid))throw Error('Duplicate Hydro feature identity in packs');fidPack.set(fid,i);
      if(!logicalPacks.has(logical))logicalPacks.set(logical,new Set());logicalPacks.get(logical).add(i);
    }
  }
  flush();if(shards.length>65535)throw Error('Hydro shard count exceeds index capacity');
  const tileRows=plan.memberships.map(tile=>{
    const ids=[...new Set([...tile.fids].map(fid=>{if(!fidPack.has(fid))throw Error('Hydro tile references a missing feature');return fidPack.get(fid);}))].sort((a,b)=>a-b);
    if(ids.length>65535)throw Error('Hydro tile exceeds index capacity');return {...tile,ids};
  });
  const chunks=[],header=Buffer.alloc(20);header.write('AWI4',0,'ascii');header.writeUInt16LE(4,4);
  header.writeUInt32LE(tileRows.length,8);header.writeUInt32LE(logicalPacks.size,12);header.writeUInt32LE(rows.length,16);chunks.push(header);
  for(const tile of tileRows){const row=Buffer.alloc(7+tile.ids.length*4);row.writeUInt8(tile.stage,0);row.writeUInt16LE(tile.x,1);
    row.writeUInt16LE(tile.y,3);row.writeUInt16LE(tile.ids.length,5);tile.ids.forEach((id,i)=>row.writeUInt32LE(id,7+i*4));chunks.push(row);}
  for(const [logical,packIds] of [...logicalPacks].sort((a,b)=>a[0]-b[0])){
    const ids=[...packIds].sort((a,b)=>a-b);if(ids.length>65535)throw Error('Hydro logical feature exceeds index capacity');
    const row=Buffer.alloc(6+ids.length*4);row.writeUInt32LE(logical,0);row.writeUInt16LE(ids.length,4);ids.forEach((id,i)=>row.writeUInt32LE(id,6+i*4));chunks.push(row);}
  for(const item of rows){const row=Buffer.alloc(15);row.writeUInt32LE(item.id,0);row.writeUInt16LE(item.shard,4);row.writeUInt32LE(item.offset,6);
    row.writeUInt32LE(item.length,10);row.writeUInt8(item.stage,14);chunks.push(row);}
  const indexRaw=Buffer.concat(chunks),[indexGzip]=await compressHydro([indexRaw],options);
  return {packs:rows,shards,indexRaw,indexGzip,indexTileCount:tileRows.length,logicalFeatureCount:logicalPacks.size};
}

// Build a private in-memory v4 pack; publishing and runtime pin changes are separate.
export async function buildHydroPack({features,encoded,changedFeatureIds},options={}){
  options.signal?.throwIfAborted();const plan=planHydroPackGroups({features,encoded,changedFeatureIds});
  const layout=await finalizeHydroPackGroups(plan,options),metadata=buildHydroMetadata(features,plan.prepared);
  const [core,detail]=await compressHydro([Buffer.from(JSON.stringify(metadata.core)),Buffer.from(JSON.stringify(metadata.detail))],options);
  const sha=data=>createHash('sha256').update(data).digest('hex');
  const index={url:'index.bin.gz',bytes:layout.indexGzip.length,sha256:sha(layout.indexGzip),
    tileCount:layout.indexTileCount,logicalFeatureCount:layout.logicalFeatureCount};
  const metadataRow={version:5,featureCount:features.length,
    core:{url:'metadata-core.json.gz',bytes:core.length,sha256:sha(core)},
    detail:{url:'metadata-detail.json.gz',bytes:detail.length,sha256:sha(detail),lazy:true}};
  const shardRows=layout.shards.map(item=>({id:item.id,url:`shards/s${item.id}.bin`,bytes:item.data.length,sha256:sha(item.data),packs:item.packs}));
  const totalBytes=layout.shards.reduce((sum,item)=>sum+item.data.length,0)+index.bytes+core.length+detail.length;
  if(totalBytes>48*1024*1024)throw Error('Compressed Hydro pack exceeds 48 MiB');
  const files=new Map([['index.bin.gz',layout.indexGzip],['metadata-core.json.gz',core],['metadata-detail.json.gz',detail],
    ...layout.shards.map(item=>[`shards/s${item.id}.bin`,item.data])]);
  const stats={featureCount:features.length,coordinateCount:plan.coordinateCount,categoryCounts:plan.categoryCounts,
    layerCounts:plan.layerCounts,stageCounts:plan.stageCounts,packCount:layout.packs.length,shardCount:layout.shards.length,
    indexTileCount:layout.indexTileCount,logicalFeatureCount:layout.logicalFeatureCount,compressedBytes:totalBytes,
    largestPackBytes:layout.packs.reduce((max,item)=>Math.max(max,item.bytes),0)};
  return {files,stats,layout:{index,metadata:metadataRow,packs:layout.packs,shards:shardRows}};
}
