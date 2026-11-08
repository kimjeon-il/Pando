import {createHash} from 'node:crypto';
import {BUILTIN_COUNTRY_MAX_STORED_BYTES,builtinCountryFileSpecs,builtinCountryAssets} from "../../src/data/builtin-country-files.js";
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fields=['entityId','file','encoding','sha256','compressedBytes','decodedBytes'];
const same=(a,b)=>a&&b&&['encoding','sha256','compressedBytes','decodedBytes'].every(key=>a[key]===b[key]);
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
 delete index.transport;index.storageLayout='country-files-v1';
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
