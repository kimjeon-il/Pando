import {createStoredAssetLoader} from './stored-asset-loader.js';
import {appendBaikonurBoundaryAttribution} from './builtin-subunits.js';
import {parseTemporal,temporalContains,temporalMonthEnd} from './temporal.js';

const modeFor=(month,currentMonth)=>month===currentMonth?'current':'dated';
const contains=(rows,month)=>rows.some(row=>temporalContains(row,temporalMonthEnd(month)));
export function selectBuiltinCountries(index,month,currentMonth=null){
 if(index?.schema!=='pandolab-builtin-world'||index.schemaVersion!==1||!Array.isArray(index.entities))throw new Error('Invalid builtin country catalog');
 if(parseTemporal(month,{nullable:false}).precision!=='month'||(currentMonth!==null&&parseTemporal(currentMonth,{nullable:false}).precision!=='month'))throw new Error('A query month is required');
 const mode=modeFor(month,currentMonth);
 return index.entities.filter(entry=>contains(entry.coverage[mode],month));
}
export function assembleBuiltinWorld(index,countries,month,currentMonth=null){
 const expected=selectBuiltinCountries(index,month,currentMonth),byId=new Map(countries.map(row=>[row.entityId,row]));
 if(byId.size!==countries.length||expected.length!==countries.length)throw new Error('Incomplete builtin country selection');
 const project=structuredClone(index.template),geometries=new Map();
 project.territorialEntities=[];project.geometries=[];
 project.timelineRecords={schemaVersion:2,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
 const mode=modeFor(month,currentMonth);
 for(const entry of expected){
  const country=byId.get(entry.entityId);
  if(country?.schemaVersion!==1||country.identity?.id!==entry.entityId)throw new Error('Builtin country identity mismatch');
  const identity=structuredClone(country.identity);
  if(mode==='current'){
   const sourceId=identity.properties?.metadata?.builtinSubunit?.sourceCountryId === 'KAB' ? 'KAB' : identity.id;
   if(sourceId==='KAB'||sourceId==='KAZ')
    identity.properties.notes=appendBaikonurBoundaryAttribution(identity.properties.notes,sourceId);
  }
  const bindings=country.sourceBindings[mode];
  if(identity.properties.metadata?.historicalTimeline)identity.properties.metadata.historicalTimeline.geometryBindings=bindings;
  identity.properties.sourceGeometryVersion=bindings.find(row=>temporalContains(row,temporalMonthEnd(month)))?.sourceVersionId||'';
  project.territorialEntities.push(identity);
  // A loaded scene contains the selected interval only. Other historical
  // intervals may refer to countries intentionally not downloaded this query.
  for(const name of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])
   project.timelineRecords[name].push(...country.modes[mode][name].filter(row=>temporalContains(row,temporalMonthEnd(month)))
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
    if(value.schema!=='pandolab-builtin-world'||value.schemaVersion!==1||!Array.isArray(value.entities)
      ||new Set(value.entities.map(row=>row.entityId)).size!==value.entities.length)throw new Error('Invalid builtin world index');
    const transport=value.transport;
    if(transport?.schemaVersion!==1||transport.encoding!=='identity'
      ||!/^transport\/countries-sha256-[a-f0-9]{64}\.bin$/.test(transport.url)||!transport.url.includes(transport.sha256)
      ||!/^[a-f0-9]{64}$/.test(transport.sha256)||!Number.isSafeInteger(transport.compressedBytes)||transport.compressedBytes<=0
      ||transport.decodedBytes!==transport.compressedBytes)throw new Error('Invalid builtin country transport');
    let offset=0;
    for(const row of value.entities){
     if(!/^countries\/[A-Za-z0-9_-]+-sha256-[a-f0-9]{64}\.json\.gz$/.test(row.file)
      ||!row.file.includes(row.sha256)||!row.coverage?.dated||!row.coverage?.current
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
   .then(({value})=>{if(value.entityId!==entry.entityId||value.schemaVersion!==1)throw new Error('Builtin country identity mismatch');countries.set(entry.entityId,value);return value;})
   .finally(()=>pending.delete(entry.entityId)));
  return pending.get(entry.entityId);
 }
 async function loadProject(month,currentMonth,{isCurrent=()=>true}={}){
  const index=await loadIndex(),selected=selectBuiltinCountries(index,month,currentMonth),loaded=new Array(selected.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(6,selected.length)},async()=>{
   while(next<selected.length){if(!isCurrent())throw Object.assign(new Error('Builtin query superseded'),{name:'AbortError',cancelled:true});const i=next++;loaded[i]=await loadCountry(selected[i],index);}
  }));
  return {project:assembleBuiltinWorld(index,loaded,month,currentMonth),fingerprint:`${manifestSpec.sha256}:${month}:${modeFor(month,currentMonth)}`};
 }
 return Object.freeze({loadIndex,loadProject});
}
