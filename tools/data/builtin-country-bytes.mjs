import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {BUILTIN_COUNTRY_MAX_STORED_BYTES,builtinCountryFileSpecs,builtinCountryAssets,builtinGeometryAssets,materializeBuiltinCountry,compileBuiltinReadIndex} from "../../src/data/builtin-country-files.js";
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fields=['entityId','file','encoding','sha256','compressedBytes','decodedBytes'];
const same=(a,b)=>a&&b&&['encoding','sha256','compressedBytes','decodedBytes'].every(key=>a[key]===b[key]);
const refKey=ref=>JSON.stringify([ref.id,ref.version]);
const compress=bytes=>{const stored=gzipSync(bytes,{level:9,mtime:0});stored[9]=3;return stored;};

/** Only incoming owners are re-encoded. Coordinate identity is independent of
 * country names/flags, and immutable payloads are shared across logical refs. */
export function encodeBuiltinCountries(index,countries,files){
 const geometries=new Map((index.geometryAssets||[]).map(asset=>[refKey(asset),asset]));
 const byContent=new Map((index.geometryAssets||[]).map(asset=>[asset.contentSha256,asset]));
 for(const country of countries){
  const entry=index.entities.find(row=>row.entityId===country.entityId);
  if(!entry)throw Error('Missing builtin descriptor owner: '+country.entityId);
  let descriptor;
  if(country.schemaVersion===3){
   if(Object.hasOwn(country,'geometries')||!Array.isArray(country.geometryRefs))throw Error('Invalid country descriptor');
   descriptor=structuredClone(country);
  }else{
   if(country.schemaVersion!==2||!Array.isArray(country.geometries))throw Error('Invalid compiled country');
   for(const geometry of country.geometries){
    const decoded=Buffer.from(JSON.stringify(geometry.geojson)+'\n'),contentSha256=hash(decoded),key=refKey(geometry);
    const prior=geometries.get(key);
    if(prior&&prior.contentSha256!==contentSha256)throw Error('Conflicting immutable geometry identity: '+geometry.id);
    let resource=byContent.get(contentSha256);
    if(!resource){
     const stored=compress(decoded),sha256=hash(stored),file='geometries/sha256-'+sha256+'.json.gz';
     resource={type:geometry.geojson.type,file,encoding:'gzip',sha256,contentSha256,compressedBytes:stored.length,decodedBytes:decoded.length};
     files.set(file,stored);byContent.set(contentSha256,resource);
    }
    geometries.set(key,{id:geometry.id,version:geometry.version,...Object.fromEntries(Object.entries(resource).filter(([name])=>!['id','version'].includes(name)))});
   }
   descriptor=Object.fromEntries(Object.entries(country).map(([key,value])=>key==='geometries'
    ?['geometryRefs',value.map(({id,version})=>({id,version}))]:[key,key==='schemaVersion'?3:structuredClone(value)]));
  }
  entry.geometryRefs=structuredClone(descriptor.geometryRefs);
  const decoded=Buffer.from(JSON.stringify(descriptor)+'\n'),stored=compress(decoded),sha256=hash(stored);
  const file='countries/'+country.entityId.replaceAll(':','-')+'-sha256-'+sha256+'.json.gz';
  files.set(file,stored);Object.assign(entry,{file,encoding:'gzip',sha256,compressedBytes:stored.length,decodedBytes:decoded.length});
 }
 const used=new Set(index.entities.flatMap(entry=>(entry.geometryRefs||[]).map(refKey)));
 index.geometryAssets=[...geometries].filter(([key])=>used.has(key)).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,asset])=>asset);
 index.storageLayout='descriptor-geometries-v1';
 return files;
}

export function readBuiltinCountry(entry,index,read){
 const decoded=gunzipSync(readBuiltinCountryStoredBytes(entry,read),{maxOutputLength:entry.decodedBytes+1});
 if(decoded.length!==entry.decodedBytes)throw Error('Invalid builtin descriptor decoded bytes');
 const descriptor=JSON.parse(decoded);
 if(JSON.stringify(descriptor.geometryRefs)!==JSON.stringify(entry.geometryRefs))throw Error('Builtin descriptor geometry manifest mismatch');
 const all=new Map(builtinGeometryAssets(index).map(asset=>[refKey(asset),asset])),geometries=new Map();
 for(const ref of descriptor.geometryRefs){
  const asset=all.get(refKey(ref));if(!asset)throw Error('Missing builtin geometry descriptor');
  const stored=read(asset.file);
  if(!Buffer.isBuffer(stored)||stored.length!==asset.compressedBytes||hash(stored)!==asset.sha256)throw Error('Invalid builtin geometry stored bytes');
  const bytes=gunzipSync(stored,{maxOutputLength:asset.decodedBytes+1});
  if(bytes.length!==asset.decodedBytes||hash(bytes)!==asset.contentSha256)throw Error('Invalid builtin geometry content bytes');
  geometries.set(refKey(ref),JSON.parse(bytes));
 }
 return materializeBuiltinCountry(descriptor,geometries);
}
export function readBuiltinCountryStoredBytes(entry,read){
 const specs=builtinCountryFileSpecs(entry);
 const chunks=specs.map(spec=>{
  const bytes=read(spec.file);
  if(!Buffer.isBuffer(bytes)||bytes.length!==spec.compressedBytes||hash(bytes)!==spec.sha256)throw Error('Invalid country bytes: '+spec.file);
  return bytes;
 });
 const bytes=chunks.length===1?chunks[0]:Buffer.concat(chunks,entry.compressedBytes);
 if(bytes.length!==entry.compressedBytes||hash(bytes)!==entry.sha256)throw Error('Invalid country bytes: '+entry.entityId);
 return bytes;
}
/** Full output or a delta over the pinned publication. Only supplied countries
 * are split. Unchanged countries and parts stay references and are never read. */
export function finalizeBuiltinWorldFiles(index,files,{previousIndex=null}={}){
 if(index?.schema!=='pandolab-builtin-world'||index.schemaVersion!==2||!Array.isArray(index.entities)||!(files instanceof Map))throw Error('Invalid builtin publication');
 if(previousIndex&&(previousIndex.schema!==index.schema||previousIndex.schemaVersion!==2||!Array.isArray(previousIndex.entities)))throw Error('Invalid previous builtin publication');
 const previous=new Map((previousIndex?.entities||[]).map(row=>[row.entityId,row]));
 if(previousIndex&&previous.size!==previousIndex.entities.length)throw Error('Duplicate previous builtin country');
 const priorFiles=new Map();
 for(const row of previous.values())for(const spec of row.parts||[row])priorFiles.set(spec.file,spec);
 for(const spec of previousIndex?.geometryAssets||[])priorFiles.set(spec.file,spec);
 const descriptors=[];
 for(const entry of index.entities)if(files.has(entry.file)){
  const stored=files.get(entry.file);
  if(!Buffer.isBuffer(stored)||stored.length!==entry.compressedBytes||hash(stored)!==entry.sha256)throw Error('Invalid country bytes: '+entry.entityId);
  const decoded=gunzipSync(stored,{maxOutputLength:entry.decodedBytes+1});
  if(decoded.length!==entry.decodedBytes)throw Error('Invalid country decoded size: '+entry.entityId);
  descriptors.push(JSON.parse(decoded));
 }
 index.readIndex=compileBuiltinReadIndex(index,descriptors,previousIndex);
 const ids=new Set();
 for(const entry of index.entities){
  if(!entry||ids.has(entry.entityId))throw Error('Invalid builtin country descriptor');ids.add(entry.entityId);
  const prior=previous.get(entry.entityId),unchanged=prior&&fields.every(key=>prior[key]===entry[key]);
  if(files.has(entry.file)){
   const bytes=files.get(entry.file);
   if(!Buffer.isBuffer(bytes)||bytes.length!==entry.compressedBytes||hash(bytes)!==entry.sha256)throw Error('Invalid country bytes: '+entry.entityId);
   delete entry.parts;
   if(bytes.length>BUILTIN_COUNTRY_MAX_STORED_BYTES){
    entry.parts=[];
    for(let start=0;start<bytes.length;start+=BUILTIN_COUNTRY_MAX_STORED_BYTES){
     const chunk=bytes.subarray(start,start+BUILTIN_COUNTRY_MAX_STORED_BYTES),sha256=hash(chunk),file=`country-parts/sha256-${sha256}.bin`;
     entry.parts.push({file,encoding:'identity',sha256,compressedBytes:chunk.length,decodedBytes:chunk.length});files.set(file,chunk);
    }
    files.delete(entry.file);
   }
  }else if(!unchanged)throw Error('Missing exact country bytes: '+entry.entityId);
  delete entry.offset;
 }
 delete index.transport;index.storageLayout='descriptor-geometries-v1';
 const specs=builtinCountryAssets(index),paths=new Set(specs.map(row=>row.file));
 for(const file of files.keys())if(file!=='index.json'&&file!=='coverage-report.json'&&!paths.has(file))throw Error('Unexpected builtin output: '+file);
 for(const spec of specs){
  const unchanged=same(priorFiles.get(spec.file),spec);
  if(files.has(spec.file)){
   const bytes=files.get(spec.file);
   if(!Buffer.isBuffer(bytes)||bytes.length!==spec.compressedBytes||hash(bytes)!==spec.sha256)throw Error('Invalid country bytes: '+spec.file);
   if(unchanged)files.delete(spec.file);
  }else if(!unchanged)throw Error('Missing exact country bytes: '+spec.file);
 }
 files.set('index.json',Buffer.from(JSON.stringify(index)+'\n'));return files;
}
