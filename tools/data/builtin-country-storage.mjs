import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {defaultRoot,libraryConfig,libraryCheckout,decodeArchiveEntry} from "./library-context.mjs";
import {storeLibraryData} from "./library-store.mjs";
import {finalizeBuiltinWorldFiles,readBuiltinCountryStoredBytes} from "./builtin-country-bytes.mjs";
import {writeBuiltinWorldPublication} from "../build/build-builtin-world.mjs";
import {builtinCountryAssets,BUILTIN_COUNTRY_MAX_STORED_BYTES} from "../../src/data/builtin-country-files.js";
export const BUILTIN_COUNTRY_ROOT='assets/data/builtin-world/generated/v1/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a&&b&&['encoding','sha256','compressedBytes','decodedBytes'].every(key=>a[key]===b[key]);
/** Metadata-only delta planning. The old pinned index may be the one-time packed
 * input, but no runtime consumer accepts that layout and no transport is read. */
export function planBuiltinCountryStorage(previousIndex,index,{coverageChanged=false}={}){
 if(previousIndex?.schema!=='pandolab-builtin-world'||previousIndex.schemaVersion!==2||!Array.isArray(previousIndex.entities))throw Error('Pinned builtin country index is required');
 const current=builtinCountryAssets(index),previous=new Map(previousIndex.entities.flatMap(row=>(row.parts||[row]).map(spec=>[spec.file,spec])));
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
  if(value.schemaVersion!==2||value.entityId!==entry.entityId||value.identity?.id!==entry.entityId)throw Error('Country payload identity differs: '+entry.entityId);
 }
 return {verifiedCountries:selected.length,physicalFiles:specs.length,maxPhysicalBytes:Math.max(0,...specs.map(row=>row.compressedBytes)),totalStoredBytes:specs.reduce((n,row)=>n+row.compressedBytes,0),segmentedCountries:index.entities.filter(row=>row.parts).map(row=>({entityId:row.entityId,parts:row.parts.length}))};
}
function pinnedInputs(root){
 const config=libraryConfig(root),checkout=libraryCheckout(root);
 const archive=JSON.parse(execFileSync('git',['show',`${config.revision}:archive/index.json`],{cwd:checkout,maxBuffer:16*1024*1024}));
 const read=path=>decodeArchiveEntry(checkout,archive.files[path],config.revision);
 return {config,checkout,archive,read,index:JSON.parse(read(BUILTIN_COUNTRY_ROOT+'index.json'))};
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
 const args=process.argv.slice(2),allowed=new Set(['--prepare','--apply','--verify','--store','--push']);
 if(args.some(arg=>!allowed.has(arg))||['--prepare','--verify','--store'].filter(arg=>args.includes(arg)).length!==1
  ||args.includes('--apply')&&!args.includes('--prepare')||args.includes('--push')&&!args.includes('--store'))throw Error('Usage: --prepare [--apply] | --verify | --store [--push]');
 if(args.includes('--store')&&execFileSync('git',['branch','--show-current'],{cwd:defaultRoot,encoding:'utf8'}).trim()!=='work/gis')throw Error('Country data publication is restricted to work/gis');
 const result=args.includes('--prepare')?prepareBuiltinCountryFiles({apply:args.includes('--apply')}):args.includes('--verify')?verifyBuiltinCountryFiles():storeBuiltinCountryDelta({push:args.includes('--push')});
 console.log(JSON.stringify(result));
}
