import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const edit=(path,change)=>{const source=readFileSync(path,'utf8');writeFileSync(path,change(source));};
const once=(source,before,after)=>{if(!source.includes(before))throw Error('Source changed before integration: '+before.slice(0,120));return source.replace(before,after);};
edit('src/data/builtin-country-files.js',s=>s+String.raw`
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
   ||Array.isArray(identity.properties)||Object.hasOwn(identity,'geometry'))fail();
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
`);
edit('tools/data/builtin-country-bytes.mjs',s=>{
 s=once(s,'builtinGeometryAssets,materializeBuiltinCountry}','builtinGeometryAssets,materializeBuiltinCountry,compileBuiltinReadIndex}');
 return once(s,' const ids=new Set();\n for(const entry of index.entities){',String.raw` const descriptors=[];
 for(const entry of index.entities)if(files.has(entry.file)){
  const stored=files.get(entry.file);
  if(!Buffer.isBuffer(stored)||stored.length!==entry.compressedBytes||hash(stored)!==entry.sha256)throw Error('Invalid country bytes: '+entry.entityId);
  const decoded=gunzipSync(stored,{maxOutputLength:entry.decodedBytes+1});
  if(decoded.length!==entry.decodedBytes)throw Error('Invalid country decoded size: '+entry.entityId);
  descriptors.push(JSON.parse(decoded));
 }
 index.readIndex=compileBuiltinReadIndex(index,descriptors,previousIndex);
 const ids=new Set();
 for(const entry of index.entities){`);
});
edit('src/data/builtin-world-loader.js',s=>{
 s=once(s,'builtinCountryAssets,builtinCountryFileSpecs','builtinCountryAssets,validateBuiltinReadIndex');
 s=once(s,'function assembleWorld(index,countries,month,descriptors){','export function assembleBuiltinWorld(index,countries,month){');
 s=once(s,'country?.schemaVersion!==(descriptors?3:2)','country?.schemaVersion!==2');
 s=once(s,'for(const geometry of descriptors?[]:country.geometries){','for(const geometry of country.geometries){');
 s=once(s," if(descriptors)project.geometryResources=index.geometryAssets.filter(asset=>used.has(JSON.stringify([asset.id,asset.version])))\n  .map(({id,version,type,contentSha256,decodedBytes})=>({id,version,type,contentSha256,decodedBytes}));\n",'');
 s=once(s,'export function assembleBuiltinWorld(index,countries,month){return assembleWorld(index,countries,month,false);}\n','');
 s=once(s,' let indexPromise;',' let indexPromise,readMetadata;');
 s=once(s,' const countries=new Map(),geometries=new Map(),pending=new Map(),geometryStates=new Map();',' const geometries=new Map(),pending=new Map(),geometryStates=new Map();');
 s=once(s,"  if(!value.template||typeof value.template!=='object'||Array.isArray(value.template))throw new Error('Invalid builtin world index');",String.raw`  if(value.template?.schemaVersion!==PROJECT_SCHEMA_VERSION||value.template?.format!=='pandolab-project-state'
    ||Object.hasOwn(value.template,'projectSetup'))throw new Error('Invalid builtin world index');
  const read=validateBuiltinReadIndex(value);
  const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
  freeze(read);freeze(value.template);
  readMetadata={...value.template,territorialEntities:read.identities,timelineRecords:read.records,
    geometryResources:freeze(value.geometryAssets.map(({id,version,type,contentSha256,decodedBytes})=>({id,version,type,contentSha256,decodedBytes})))};`);
 let a=s.indexOf(' function parseCountry('),b=s.indexOf(' async function loadIndex()',a);if(a<0||b<a)throw Error('Missing descriptor parser');s=s.slice(0,a)+s.slice(b);
 a=s.indexOf(' async function readCountry(');b=s.indexOf(' async function loadGeometry(',a);if(a<0||b<a)throw Error('Missing descriptor reader');s=s.slice(0,a)+s.slice(b);
 return once(s,"  // Descriptors retain every era independently of immutable coordinate files.\n  const descriptors=await loadAll(index.entities,loadCountry);\n  const project=assembleWorld(index,descriptors,month,true),catalog=new Map(index.geometryAssets.map(asset=>[JSON.stringify([asset.id,asset.version]),asset]));",String.raw`  // Published metadata is immutable. Only active geometry is loaded; no
  // country-document reconstruction or parallel runtime model is retained.
  queryMonthEnd(month);
  const project={...readMetadata,projectSetup:createBuiltinProjectSetup(month),geometries:[]};
  const catalog=new Map(index.geometryAssets.map(asset=>[JSON.stringify([asset.id,asset.version]),asset]));`);
});
writeFileSync('tools/build/build-builtin-read-index.mjs',String.raw`import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readLibraryDataFile} from '../data/library-context.mjs';
import {writeLibraryOutput} from '../data/library-runtime.mjs';
import {readBuiltinCountryStoredBytes} from '../data/builtin-country-bytes.mjs';
import {compileBuiltinReadIndex} from '../../src/data/builtin-country-files.js';

/** Upgrade only small metadata, never geometry, meshes or source GIS. */
export function buildBuiltinReadIndex({root=process.cwd()}={}){
 const base='assets/data/builtin-world/generated/v1/';
 const read=file=>readLibraryDataFile(base+file,{root,fetch:true});
 const before=read('index.json'),index=JSON.parse(before);
 const descriptors=index.entities.map(entry=>{
  const bytes=gunzipSync(readBuiltinCountryStoredBytes(entry,read),{maxOutputLength:entry.decodedBytes+1});
  if(bytes.length!==entry.decodedBytes)throw Error('Country descriptor decoded length mismatch');
  return JSON.parse(bytes);
 });
 const {readIndex:old,...unchanged}=index;
 index.readIndex=compileBuiltinReadIndex(index,descriptors);
 const {readIndex,...retained}=index;
 if(JSON.stringify(unchanged)!==JSON.stringify(retained))throw Error('Unrelated catalog metadata changed');
 const after=Buffer.from(JSON.stringify(index)+'\n');
 if(!before.equals(after))writeLibraryOutput(resolve(root,base+'index.json'),after);
 return {identities:readIndex.identities.length,records:Object.fromEntries(Object.entries(readIndex.records).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),
  bytes:after.length,readIndexBytes:Buffer.byteLength(JSON.stringify(readIndex)),changed:!before.equals(after),sha256:createHash('sha256').update(after).digest('hex')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildBuiltinReadIndex()));
`);
edit('tests/unit/data/builtin-world-loader.test.mjs',s=>s.replace("import {builtinCountryFileSpecs} from '../../../src/data/builtin-country-files.js';\n",'').replace("const expected=new Set(['index.json',...index.entities.flatMap(entry=>builtinCountryFileSpecs(entry).map(asset=>asset.file)),","const expected=new Set(['index.json',").replace('individual country bytes','selected geometry bytes'));
edit('tests/unit/data/builtin-country-parts.test.mjs',s=>{
 const a=s.indexOf('function split(f){'),b=s.indexOf("test('generation",a);if(a<0||b<a)throw Error('Missing authoring part fixture');
 s=s.slice(0,a)+"function split(f){const files=new Map([[f.entry.file,f.bytes]]);finalizeBuiltinWorldFiles(f.index,files);return files;}\n"+s.slice(b);
 return s.replace('the loader reads bounded parts, never requests the oversized original and preserves the country payload','the viewer reads only the temporal index and preserves the oversized authoring identity')
 .replace("assert.deepEqual(calls,['index.json',...f.entry.parts.map(part=>part.file)]);","assert.deepEqual(calls,['index.json']);")
 .replace('assert.equal(calls.length,1+f.entry.parts.length);','assert.equal(calls.length,1);');
});
execFileSync('git',['diff','--check'],{stdio:'inherit'});
