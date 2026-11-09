import {createStoredAssetLoader} from "./stored-asset-loader.js";
import {parseTemporal,temporalContains,temporalMonthEnd,normalizeTemporalInterval,sharedCalculationCore} from "../document/temporal.js";
import {builtinCountryAssets,validateBuiltinReadIndex} from "./builtin-country-files.js";
import {createBuiltinProjectSetup} from "../document/project-setup.js";
import {PROJECT_SCHEMA_VERSION} from "../runtime/version-contract.js";
import {validateMapProjectManifest,mapProjectResourcePath} from "./map-project-manifest.js";

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
export function createBuiltinWorldLoader({manifestUrl,manifestSpec,dataRevision,projectManifest=null,catalogReceipt=null,
  fetchFn=globalThis.fetch,cacheStorage=globalThis.caches}){
  if(!manifestUrl||!manifestSpec?.sha256||!dataRevision)throw new Error('Builtin country catalog integrity metadata is required');
  const selectedProject=projectManifest===null?null:validateMapProjectManifest(projectManifest);
  if(selectedProject){
    const catalog=mapProjectResourcePath(selectedProject,selectedProject.document.sourceRole);
    if(manifestSpec.url!==catalog||catalogReceipt?.catalog!==catalog
      ||catalogReceipt?.sha256!==manifestSpec.sha256)
      throw new TypeError('Project territorial catalog differs from the verified builtin resource');
  }
  // This describes immutable content, not the runtime document. C++ retains
  // the sole authority to admit an actual documentId and dated world.
  const contentProject=selectedProject?Object.freeze({
    manifest:selectedProject,dataRevision,catalogSha256:manifestSpec.sha256,
  }):null;
 const base=new URL(manifestUrl,globalThis.location?.href),parse=bytes=>JSON.parse(new TextDecoder().decode(bytes));
 const assetOptions={dataRevision,fetchFn,cacheStorage,resolveUrl:spec=>new URL(spec.url,base).href};
 // The mutable catalog belongs to a revision. Content-hashed countries do not:
 // unchanged files must survive a newer catalog/data revision without refetching.
 const catalogs=createStoredAssetLoader(assetOptions);
 const assets=createStoredAssetLoader({...assetOptions,cachePolicy:'immutable'});
 let indexPromise,readMetadata;
 const geometries=new Map(),pending=new Map(),geometryStates=new Map();
 let activeReads=0;
 const readQueue=[];
 async function limitedRead(operation){
  if(activeReads===6)await new Promise(resolve=>readQueue.push(resolve));else activeReads++;
  try{return await operation();}finally{if(readQueue.length)readQueue.shift()();else activeReads--;}
 }
 function parseIndex(bytes){
  const value=parse(bytes);builtinCountryAssets(value);
  if(value.template?.schemaVersion!==PROJECT_SCHEMA_VERSION||value.template?.format!=='pandolab-project-state'
    ||Object.hasOwn(value.template,'projectSetup'))throw new Error('Invalid builtin world index');
  const read=validateBuiltinReadIndex(value);
  const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
  freeze(read);freeze(value.template);
  readMetadata={...value.template,territorialEntities:read.identities,timelineRecords:read.records,
    geometryResources:freeze(value.geometryAssets.map(({id,version,type,contentSha256,decodedBytes})=>({id,version,type,contentSha256,decodedBytes})))};
  for(const row of value.entities){
   if(!Array.isArray(row.coverage))throw new Error('Invalid builtin country coverage descriptor');
   for(const interval of row.coverage){
    if(!interval||!['validFrom','validTo'].every(key=>interval[key]===null||typeof interval[key]==='string'&&interval[key].trim()))throw new Error('Invalid builtin country coverage descriptor');
    normalizeTemporalInterval(interval.validFrom,interval.validTo);
   }
  }
  return value;
 }
 async function loadIndex(){
  if(!indexPromise)indexPromise=catalogs.loadAsset({...manifestSpec,url:base.href},'builtin-world','index','국가 자료 목록',parseIndex)
   .then(({value})=>value).catch(error=>{indexPromise=null;throw error;});
  return indexPromise;
 }
 async function loadGeometry(asset){
  const key=asset.file;
  if(geometries.has(key))return geometries.get(key);
  if(!pending.has(key)){
   geometryStates.set(key,'loading');
   pending.set(key,limitedRead(()=>assets.loadAsset({...asset,url:asset.file},
   'builtin-world',asset.id,'국가 형상',async buffer=>{
    const digest=await globalThis.crypto.subtle.digest('SHA-256',buffer);
    const actual=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(actual!==asset.contentSha256)throw Error('Builtin geometry content hash mismatch: '+asset.id);
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer);
   })).then(({value})=>{geometries.set(key,value);geometryStates.set(key,'ready');return value;})
   .catch(error=>{geometryStates.set(key,'error');throw error;}).finally(()=>pending.delete(key)));
  }
  return pending.get(key);
 }
 async function loadGeometryResources(requirements,{isCurrent=()=>true}={}){
  const index=await loadIndex(),byRef=new Map(index.geometryAssets.map(asset=>[JSON.stringify([asset.id,asset.version]),asset]));
  const rows=await Promise.all(requirements.map(async requirement=>{
   if(!isCurrent())throw Object.assign(Error('Builtin geometry request superseded'),{name:'AbortError',cancelled:true});
   const asset=byRef.get(JSON.stringify([requirement.id,requirement.version]));
   if(!asset||['type','contentSha256','decodedBytes'].some(key=>asset[key]!==requirement[key]))throw Error('Builtin geometry requirement does not match pinned catalog');
   return {id:asset.id,version:asset.version,source:await loadGeometry(asset)};
  }));
  if(!isCurrent())throw Object.assign(Error('Builtin geometry request superseded'),{name:'AbortError',cancelled:true});
  return rows;
 }
 async function geometryState(ref){
  const index=await loadIndex(),asset=index.geometryAssets.find(asset=>asset.id===ref.id&&asset.version===ref.version);
  if(!asset)throw Error('Unknown builtin geometry reference');
  return geometryStates.get(asset.file)||'unloaded';
 }
 async function loadProject(month,{isCurrent=()=>true,concurrency=6,waitForIdle=null}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>6)throw new RangeError('Builtin country read concurrency must be 1-6.');
  const assertCurrent=()=>{if(!isCurrent())throw Object.assign(new Error('Builtin query superseded'),{name:'AbortError',cancelled:true});};
  assertCurrent();
  const index=await loadIndex();assertCurrent();
  async function loadAll(selected,read){
  const loaded=new Array(selected.length);
  let next=0,failed=false;
  const workers=Array.from({length:Math.min(concurrency,selected.length)},async()=>{
   try{
    while(!failed&&next<selected.length){
     assertCurrent();
     if(waitForIdle){await waitForIdle();assertCurrent();}
     if(failed||next>=selected.length)break;
     const i=next++;loaded[i]=await read(selected[i]);assertCurrent();
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
  return loaded;
  }
  // Published metadata is immutable. Only active geometry is loaded; no
  // country-document reconstruction or parallel runtime model is retained.
  queryMonthEnd(month);
  const project={...readMetadata,projectSetup:createBuiltinProjectSetup(month),geometries:[]};
  const catalog=new Map(index.geometryAssets.map(asset=>[JSON.stringify([asset.id,asset.version]),asset]));
  const world=sharedCalculationCore.timelineResolveWorld(project.timelineRecords,{
   entities:project.territorialEntities.map(row=>({objectRef:{domain:'territorial',id:row.id},entityKind:row.properties.entityKind})),
   geometryExists:ref=>catalog.has(JSON.stringify([ref.id,ref.version])),
  },month);
  const required=new Map(world.entities.map(row=>{const key=JSON.stringify([row.geometryRef.id,row.geometryRef.version]);return[key,catalog.get(key)];}));
  project.geometries=await loadAll([...required.values()],async asset=>({id:asset.id,version:asset.version,source:await loadGeometry(asset)}));
  if(waitForIdle)await waitForIdle();
  assertCurrent();
  return {project,fingerprint:`${manifestSpec.sha256}:complete-timeline`,contentProject};
 }
 return Object.freeze({loadIndex,loadProject,loadGeometryResources,geometryState});
}
