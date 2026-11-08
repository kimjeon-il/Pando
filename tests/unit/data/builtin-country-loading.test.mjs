import { describe as contractSuite } from 'node:test';
import * as __country_dep0 from "node:test";
import * as __country_dep1 from "node:assert/strict";
import * as __country_dep2 from "node:crypto";
import * as __country_dep3 from "node:zlib";
import * as __country_dep4 from "../../../src/data/builtin-world-loader.js";
import * as __country_dep5 from "../../../tools/build/build-builtin-world.mjs";
import * as __country_dep6 from "../../fixtures/historical-world-cases.mjs";
import * as __country_dep7 from "../../helpers/builtin-world.mjs";
import * as __country_dep8 from "node:fs";
import * as __country_dep9 from "node:os";
import * as __country_dep10 from "node:path";
import * as __country_dep11 from "node:child_process";
import * as __country_dep12_context from "../../../tools/data/library-context.mjs";
import * as __country_dep12_reports from "../../../tools/data/library-reports.mjs";
import * as __country_dep12_runtime from "../../../tools/data/library-runtime.mjs";
import * as __country_dep12_publication from "../../../tools/data/library-report-publication.mjs";
import * as __country_dep12_store from "../../../tools/data/library-store.mjs";
const __country_dep12={...__country_dep12_context,...__country_dep12_reports,...__country_dep12_runtime,...__country_dep12_publication,...__country_dep12_store};
contractSuite("builtin-country-loading", () => {
const test = __country_dep0.default;
const assert = __country_dep1.default;
const { createHash } = __country_dep2;
const { gzipSync } = __country_dep3;
const { createBuiltinWorldLoader } = __country_dep4;






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
 const index={schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',template:{format:'pandolab-project-state',schemaVersion:14},entities};
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

test('a complete logical timeline downloads every country once and limits concurrent reads to six',async()=>{
 const pub=publication([...Array.from({length:9},(_,i)=>({id:'state:'+i})),
  {id:'future',coverage:[{validFrom:'2030',validTo:null}]}]);
 const f=reader(pub,{beforeFetch:()=>new Promise(resolve=>setTimeout(resolve,3))});
 const [one,two]=await Promise.all([f.loader.loadProject('2026-10'),f.loader.loadProject('2026-11')]);
 assert.equal(one.project.territorialEntities.length,10);assert.equal(two.project.territorialEntities.length,10);
 assert.equal(countryCalls(f).length,10);assert.equal(new Set(countryCalls(f)).size,10);
 assert.ok(f.peak()<=6);assert.ok(f.peak()>1);
 assert.equal(f.calls.filter(row=>row.file==='index.json').length,1);
 assert.equal(f.calls.some(row=>/transport|world-project/.test(row.file)),false);
 const prior=f.calls.length;await f.loader.loadProject('2026-12');assert.equal(f.calls.length,prior);
 const later=await f.loader.loadProject('2030-01');assert.equal(later.project.territorialEntities.length,10);
 assert.equal(f.calls.length,prior,'a month change never fetches another country');
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
 assert.equal(countryCalls(f).filter(file=>file===target).length,1,'404 is not a transient download failure');
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


test('background direct country reads retain the main concurrency limit and idle admission',async()=>{
 const pub=publication([{id:'A'},{id:'B'},{id:'C'}]);let yields=0;
 const f=reader(pub,{beforeFetch:()=>new Promise(resolve=>setTimeout(resolve,1))});
 const result=await f.loader.loadProject('2026-10',{concurrency:1,waitForIdle:async()=>{yields++;}});
 assert.equal(result.project.territorialEntities.length,3);
 assert.equal(f.peak(),1);
 assert.equal(yields,4); // Each country and the final publication wait for idle.
 assert.deepEqual(countryCalls(f),pub.index.entities.map(row=>row.file));
});

test('cancellation during idle prevents country requests and scene publication',async()=>{
 const f=reader(publication([{id:'A'}]));let current=true;
 await assert.rejects(f.loader.loadProject('2026-10',{
  isCurrent:()=>current,concurrency:1,waitForIdle:async()=>{current=false;}
 }),error=>error.name==='AbortError');
 assert.deepEqual(f.calls.map(row=>row.file),['index.json']);
});

test('invalid per-query country concurrency rejects before fetching the catalog',async()=>{
 for(const concurrency of [0,7,1.5,NaN]){
  const f=reader(publication([{id:'A'}]));
  await assert.rejects(f.loader.loadProject('2026-10',{concurrency}),RangeError);
  assert.equal(f.calls.length,0);
 }
});
});
contractSuite("builtin-country-retry", () => {
const test = __country_dep0.default;
const assert = __country_dep1.default;
const { createHash } = __country_dep2;
const { buildBuiltinWorldPublication } = __country_dep5;
const { historicalWorldCases } = __country_dep6;
const { withExplicitView } = __country_dep7;
const { createBuiltinWorldLoader } = __country_dep4;








const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test('a failed query settles its outstanding failed reads before an immediate clean retry',async t=>{
 const files=buildBuiltinWorldPublication({input:withExplicitView(historicalWorldCases())});
 const index=JSON.parse(files.get('index.json'));index.entities=index.entities.filter(row=>['AUS','CHN'].includes(row.entityId));
 assert.equal(index.entities.length,2);
 const bytes=Buffer.from(JSON.stringify(index));files.set('index.json',bytes);
 const slow=index.entities[1].file,entered=deferred(),release=deferred();t.after(()=>release.resolve());
 const calls=[];let successful=false,slowAttempts=0,settled=false;
 const loader=createBuiltinWorldLoader({manifestUrl:'https://retry.test/data/index.json',
  manifestSpec:{sha256:createHash('sha256').update(bytes).digest('hex'),encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length},
  dataRevision:'retry',cacheStorage:null,fetchFn:async url=>{
   const file=new URL(url).pathname.slice('/data/'.length);calls.push(file);
   if(file==='index.json')return new Response(bytes);
   const fail=!successful;
   if(fail&&file===slow&&++slowAttempts===3){entered.resolve();await release.promise;}
   return fail?new Response(null,{status:503}):new Response(files.get(file));
  }});
 const first=loader.loadProject('2026-10').then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 await entered.promise;await new Promise(resolve=>globalThis.setImmediate(resolve));
 // The fast file has failed; the slower file's last failed attempt is still held.
 // Returning now would let an immediate retry join that doomed pending request.
 assert.equal(settled,false,'failed query must drain its outstanding workers');
 release.resolve();assert.match((await first).message,/503/);
 successful=true;
 assert.equal((await loader.loadProject('2026-10')).project.territorialEntities.length,2);
 for(const entry of index.entities)assert.equal(calls.filter(file=>file===entry.file).length,4);
});
});
contractSuite("builtin-country-materialization", () => {
const test = __country_dep0.default;
const assert = __country_dep1.default;
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = __country_dep8;
const { tmpdir } = __country_dep9;
const { join, dirname } = __country_dep10;
const { execFileSync } = __country_dep11;
const { createHash } = __country_dep2;
const { gzipSync } = __country_dep3;
const { prepareLibraryData, storeLibraryData } = __country_dep12;










const base='assets/data/builtin-world/generated/v1/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t,{missingPart=false,badHash=false,legacy=false}={}){
 const parent=mkdtempSync(join(tmpdir(),'pando-country-runtime-')),root=join(parent,'app'),data=join(root,'.library-data/repository');
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const put=(dir,path,bytes)=>{mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);};
 const git=(dir,...args)=>execFileSync('git',['-c','core.autocrlf=false','-c','core.fsync=none',...args],{cwd:dir,encoding:'utf8',stdio:'pipe'}).trim();
 for(const dir of [root,data]){mkdirSync(dir,{recursive:true});git(dir,'init','-q');git(dir,'config','user.name','Fixture');git(dir,'config','user.email','fixture@example.invalid');}
 const files={},archive=(path,bytes,{absent=false}={})=>{
  bytes=Buffer.from(bytes);if(!absent)put(data,path,bytes);
  files[path]={stored:path,encoding:'identity',sha256:hash(bytes),bytes:bytes.length};
 };
 const decoded=Buffer.from('{"entityId":"state:test","schemaVersion":2}\n'),bytes=gzipSync(decoded);
 const country={entityId:'state:test',file:`countries/state-test-sha256-${hash(bytes)}.json.gz`,sha256:hash(bytes),encoding:'gzip',compressedBytes:bytes.length,decodedBytes:decoded.length};
 const pieces=[bytes.subarray(0,20),bytes.subarray(20)];
 country.parts=pieces.map((piece,i)=>{
  const file=`country-parts/sha256-${hash(piece)}.bin`;
  archive(base+file,piece,{absent:missingPart&&i===1});
  return {file,encoding:'identity',sha256:hash(piece),compressedBytes:piece.length,decodedBytes:piece.length};
 });
 if(badHash)files[base+country.parts[0].file].sha256='0'.repeat(64);
 const retired=[base+'transport/countries-sha256-'+hash(Buffer.from('retired'))+'.bin',base+country.file,base+'countries/orphan.json.gz'];
 for(const path of retired)archive(path,path===base+country.file?bytes:Buffer.from('retired'),{absent:!legacy});
 const index={schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',inputHashes:{sourceRevisions:{}},entities:[country]};
 if(legacy){delete index.storageLayout;index.transport={url:retired[0].slice(base.length)};}
 archive(base+'index.json',JSON.stringify(index));
 // Runtime publication now verifies paired source indexes even for a
 // built-in-country-only storage scope. Model the immutable empty source
 // corpus, rather than relying on a missing archive file in this fixture.
 archive('assets/data/territorial-entities/generated/v2/index.json',JSON.stringify({entities:[]}));
 archive(base+'coverage-report.json','{}');archive('assets/data/other/value.bin','unchanged');
 put(data,'archive/index.json',JSON.stringify({schemaVersion:1,branch:'main',files}));put(data,'library.json','{}');
 git(data,'add','.');git(data,'commit','-qm','archived fixture');const pin=git(data,'rev-parse','HEAD');
 put(root,'config/library-data.json',JSON.stringify({repository:'fixture/data',revision:pin,mounts:['assets/data','reports']}));
 put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','app');
 return {root,data,git,files,retired,pin,country};
}

test('runtime preparation needs only active builtin files and broad storage preserves unhydrated archive history',t=>{
 const f=fixture(t);
 prepareLibraryData({root:f.root,fetch:false});
 for(const part of f.country.parts)assert.ok(existsSync(join(f.root,base+part.file)));
 for(const path of f.retired)assert.equal(existsSync(join(f.root,path)),false,path);
 assert.equal(readFileSync(join(f.root,'assets/data/other/value.bin'),'utf8'),'unchanged');
 assert.equal(f.git(f.data,'rev-parse','HEAD'),f.pin);
 storeLibraryData({root:f.root,prefixes:['assets/data/builtin-world']});
 const stored=JSON.parse(f.git(f.data,'show','HEAD:archive/index.json'));
 for(const [path,entry]of Object.entries(f.files))assert.deepEqual(stored.files[path],entry,path);
});

test('missing active country part is never excused as an archived orphan',t=>{
 const f=fixture(t,{missingPart:true});
 assert.throws(()=>prepareLibraryData({root:f.root,fetch:false}),/country-parts/);
 assert.equal(f.git(f.data,'rev-parse','HEAD'),f.pin);
});

test('country catalog and archive must agree on the active file integrity pins',t=>{
 const f=fixture(t,{badHash:true});
 assert.throws(()=>prepareLibraryData({root:f.root,fetch:false}),/country.*(?:pin|integrity)|(?:pin|integrity).*country/i);
 assert.equal(f.git(f.data,'rev-parse','HEAD'),f.pin);
});

test('explicit preparation of a historical data pin remains available for one-time conversion',t=>{
 const f=fixture(t,{legacy:true});
 prepareLibraryData({root:f.root,fetch:false});
 for(const path of f.retired)assert.ok(existsSync(join(f.root,path)),path);
});
});
