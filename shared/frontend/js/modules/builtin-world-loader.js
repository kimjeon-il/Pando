import {createStoredAssetLoader} from './stored-asset-loader.js';
import {parseTemporal,temporalContains,temporalMonthEnd,normalizeTemporalInterval} from './temporal.js';
import {builtinCountryAssets,builtinCountryFileSpecs} from './builtin-country-files.js';
import {createBuiltinProjectSetup} from './project-setup.js';
import {PROJECT_SCHEMA_VERSION} from './version-contract.js';

// The verified country catalog provides source coverage. The project retains
// every original temporal interval; C++ owns month-end selection.
const contains=(rows,date)=>rows.some(row=>temporalContains(row,date));
function validateBuiltinCatalog(index){
 if(index?.schema!=='pandolab-builtin-world'||index.schemaVersion!==2||!Array.isArray(index.entities))throw new Error('Invalid builtin country catalog');
}
function queryMonthEnd(month){
 const value=parseTemporal(month,{nullable:false});
 if(value.precision!=='month')throw new Error('A query month is required');
 return temporalMonthEnd(value);
}
const countriesAt=(index,date)=>index.entities.filter(entry=>contains(entry.coverage,date));
export function selectBuiltinCountries(index,month){
 validateBuiltinCatalog(index);
 return countriesAt(index,queryMonthEnd(month));
}
export function assembleBuiltinWorld(index,countries,month){
 validateBuiltinCatalog(index);
 queryMonthEnd(month);
 const expected=index.entities;
 const byId=new Map(countries.map(row=>[row.entityId,row]));
 if(byId.size!==countries.length||expected.length!==countries.length)throw new Error('Incomplete builtin country selection');
 if(index.template?.schemaVersion!==PROJECT_SCHEMA_VERSION
   ||index.template?.format!=='pandolab-project-state'
   ||Object.hasOwn(index.template,'projectSetup'))
   throw new Error('Invalid builtin project template');
 const project=structuredClone(index.template),geometries=new Map();
 project.territorialEntities=[];project.geometries=[];
 project.timelineRecords={schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
 for(const entry of expected){
  const country=byId.get(entry.entityId);
  if(country?.schemaVersion!==2||country.identity?.id!==entry.entityId)throw new Error('Builtin country identity mismatch');
  const identity=structuredClone(country.identity);
  if(identity.properties.metadata?.historicalTimeline)
   identity.properties.metadata.historicalTimeline.geometryBindings=structuredClone(country.sourceBindings);
  project.territorialEntities.push(identity);
  // Historical lifetimes, geometries, parents, names and flags remain dated.
  // Only the canonical C++ cursor selects an effective month.
  for(const name of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])
   project.timelineRecords[name].push(...structuredClone(country.timelineRecords[name]));
  for(const geometry of country.geometries){
   const key=JSON.stringify([geometry.id,geometry.version]),existing=geometries.get(key);
   if(existing&&JSON.stringify(existing)!==JSON.stringify(geometry))throw new Error('Conflicting builtin geometry');
   geometries.set(key,geometry);
  }
 }
 const used=new Set(project.timelineRecords.geometryBindings.map(row=>JSON.stringify([row.geometryRef.id,row.geometryRef.version])));
 project.geometries=[...geometries].filter(([key])=>used.has(key)).map(([,value])=>value);
 project.projectSetup=createBuiltinProjectSetup(month);
 return project;
}
export function createBuiltinWorldLoader({manifestUrl,manifestSpec,dataRevision,fetchFn=globalThis.fetch,cacheStorage=globalThis.caches}){
 if(!manifestUrl||!manifestSpec?.sha256||!dataRevision)throw new Error('Builtin country catalog integrity metadata is required');
 const base=new URL(manifestUrl,globalThis.location?.href),parse=bytes=>JSON.parse(new TextDecoder().decode(bytes));
 const assetOptions={dataRevision,fetchFn,cacheStorage,resolveUrl:spec=>new URL(spec.url,base).href};
 // The mutable catalog belongs to a revision. Content-hashed countries do not:
 // unchanged files must survive a newer catalog/data revision without refetching.
 const catalogs=createStoredAssetLoader(assetOptions);
 const assets=createStoredAssetLoader({...assetOptions,cachePolicy:'immutable'});
 let indexPromise;
 const countries=new Map(),pending=new Map();
 let activeReads=0;
 const readQueue=[];
 async function limitedRead(operation){
  if(activeReads===6)await new Promise(resolve=>readQueue.push(resolve));else activeReads++;
  try{return await operation();}finally{if(readQueue.length)readQueue.shift()();else activeReads--;}
 }
 function parseIndex(bytes){
  const value=parse(bytes);builtinCountryAssets(value);
  if(!value.template||typeof value.template!=='object'||Array.isArray(value.template))throw new Error('Invalid builtin world index');
  for(const row of value.entities){
   if(!Array.isArray(row.coverage))throw new Error('Invalid builtin country coverage descriptor');
   for(const interval of row.coverage){
    if(!interval||!['validFrom','validTo'].every(key=>interval[key]===null||typeof interval[key]==='string'&&interval[key].trim()))throw new Error('Invalid builtin country coverage descriptor');
    normalizeTemporalInterval(interval.validFrom,interval.validTo);
   }
  }
  return value;
 }
 function parseCountry(bytes,entry){
  const value=parse(bytes);
  if(value?.schemaVersion!==2||value.entityId!==entry.entityId||value.identity?.id!==entry.entityId
   ||!value.identity.properties||typeof value.identity.properties!=='object'||Array.isArray(value.identity.properties)
   ||!Array.isArray(value.sourceBindings)||!Array.isArray(value.geometries)||value.timelineRecords?.schemaVersion!==3
   ||!['lifetimes','geometryBindings','parentRelations','propertyBindings'].every(key=>Array.isArray(value.timelineRecords[key])))throw new Error('Invalid builtin country payload or identity: '+entry.entityId);
  return value;
 }
 async function loadIndex(){
  if(!indexPromise)indexPromise=catalogs.loadAsset({...manifestSpec,url:base.href},'builtin-world','index','국가 자료 목록',parseIndex)
   .then(({value})=>value).catch(error=>{indexPromise=null;throw error;});
  return indexPromise;
 }
 async function readCountry(entry){
  if(!entry.parts)return assets.loadAsset({...entry,url:entry.file},'builtin-world',entry.entityId,entry.entityId,bytes=>parseCountry(bytes,entry));
  // Reassemble only this country's original compressed stream. Parts are read
  // sequentially within one slot, so total network concurrency stays at six.
  const bytes=new Uint8Array(entry.compressedBytes);let position=0;
  for(const part of builtinCountryFileSpecs(entry)){
   const result=await assets.loadStoredAsset({...part,url:part.file},'builtin-world',part.sha256,entry.entityId,stored=>stored);
   bytes.set(new Uint8Array(result.value),position);position+=part.compressedBytes;
  }
  return assets.decodeStoredAsset(bytes.buffer,entry,'builtin-world',entry.entityId,entry.entityId,stored=>parseCountry(stored,entry));
 }
 async function loadCountry(entry){
  const key=entry.file;
  if(countries.has(key))return countries.get(key);
  // A shared file request is independent of any one month query's cancellation.
  if(!pending.has(key))pending.set(key,limitedRead(()=>readCountry(entry))
   .then(({value})=>{countries.set(key,value);return value;})
   .finally(()=>pending.delete(key)));
  return pending.get(key);
 }
 async function loadProject(month,{isCurrent=()=>true,concurrency=6,waitForIdle=null}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>6)throw new RangeError('Builtin country read concurrency must be 1-6.');
  const assertCurrent=()=>{if(!isCurrent())throw Object.assign(new Error('Builtin query superseded'),{name:'AbortError',cancelled:true});};
  assertCurrent();
  const index=await loadIndex();assertCurrent();
  // Fetch each immutable country file once for the lifetime of this project;
  // inactive and future identities must remain available to its timeline.
  const selected=index.entities,loaded=new Array(selected.length);
  let next=0,failed=false;
  const workers=Array.from({length:Math.min(concurrency,selected.length)},async()=>{
   try{
    while(!failed&&next<selected.length){
     assertCurrent();
     if(waitForIdle){await waitForIdle();assertCurrent();}
     if(failed||next>=selected.length)break;
     const i=next++;loaded[i]=await loadCountry(selected[i]);assertCurrent();
    }
   }catch(error){failed=true;throw error;}
  });
  try{await Promise.all(workers);}
  catch(error){
   // An immediate retry must not join another worker's still-pending failure.
   // Superseded queries do not wait: their shared reads may serve the next query.
   if(error?.name!=='AbortError')await Promise.allSettled(workers);
   throw error;
  }
  if(waitForIdle)await waitForIdle();
  assertCurrent();
  return {project:assembleBuiltinWorld(index,loaded,month),fingerprint:`${manifestSpec.sha256}:complete-timeline`};
 }
 return Object.freeze({loadIndex,loadProject});
}
