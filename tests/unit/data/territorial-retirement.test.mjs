import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as retirement from '../../../tools/gis/territorial-retirement.mjs';
import * as publication from '../../../tools/build/build-builtin-world.mjs';
import {territorialIndexEntry} from '../../../tools/gis/territorial-index-entry.js';
import {builtinSubunitId} from '../../../src/document/builtin-subunits.js';
import {assertTerritorialStorageScope} from '../../../tools/data/library-store.mjs';
import {buildTerritorialRetirementIndex} from '../../../tools/build/build-territorial-entity-chunks.mjs';
import {encodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {buildCurrentWorld} from '../../../tools/data/territorial-current-world.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const base='assets/data/territorial-entities';
function fixture(){
 const entity=(id,x,parent='')=>({schemaVersion:2,entityId:'state:'+id,entityKind:'general',lineageId:id.toLowerCase(),
  names:{ko:id},alternateNames:[],lifetime:{validFrom:null,validTo:null},parentEntityId:parent,
  instantiation:{entityKind:'general',coverageMode:'explicit'},metadata:{confidence:'low'},
  sourceInfo:{featureId:id,featureProperties:{name:id}},
  geometryVersions:[{versionId:id+':current',validFrom:null,validTo:null,geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,1],[x,0]]]}}]});
 const entities=[entity('USA',0),entity('PGA',10,'state:USA'),entity('VNM',20)];
 const stored=new Map(),receipts=new Map();
 const receipt=(name,data)=>{receipts.set(name,data);return {path:name,sha256:sha(data)};};
 const index={schemaVersion:2,entities:entities.map(e=>{const raw=bytes(e),chunk=gzipSync(raw,{level:1});stored.set(e.entityId,chunk);return territorialIndexEntry(e,{sha256:sha(chunk),compressedBytes:chunk.length,decodedBytes:raw.length});}),
  lineages:entities.map(e=>({schemaVersion:2,lineageId:e.lineageId,names:{ko:e.lineageId},entityRefs:[e.entityId],relations:[]})),snapshots:[],
  views:[{schemaVersion:1,id:'world:catalog',sourceInfo:{collectionMetadata:{type:'FeatureCollection'}},selections:entities.map(e=>({entityId:e.entityId,geometryVersionId:e.geometryVersions[0].versionId}))}]};
 const displayPolicy={schema:'pandolab-builtin-display-policy',schemaVersion:1,revision:'keep',subunits:[{sourceCountryId:'PGA',parentId:'USA'}],territoryMerges:[],sourceAttributions:{}};
 const policy={schemaVersion:1,unknownPeerOverlap:'exclude-from-all',replacements:[]};
 const files=publication.buildBuiltinWorldPublication({input:{entities,view:index.views[0],policy,sourceIndex:index,displayPolicy}});
 const sourceEncoding=encodeTerritorialSource(entities[1]);
 const manifest={schemaVersion:1,kind:'invalid-current-identity',previousIndex:receipt('index.before.json',bytes(index)),stagedIndex:receipt('index.staged.json',bytes(index)),
  previousBuiltinIndex:receipt('builtin.before.json',files.get('index.json')),previousCoverage:receipt('coverage.before.json',files.get('coverage-report.json')),
  previousCurrentWorld:receipt('world-projection.before.geojson',bytes(buildCurrentWorld({entities,view:index.views[0]}))),
  worldView:receipt('world.before.json',bytes(index.views[0])),displayPolicy:receipt('display.before.json',bytes(displayPolicy)),
  sources:[{entityId:'state:PGA',source:receipt('PGA.before.json',bytes(sourceEncoding.descriptor)),geometryResources:[...sourceEncoding.geometries].map(([file,data])=>({file,receipt:receipt(file,data)})),chunk:receipt('PGA.before.gz',stored.get('state:PGA')),lineage:receipt('pga.before.json',bytes(index.lineages[1]))}]};
 const next=structuredClone(index);next.entities.splice(1,1);next.lineages.splice(1,1);next.views[0].selections.splice(1,1);
 return {entities,index,next,displayPolicy,nextDisplay:{...displayPolicy,subunits:[]},policy,files,manifest,receipts,
  readRecovery:p=>receipts.get(p),previousIndex:JSON.parse(files.get('index.json')),previousCoverage:JSON.parse(files.get('coverage-report.json'))};
}
function options(f){return {manifest:f.manifest,previousIndex:f.index,index:f.next,displayPolicy:f.nextDisplay,readRecovery:f.readRecovery};}

test('explicit retirement verifies recovered source/chunk/index and exact current metadata removal',()=>{
 const f=fixture(),before=JSON.stringify(f.index),result=retirement.assertTerritorialRetirement(options(f));
 assert.deepEqual([...result.sourceIds],['state:PGA']);
 assert.deepEqual(result.index,f.next);assert.deepEqual(result.displayPolicy,f.nextDisplay);
 assert.equal(JSON.stringify(f.index),before);
 assert.deepEqual(f.next.entities[0],f.index.entities[0]);
});
test('retirement rejects missing, extra, stale and mismatched recovery or metadata',()=>{
 for(const change of [
  f=>{f.manifest.sources=[];},f=>{f.manifest.sources.push(structuredClone(f.manifest.sources[0]));},
  f=>{f.receipts.set('PGA.before.gz',Buffer.from('corrupt'));},
  f=>{f.next.entities.pop();},f=>{f.next.lineages.pop();},
  f=>{f.next.views[0].selections.pop();},f=>{f.nextDisplay.revision='changed';},
  f=>{f.index.entities[0].names.ko='stale';},
  f=>{f.next.entities[0].parentEntityId='state:PGA';},
  f=>{f.next.snapshots.push({entityRefs:['state:PGA']});},
 ]){const f=fixture();change(f);assert.throws(()=>retirement.assertTerritorialRetirement(options(f)),/retirement/i);}
});
test('metadata retirement removes the false identity without rewriting unrelated payloads or promoting updates',()=>{
 const f=fixture(),pga=builtinSubunitId('PGA');
 f.next.entities[0].sha256='a'.repeat(64); // Other authored input is deliberately not yet compiled.
 const files=publication.buildBuiltinWorldRetirementPublication({retirement:f.manifest,sourceIndex:f.next,previousSourceIndex:f.index,
  previousIndex:f.previousIndex,previousCoverage:f.previousCoverage,view:f.next.views[0],policy:f.policy,displayPolicy:f.nextDisplay,readRecovery:f.readRecovery});
 const index=JSON.parse(files.get('index.json')),coverage=JSON.parse(files.get('coverage-report.json'));
 assert.deepEqual([...files.keys()].sort(),['coverage-report.json','index.json']);
 assert.deepEqual(index.entities,f.previousIndex.entities.filter(row=>row.entityId!==pga));
 assert.equal(index.sourceIdentities.some(row=>row.sourceEntityIds.includes('state:PGA')),false);
 assert.equal(coverage.entities.some(row=>row.entityId===pga),false);
 assert.equal(Object.hasOwn(index.inputHashes.sourceRevisions,'state:PGA'),false);
 assert.equal(index.inputHashes.sourceRevisions['state:USA'],f.previousIndex.inputHashes.sourceRevisions['state:USA']);
 const full=publication.buildBuiltinWorldPublication({input:{entities:f.entities.filter(e=>e.entityId!=='state:PGA'),view:f.next.views[0],policy:f.policy,sourceIndex:f.next,displayPolicy:f.nextDisplay}});
 assert.deepEqual(index.entities,JSON.parse(full.get('index.json')).entities);
});
test('retirement updates the temporal read index and removes only unreferenced coordinate assets',()=>{
 const f=fixture(),input={retirement:f.manifest,sourceIndex:f.next,previousSourceIndex:f.index,
  previousIndex:f.previousIndex,previousCoverage:f.previousCoverage,view:f.next.views[0],policy:f.policy,displayPolicy:f.nextDisplay,readRecovery:f.readRecovery};
 const files=publication.buildBuiltinWorldRetirementPublication(input),index=JSON.parse(files.get('index.json'));
 const required=new Set(index.entities.flatMap(row=>row.geometryRefs.map(ref=>JSON.stringify([ref.id,ref.version]))));
 assert.deepEqual(new Set(index.geometryAssets.map(ref=>JSON.stringify([ref.id,ref.version]))),required);
 for(const asset of index.geometryAssets)assert.deepEqual(asset,f.previousIndex.geometryAssets.find(old=>old.id===asset.id&&old.version===asset.version));
 assert.equal(index.readIndex.identities.some(row=>row.id===builtinSubunitId('PGA')),false);
 index.readIndex.identities[0].properties.name='forged cached metadata';
 const plan=retirement.assertTerritorialRetirement(options(f));
 assert.throws(()=>retirement.assertBuiltinRetirement({plan,sourceIndex:f.next,previousSourceIndex:f.index,
  previousIndex:f.previousIndex,index,previousCoverage:f.previousCoverage,coverage:JSON.parse(files.get('coverage-report.json')),policy:f.policy}),/temporal read index/);
});

test('retirement publication rejects incoming policy/coverage links and stale compiled attribution',()=>{
 for(const change of [f=>{f.policy.replacements.push({targetEntityId:'state:PGA',priorityEntityId:'state:USA'});},
  f=>{f.previousCoverage.adjustments.push({entityId:'USA',relatedIds:[builtinSubunitId('PGA')]});},
  f=>{f.previousIndex.inputHashes.sourceRevisions['state:PGA']='bad';}]){
  const f=fixture();change(f);assert.throws(()=>publication.buildBuiltinWorldRetirementPublication({retirement:f.manifest,
   sourceIndex:f.next,previousSourceIndex:f.index,previousIndex:f.previousIndex,previousCoverage:f.previousCoverage,
   view:f.next.views[0],policy:f.policy,displayPolicy:f.nextDisplay,readRecovery:f.readRecovery}),/retirement/i);
 }
});
test('scoped storage requires exact deletion paths and all retirement dependencies, ordinary scopes remain closed',()=>{
 const f=fixture(),paths=[base+'/source/countries/state-PGA.json',base+'/generated/v2/state-PGA.json.gz',base+'/source/lineages/pga.json'];
 const prefixes=[...paths,base+'/generated/v2/index.json',base+'/generated/current-world.geojson',base+'/source/views/world.json','assets/data/builtin-world/display-policy-v1.json',
  'assets/data/builtin-world/generated/v1/index.json','assets/data/builtin-world/generated/v1/coverage-report.json'];
 const args={retirement:f.manifest,displayPolicy:f.nextDisplay,worldView:f.next.views[0],readRecovery:f.readRecovery,removePaths:paths,pathExists:()=>false,readLineage:id=>f.next.lineages.find(row=>row.lineageId===id)};
 assert.throws(()=>assertTerritorialStorageScope(prefixes,f.next,f.index),/remove/);
 assert.doesNotThrow(()=>assertTerritorialStorageScope(prefixes,f.next,f.index,args));
 assert.throws(()=>assertTerritorialStorageScope(prefixes,f.next,f.index,{...args,removePaths:paths.slice(1)}),/retirement/i);
 assert.throws(()=>assertTerritorialStorageScope(prefixes.slice(1),f.next,f.index,args),/retirement/i);
 f.next.entities[0].lineageId='pga';
 assert.throws(()=>assertTerritorialStorageScope(prefixes,f.next,f.index,args),/changed metadata|dangling reference/);
});
test('canonical chunk retirement preserves every survivor descriptor and rejects stale active files',()=>{
 const f=fixture(),args={previousIndex:f.index,retirement:f.manifest,view:f.next.views[0],displayPolicy:f.nextDisplay,readRecovery:f.readRecovery,pathExists:()=>false};
 assert.deepEqual(buildTerritorialRetirementIndex(args),f.next);
 assert.throws(()=>buildTerritorialRetirementIndex({...args,pathExists:()=>true}),/retirement/i);
 assert.throws(()=>buildTerritorialRetirementIndex({...args,view:f.index.views[0]}),/retirement/i);
 assert.throws(()=>buildTerritorialRetirementIndex({...args,displayPolicy:f.displayPolicy}),/retirement/i);
});
test('publication writer admits only the exact metadata retirement before touching output',t=>{
 const f=fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'territorial-retirement-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 for(const [file,bytes] of f.files){const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
 const retirementInputs={retirement:f.manifest,sourceIndex:f.next,previousSourceIndex:f.index,view:f.next.views[0],policy:f.policy,displayPolicy:f.nextDisplay,readRecovery:f.readRecovery,readSource:id=>f.entities.find(e=>e.entityId===id)};
 const files=publication.buildBuiltinWorldRetirementPublication({...retirementInputs,previousIndex:f.previousIndex,previousCoverage:f.previousCoverage});
 assert.throws(()=>publication.writeBuiltinWorldPublication(files,directory),/explicit paired/);
 assert.deepEqual(fs.readFileSync(path.join(directory,'index.json')),f.files.get('index.json'));
 const bad=new Map(files);bad.set('coverage-report.json',bytes({schemaVersion:2,entities:[],adjustments:[]}));
 const currentWorldTarget=path.join(directory,'current-world.geojson'),displayPolicyTarget=path.join(directory,'display-policy.json');
 fs.writeFileSync(currentWorldTarget,f.readRecovery(f.manifest.previousCurrentWorld.path));
 fs.writeFileSync(displayPolicyTarget,f.readRecovery(f.manifest.displayPolicy.path));
 assert.throws(()=>publication.writeBuiltinWorldPublication(bad,directory,{retirementInputs,currentWorldTarget,displayPolicyTarget}),/canonical producer/);
 publication.writeBuiltinWorldPublication(files,directory,{retirementInputs,currentWorldTarget,displayPolicyTarget});
 for(const [file,stored] of f.files)if(file!=='index.json'&&file!=='coverage-report.json')assert.deepEqual(fs.readFileSync(path.join(directory,file)),stored);
 assert.deepEqual(fs.readFileSync(path.join(directory,'index.json')),files.get('index.json'));
 assert.equal(JSON.parse(fs.readFileSync(currentWorldTarget)).features.some(row=>row.id==='PGA'),false);
 publication.writeBuiltinWorldPublication(files,directory,{retirementInputs,currentWorldTarget,displayPolicyTarget,check:true});
});

function stagedChange(f){
 const entity=f.entities[0];entity.geometryVersions[0].geometry.coordinates[0][1][0]+=0.25;
 const decoded=bytes(entity),stored=gzipSync(decoded,{level:1});
 const entry=territorialIndexEntry(entity,{sha256:sha(stored),compressedBytes:stored.length,decodedBytes:decoded.length});
 f.next.entities[0]=entry;
 const staged=structuredClone(f.index);staged.entities[0]=entry;
 const raw=bytes(staged);f.receipts.set('index.staged.json',raw);f.manifest.stagedIndex.sha256=sha(raw);
 return staged;
}
test('dual pinned/staged baselines preserve authored source updates without falsely advancing runtime',()=>{
 const f=fixture(),staged=stagedChange(f);
 const index=buildTerritorialRetirementIndex({previousIndex:staged,retirement:f.manifest,view:f.next.views[0],displayPolicy:f.nextDisplay,readRecovery:f.readRecovery,pathExists:()=>false});
 assert.deepEqual(index,f.next);
 const input={retirement:f.manifest,sourceIndex:f.next,previousSourceIndex:f.index,view:f.next.views[0],policy:f.policy,displayPolicy:f.nextDisplay,
  previousIndex:f.previousIndex,previousCoverage:f.previousCoverage,readRecovery:f.readRecovery,readSource:id=>f.entities.find(e=>e.entityId===id)};
 const baseline=publication.buildBuiltinWorldRetirementPublication(input),baselineIndex=JSON.parse(baseline.get('index.json'));
 assert.equal(baselineIndex.inputHashes.sourceRevisions['state:USA'],f.index.entities[0].sha256);
 const forged=structuredClone(baselineIndex);forged.inputHashes.sourceRevisions['state:USA']=f.next.entities[0].sha256;forged.inputHashes.entities=sha(JSON.stringify(forged.inputHashes.sourceRevisions));
 const plan=retirement.assertTerritorialRetirement(options(f));
 assert.throws(()=>retirement.assertBuiltinRetirement({plan,sourceIndex:f.next,previousSourceIndex:f.index,previousIndex:f.previousIndex,index:forged,
  previousCoverage:f.previousCoverage,coverage:JSON.parse(baseline.get('coverage-report.json')),policy:f.policy}),/lacks its regenerated country/);
 const final=publication.buildBuiltinWorldRetiredPartialPublication({...input,entityIds:['state:USA']});
 const next=JSON.parse(final.get('index.json'));
 assert.equal(next.inputHashes.sourceRevisions['state:USA'],f.next.entities[0].sha256);
 assert.notEqual(next.entities.find(row=>row.entityId==='USA').sha256,f.previousIndex.entities.find(row=>row.entityId==='USA').sha256);
 assert.deepEqual(next.entities.find(row=>row.entityId==='VNM'),f.previousIndex.entities.find(row=>row.entityId==='VNM'));
});
test('shared storage retirement rejects an unrelated added compiled identity and coverage row',()=>{
 const f=fixture(),plan=retirement.assertTerritorialRetirement(options(f));
 const files=publication.buildBuiltinWorldRetirementPublication({retirement:f.manifest,sourceIndex:f.next,previousSourceIndex:f.index,
  previousIndex:f.previousIndex,previousCoverage:f.previousCoverage,view:f.next.views[0],policy:f.policy,displayPolicy:f.nextDisplay,readRecovery:f.readRecovery});
 const index=JSON.parse(files.get('index.json')),coverage=JSON.parse(files.get('coverage-report.json'));
 index.entities.push({...index.entities[0],entityId:'UNRELATED',sha256:'a'.repeat(64)});
 coverage.entities.push({...coverage.entities[0],entityId:'UNRELATED'});
 assert.throws(()=>retirement.assertBuiltinRetirement({plan,sourceIndex:f.next,previousSourceIndex:f.index,previousIndex:f.previousIndex,index,
  previousCoverage:f.previousCoverage,coverage,policy:f.policy}),/compiled identity membership/);
});
test('final storage still requires paired source and chunk scopes for previously staged updates',()=>{
 const f=fixture();stagedChange(f);
 const plan=retirement.assertTerritorialRetirement(options(f)),prefixes=[...plan.removePaths,base+'/generated/v2/index.json',base+'/generated/current-world.geojson',
  base+'/source/views/world.json','assets/data/builtin-world/display-policy-v1.json','assets/data/builtin-world/generated/v1/index.json','assets/data/builtin-world/generated/v1/coverage-report.json'];
 const args={retirement:f.manifest,displayPolicy:f.nextDisplay,worldView:f.next.views[0],readRecovery:f.readRecovery,removePaths:plan.removePaths,pathExists:()=>false};
 assert.throws(()=>assertTerritorialStorageScope(prefixes,f.next,f.index,args),/source, chunk and index together: state:USA/);
 assert.doesNotThrow(()=>assertTerritorialStorageScope([...prefixes,base+'/source/countries/state-USA.json',base+'/generated/v2/state-USA.json.gz'],f.next,f.index,args));
});
test('failed compile writes nothing; failed activation restores policy, projection, coverage and index',t=>{
 const f=fixture();stagedChange(f);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'retirement-activation-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const currentWorldTarget=path.join(directory,'current-world.geojson'),displayPolicyTarget=path.join(directory,'display-policy.json');
 for(const [file,data] of f.files){const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
 fs.writeFileSync(currentWorldTarget,f.readRecovery(f.manifest.previousCurrentWorld.path));fs.writeFileSync(displayPolicyTarget,f.readRecovery(f.manifest.displayPolicy.path));
 const retirementInputs={retirement:f.manifest,sourceIndex:f.next,previousSourceIndex:f.index,view:f.next.views[0],policy:f.policy,displayPolicy:f.nextDisplay,readRecovery:f.readRecovery,
  previousIndex:f.previousIndex,previousCoverage:f.previousCoverage,readSource:id=>f.entities.find(e=>e.entityId===id),entityIds:['state:USA']};
 assert.throws(()=>publication.buildBuiltinWorldRetiredPartialPublication({...retirementInputs,readSource:()=>{throw Error('synthetic source failure');}}),/synthetic source failure/);
 assert.deepEqual(fs.readFileSync(path.join(directory,'index.json')),f.files.get('index.json'));
 const files=publication.buildBuiltinWorldRetiredPartialPublication(retirementInputs),write=fs.writeFileSync;
 let failed=false;
 t.mock.method(fs,'writeFileSync',(target,...args)=>{if(target===path.join(directory,'index.json')&&!failed){failed=true;throw Error('synthetic activation failure');}return write(target,...args);});
 assert.throws(()=>publication.writeBuiltinWorldPublication(files,directory,{retirementInputs,currentWorldTarget,displayPolicyTarget}),/synthetic activation failure/);
 assert.equal(failed,true);
 for(const [file,data] of f.files)assert.deepEqual(fs.readFileSync(path.join(directory,file)),data);
 assert.deepEqual(fs.readFileSync(currentWorldTarget),f.readRecovery(f.manifest.previousCurrentWorld.path));
 assert.deepEqual(fs.readFileSync(displayPolicyTarget),f.readRecovery(f.manifest.displayPolicy.path));
 publication.writeBuiltinWorldPublication(files,directory,{retirementInputs,currentWorldTarget,displayPolicyTarget});
 assert.deepEqual(fs.readFileSync(path.join(directory,'index.json')),files.get('index.json'));
});

test('retirement anchors exact coordinate receipts and retains immutable shared resources',()=>{
 const f=fixture(),plan=retirement.planTerritorialRetirement(f.manifest,f.index,{readRecovery:f.readRecovery});
 const resource=f.manifest.sources[0].geometryResources[0];
 assert.deepEqual(plan.recoveryReceipts.get(base+'/source/'+resource.file),resource.receipt);
 assert.equal(plan.removePaths.length,3);
 assert.equal(plan.removePaths.includes(base+'/source/'+resource.file),false);
 assert.deepEqual(plan.index,f.next);
});

test('retirement rejects missing duplicate extra or mismatched coordinate receipts',()=>{
 const mutations=[
  f=>{delete f.manifest.sources[0].geometryResources;},
  f=>{f.manifest.sources[0].geometryResources=[];},
  f=>{const r=f.manifest.sources[0].geometryResources;r.push(structuredClone(r[0]));},
  f=>{const r=f.manifest.sources[0].geometryResources;r.push({...r[0],file:'geometries/sha256-'+ 'a'.repeat(64)+'.json'});},
  f=>{f.manifest.sources[0].geometryResources[0].file='../outside.json';},
  f=>{f.manifest.sources[0].geometryResources[0].receipt.sha256='a'.repeat(64);},
  f=>{const r=f.manifest.sources[0].geometryResources[0].receipt;const data=Buffer.from('corrupt');f.receipts.set(r.path,data);r.sha256=sha(data);},
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>retirement.planTerritorialRetirement(f.manifest,f.index,{readRecovery:f.readRecovery}),/retirement|geometry resource/i);}
});

test('retirement resolves only the current descriptor codec with real identity and length checks',()=>{
 const mutations=[
  d=>{d.geometryVersions[0].geometryResource.bytes++;},
  d=>{d.geometryVersions[0].geometryResource.logicalRef.id='state:OTHER:current';},
  d=>{d.geometryVersions[0].geometry={type:'Polygon',coordinates:[]};},
  d=>{delete d.storageLayout;},
 ];
 for(const mutate of mutations){const f=fixture(),r=f.manifest.sources[0].source,d=JSON.parse(f.readRecovery(r.path));mutate(d);const data=bytes(d);f.receipts.set(r.path,data);r.sha256=sha(data);assert.throws(()=>retirement.planTerritorialRetirement(f.manifest,f.index,{readRecovery:f.readRecovery}),/geometry resource/i);}
 const f=fixture(),r=f.manifest.sources[0].source,data=bytes(f.entities[1]);f.receipts.set(r.path,data);r.sha256=sha(data);
 assert.throws(()=>retirement.planTerritorialRetirement(f.manifest,f.index,{readRecovery:f.readRecovery}),/invalid source descriptor/);
});

test('valid rehashed descriptor and geometry cannot replace the indexed retired source',()=>{
 const f=fixture(),replacement=structuredClone(f.entities[1]);replacement.geometryVersions[0].geometry.coordinates[0][1][0]+=0.25;
 const encoded=encodeTerritorialSource(replacement),row=f.manifest.sources[0],raw=bytes(encoded.descriptor);
 f.receipts.set(row.source.path,raw);row.source.sha256=sha(raw);
 row.geometryResources=[...encoded.geometries].map(([file,data])=>{f.receipts.set(file,data);return {file,receipt:{path:file,sha256:sha(data)}};});
 assert.throws(()=>retirement.planTerritorialRetirement(f.manifest,f.index,{readRecovery:f.readRecovery}),/recovery source differs from indexed chunk/);
});

// Exercise the real CLI entrypoints against a tiny read-only filesystem fixture.
// No catalog hydration, network, writes, or native build occurs in the child.
function retirementCli(f,kind){
 const root=fileURLToPath(new URL('../../../',import.meta.url)),chunk=kind==='chunk';
 const entry=path.join(root,'tools/build/'+(chunk?'build-territorial-entity-chunks.mjs':'build-builtin-world.mjs'));
 const manifestFile=path.join(root,'synthetic-retirement-manifest.json');
 const fixtureFiles=[...f.receipts].map(([p,b])=>[path.resolve(root,p),b.toString('base64')]);
 fixtureFiles.push([manifestFile,bytes(f.manifest).toString('base64')],
  [path.join(root,base,'source/views/world.json'),bytes(f.next.views[0]).toString('base64')],
  [path.join(root,base,'generated/v2/index.json'),bytes(f.next).toString('base64')],
  [path.join(root,'assets/data/builtin-world/generated/v1/index.json'),bytes(f.previousIndex).toString('base64')]);
 const input={root,entry,manifestFile,files:fixtureFiles,kind};
 const script="import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {syncBuiltinESMExports} from 'node:module';"+
  'const input='+JSON.stringify(input)+';'+
  "const files=new Map(input.files),read=fs.readFileSync,exists=fs.existsSync,resolve=p=>path.resolve(p instanceof URL?fileURLToPath(p):p);"+
  "fs.readFileSync=(p,...args)=>{const key=resolve(p);if(key===path.join(input.root,'assets/data/historical-world/policy.json'))throw Error('correct canonical policy target');if(key===path.join(input.root,'tools/assets/data/historical-world/policy.json'))throw Error('wrong relocated policy target');if(files.has(key)){const data=Buffer.from(files.get(key),'base64');return typeof args[0]==='string'?data.toString(args[0]):data;}return read(p,...args);};"+
  "fs.existsSync=p=>{const key=resolve(p);if(key===path.join(input.root,'assets/data/territorial-entities/source/countries/state-PGA.json'))return true;if(key.includes(path.join('tools','assets','data')))return false;return exists(p);};"+
  "for(const name of ['writeFileSync','mkdirSync','unlinkSync','renameSync'])fs[name]=()=>{throw Error('unexpected CLI mutation');};syncBuiltinESMExports();"+
  "process.argv=[process.execPath,input.entry,'--retirement-manifest='+input.manifestFile,'--check'];await import(pathToFileURL(input.entry));";
 const imports=[];for(let i=0;i<process.execArgv.length;i++)if(process.execArgv[i]==='--import')imports.push(process.execArgv[i],process.execArgv[++i]);
 return spawnSync(process.execPath,[...imports,'--input-type=module','-'],{cwd:root,input:script,encoding:'utf8',timeout:20000,env:process.env});
}
test('retirement chunk CLI rejects a source that still exists at the canonical app path',()=>{
 const result=retirementCli(fixture(),'chunk');assert.equal(result.status,1);assert.match(result.stderr,/remove only the preserved source, lineage and chunk/);
});
test('retirement builtin CLI resolves policy from the canonical app data path',()=>{
 const result=retirementCli(fixture(),'builtin');assert.equal(result.status,1);assert.match(result.stderr,/^Error: correct canonical policy target$/m);
});
