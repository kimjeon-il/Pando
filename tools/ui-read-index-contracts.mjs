import {readFileSync,writeFileSync} from 'node:fs';
const path='tests/unit/data/builtin-country-loading.test.mjs';
let s=readFileSync(path,'utf8');
s="import {compileBuiltinReadIndex} from '../../../src/data/builtin-country-files.js';\n"+s;
let a=s.indexOf('function country(id){'),b=s.indexOf('function memoryCache()',a);
if(a<0||b<a)throw Error('Country fixture changed');
s=s.slice(0,a)+String.raw`function country(id){
 const geometryRef={id:'geometry:'+id,version:1},objectRef={domain:'territorial',id};
 const interval={objectRef,validFrom:null,validTo:null};
 return {schemaVersion:3,entityId:id,identity:{id,properties:{name:id,entityKind:'general',metadata:{}}},sourceBindings:[],geometryRefs:[geometryRef],
  timelineRecords:{schemaVersion:3,lifetimes:[{id:'life:'+id,...interval}],geometryBindings:[{id:'shape:'+id,...interval,geometryRef}],
    parentRelations:[{id:'parent:'+id,...interval,parentId:'',coverageMode:'explicit'}],propertyBindings:[]}};
}
function publication(rows){
 const files=new Map(),entities=[],descriptors=[],geometryAssets=[];
 for(const {id,coverage=[{validFrom:null,validTo:null}],value=country(id)} of rows){
  for(const name of ['lifetimes','geometryBindings','parentRelations'])value.timelineRecords[name]?.forEach(row=>Object.assign(row,coverage[0]));
  const decoded=json(value),stored=gzipSync(decoded),hash=sha(stored);
  const file='countries/'+id.replaceAll(':','-')+'-sha256-'+hash+'.json.gz';
  files.set(file,stored);entities.push({geometryRefs:value.geometryRefs,entityId:id,coverage,file,encoding:'gzip',sha256:hash,compressedBytes:stored.length,decodedBytes:decoded.length});
  descriptors.push(value);
  const x=rows.findIndex(row=>row.id===id),shape={type:'Polygon',coordinates:[[[x,0],[x+0.5,0],[x+0.5,0.5],[x,0]]]},bytes=json(shape),compressed=gzipSync(bytes),digest=sha(compressed);
  const asset={...value.geometryRefs[0],type:'Polygon',file:'geometries/sha256-'+digest+'.json.gz',sha256:digest,contentSha256:sha(bytes),encoding:'gzip',compressedBytes:compressed.length,decodedBytes:bytes.length};
  files.set(asset.file,compressed);geometryAssets.push(asset);
 }
 const index={schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'descriptor-geometries-v1',geometryAssets,template:{format:'pandolab-project-state',schemaVersion:14},entities};
 index.readIndex=compileBuiltinReadIndex(index,descriptors);
 files.set('index.json',json(index));return {files,index};
}
`+s.slice(b);
s=s.replace("const countryCalls=f=>f.calls.filter(row=>row.file.startsWith('countries/')).map(row=>row.file);","const countryCalls=f=>f.calls.filter(row=>row.file.startsWith('geometries/')).map(row=>row.file);")
 .replace('a complete logical timeline downloads every country once and limits concurrent reads to six','a complete temporal index loads only active geometry once and limits concurrent reads to six')
 .replace('assert.equal(countryCalls(f).length,10);assert.equal(new Set(countryCalls(f)).size,10);','assert.equal(countryCalls(f).length,9);assert.equal(new Set(countryCalls(f)).size,9);')
 .replace("assert.equal(f.calls.length,prior,'a month change never fetches another country');","assert.equal(f.calls.length,prior+1,'a future identity loads only its newly active geometry');")
 .replace('a changed revision reuses unchanged country cache entries and fetches only the changed country','a name-only revision fetches only the temporal index and reuses every geometry')
 .replace("['index.json',next.index.entities[1].file]","['index.json']")
 .replace('const target=pub.index.entities[0].file;','const target=pub.index.geometryAssets[0].file;')
 .replace('target=pub.index.entities[1].file','target=pub.index.geometryAssets[1].file')
 .replace("test('invalid country schema or identity is not accepted even with a correct byte hash',async()=>{","test('the compiler rejects invalid country schema or identity before publishing the temporal index',async()=>{")
 .replace("const value=country('A');change(value);const pub=publication([{id:'A',value}]),f=reader(pub);\n  await assert.rejects(f.loader.loadProject('2026-10'),/country|schema|identity/i);","const value=country('A');change(value);assert.throws(()=>publication([{id:'A',value}]),/read index|descriptor|country|schema|identity/i);")
 .replace('pub.index.entities[0].decodedBytes++;','pub.index.geometryAssets[0].decodedBytes++;')
 .replace('pub.index.entities.map(row=>row.file));','pub.index.geometryAssets.map(row=>row.file));')
 .replaceAll('country bytes','geometry bytes').replace('missing country rejects','missing geometry rejects').replace('rejects the country','rejects the geometry').replace('background direct country reads','background selected geometry reads');
a=s.indexOf(' const files=buildBuiltinWorldPublication({input:withExplicitView(historicalWorldCases())});',s.indexOf('contractSuite("builtin-country-retry"'));
b=s.indexOf(' const bytes=Buffer.from(JSON.stringify(index));',a);
if(a<0||b<a)throw Error('Retry fixture changed');
s=s.slice(0,a)+String.raw` const files=buildBuiltinWorldPublication({input:withExplicitView(historicalWorldCases())});
 const index=JSON.parse(files.get('index.json')),wanted=new Set(['AUS','CHN']);
 const positions=index.entities.map((entry,i)=>wanted.has(entry.entityId)?i:-1).filter(i=>i>=0);
 index.readIndex.identities=positions.map(i=>index.readIndex.identities[i]);
 index.readIndex.sourceHashes=positions.map(i=>index.readIndex.sourceHashes[i]);
 for(const key of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])index.readIndex.records[key]=index.readIndex.records[key].filter(row=>wanted.has(row.objectRef.id));
 index.entities=index.entities.filter(row=>wanted.has(row.entityId));
 const refs=new Set(index.entities.flatMap(entry=>entry.geometryRefs.map(ref=>JSON.stringify([ref.id,ref.version]))));
 index.geometryAssets=index.geometryAssets.filter(asset=>refs.has(JSON.stringify([asset.id,asset.version])));
 assert.equal(index.geometryAssets.length,2);
`+s.slice(b);
s=s.replace('const slow=index.entities[1].file','const slow=index.geometryAssets[1].file')
 .replace('for(const entry of index.entities)assert.equal(calls.filter(file=>file===entry.file).length,4);','for(const entry of index.geometryAssets)assert.equal(calls.filter(file=>file===entry.file).length,4);');
writeFileSync(path,s);
