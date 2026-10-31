import {createStoredAssetLoader} from './stored-asset-loader.js';
import {parseTemporal,temporalContains,temporalMonthEnd} from './temporal.js';
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
 const assets=createStoredAssetLoader({dataRevision,fetchFn,cacheStorage,resolveUrl:spec=>new URL(spec.url,base).href});
 let indexPromise,transportPromise;
 const countries=new Map(),pending=new Map();
 let activeReads=0;
 const readQueue=[];
 async function limitedRead(operation){
  if(activeReads===6)await new Promise(resolve=>readQueue.push(resolve));else activeReads++;
  try{return await operation();}finally{if(readQueue.length)readQueue.shift()();else activeReads--;}
 }
 async function loadIndex(){
  if(!indexPromise)indexPromise=assets.loadAsset({...manifestSpec,url:base.href},'builtin-world','index','국가 자료 목록',parse)
   .then(({value})=>{
    if(value.schema!=='pandolab-builtin-world'||value.schemaVersion!==2||!Array.isArray(value.entities)
      ||new Set(value.entities.map(row=>row.entityId)).size!==value.entities.length)throw new Error('Invalid builtin world index');
    const transport=value.transport;
    if(transport?.schemaVersion!==1||transport.encoding!=='identity'
      ||!/^transport\/countries-sha256-[a-f0-9]{64}\.bin$/.test(transport.url)||!transport.url.includes(transport.sha256)
      ||!/^[a-f0-9]{64}$/.test(transport.sha256)||!Number.isSafeInteger(transport.compressedBytes)||transport.compressedBytes<=0
      ||transport.decodedBytes!==transport.compressedBytes)throw new Error('Invalid builtin country transport');
    let offset=0;
    for(const row of value.entities){
     if(!/^countries\/[A-Za-z0-9_-]+-sha256-[a-f0-9]{64}\.json\.gz$/.test(row.file)
      ||!row.file.includes(row.sha256)||!Array.isArray(row.coverage)
      ||!Number.isSafeInteger(row.offset)||row.offset!==offset||!Number.isSafeInteger(row.compressedBytes)||row.compressedBytes<=0
      ||!Number.isSafeInteger(row.decodedBytes)||row.decodedBytes<=0)throw new Error('Invalid builtin country descriptor');
     offset+=row.compressedBytes;
     if(!Number.isSafeInteger(offset)||offset>transport.compressedBytes)throw new Error('Builtin country range exceeds transport');
    }
    if(offset!==transport.compressedBytes)throw new Error('Incomplete builtin country transport');
    return value;
   })
   .catch(error=>{indexPromise=null;throw error;});
  return indexPromise;
 }
 async function loadTransport(index){
  if(!transportPromise)transportPromise=assets.loadStoredAsset(index.transport,'builtin-world','transport','국가 자료 묶음',bytes=>bytes)
   .then(({value})=>value).catch(error=>{transportPromise=null;throw error;});
  return transportPromise;
 }
 async function loadCountry(entry,index){
  if(countries.has(entry.entityId))return countries.get(entry.entityId);
  if(!pending.has(entry.entityId))pending.set(entry.entityId,limitedRead(async()=>{
   const bytes=await loadTransport(index);
   return assets.decodeStoredAsset(bytes.slice(entry.offset,entry.offset+entry.compressedBytes),{...entry,encoding:'gzip'},'builtin-world',entry.entityId,entry.entityId,parse);
  })
   .then(({value})=>{if(value.entityId!==entry.entityId||value.schemaVersion!==2)throw new Error('Builtin country identity mismatch');countries.set(entry.entityId,value);return value;})
   .finally(()=>pending.delete(entry.entityId)));
  return pending.get(entry.entityId);
 }
 async function loadProject(month,{isCurrent=()=>true}={}){
  const index=await loadIndex(),selected=selectBuiltinCountries(index,month),loaded=new Array(selected.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(6,selected.length)},async()=>{
   while(next<selected.length){if(!isCurrent())throw Object.assign(new Error('Builtin query superseded'),{name:'AbortError',cancelled:true});const i=next++;loaded[i]=await loadCountry(selected[i],index);}
  }));
  return {project:assembleBuiltinWorld(index,loaded,month),fingerprint:`${manifestSpec.sha256}:${month}`};
 }
 return Object.freeze({loadIndex,loadProject});
}
