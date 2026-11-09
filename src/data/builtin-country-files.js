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
 if(index?.schema!=='pandolab-builtin-world'||index.schemaVersion!==2||index.storageLayout!=='descriptor-geometries-v1'
  ||Object.hasOwn(index,'transport')||!Array.isArray(index.entities))throw Error('Invalid builtin country index layout');
 const geometryAssets=builtinGeometryAssets(index),geometryRefs=new Set(geometryAssets.map(row=>JSON.stringify([row.id,row.version])));
 const ids=new Set(),countries=new Set(),files=new Map();
 for(const row of index.entities){
  const specs=builtinCountryFileSpecs(row);
  if(ids.has(row.entityId)||countries.has(row.file))throw Error('Duplicate builtin country descriptor');
  ids.add(row.entityId);countries.add(row.file);
  if(!Array.isArray(row.geometryRefs)||new Set(row.geometryRefs.map(ref=>JSON.stringify([ref.id,ref.version]))).size!==row.geometryRefs.length
    ||row.geometryRefs.some(ref=>!geometryRefs.has(JSON.stringify([ref.id,ref.version]))))throw Error('Invalid builtin country geometry references');
  for(const spec of specs){
   const value={file:spec.file,encoding:spec.encoding,sha256:spec.sha256,compressedBytes:spec.compressedBytes,decodedBytes:spec.decodedBytes};
   const prior=files.get(spec.file);
   if(prior&&JSON.stringify(prior)!==JSON.stringify(value))throw Error('Conflicting builtin country asset pin');
   files.set(spec.file,value);
  }
 }
 for(const spec of geometryAssets){
  const value={file:spec.file,encoding:spec.encoding,sha256:spec.sha256,compressedBytes:spec.compressedBytes,decodedBytes:spec.decodedBytes};
  const prior=files.get(spec.file);if(prior&&JSON.stringify(prior)!==JSON.stringify(value))throw Error('Conflicting builtin geometry asset pin');
  files.set(spec.file,value);
 }
 return [...files.values()];
}

export function builtinGeometryAssets(index){
 if(!Array.isArray(index?.geometryAssets))throw Error('Missing builtin geometry manifest');
 const ids=new Set();
 for(const asset of index.geometryAssets){
  const key=JSON.stringify([asset.id,asset.version]);
  if(typeof asset.id!=='string'||!asset.id||!Number.isInteger(asset.version)||asset.version<1||asset.version>4294967295||ids.has(key)
    ||!hash.test(asset.sha256)||!hash.test(asset.contentSha256)||asset.file!==`geometries/sha256-${asset.sha256}.json.gz`
    ||!['Polygon','MultiPolygon','LineString','MultiLineString'].includes(asset.type)
    ||asset.encoding!=='gzip'||!positive(asset.compressedBytes)||!positive(asset.decodedBytes))throw Error('Invalid builtin geometry descriptor');
  ids.add(key);
 }
 return index.geometryAssets;
}

/** Materialization boundary: stored descriptors contain no coordinates. The
 * compiler/domain representation is complete and never contains missing shapes. */
export function materializeBuiltinCountry(descriptor,geometries){
 if(descriptor?.schemaVersion!==3||Object.hasOwn(descriptor,'geometries')||!Array.isArray(descriptor.geometryRefs))throw Error('Invalid builtin country descriptor payload');
 const resolved=descriptor.geometryRefs.map(ref=>{
  const geometry=geometries.get(JSON.stringify([ref.id,ref.version]));
  if(!geometry)throw Error('Missing builtin geometry payload: '+ref.id);
  return {id:ref.id,version:ref.version,geojson:geometry};
 });
 return Object.fromEntries(Object.entries(descriptor).map(([key,value])=>key==='geometryRefs'?['geometries',resolved]
  :[key,key==='schemaVersion'?2:structuredClone(value)]));
}

const timelineTables=['lifetimes','geometryBindings','parentRelations','propertyBindings'];
const geometryKey=ref=>JSON.stringify([ref?.id,ref?.version]);
/** The compiler creates this coordinate-free projection. Viewer reads the same
 * dated tables without fetching or assembling authoring country descriptors. */
export function compileBuiltinReadIndex(index,descriptors,previousIndex=null){
 const current=new Map(descriptors.map(country=>[country.entityId,country]));
 if(current.size!==descriptors.length)throw Error('Duplicate builtin read index country');
 const previous=previousIndex?.readIndex,priorIds=new Map((previousIndex?.entities||[]).map((entry,i)=>[entry.entityId,i]));
 if(previous)validateBuiltinReadIndex(previousIndex);
 const readIndex={schemaVersion:1,sourceHashes:[],identities:[],records:{schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]}};
 const previousRows=new Map();
 if(previous)for(const name of timelineTables){const grouped=new Map();for(const row of previous.records[name]){
  const id=row.objectRef.id;if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(row);
 }previousRows.set(name,grouped);}
 for(const entry of index.entities){
  const country=current.get(entry.entityId),prior=priorIds.get(entry.entityId);let identity,records;
  if(country){
   if(country.schemaVersion!==3||country.identity?.id!==entry.entityId||Object.hasOwn(country,'geometries')
    ||!Array.isArray(country.sourceBindings)||JSON.stringify(country.geometryRefs)!==JSON.stringify(entry.geometryRefs)
    ||country.timelineRecords?.schemaVersion!==3||!timelineTables.every(name=>Array.isArray(country.timelineRecords[name])))
    throw Error('Invalid builtin read index descriptor: '+entry.entityId);
   identity=structuredClone(country.identity);
   if(identity.properties?.metadata?.historicalTimeline)identity.properties.metadata.historicalTimeline.geometryBindings=structuredClone(country.sourceBindings);
   records=country.timelineRecords;
  }else{
   if(!previous||prior===undefined||previous.sourceHashes[prior]!==entry.sha256)throw Error('Missing exact descriptor for builtin read index: '+entry.entityId);
   identity=structuredClone(previous.identities[prior]);
   records=Object.fromEntries(timelineTables.map(name=>[name,previousRows.get(name).get(entry.entityId)||[]]));
  }
  readIndex.sourceHashes.push(entry.sha256);readIndex.identities.push(identity);
  for(const name of timelineTables)readIndex.records[name].push(...structuredClone(records[name]));
 }
 validateBuiltinReadIndex({...index,readIndex});return readIndex;
}
/** Validate only at hash-verified catalog admission, not per frame. */
export function validateBuiltinReadIndex(index){
 const read=index?.readIndex,entries=index?.entities,fail=()=>{throw Error('Invalid or stale builtin temporal read index');};
 if(!Array.isArray(entries)||read?.schemaVersion!==1||!Array.isArray(read.sourceHashes)||!Array.isArray(read.identities)
  ||read.sourceHashes.length!==entries.length||read.identities.length!==entries.length||Object.hasOwn(read,'geometries')
  ||read.records?.schemaVersion!==3||!timelineTables.every(name=>Array.isArray(read.records[name])))fail();
 const owners=new Map();
 for(let i=0;i<entries.length;i++){
  const entry=entries[i],identity=read.identities[i];
  if(!identity||identity.id!==entry.entityId||owners.has(entry.entityId)||read.sourceHashes[i]!==entry.sha256
   ||!hash.test(entry.sha256)||!identity.properties||typeof identity.properties!=='object'
   ||Array.isArray(identity.properties)||identity.geometry!=null)fail();
  owners.set(entry.entityId,new Set(entry.geometryRefs.map(geometryKey)));
 }
 for(const name of timelineTables){const ids=new Set();for(const row of read.records[name]){
  if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||row.objectRef?.domain!=='territorial'||!owners.has(row.objectRef.id))fail();
  ids.add(row.id);
  if(name==='geometryBindings'&&!owners.get(row.objectRef.id).has(geometryKey(row.geometryRef)))fail();
  if(name==='parentRelations'&&row.parentId&&!owners.has(row.parentId))fail();
 }}
 return read;
}
