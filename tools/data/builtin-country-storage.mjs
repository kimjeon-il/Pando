import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {defaultRoot,libraryConfig,libraryCheckout,decodeArchiveEntry} from "./library-context.mjs";
import {storeLibraryData} from "./library-store.mjs";
import {encodeBuiltinCountries,finalizeBuiltinWorldFiles,readBuiltinCountryStoredBytes,readBuiltinCountry} from "./builtin-country-bytes.mjs";
import {writeBuiltinWorldPublication} from "../build/build-builtin-world.mjs";
import {builtinCountryAssets,BUILTIN_COUNTRY_MAX_STORED_BYTES} from "../../src/data/builtin-country-files.js";
export const BUILTIN_COUNTRY_ROOT='assets/data/builtin-world/generated/v1/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a&&b&&['encoding','sha256','compressedBytes','decodedBytes'].every(key=>a[key]===b[key]);

/** Explicit one-time data conversion, never a runtime compatibility reader. */
export function factorBuiltinCountryGeometryStorage({previousIndex,read}){
 if(previousIndex?.storageLayout!=='country-files-v1'||previousIndex.schemaVersion!==2)throw Error('Explicit country-files-v1 conversion input is required');
 const storedInputs=new Map();
 const readImmutable=file=>{
  if(!storedInputs.has(file))storedInputs.set(file,read(file));
  return storedInputs.get(file);
 };
 const oldCountry=entry=>{
  const bytes=gunzipSync(readBuiltinCountryStoredBytes(entry,readImmutable),{maxOutputLength:entry.decodedBytes+1});
  const value=JSON.parse(bytes);
  if(bytes.length!==entry.decodedBytes||value.schemaVersion!==2||value.entityId!==entry.entityId||!Array.isArray(value.geometries))throw Error('Invalid old country conversion input');
  return value;
 };
 const index=structuredClone(previousIndex),files=new Map();
 function* countries(){for(const entry of previousIndex.entities)yield oldCountry(entry);}
 encodeBuiltinCountries(index,countries(),files);finalizeBuiltinWorldFiles(index,files);
 let verifiedCountries=0;
 for(let i=0;i<previousIndex.entities.length;i++){
  const before=oldCountry(previousIndex.entities[i]),after=readBuiltinCountry(index.entities[i],index,file=>files.get(file));
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Country conversion changed ordered data: '+before.entityId);
  verifiedCountries++;
 }
 const previousFiles=new Map(previousIndex.entities.flatMap(entry=>(entry.parts||[entry]).map(spec=>[spec.file,spec])));
 const nextFiles=builtinCountryAssets(index),nextUnique=new Map(nextFiles.map(spec=>[spec.file,spec]));
 return {index,files,readPreviousCountry:entry=>oldCountry(entry),verification:{verifiedCountries,exactOrderedDocument:true,geometryPayloadFiles:new Set(index.geometryAssets.map(asset=>asset.file)).size,
   previousFiles:previousFiles.size,previousStoredBytes:[...previousFiles.values()].reduce((sum,spec)=>sum+spec.compressedBytes,0),
   nextFiles:nextUnique.size,nextStoredBytes:[...nextUnique.values()].reduce((sum,spec)=>sum+spec.compressedBytes,0)}};
}
/** Metadata-only delta planning. The old pinned index may be the one-time packed
 * input, but no runtime consumer accepts that layout and no transport is read. */
export function planBuiltinCountryStorage(previousIndex,index,{coverageChanged=false}={}){
 if(previousIndex?.schema!=='pandolab-builtin-world'||previousIndex.schemaVersion!==2||!Array.isArray(previousIndex.entities))throw Error('Pinned builtin country index is required');
 const current=builtinCountryAssets(index),previous=new Map([...previousIndex.entities.flatMap(row=>(row.parts||[row]).map(spec=>[spec.file,spec])),
  ...(previousIndex.geometryAssets||[]).map(spec=>[spec.file,spec])]);
 const changed=current.filter(spec=>!same(previous.get(spec.file),spec));
 const priorCountries=new Map(previousIndex.entities.map(row=>[row.entityId,row]));
 const changedCountries=index.entities.filter(row=>JSON.stringify(row)!==JSON.stringify(priorCountries.get(row.entityId))).map(row=>row.entityId);
 const changedIndex=JSON.stringify(previousIndex)!==JSON.stringify(index);
 const prefixes=changedIndex||changed.length||coverageChanged?[BUILTIN_COUNTRY_ROOT+'index.json',...changed.map(spec=>BUILTIN_COUNTRY_ROOT+spec.file)]:[];
 if(coverageChanged)prefixes.push(BUILTIN_COUNTRY_ROOT+'coverage-report.json');
 return {prefixes,changedCountries,changedFiles:changed.map(spec=>spec.file),reusedFiles:current.length-changed.length,storedBytes:changed.reduce((n,spec)=>n+spec.compressedBytes,0)};
}
export function prepareBuiltinCountryFiles({root=defaultRoot,apply=false}={}){
 const directory=resolve(root,BUILTIN_COUNTRY_ROOT),previous=JSON.parse(readFileSync(resolve(directory,'index.json'))),index=structuredClone(previous),files=new Map();
 for(const entry of index.entities)if(!entry.parts&&entry.compressedBytes>BUILTIN_COUNTRY_MAX_STORED_BYTES)files.set(entry.file,readFileSync(resolve(directory,entry.file)));
 finalizeBuiltinWorldFiles(index,files,{previousIndex:previous});
 for(let i=0;i<index.entities.length;i++)if(index.entities[i].sha256!==previous.entities[i].sha256||index.entities[i].decodedBytes!==previous.entities[i].decodedBytes)throw Error('Country content changed during file separation');
 if(apply)writeBuiltinWorldPublication(files,directory);
 return {countryCount:index.entities.length,segmentedCountries:index.entities.filter(row=>row.parts).map(row=>row.entityId),preservedCountryHashes:true,
  emittedFiles:[...files.keys()],...planBuiltinCountryStorage(previous,index)};
}
export function verifyBuiltinCountryFiles({root=defaultRoot,entityIds=null}={}){
 const directory=resolve(root,BUILTIN_COUNTRY_ROOT),index=JSON.parse(readFileSync(resolve(directory,'index.json'))),specs=builtinCountryAssets(index);
 const selected=entityIds?index.entities.filter(row=>entityIds.includes(row.entityId)):index.entities;
 if(entityIds&&selected.length!==new Set(entityIds).size)throw Error('Unknown country verification scope');
 for(const entry of selected){
  const stored=readBuiltinCountryStoredBytes(entry,file=>readFileSync(resolve(directory,file)));
  const decoded=gunzipSync(stored,{maxOutputLength:entry.decodedBytes+1});
  if(decoded.length!==entry.decodedBytes)throw Error('Country decoded size differs: '+entry.entityId);
  const value=JSON.parse(decoded);
  if(value.schemaVersion!==3||value.entityId!==entry.entityId||value.identity?.id!==entry.entityId)throw Error('Country payload identity differs: '+entry.entityId);
  readBuiltinCountry(entry,index,file=>readFileSync(resolve(directory,file)));
 }
 return {verifiedCountries:selected.length,physicalFiles:specs.length,maxPhysicalBytes:Math.max(0,...specs.map(row=>row.compressedBytes)),totalStoredBytes:specs.reduce((n,row)=>n+row.compressedBytes,0),segmentedCountries:index.entities.filter(row=>row.parts).map(row=>({entityId:row.entityId,parts:row.parts.length}))};
}
function pinnedInputs(root){
 const config=libraryConfig(root),checkout=libraryCheckout(root);
 const archive=JSON.parse(execFileSync('git',['show',`${config.revision}:archive/index.json`],{cwd:checkout,maxBuffer:16*1024*1024}));
 const read=path=>decodeArchiveEntry(checkout,archive.files[path],config.revision);
 return {config,checkout,archive,read,index:JSON.parse(read(BUILTIN_COUNTRY_ROOT+'index.json'))};
}
/** Explicit catalog upgrade. Payload bytes/URLs and country descriptors stay
 * unchanged; type is read from each verified immutable content exactly once. */
export function indexBuiltinGeometryTypes({previousIndex,read}){
 if(previousIndex?.storageLayout!=='descriptor-geometries-v1')throw Error('Factored geometry catalog required');
 const index=structuredClone(previousIndex),seen=new Map();
 for(const asset of index.geometryAssets){
  let type=seen.get(asset.file);
  if(!type){
   const stored=read(asset.file);
   if(stored.length!==asset.compressedBytes||hash(stored)!==asset.sha256)throw Error('Invalid geometry transport: '+asset.file);
   const bytes=gunzipSync(stored,{maxOutputLength:asset.decodedBytes+1});
   if(bytes.length!==asset.decodedBytes||hash(bytes)!==asset.contentSha256)throw Error('Invalid geometry content: '+asset.file);
   type=JSON.parse(bytes).type;
   if(!['Polygon','MultiPolygon','LineString','MultiLineString'].includes(type))throw Error('Invalid builtin geometry type');
   seen.set(asset.file,type);
  }
  if(asset.type&&asset.type!==type)throw Error('Geometry catalog type mismatch');
  asset.type=type;
 }
 return {index,files:new Map([['index.json',Buffer.from(JSON.stringify(index)+'\n')]]),verifiedPayloads:seen.size};
}
export function indexBuiltinCountryGeometries({root=defaultRoot,apply=false,push=false}={}){
 if(push&&!apply)throw Error('Publication requires applied geometry metadata');
 const pinned=pinnedInputs(root),result=indexBuiltinGeometryTypes({previousIndex:pinned.index,read:file=>pinned.read(BUILTIN_COUNTRY_ROOT+file)});
 const path=BUILTIN_COUNTRY_ROOT+'index.json',current=readFileSync(resolve(root,path)),next=result.files.get('index.json');
 if(hash(current)!==pinned.archive.files[path].sha256&&!current.equals(next))throw Error('Preserve unrelated builtin catalog edits');
 if(current.equals(next))return {unchanged:true,revision:pinned.config.revision,verifiedPayloads:result.verifiedPayloads};
 if(apply)writeBuiltinWorldPublication(result.files,resolve(root,BUILTIN_COUNTRY_ROOT));
 if(!push)return {applied:apply,verifiedPayloads:result.verifiedPayloads,payloadWrites:0};
 const revision=storeLibraryData({root,push,prefixes:[path]}),stored=pinnedInputs(root);
 if(stored.config.revision!==revision||!stored.read(path).equals(next))throw Error('Geometry catalog remote bytes differ');
 return {revision,verifiedPayloads:result.verifiedPayloads,verifiedStoredFiles:1,payloadWrites:0};
}
export function factorBuiltinCountryFiles({root=defaultRoot,apply=false,push=false}={}){
 if(push&&!apply)throw Error('Data publication requires the verified conversion to be applied');
 const pinned=pinnedInputs(root),directory=resolve(root,BUILTIN_COUNTRY_ROOT);
 if(pinned.index.storageLayout==='descriptor-geometries-v1')return {unchanged:true,revision:pinned.config.revision};
 const result=factorBuiltinCountryGeometryStorage({previousIndex:pinned.index,read:file=>pinned.read(BUILTIN_COUNTRY_ROOT+file)});
 const indexPath=resolve(directory,'index.json'),current=readFileSync(indexPath);
 if(hash(current)!==pinned.archive.files[BUILTIN_COUNTRY_ROOT+'index.json'].sha256&&!current.equals(result.files.get('index.json')))
  throw Error('Preserve unrelated builtin index edits before converting geometry storage');
 const readPreviousCountry=(entry,index,read)=>index.storageLayout==='country-files-v1'
  ?result.readPreviousCountry(entry):readBuiltinCountry(entry,index,read);
 const plan=planBuiltinCountryStorage(pinned.index,result.index);
 if(apply)writeBuiltinWorldPublication(result.files,directory,{readPreviousCountry});
 if(!push)return {...result.verification,...plan,applied:apply,revision:pinned.config.revision};
 const expected=new Map(plan.prefixes.map(path=>[path,hash(readFileSync(resolve(root,path)))]));
 const revision=storeLibraryData({root,push,prefixes:plan.prefixes,readPreviousCountry});
 const stored=pinnedInputs(root);
 if(stored.config.revision!==revision)throw Error('Converted country data pin differs from stored revision');
 for(const [path,digest]of expected)if(hash(stored.read(path))!==digest)throw Error('Converted country storage differs: '+path);
 return {...result.verification,...plan,applied:apply,revision,verifiedStoredFiles:expected.size};
}
export function storeBuiltinCountryDelta({root=defaultRoot,push=false}={}){
 const pinned=pinnedInputs(root),index=JSON.parse(readFileSync(resolve(root,BUILTIN_COUNTRY_ROOT+'index.json')));
 const coveragePath=BUILTIN_COUNTRY_ROOT+'coverage-report.json';
 const coverageChanged=existsSync(resolve(root,coveragePath))&&hash(readFileSync(resolve(root,coveragePath)))!==pinned.archive.files[coveragePath]?.sha256;
 const plan=planBuiltinCountryStorage(pinned.index,index,{coverageChanged});
 if(!plan.prefixes.length)return {...plan,revision:pinned.config.revision,unchanged:true};
 // Only selected country streams are read. Unrelated payloads remain opaque.
 verifyBuiltinCountryFiles({root,entityIds:plan.changedCountries});
 const expected=new Map(plan.prefixes.map(path=>[path,hash(readFileSync(resolve(root,path)))]));
 const revision=storeLibraryData({root,push,prefixes:plan.prefixes});
 const stored=pinnedInputs(root);
 if(stored.config.revision!==revision)throw Error('Country data pin changed during storage');
 for(const [path,digest] of expected)if(hash(stored.read(path))!==digest)throw Error('Stored country delta differs: '+path);
 return {...plan,revision,verifiedStoredFiles:expected.size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),allowed=new Set(['--prepare','--apply','--verify','--store','--push','--factor-geometries','--index-geometries']);
 if(args.some(arg=>!allowed.has(arg))||['--prepare','--verify','--store','--factor-geometries','--index-geometries'].filter(arg=>args.includes(arg)).length!==1
  ||args.includes('--apply')&&!args.includes('--prepare')&&!args.includes('--factor-geometries')&&!args.includes('--index-geometries')
  ||args.includes('--push')&&!args.includes('--store')&&!args.includes('--factor-geometries')&&!args.includes('--index-geometries'))throw Error('Usage: --prepare [--apply] | --verify | --store [--push] | --factor-geometries [--apply [--push]] | --index-geometries [--apply [--push]]');
 if(args.includes('--store')&&execFileSync('git',['branch','--show-current'],{cwd:defaultRoot,encoding:'utf8'}).trim()!=='work/gis')throw Error('Country data publication is restricted to work/gis');
 const result=args.includes('--index-geometries')?indexBuiltinCountryGeometries({apply:args.includes('--apply'),push:args.includes('--push')}):args.includes('--factor-geometries')?factorBuiltinCountryFiles({apply:args.includes('--apply'),push:args.includes('--push')}):args.includes('--prepare')?prepareBuiltinCountryFiles({apply:args.includes('--apply')}):args.includes('--verify')?verifyBuiltinCountryFiles():storeBuiltinCountryDelta({push:args.includes('--push')});
 console.log(JSON.stringify(result));
}
