import { describe as contractSuite } from 'node:test';
import * as __gis_dep0 from "../../shared/frontend/js/modules/builtin-subunits.js";
import * as __gis_dep1 from "node:test";
import * as __gis_dep2 from "node:assert/strict";
import * as __gis_dep3 from "node:fs";
import * as __gis_dep4 from "node:os";
import * as __gis_dep5 from "node:path";
import * as __gis_dep6 from "node:crypto";
import * as __gis_dep7 from "node:zlib";
import * as __gis_dep8 from "../../tools/build-prepared-polygon-mesh.mjs";
import * as __gis_dep9 from "../../tools/build-builtin-world.mjs";
import * as __gis_dep10 from "../fixtures/historical-world-cases.mjs";
import * as __gis_dep11 from "../helpers/builtin-world.mjs";
import * as __gis_dep12 from "../../tools/gis/territorial-index-entry.js";
import * as __gis_dep13 from "../../shared/frontend/js/modules/polygon-mesh-codec.js";
import * as __gis_dep14 from "../../shared/frontend/js/modules/prepared-polygon-mesh.js";
import * as __gis_dep15 from "../../shared/frontend/js/modules/physical-resources.js";
contractSuite("prepared-country-scope", () => {
const { BUILTIN_SUBUNITS } = __gis_dep0;
const test = __gis_dep1.default;
const assert = __gis_dep2.default;
const fs = __gis_dep3.default;
const os = __gis_dep4.default;
const path = __gis_dep5.default;
const { createHash } = __gis_dep6;
const { gzipSync } = __gis_dep7;
const { buildPreparedPolygonMeshes } = __gis_dep8;
const { buildBuiltinWorldPublication } = __gis_dep9;
const { historicalWorldCases } = __gis_dep10;
const { withExplicitView } = __gis_dep11;
const { territorialIndexEntry } = __gis_dep12;
const { POLYGON_MESH_FORMAT_VERSION } = __gis_dep13;


const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t,selected=['state:parent','state:child'],onlyActive=false){const root=fs.mkdtempSync(path.join(os.tmpdir(),'prepared-country-scope-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const put=(p,b)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof b==='string'||Buffer.isBuffer(b)?b:JSON.stringify(b));};const input=withExplicitView(historicalWorldCases()),sourceIndex={entities:input.entities.map(e=>territorialIndexEntry(e,{sha256:sha(JSON.stringify(e))}))},files=buildBuiltinWorldPublication({input:{...input,sourceIndex}}),index=JSON.parse(files.get('index.json'));if(onlyActive)index.entities=index.entities.filter(e=>selected.includes(e.entityId));put('assets/data/builtin-world/generated/v1/index.json',index);for(const e of index.entities.filter(e=>selected.includes(e.entityId)))put('assets/data/builtin-world/generated/v1/'+e.file,files.get(e.file));for(const e of input.entities.filter(e=>index.sourceIdentities.some(row=>selected.includes(row.projectEntityId)&&row.sourceEntityIds.includes(e.entityId)))){const entry=sourceIndex.entities.find(r=>r.entityId===e.entityId);put('assets/data/territorial-entities/generated/v2/'+entry.file,gzipSync(JSON.stringify(e)));}put('assets/data/territorial-entities/generated/v2/index.json',sourceIndex);const engine=globalThis.PandoLabGpuMeshCore;put('assets/data/prepared-polygons/generated/v2/manifest.json',{schemaVersion:2,meshFormatVersion:POLYGON_MESH_FORMAT_VERSION,algorithmVersion:engine.MESH_ALGORITHM_REVISION,maxEdgeDegrees:engine.MAX_RENDER_EDGE_DEGREES,meshes:{unrelated:{url:'must-not-read.bin'}},inputHashes:{unrelated:'keep'},precisionDiscards:[{id:'unrelated',month:'2000-01',discards:[]}]});return {root,selected,input};}
test('country-scoped prepared meshes read only selected payloads and preserve unrelated references',t=>{const {root,selected}=fixture(t),writes=[];const result=buildPreparedPolygonMeshes({root,countryIds:selected,countryMonths:['1900-12'],sourceIdentity:()=>({sourceSha256:'synthetic-source'}),write:(p,b)=>writes.push({p,b})});assert.ok(result.selectedDigests.length);assert.equal(result.manifest.meshes.unrelated.url,'must-not-read.bin');assert.equal(result.manifest.inputHashes.unrelated,'keep');assert.equal(result.manifest.precisionDiscards[0].id,'unrelated');assert.ok(writes.some(r=>r.p.endsWith('manifest.json')));assert.ok(Object.keys(result.manifest.inputHashes).every(p=>p==='unrelated'||!p.includes('physical-land')));});
test('country-scoped prepared meshes reject incomplete active hierarchy before reading missing country files',t=>{const {root}=fixture(t);assert.throws(()=>buildPreparedPolygonMeshes({root,countryIds:['state:child'],countryMonths:['1900-12'],sourceIdentity:()=>({sourceSha256:'synthetic'})}),/active parent\/child closure/);});
test('country-scoped mesh requests require countries and explicit valid query months',()=>{assert.throws(()=>buildPreparedPolygonMeshes({countryIds:['A'],countryMonths:[]}),/query months/);assert.throws(()=>buildPreparedPolygonMeshes({countryIds:['A','A'],countryMonths:['1900-12']}),/query months/);});

test('query months alone cannot silently trigger a complete catalog build',()=>{assert.throws(()=>buildPreparedPolygonMeshes({countryMonths:['1900-12']}),/supplied together/);});

for(const code of ['GRL','HKG'])test('scoped meshes enforce compiler builtin parent for '+code,t=>{const {id,parentId}=BUILTIN_SUBUNITS.find(row=>row.sourceCountryId===code),pair=[parentId,id],{root}=fixture(t,pair,true);for(const only of [parentId,id])assert.throws(()=>buildPreparedPolygonMeshes({root,countryIds:[only],countryMonths:['2000-01'],sourceIdentity:()=>({sourceSha256:'synthetic'})}),/active parent\/child closure/);const result=buildPreparedPolygonMeshes({root,countryIds:pair,countryMonths:['2000-01'],sourceIdentity:()=>({sourceSha256:'synthetic'}),write:()=>{}});assert.ok(result.selectedDigests.length);});


test('country scope prepares only geometry effective in the requested month',t=>{
 const {root,input}=fixture(t,['state:changing'],true),writes=[];
 const run=months=>buildPreparedPolygonMeshes({root,countryIds:['state:changing'],countryMonths:months,sourceIdentity:()=>({sourceSha256:'synthetic'}),write:(p,b)=>writes.push({p,b})});
 const versions=input.entities.find(e=>e.entityId==='state:changing').geometryVersions;
 const digest=v=>sha(JSON.stringify([v.geometry.type,v.geometry.coordinates]));
 assert.deepEqual(run(['2020-10']).selectedDigests,[digest(versions[0])]);
 assert.deepEqual(run(['2020-12']).selectedDigests,[digest(versions[1])]);
 assert.equal(run(['2020-10','2020-12','2020-10']).count,2);
});

test('country scope uses compiled inputs without reading duplicate raw source chunks',t=>{
 const {root}=fixture(t);
 fs.rmSync(path.join(root,'assets/data/territorial-entities/generated/v2'),{recursive:true});
 // Restore only the metadata needed to verify parent/child closure.
 const input=withExplicitView(historicalWorldCases());
 const dir=path.join(root,'assets/data/territorial-entities/generated/v2');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({entities:input.entities.map(e=>territorialIndexEntry(e,{sha256:sha(JSON.stringify(e))}))}));
 const result=buildPreparedPolygonMeshes({root,countryIds:['state:parent','state:child'],countryMonths:['1900-12'],sourceIdentity:()=>({sourceSha256:'synthetic'}),write:()=>{}});
 assert.ok(result.count>0);assert.equal(Object.keys(result.manifest.inputHashes).some(p=>p.includes('state-parent.json.gz')),false);
});

test('repeated country scope reuses mesh bytes and does not rewrite an unchanged manifest',t=>{
 const {root}=fixture(t,['state:changing'],true),options={root,countryIds:['state:changing'],countryMonths:['2020-10'],sourceIdentity:()=>({sourceSha256:'synthetic'})};
 const first=buildPreparedPolygonMeshes({...options,write:(p,b)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);}});
 const writes=[],second=buildPreparedPolygonMeshes({...options,write:(p,b)=>writes.push({p,b})});
 assert.equal(first.count,1);assert.equal(second.reused,1);assert.deepEqual(writes,[]);
});

test('inactive country queries fail before reading missing payloads or writing a manifest',t=>{
 const {root}=fixture(t,['state:changing'],true);let writes=0;
 assert.throws(()=>buildPreparedPolygonMeshes({root,countryIds:['state:changing'],countryMonths:['1900-12'],sourceIdentity:()=>({sourceSha256:'synthetic'}),write:()=>writes++}),/No selected countries/);
 assert.equal(writes,0);
});


test('obsolete selected country and raw-source receipts are retired without reading their old bytes',t=>{
 const {root}=fixture(t,['state:changing'],true),p=path.join(root,'assets/data/prepared-polygons/generated/v2/manifest.json'),old=JSON.parse(fs.readFileSync(p));
 const obsolete='assets/data/builtin-world/generated/v1/countries/state-changing-sha256-'+ 'f'.repeat(64)+'.json.gz';
 const raw='assets/data/territorial-entities/generated/v2/state-changing.json.gz';
 old.inputHashes[obsolete]='old';old.inputHashes[raw]='old';fs.writeFileSync(p,JSON.stringify(old));
 const r=buildPreparedPolygonMeshes({root,countryIds:['state:changing'],countryMonths:['2020-10'],sourceIdentity:()=>({sourceSha256:'synthetic'}),write:()=>{}});
 assert.equal(Object.hasOwn(r.manifest.inputHashes,obsolete),false);assert.equal(Object.hasOwn(r.manifest.inputHashes,raw),false);assert.equal(r.manifest.inputHashes.unrelated,'keep');
});

test('stale unrelated or unattributable split-country receipts block a scoped append before writes',t=>{
 for(const receipt of ['countries/state-changing-sha256-other-sha256-'+ 'f'.repeat(64)+'.json.gz','countries/other-sha256-'+ 'f'.repeat(64)+'.json.gz','country-parts/sha256-'+ 'f'.repeat(64)+'.bin']){
  const {root}=fixture(t,['state:changing'],true),p=path.join(root,'assets/data/prepared-polygons/generated/v2/manifest.json'),old=JSON.parse(fs.readFileSync(p));
  old.inputHashes['assets/data/builtin-world/generated/v1/'+receipt]='old';fs.writeFileSync(p,JSON.stringify(old));let writes=0;
  assert.throws(()=>buildPreparedPolygonMeshes({root,countryIds:['state:changing'],countryMonths:['2020-10'],sourceIdentity:()=>({sourceSha256:'synthetic'}),write:()=>writes++}),/stale country input/);assert.equal(writes,0);
 }
});
});
contractSuite("prepared-physical-scope", () => {
const test = __gis_dep1.default;
const assert = __gis_dep2.default;
const { createHash } = __gis_dep6;
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = __gis_dep3;
const { resolve, dirname } = __gis_dep5;
const { tmpdir } = __gis_dep4;
const { gunzipSync, gzipSync } = __gis_dep7;
const { buildPreparedPolygonMeshes } = __gis_dep8;
const { decodePolygonMesh, POLYGON_MESH_FORMAT_VERSION } = __gis_dep13;
const { polygonGeometryDigest } = __gis_dep14;
const { composePhysicalWaterGeometry } = __gis_dep15;
const { buildBuiltinWorldPublication } = __gis_dep9;
const { historicalWorldCases } = __gis_dep10;
const { withExplicitView } = __gis_dep11;















test('physical month generation reads only the selected context, appends two meshes and preserves the existing catalog',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'pando-physical-scope-'));
  t.after(()=>{assert.ok(root.startsWith(resolve(tmpdir(),'pando-physical-scope-')));rmSync(root,{recursive:true});});
  const write=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);};
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const asset=(name,value)=>{const url='assets/data/'+name+'.json',body=Buffer.from(JSON.stringify(value));write(resolve(root,url),body);return {url,sha256:sha(body),compressedBytes:body.length,decodedBytes:body.length,encoding:'identity'};};
  const box=x=>({type:'Polygon',coordinates:[[[x,0],[x,2],[x+2,2],[x+2,0],[x,0]]]});
  const landGeometry={type:'MultiPolygon',coordinates:[box(0).coordinates]},land=asset('land-history',landGeometry);
  const waters=[box(4),box(8)],rows=['aral','caspian'].map((id,index)=>({objectRef:{domain:'hydroBuiltin',id},geometryRef:{id,version:1},land,asset:asset(id,waters[index])}));
  const catalog={identities:rows.map(({objectRef})=>({objectRef,entityKind:'lake'})),geometries:rows,
    timelineRecords:{schemaVersion:3,parentRelations:[],propertyBindings:[],lifetimes:rows.map(({objectRef})=>({id:'life:'+objectRef.id,objectRef,validFrom:null,validTo:null})),
      geometryBindings:rows.map(({objectRef,geometryRef})=>({id:'geometry:'+objectRef.id,objectRef,geometryRef,validFrom:'1922-01-01',validTo:'1929-12-31'}))}};
  // No country index, unrelated physical source, or C++ checkout is present.
  write(resolve(root,'assets/data/physical-land/v1/manifest.json'),JSON.stringify({waterObjects:catalog}));
  const path=resolve(root,'assets/data/prepared-polygons/generated/v2/manifest.json'),engine=globalThis.PandoLabGpuMeshCore;
  const preserved={url:'assets/data/unhydrated-existing-mesh.bin.gz',sha256:'existing',compressedBytes:123};
  const original={schema:'pandolab-prepared-polygon-meshes',schemaVersion:2,meshFormatVersion:POLYGON_MESH_FORMAT_VERSION,
    algorithmVersion:engine.MESH_ALGORITHM_REVISION,maxEdgeDegrees:engine.MAX_RENDER_EDGE_DEGREES,
    algorithmSourceSha256:'prior-unrelated-core',inputHashes:{original:'identity'},precisionDiscards:[{id:'preserved'}],meshes:{existing:preserved}};
  write(path,JSON.stringify(original));
  const options={root,physicalMonth:'1922-12',write,sourceIdentity:()=>({sourceSha256:'current-core'})};
  assert.throws(()=>buildPreparedPolygonMeshes({...options,physicalMonth:''}),/month|required|날짜|시점/i,'an empty scoped option must never start full generation');
  const first=buildPreparedPolygonMeshes(options),expected=[await polygonGeometryDigest(landGeometry),await polygonGeometryDigest(composePhysicalWaterGeometry(waters))].sort();
  assert.deepEqual(first.selectedDigests.sort(),expected);assert.equal(first.count,2);assert.equal(first.reused,0);
  assert.deepEqual(first.manifest.meshes.existing,preserved);assert.deepEqual(first.manifest.precisionDiscards,original.precisionDiscards);
  assert.equal(first.manifest.inputHashes.original,'identity');assert.equal(Object.keys(first.manifest.meshes).length,3);
  assert.equal(existsSync(resolve(root,preserved.url)),false,'scope must not hydrate existing unrelated assets');
  for(const digest of expected){const spec=first.manifest.meshes[digest],stored=readFileSync(resolve(root,spec.url));assert.equal(sha(stored),spec.sha256);const decoded=gunzipSync(stored);decodePolygonMesh(decoded.buffer.slice(decoded.byteOffset,decoded.byteOffset+decoded.byteLength),{algorithmVersion:engine.MESH_ALGORITHM_REVISION});}
  const second=buildPreparedPolygonMeshes(options);assert.equal(second.reused,2);assert.deepEqual(second.manifest.meshes,first.manifest.meshes);
  write(path,JSON.stringify({...first.manifest,algorithmVersion:'obsolete'}));
  assert.throws(()=>buildPreparedPolygonMeshes(options),/current mesh algorithm/);
});

test('unscoped generation retains precision-discard audit records from synthetic territorial scopes',t=>{
  const root=mkdtempSync(resolve(tmpdir(),'pando-physical-scope-'));
  t.after(()=>{assert.ok(root.startsWith(resolve(tmpdir(),'pando-physical-scope-')));rmSync(root,{recursive:true});});
  const write=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);};
  const data=buildBuiltinWorldPublication({input:withExplicitView(historicalWorldCases())});
  for(const [path,bytes]of data)write(resolve(root,'assets/data/builtin-world/generated/v1',path),bytes);
  write(resolve(root,'assets/data/territorial-entities/generated/current-world.geojson'),JSON.stringify({type:'FeatureCollection',features:[]}));
  write(resolve(root,'assets/data/territorial-entities/generated/v2/index.json'),JSON.stringify({entities:[]}));
  // The input path is gzip even for the tiny synthetic land fixture.
  const land={type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]};
  write(resolve(root,'assets/data/physical-land/v1/geometry.json.gz'),gzipSync(Buffer.from(JSON.stringify(land))));
  write(resolve(root,'assets/data/physical-land/v1/manifest.json'),JSON.stringify({waterObjects:{geometries:[]}}));
  const clipper=globalThis.polygonClipping;
  const artifact=[[46.798053,39.097382],[46.803617228283514,39.10088708625098],[46.80361722811995,39.10088708614795],[46.798053,39.097382]];
  globalThis.polygonClipping={...clipper,union:(...args)=>[...clipper.union(...args),[artifact]]};
  t.after(()=>{globalThis.polygonClipping=clipper;});
  const result=buildPreparedPolygonMeshes({root,write,sourceIdentity:()=>({sourceSha256:'fixture'})});
  assert.ok(result.manifest.precisionDiscards.length>0,'scope discard evidence must reach the unscoped manifest');
  assert.ok(result.manifest.precisionDiscards.some(row=>row.discards.some(discard=>discard.operation==='union')));
});
});
contractSuite("prepared-input-verification", () => {
const test = __gis_dep1.default;
const assert = __gis_dep2.default;
const { existsSync } = __gis_dep3;
const { createHash } = __gis_dep6;
const { gzipSync } = __gis_dep7;





const owner=new URL('../../scripts/lib/prepared-input-verification.mjs',import.meta.url);
const base='assets/data/builtin-world/generated/v1/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const bytes=gzipSync('{"entityId":"state:test","schemaVersion":2}');
 const row={entityId:'state:test',file:`countries/state-test-sha256-${sha(bytes)}.json.gz`,sha256:sha(bytes),encoding:'gzip',compressedBytes:bytes.length,decodedBytes:42};
 const chunks=[bytes.subarray(0,20),bytes.subarray(20)],files=new Map();
 row.parts=chunks.map(bytes=>{const file=`country-parts/sha256-${sha(bytes)}.bin`;files.set(base+file,bytes);return {file,sha256:sha(bytes),encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length};});
 files.set(base+'index.json',Buffer.from(JSON.stringify({schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',entities:[row]})));
 files.set('assets/data/other.bin',Buffer.from('other'));
 const calls=[],read=path=>{calls.push(path);assert.ok(files.has(path),'Unexpected or retired physical read: '+path);return files.get(path);};
 return {bytes,row,files,calls,read,hashes:{[base+row.file]:sha(bytes)}};
}
async function verifier(){
 assert.ok(existsSync(owner),'A country-aware prepared input verifier is required');
 return (await import(owner.href)).verifyPreparedInputHashes;
}
test('prepared input hashes resolve split countries without reading their retired originals',async()=>{
 const verify=await verifier(),f=fixture();verify(f.hashes,f.read);
 assert.deepEqual(f.calls,[base+'index.json',...f.row.parts.map(part=>base+part.file)]);
});
test('prepared input verification still rejects corrupt physical country parts',async()=>{
 const verify=await verifier(),f=fixture();f.files.set(base+f.row.parts[0].file,Buffer.from('broken'));
 assert.throws(()=>verify(f.hashes,f.read),/Invalid country bytes/);
});
test('a correct reconstructed country cannot excuse a stale prepared input hash',async()=>{
 const verify=await verifier(),f=fixture();f.hashes[base+f.row.file]='0'.repeat(64);
 assert.throws(()=>verify(f.hashes,f.read),/prepared input/);
});
test('retired aggregate and unreferenced country inputs fail instead of restoring archive payloads',async()=>{
 const verify=await verifier(),f=fixture();
 assert.throws(()=>verify({[base+'transport/old.bin']:'old'},f.read),/Retired builtin/);assert.deepEqual(f.calls,[]);
 assert.throws(()=>verify({[base+'countries/old.json.gz']:'old'},f.read),/Unreferenced builtin/);
 assert.deepEqual(f.calls,[base+'index.json']);
});
test('ordinary prepared input hash validation remains exact',async()=>{
 const verify=await verifier(),f=fixture(),path='assets/data/other.bin';
 verify({[path]:sha(f.files.get(path))},f.read);
 assert.throws(()=>verify({[path]:'0'.repeat(64)},f.read),/prepared input/);
});
});
