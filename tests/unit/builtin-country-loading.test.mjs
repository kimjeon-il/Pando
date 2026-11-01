import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createBuiltinWorldLoader} from '../../shared/frontend/js/modules/builtin-world-loader.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value));
const base='https://test.local/data/';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function country(id){
 return {schemaVersion:2,entityId:id,identity:{id,properties:{name:id,metadata:{}}},sourceBindings:[],geometries:[],
  timelineRecords:{schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]}};
}
function publication(rows){
 const files=new Map(),entities=[];
 for(const {id,coverage=[{validFrom:null,validTo:null}],value=country(id)} of rows){
  const decoded=json(value),stored=gzipSync(decoded),hash=sha(stored);
  const file=`countries/${id.replaceAll(':','-')}-sha256-${hash}.json.gz`;
  files.set(file,stored);entities.push({entityId:id,coverage,file,encoding:'gzip',sha256:hash,compressedBytes:stored.length,decodedBytes:decoded.length});
 }
 const index={schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',template:{},entities};
 files.set('index.json',json(index));return {files,index};
}
function memoryCache(){
 const stores=new Map();
 return {stores,open:async name=>{
  if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);
  return {match:async key=>values.get(key)?.clone(),put:async(key,value)=>{values.set(key,value.clone());},delete:async key=>values.delete(key)};
 },keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name)};
}
function reader(pub,{cacheStorage=null,dataRevision='first',beforeFetch=async()=>{},response=null}={}){
 const calls=[];let active=0,peak=0;
 const bytes=pub.files.get('index.json');
 const loader=createBuiltinWorldLoader({manifestUrl:base+'index.json',manifestSpec:{sha256:sha(bytes),encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length},dataRevision,cacheStorage,
  fetchFn:async(url,options)=>{
   const file=new URL(url).pathname.slice('/data/'.length);calls.push({file,options});active++;peak=Math.max(peak,active);
   try{await beforeFetch(file);const value=pub.files.get(file);return response?.(file,options)??new Response(value,{status:value?200:404});}finally{active--;}
  }});
 return {loader,calls,peak:()=>peak};
}
const countryCalls=f=>f.calls.filter(row=>row.file.startsWith('countries/')).map(row=>row.file);

test('direct country requests are selected by month, deduplicated and globally limited to six',async()=>{
 const pub=publication([...Array.from({length:9},(_,i)=>({id:'state:'+i})),
  {id:'future',coverage:[{validFrom:'2030',validTo:null}]}]);
 const f=reader(pub,{beforeFetch:()=>new Promise(resolve=>setTimeout(resolve,3))});
 const [one,two]=await Promise.all([f.loader.loadProject('2026-10'),f.loader.loadProject('2026-11')]);
 assert.equal(one.project.territorialEntities.length,9);assert.equal(two.project.territorialEntities.length,9);
 assert.equal(countryCalls(f).length,9);assert.equal(new Set(countryCalls(f)).size,9);
 assert.ok(f.peak()<=6);assert.ok(f.peak()>1);
 assert.equal(f.calls.filter(row=>row.file==='index.json').length,1);
 assert.equal(f.calls.some(row=>/transport|world-project/.test(row.file)),false);
 const prior=f.calls.length;await f.loader.loadProject('2026-12');assert.equal(f.calls.length,prior);
 const later=await f.loader.loadProject('2030-01');assert.equal(later.project.territorialEntities.length,10);
 assert.equal(f.calls.length,prior+1);
});

test('a changed revision reuses unchanged country cache entries and fetches only the changed country',async()=>{
 const cacheStorage=memoryCache(),first=publication([{id:'A'},{id:'B'}]);
 await reader(first,{cacheStorage}).loader.loadProject('2026-10');
 const edited=country('B');edited.identity.properties.name='changed';
 const next=publication([{id:'A'},{id:'B',value:edited}]),f=reader(next,{cacheStorage,dataRevision:'second'});
 const result=await f.loader.loadProject('2026-10');
 assert.deepEqual(f.calls.map(row=>row.file),['index.json',next.index.entities[1].file]);
 assert.equal(result.project.territorialEntities.find(row=>row.id==='B').properties.name,'changed');
 assert.equal(first.index.entities[0].file,next.index.entities[0].file);
 assert.ok(cacheStorage.stores.has('pandolab-world-content-v1'));
 const again=reader(next,{cacheStorage,dataRevision:'second'});await again.loader.loadProject('2026-10');assert.equal(again.calls.length,0);
});

test('corrupt cached country bytes are repaired without redownloading other countries',async()=>{
 const cacheStorage=memoryCache(),pub=publication([{id:'A'},{id:'B'}]);
 await reader(pub,{cacheStorage}).loader.loadProject('2026-10');
 const target=pub.index.entities[0].file;
 for(const values of cacheStorage.stores.values())if(values.has(base+target))values.set(base+target,new Response('corrupt'));
 const f=reader(pub,{cacheStorage});assert.equal((await f.loader.loadProject('2026-10')).project.territorialEntities.length,2);
 assert.deepEqual(f.calls.map(row=>row.file),[target]);
});

test('a missing country rejects the complete query, retries only that file and can recover',async()=>{
 const pub=publication([{id:'A'},{id:'B'}]),target=pub.index.entities[1].file;let missing=true;
 const f=reader(pub,{response:file=>file===target&&missing?new Response(null,{status:404}):null});
 await assert.rejects(f.loader.loadProject('2026-10'),/404/);
 assert.equal(countryCalls(f).filter(file=>file===target).length,3);
 assert.equal(countryCalls(f).filter(file=>file!==target).length,1);
 missing=false;const result=await f.loader.loadProject('2026-10');assert.equal(result.project.territorialEntities.length,2);
 assert.equal(countryCalls(f).filter(file=>file!==target).length,1);
});

test('invalid country schema or identity is not accepted even with a correct byte hash',async()=>{
 await Promise.all([
  value=>{value.identity.id='wrong';},value=>{value.schemaVersion=99;},value=>{delete value.timelineRecords.propertyBindings;}
 ].map(async change=>{
  const value=country('A');change(value);const pub=publication([{id:'A',value}]),f=reader(pub);
  await assert.rejects(f.loader.loadProject('2026-10'),/country|schema|identity/i);
 }));
});

test('bad descriptors and retired packed indexes fail before any country request',async()=>{
 await Promise.all([
  index=>{index.entities[0].file='../outside.gz';},
  index=>{index.entities[0].sha256='a'.repeat(64);},
  index=>{index.entities[0].encoding='identity';},
  index=>{index.entities[0].offset=0;},
  index=>{index.entities.push({...index.entities[0]});},
  index=>{index.storageLayout='packed';},
  index=>{index.transport={url:'transport/old.bin'};}
 ].map(async change=>{
  const pub=publication([{id:'A'}]);change(pub.index);pub.files.set('index.json',json(pub.index));const f=reader(pub);
  await assert.rejects(f.loader.loadProject('2026-10'),/index|descriptor|catalog|layout|transport/i);
  assert.equal(countryCalls(f).length,0);
 }));
});

test('supersession while the last country is pending cannot publish the old query or poison a shared new query',async()=>{
 const pub=publication([{id:'A'}]),entered=deferred(),held=deferred();let current=true;
 const f=reader(pub,{beforeFetch:async file=>{if(file!=='index.json'){entered.resolve();await held.promise;}}});
 const earlier=f.loader.loadProject('2026-10',{isCurrent:()=>current});
 const rejected=assert.rejects(earlier,error=>error.name==='AbortError'&&error.cancelled===true);
 await entered.promise;current=false;const latest=f.loader.loadProject('2026-11');held.resolve();
 await rejected;assert.equal((await latest).project.projectSetup.initialMonth,'2026-11');assert.equal(countryCalls(f).length,1);
});

test('a superseded empty query rejects even when there are no country workers',async()=>{
 const pub=publication([]),entered=deferred(),held=deferred();let current=true;
 const f=reader(pub,{beforeFetch:async()=>{entered.resolve();await held.promise;}});
 const pending=f.loader.loadProject('2026-10',{isCurrent:()=>current});
 const rejected=assert.rejects(pending,error=>error.name==='AbortError');
 await entered.promise;current=false;held.resolve();await rejected;assert.equal(countryCalls(f).length,0);
});

test('an already superseded query makes no request',async()=>{
 const f=reader(publication([{id:'A'}]));
 await assert.rejects(f.loader.loadProject('2026-10',{isCurrent:()=>false}),error=>error.name==='AbortError');
 assert.equal(f.calls.length,0);
});

test('a correct stored hash with an incorrect decoded size rejects the country',async()=>{
 const pub=publication([{id:'A'}]);pub.index.entities[0].decodedBytes++;
 pub.files.set('index.json',json(pub.index));const f=reader(pub);
 await assert.rejects(f.loader.loadProject('2026-10'),/크기|size/i);
});

test('loading still works when persistent cache access is unavailable',async()=>{
 const pub=publication([{id:'A'}]),cacheStorage={open:async()=>{throw Error('storage unavailable');}};
 const f=reader(pub,{cacheStorage});assert.equal((await f.loader.loadProject('2026-10')).project.territorialEntities.length,1);
 const count=f.calls.length;await f.loader.loadProject('2026-11');assert.equal(f.calls.length,count);
});
