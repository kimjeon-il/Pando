// One physical-file contract for generation, loading and Web/App publication.
// This cap bounds a transfer file, not a country's identity or geometry.
export const BUILTIN_COUNTRY_MAX_STORED_BYTES=512*1024;
const hash=/^[a-f0-9]{64}$/;
const positive=value=>Number.isSafeInteger(value)&&value>0;
export function builtinCountryFileSpecs(row){
 if(!row||typeof row.entityId!=='string'||!row.entityId||!hash.test(row.sha256)
  ||row.file!==`countries/${row.entityId.replaceAll(':','-')}-sha256-${row.sha256}.json.gz`
  ||!/^countries\/[A-Za-z0-9_-]+-sha256-[a-f0-9]{64}\.json\.gz$/.test(row.file)
  ||row.encoding!=='gzip'||Object.hasOwn(row,'offset')||!positive(row.compressedBytes)||!positive(row.decodedBytes))throw Error('Invalid builtin country descriptor');
 if(!Object.hasOwn(row,'parts')){
  if(row.compressedBytes>BUILTIN_COUNTRY_MAX_STORED_BYTES)throw Error('Oversized builtin country requires bounded parts');
  return [row];
 }
 if(!Array.isArray(row.parts)||row.parts.length<2)throw Error('Invalid builtin country parts');
 let total=0;
 for(const part of row.parts){
  if(!part||!hash.test(part.sha256)||part.file!==`country-parts/sha256-${part.sha256}.bin`
   ||part.encoding!=='identity'||Object.hasOwn(part,'offset')||!positive(part.compressedBytes)
   ||part.compressedBytes>BUILTIN_COUNTRY_MAX_STORED_BYTES||part.decodedBytes!==part.compressedBytes)throw Error('Invalid builtin country part descriptor');
  total+=part.compressedBytes;if(!Number.isSafeInteger(total)||total>row.compressedBytes)throw Error('Invalid builtin country part size');
 }
 if(total!==row.compressedBytes)throw Error('Incomplete builtin country parts');
 return row.parts;
}
export function builtinCountryAssets(index){
 if(index?.schema!=='pandolab-builtin-world'||index.schemaVersion!==2||index.storageLayout!=='country-files-v1'
  ||Object.hasOwn(index,'transport')||!Array.isArray(index.entities))throw Error('Invalid builtin country index layout');
 const ids=new Set(),countries=new Set(),files=new Map();
 for(const row of index.entities){
  const specs=builtinCountryFileSpecs(row);
  if(ids.has(row.entityId)||countries.has(row.file))throw Error('Duplicate builtin country descriptor');
  ids.add(row.entityId);countries.add(row.file);
  for(const spec of specs){
   const value={file:spec.file,encoding:spec.encoding,sha256:spec.sha256,compressedBytes:spec.compressedBytes,decodedBytes:spec.decodedBytes};
   const prior=files.get(spec.file);
   if(prior&&JSON.stringify(prior)!==JSON.stringify(value))throw Error('Conflicting builtin country asset pin');
   files.set(spec.file,value);
  }
 }
 return [...files.values()];
}
