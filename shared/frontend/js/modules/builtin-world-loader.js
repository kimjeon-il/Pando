import {createStoredAssetLoader} from './stored-asset-loader.js';
import {parseTemporal,temporalContains,temporalMonthEnd,normalizeTemporalInterval} from './temporal.js';
import {projectTimelineIdentity} from './timeline-resolver.js';

const contains=(rows,month)=>rows.some(row=>temporalContains(row,temporalMonthEnd(month)));
export function selectBuiltinCountries(index,month){
 if(index?.schema!=='pandolab-builtin-world'||index.schemaVersion!==2||!Array.isArray(index.entities))throw new Error('Invalid builtin country catalog');
 if(parseTemporal(month,{nullable:false}).precision!=='month')throw new Error('A query month is required');
 return index.entities.filter(entry=>contains(entry.coverage,month));
}
export function assembleBuiltinWorld(index,countries,month){
 const expected=selectBuiltinCountries(index,month),byId=new Map(countries.map(row=>[row.entityId,row]));
 if(byId.size!==countries.length||expected.length!==countries.length)throw new Error('Incomplete builtin country selection');
 const project=structuredClone(index.template),geometries=new Map();
 project.territorialEntities=[];project.geometries=[];
 project.timelineRecords={schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
 for(const entry of expected){
  const country=byId.get(entry.entityId);
  if(country?.schemaVersion!==2||country.identity?.id!==entry.entityId)throw new Error('Builtin country identity mismatch');
  let identity=structuredClone(country.identity);
  const bindings=country.sourceBindings;
  if(identity.properties.metadata?.historicalTimeline)identity.properties.metadata.historicalTimeline.geometryBindings=bindings;
  identity.properties.sourceGeometryVersion=bindings.find(row=>temporalContains(row,temporalMonthEnd(month)))?.sourceVersionId||'';
  // This loader materializes a single dated country snapshot. Apply the
  // selected name edition to its initial identity as well as retaining the
  // existing timeline binding, so the editor's static first frame uses the
  // correct historical name before explicit month-edit mode is activated.
  const names=country.timelineRecords.propertyBindings.filter(row=>row.property==='name'
   && temporalContains(row,temporalMonthEnd(month)));
  if(names.length>1)throw new Error('Conflicting dated country names: '+entry.entityId);
  if(names.length)identity=projectTimelineIdentity(identity,{name:names[0].value});
  const flags=country.timelineRecords.propertyBindings.filter(row=>row.property==='flag'
   && temporalContains(row,temporalMonthEnd(month)));
  if(flags.length>1)throw new Error('Conflicting dated country flags: '+entry.entityId);
  if(flags.length) {
   const {policy,embeddedDataUrl}=flags[0].value;
   // The name projection may have frozen the identity and its nested metadata.
   // Always materialize a fresh immutable historical flag edition instead
   // of mutating an earlier C++ timeline projection.
   const meta={...identity.properties.metadata};
   if(policy==='embedded')meta.flagDataUrl=embeddedDataUrl;
   else if(policy==='none')meta.flagDataUrl=null;
   else if(meta.defaultFlagDataUrl)meta.flagDataUrl=meta.defaultFlagDataUrl;
   else delete meta.flagDataUrl;
   identity={...identity,properties:{...identity.properties,metadata:meta}};
  }
  project.territorialEntities.push(identity);
  // A loaded scene contains the selected interval only. Other historical
  // intervals may refer to countries intentionally not downloaded this query.
  for(const name of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])
   project.timelineRecords[name].push(...country.timelineRecords[name].filter(row=>temporalContains(row,temporalMonthEnd(month)))
    .map(row=>({...row,validFrom:null,validTo:null})));
  for(const geometry of country.geometries){
   const key=JSON.stringify([geometry.id,geometry.version]),existing=geometries.get(key);
   if(existing&&JSON.stringify(existing)!==JSON.stringify(geometry))throw new Error('Conflicting builtin geometry');
   geometries.set(key,geometry);
  }
 }
 const used=new Set(project.timelineRecords.geometryBindings.map(row=>JSON.stringify([row.geometryRef.id,row.geometryRef.version])));
 project.geometries=[...geometries].filter(([key])=>used.has(key)).map(([,value])=>value);
 project.projectSetup={initialMonth:month,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
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
  const value=parse(bytes);
  if(value?.schema!=='pandolab-builtin-world'||value.schemaVersion!==2||value.storageLayout!=='country-files-v1'
   ||Object.hasOwn(value,'transport')||!Array.isArray(value.entities)
   ||!value.template||typeof value.template!=='object'||Array.isArray(value.template))throw new Error('Invalid builtin world index');
  const ids=new Set(),paths=new Set();
  for(const row of value.entities){
   if(!row||typeof row.entityId!=='string'||!row.entityId||ids.has(row.entityId)
    ||!/^countries\/[A-Za-z0-9_-]+-sha256-[a-f0-9]{64}\.json\.gz$/.test(row.file)
    ||!/^[a-f0-9]{64}$/.test(row.sha256)||row.file!==`countries/${row.entityId.replaceAll(':','-')}-sha256-${row.sha256}.json.gz`
    ||paths.has(row.file)||row.encoding!=='gzip'||Object.hasOwn(row,'offset')||!Array.isArray(row.coverage)
    ||!Number.isSafeInteger(row.compressedBytes)||row.compressedBytes<=0
    ||!Number.isSafeInteger(row.decodedBytes)||row.decodedBytes<=0)throw new Error('Invalid builtin country descriptor');
   for(const interval of row.coverage){
    if(!interval||!['validFrom','validTo'].every(key=>interval[key]===null||typeof interval[key]==='string'&&interval[key].trim()))throw new Error('Invalid builtin country coverage descriptor');
    normalizeTemporalInterval(interval.validFrom,interval.validTo);
   }
   ids.add(row.entityId);paths.add(row.file);
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
 async function loadCountry(entry){
  const key=entry.file;
  if(countries.has(key))return countries.get(key);
  // A shared file request is independent of any one month query's cancellation.
  if(!pending.has(key))pending.set(key,limitedRead(()=>assets.loadAsset({...entry,url:entry.file},
   'builtin-world',entry.entityId,entry.entityId,bytes=>parseCountry(bytes,entry)))
   .then(({value})=>{countries.set(key,value);return value;})
   .finally(()=>pending.delete(key)));
  return pending.get(key);
 }
 async function loadProject(month,{isCurrent=()=>true}={}){
  const assertCurrent=()=>{if(!isCurrent())throw Object.assign(new Error('Builtin query superseded'),{name:'AbortError',cancelled:true});};
  assertCurrent();
  const index=await loadIndex();assertCurrent();
  const selected=selectBuiltinCountries(index,month),loaded=new Array(selected.length);
  let next=0,failed=false;
  const workers=Array.from({length:Math.min(6,selected.length)},async()=>{
   try{
    while(!failed&&next<selected.length){
     assertCurrent();const i=next++;loaded[i]=await loadCountry(selected[i]);assertCurrent();
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
  assertCurrent();
  return {project:assembleBuiltinWorld(index,loaded,month),fingerprint:`${manifestSpec.sha256}:${month}`};
 }
 return Object.freeze({loadIndex,loadProject});
}
