// Local derivation only. Graph owners remain the sole generator/validator owners.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,unlinkSync,existsSync,renameSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {stageArtifacts,publishArtifacts,graphStatus,safePath,assertBranchState,RECEIPT_PATH} from './p2-artifact-graph.mjs';
import {libraryConfig,libraryCheckout} from "../../tools/data/library-context.mjs";
import {prepareLibraryData,withLibraryOutputs} from "../../tools/data/library-runtime.mjs";
import {readBuiltinCountryStoredBytes,readBuiltinCountry} from "../../tools/data/builtin-country-bytes.mjs";
import {builtinCountryAssets} from "../../src/data/builtin-country-files.js";
import {temporalContains,temporalMonthEnd} from "../../src/document/temporal.js";
import {createAutoPublicationReceipt} from './library-auto-publication.mjs';
const FAMILIES=Object.freeze(['territorial','current-world','world-mesh','world-preview','world-bundle','shared-boundaries','builtin-world','prepared-mesh']);
const COUNTRY='assets/data/builtin-world/generated/v1/';
const TERRITORIAL='assets/data/territorial-entities/generated/v2/';
const FIXTURE='tests/fixtures/builtin-modern-interval-baseline.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=(root,p)=>JSON.parse(readFileSync(safePath(root,p),'utf8'));
function fail(message){throw Error('AUTO_RUNTIME_'+message);}
function localGit(root,args){return execFileSync('git',args,{cwd:root,env:{...process.env,GIT_NO_LAZY_FETCH:'1'},maxBuffer:64*1024*1024}).toString().trim();}
function assertCurrent(root,{expectedAppSha,expectedDataSha,branch}){
 assertBranchState(root,{expectedSourceSha:expectedAppSha});
 assert.equal(localGit(root,['branch','--show-current']),branch,'AUTO_RUNTIME_BRANCH_CHANGED');
 assert.equal(libraryConfig(root).revision,expectedDataSha,'AUTO_RUNTIME_DATA_PIN_CHANGED');
 assert.equal(localGit(root,['status','--porcelain=v1','--untracked-files=all']),'','AUTO_RUNTIME_DIRTY_CHECKOUT');
}
function readPinnedSources(root,revision,paths){
 const archive=JSON.parse(localGit(libraryCheckout(root),['show',revision+':archive/index.json']));
 return Object.fromEntries(paths.map(p=>{const d=archive.files?.[p];if(!d||!/^[a-f0-9]{64}$/.test(d.sha256)||!Number.isSafeInteger(d.bytes)||d.bytes<0)fail('PINNED_SOURCE_MISSING: '+p);return [p,{sha256:d.sha256,bytes:d.bytes}];}));
}
function runCommand(command,cwd,env){
 assert.ok(Array.isArray(command)&&command.length>=2,'AUTO_RUNTIME_INVALID_OWNER_COMMAND');
 execFileSync(command[0]==='node'?process.execPath:command[0],command.slice(1),{cwd,env:{...process.env,...env,GIT_NO_LAZY_FETCH:'1'},stdio:'inherit'});
}
function runBaseline(root){execFileSync(process.execPath,['--test','--test-name-pattern=builtin-world-baseline','tests/unit/document/builtin-world-catalog.test.mjs'],{cwd:root,env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:'inherit'});}
function write(root,p,bytes,lease){const target=safePath(root,p);mkdirSync(dirname(target),{recursive:true});return lease({root,paths:[target]},()=>writeFileSync(target,bytes));}
function replaceFixture(root,bytes,{rename=renameSync}={}){
 const target=safePath(root,FIXTURE),temporary=safePath(root,FIXTURE+'.auto-fixture-'+randomUUID());
 try{writeFileSync(temporary,bytes,{flag:'wx'});rename(temporary,target);}
 finally{if(existsSync(temporary))unlinkSync(temporary);}
}
function pruneObsoleteCountryCopies(root,baselineAssets,withOutputs){
 const active=new Set(builtinCountryAssets(json(root,COUNTRY+'index.json')).map(row=>row.file));
 const files=[];
 function visit(prefix){for(const name of readdirSync(safePath(root,COUNTRY+prefix))){const p=prefix+name,full=safePath(root,COUNTRY+p),stat=lstatSync(full);if(stat.isDirectory())visit(p+'/');else{if(!stat.isFile())fail('UNKNOWN_COUNTRY_FILE: '+p);files.push(p);}}}
 visit('');const obsolete=[];
 // Authenticate every deletion candidate before removing any file. Unknown user
 // files or modified baseline copies fail closed and remain untouched.
 for(const p of files){if(['index.json','coverage-report.json'].includes(p)||active.has(p))continue;
  const original=baselineAssets.get(p);if(!original)fail('UNKNOWN_COUNTRY_FILE: '+p);
  const bytes=readFileSync(safePath(root,COUNTRY+p));if(bytes.length!==original.compressedBytes||hash(bytes)!==original.sha256)fail('OBSOLETE_COUNTRY_BYTES_CHANGED: '+p);
  obsolete.push(COUNTRY+p);
 }
 withOutputs({root,paths:obsolete.map(p=>safePath(root,p))},()=>{for(const p of obsolete)unlinkSync(safePath(root,p));});
}
function countries(root,decodeIds=new Set()){
 const index=json(root,COUNTRY+'index.json'),result=new Map();
 if(!Array.isArray(index.entities))fail('COUNTRY_INDEX');
 for(const entry of index.entities){
  if(result.has(entry.entityId))fail('DUPLICATE_COUNTRY');
  let payload;
  // Hash-check every stored country, but retain geometry only for the changed
  // current bindings. Never keep a second full 286-country catalog in memory.
  if(decodeIds.has(entry.entityId)){
   payload=readBuiltinCountry(entry,index,p=>readFileSync(safePath(root,COUNTRY+p)));assert.equal(payload.entityId,entry.entityId,'AUTO_RUNTIME_COUNTRY_ID');
  }else readBuiltinCountryStoredBytes(entry,p=>readFileSync(safePath(root,COUNTRY+p)));
  result.set(entry.entityId,{entry,...(payload?{payload}:{})});
 }
 return result;
}
function scopedFixture(fixture,compiled,changedEntityIds,provenance){
 const result=structuredClone(fixture),ids=new Set(changedEntityIds.map(id=>id.slice('state:'.length)));
 const month=result.months?.find(row=>row.month==='2026-10');if(!month||!Array.isArray(month.entities))fail('FIXTURE_MONTH');
 for(const id of ids){
  const row=month.entities.find(e=>e.entityId===id),country=compiled.get(id);
  if(!row||!country)fail('FIXTURE_EXISTING_COUNTRY: '+id);
  const bindings=country.payload.sourceBindings?.filter(b=>temporalContains(b,temporalMonthEnd('2026-10')));
  if(bindings?.length!==1||!bindings[0].geometryRef||typeof bindings[0].sourceVersionId!=='string')fail('FIXTURE_CURRENT_BINDING: '+id);
  row.geometryRef=structuredClone(bindings[0].geometryRef);row.sourceVersionId=bindings[0].sourceVersionId;
 }
 if(!result.provenance||!Array.isArray(result.provenance.acceptedGeometryUpdates))fail('FIXTURE_PROVENANCE');
 result.provenance.acceptedGeometryUpdates.push({entities:[...ids].sort(),month:'2026-10',...provenance,scope:'Automatic current binding refresh only; no historical evidence or sovereignty finding.'});
 return result;
}
function verifyNativeProjection(root,writes){
 const index=json(root,TERRITORIAL+'index.json');
 for(const w of writes){
  if(w.path.endsWith('/views/world.json')){assert.deepEqual(index.views?.find(v=>v.id==='world:catalog'),JSON.parse(w.bytes),'AUTO_RUNTIME_WORLD_SOURCE_MISMATCH');continue;}
  const entity=JSON.parse(w.bytes),entry=index.entities?.find(e=>e.entityId===entity.entityId);if(!entry)fail('NATIVE_ENTRY_MISSING');
  const stored=readFileSync(safePath(root,TERRITORIAL+entry.file));
  if(stored.length!==entry.compressedBytes||hash(stored)!==entry.sha256)fail('NATIVE_HASH');
  const bytes=stored[0]===0x1f&&stored[1]===0x8b?gunzipSync(stored,{maxOutputLength:32*1024*1024}):stored;
  if(bytes.length!==entry.decodedBytes)fail('NATIVE_SIZE');assert.deepEqual(JSON.parse(bytes),entity,'AUTO_RUNTIME_NATIVE_SOURCE_MISMATCH');
 }
}
/** Dependencies are trusted local owner adapters, not manifest-provided commands.
 * No remote reads, data storage, commits or deployment. Root sources remain edited
 * only after successful guarded local publication; failures restore owned bytes.
 */
export async function deriveAutomaticRuntime({root,inputProjection,inputDataSha,expectedAppSha,expectedDataSha,branch,generatorIdentity,stageDir,regenerationOnly=false,dependencies={}}){
 if(!['main','work/gis'].includes(branch))fail('BRANCH');
 for(const value of [inputDataSha,expectedAppSha,expectedDataSha])if(!/^(?!0{40}$)[a-f0-9]{40}$/.test(value||''))fail('SHA');
 if(!/^(?!0{64}$)[a-f0-9]{64}$/.test(generatorIdentity||'')||!/^(?!0{64}$)[a-f0-9]{64}$/.test(inputProjection?.inputFingerprint||''))fail('IDENTITY');
 if(typeof stageDir!=='string'||!stageDir.startsWith('build-native/p2/'))fail('STAGE_LOCATION');safePath(root,stageDir);
 const writes=inputProjection.writes;
 if(typeof regenerationOnly!=='boolean')fail('REGENERATION_MODE');
 if(regenerationOnly&&(inputProjection.noop!==true||writes?.length!==0||inputProjection.changedEntityIds?.length!==0||inputProjection.viewChanged!==false))fail('REGENERATION_PROJECTION');
 if(!Array.isArray(writes)||(!writes.length&&!regenerationOnly)||!Array.isArray(inputProjection.changedEntityIds)||new Set(inputProjection.changedEntityIds).size!==inputProjection.changedEntityIds.length)fail('PROJECTION');
 const allowed=new Set(inputProjection.changedEntityIds.map(id=>{if(!/^state:[A-Za-z0-9_-]+$/.test(id))fail('ENTITY_ID');return 'assets/data/territorial-entities/source/countries/'+id.replace(':','-')+'.json';}));
 if(inputProjection.viewChanged)allowed.add('assets/data/territorial-entities/source/views/world.json');
 if(writes.length!==allowed.size||new Set(writes.map(w=>w.path)).size!==writes.length||writes.some(w=>!allowed.has(w.path)||!Buffer.isBuffer(w.bytes)||w.bytes.length>32*1024*1024))fail('SOURCE_PATH');
 if(JSON.stringify(inputProjection.requiredFamilies)!==JSON.stringify(FAMILIES))fail('FAMILIES');
 for(const w of writes){const value=JSON.parse(w.bytes);if(w.path.endsWith('/views/world.json')){if(value.id!=='world:catalog')fail('SOURCE_IDENTITY');}
  else if(w.path!=='assets/data/territorial-entities/source/countries/'+String(value.entityId).replace(':','-')+'.json')fail('SOURCE_IDENTITY');}
 const d={assertCurrent,readPinnedSources,prepareLibraryData,withLibraryOutputs,stageArtifacts,publishArtifacts,graphStatus,runBaseline,runCommand,renameFixture:renameSync,...dependencies};
 const guard=()=>d.assertCurrent(root,{expectedAppSha,expectedDataSha,branch});guard();
 const pinned=await d.readPinnedSources(root,expectedDataSha,writes.map(w=>w.path)),originals=new Map();
 // All originals verified before the first write; never trust caller-supplied hashes.
 for(const w of writes){const bytes=readFileSync(safePath(root,w.path)),descriptor=pinned[w.path];if(!descriptor||bytes.length!==descriptor.bytes||hash(bytes)!==descriptor.sha256)fail('ORIGINAL_SOURCE: '+w.path);originals.set(w.path,bytes);}
 const baselineAssets=new Map(builtinCountryAssets(json(root,COUNTRY+'index.json')).map(row=>[row.file,row]));
 const previous=countries(root),fixtureBytes=readFileSync(safePath(root,FIXTURE)),fixture=JSON.parse(fixtureBytes);
 // Existing baseline test proves fixture identity/geometry/points and SOURCE_CUTS
 // against the old compiled baseline before any selective refresh can mask drift.
 await d.runBaseline(root);
 const inject=target=>{for(const w of writes)write(target,w.path,w.bytes,d.withLibraryOutputs);};
 let published=false;
 try{
  guard();
  for(const w of writes)if(!readFileSync(safePath(root,w.path)).equals(originals.get(w.path)))fail('SOURCE_MOVED: '+w.path);
  inject(root);
  let builtinPruned=false;
  const publication=await d.stageArtifacts(root,{families:[...FAMILIES],expectedSourceSha:expectedAppSha,stageDir,run:async(command,cwd,env)=>{
   assert.equal(resolve(cwd),resolve(safePath(root,stageDir),'checkout'),'AUTO_RUNTIME_OWNER_STAGE_LOCATION');
   await d.runCommand(command,cwd,env);
   if(command.length===2&&command[0]==='node'&&command[1]==='tools/build/build-builtin-world.mjs'){
    pruneObsoleteCountryCopies(cwd,baselineAssets,d.withLibraryOutputs);builtinPruned=true;
   }
  },prepareData:({root:target,purpose,prefixes})=>{
   const result=d.prepareLibraryData({root:target,fetch:false,purpose,prefixes});if(result?.then)fail('ASYNC_PREPARE_UNSUPPORTED');
   // Official stage prepares the pinned baseline; reapply verified edits BEFORE owners run.
   for(const w of writes){const b=readFileSync(safePath(target,w.path)),p=pinned[w.path];if(b.length!==p.bytes||hash(b)!==p.sha256)fail('STAGE_ORIGINAL_SOURCE: '+w.path);}inject(target);
  }});
  if(!builtinPruned)fail('BUILTIN_OWNER_NOT_RUN');
  const checkout=resolve(safePath(root,stageDir),'checkout');
  for(const w of writes)assert.deepEqual(readFileSync(safePath(checkout,w.path)),w.bytes,'AUTO_RUNTIME_STAGE_SOURCE_CHANGED');
  verifyNativeProjection(checkout,writes);
  const compiledIndex=json(checkout,COUNTRY+'index.json'),nativeIndex=json(checkout,TERRITORIAL+'index.json');
  if(inputProjection.viewChanged){const world=writes.find(w=>w.path.endsWith('/views/world.json'));if(compiledIndex.inputHashes?.view!==hash(JSON.stringify(JSON.parse(world.bytes))))fail('COMPILED_WORLD_SOURCE');}
  for(const id of inputProjection.changedEntityIds){const native=nativeIndex.entities.find(e=>e.entityId===id);if(compiledIndex.inputHashes?.sourceRevisions?.[id]!==native?.sha256)fail('COMPILED_SOURCE_REVISION: '+id);}
  const changed=new Set(inputProjection.changedEntityIds.map(id=>id.slice(6))),compiled=countries(checkout,changed);
  assert.deepEqual([...compiled.keys()].sort(),[...previous.keys()].sort(),'AUTO_RUNTIME_COUNTRY_MEMBERSHIP');
  for(const [id,old] of previous)if(!regenerationOnly&&!changed.has(id))assert.deepEqual(compiled.get(id).entry,old.entry,'AUTO_RUNTIME_UNRELATED_COUNTRY: '+id);
  if(regenerationOnly)assert.deepEqual(readFileSync(safePath(checkout,FIXTURE)),fixtureBytes,'AUTO_RUNTIME_REGENERATION_FIXTURE_CHANGED');
  else {
   const updated=scopedFixture(fixture,compiled,inputProjection.changedEntityIds,{inputDataSha,inputFingerprint:inputProjection.inputFingerprint,generatingAppSha:expectedAppSha,generatorIdentity});
   write(checkout,FIXTURE,Buffer.from(JSON.stringify(updated,null,2)+'\n'),d.withLibraryOutputs);
  }
  await d.runBaseline(checkout);
  const status=d.graphStatus(checkout,{requested:[...FAMILIES]}),outputs={};
  for(const family of FAMILIES){if(!status.statuses[family])fail('MISSING_GRAPH_FAMILY');for(const [p,digest] of Object.entries(status.statuses[family].outputs)){
   if(p===RECEIPT_PATH)continue;
   const actual=hash(readFileSync(safePath(checkout,p)));if(actual!==digest)fail('GRAPH_OUTPUT_HASH: '+p);outputs[p]=actual;
  }}
  const autoReceipt=createAutoPublicationReceipt({inputDataSha,inputFingerprint:inputProjection.inputFingerprint,generatingAppSha:expectedAppSha,generatorIdentity,families:[...FAMILIES],outputs});
  const receipt=json(checkout,RECEIPT_PATH);receipt.autoPublication=autoReceipt;
  write(checkout,RECEIPT_PATH,Buffer.from(JSON.stringify(receipt,null,2)+'\n'),d.withLibraryOutputs);
  // Official stage manifest must account for the augmented receipt, never itself
  // become part of autoReceipt.outputs. Fixture remains a separate app-owned file.
  publication.paths=[...new Set([...publication.paths,RECEIPT_PATH])].sort();
  publication.before[RECEIPT_PATH]=(()=>{try{return hash(readFileSync(safePath(root,RECEIPT_PATH)));}catch(e){if(e.code==='ENOENT')return null;throw e;}})();
  publication.after[RECEIPT_PATH]=hash(readFileSync(safePath(checkout,RECEIPT_PATH)));
  write(root,stageDir+'/stage.json',Buffer.from(JSON.stringify(publication,null,2)+'\n'),d.withLibraryOutputs);
  assert.deepEqual(readFileSync(safePath(root,FIXTURE)),fixtureBytes,'AUTO_RUNTIME_FIXTURE_CHANGED');
  for(const w of writes)assert.deepEqual(readFileSync(safePath(root,w.path)),w.bytes,'AUTO_RUNTIME_ROOT_SOURCE_CHANGED');
  const publicationGuard=()=>{guard();
   for(const w of writes)assert.deepEqual(readFileSync(safePath(root,w.path)),w.bytes,'AUTO_RUNTIME_ROOT_SOURCE_CHANGED');
   assert.deepEqual(readFileSync(safePath(root,FIXTURE)),fixtureBytes,'AUTO_RUNTIME_FIXTURE_CHANGED');
  };
  publicationGuard();const result=d.publishArtifacts(root,{stageDir,expectedSourceSha:expectedAppSha,branch,guard:publicationGuard});published=true;
  assert.deepEqual(readFileSync(safePath(root,FIXTURE)),fixtureBytes,'AUTO_RUNTIME_FIXTURE_CHANGED');
  if(!regenerationOnly)replaceFixture(root,readFileSync(safePath(checkout,FIXTURE)),{rename:d.renameFixture});
  return {changedPaths:[...new Set([...result.changedPaths,...writes.map(w=>w.path),...(regenerationOnly?[]:[FIXTURE])])].sort(),sourcePaths:writes.map(w=>w.path),fixturePath:FIXTURE,autoReceipt,verification:{officialStage:true,nativeProjection:true,countryIntegrity:true,unrelatedCountriesPreserved:!regenerationOnly,regenerationOnly,baselineBefore:true,baselineAfter:true}};
 }catch(error){
  if(published){error.localPublicationComplete=true;error.recovery='fresh-clean-checkout-required';}
  if(!published)for(const w of writes){try{if(readFileSync(safePath(root,w.path)).equals(w.bytes))write(root,w.path,originals.get(w.path),d.withLibraryOutputs);}catch(restoreError){(error.restoreErrors??=[]).push({path:w.path,message:restoreError.message});}}
  throw error;
 }
}
