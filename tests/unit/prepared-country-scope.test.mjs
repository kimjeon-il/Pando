import {BUILTIN_SUBUNITS} from'../../shared/frontend/js/modules/builtin-subunits.js';
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{createHash}from'node:crypto';import{gzipSync}from'node:zlib';import{buildPreparedPolygonMeshes}from'../../tools/build-prepared-polygon-mesh.mjs';import{buildBuiltinWorldPublication}from'../../tools/build-builtin-world.mjs';import{historicalWorldCases}from'../fixtures/historical-world-cases.mjs';import{withExplicitView}from'../helpers/builtin-world.mjs';import{territorialIndexEntry}from'../../tools/gis/territorial-index-entry.js';import{POLYGON_MESH_FORMAT_VERSION}from'../../shared/frontend/js/modules/polygon-mesh-codec.js';
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
