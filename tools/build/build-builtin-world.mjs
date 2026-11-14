import fs from 'node:fs';
import {assertHistoricalCompiledChanges} from "../gis/historical-display-review.mjs";
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {withLibraryOutputs} from "../data/library-runtime.mjs";
import {libraryConfig,libraryCheckout,decodeArchiveEntry} from "../data/library-context.mjs";
import {readTerritorialSources,readTerritorialSource,entityFileName,territorialSourceRoot,territorialDataRoot} from "../data/territorial-entity-sources.mjs";
import {normalizeTerritorialLibraryEntity} from "../gis/territorial-library.js";
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
import {buildCurrentWorld} from "../data/territorial-current-world.mjs";
import {compileBuiltinWorldCatalog,coalesceCoverageAdjustments,replaceBuiltinWorldCountryNames} from "./builtin-world-compiler.mjs";
import {builtinSubunitId} from "../../src/document/territorial-display-identity.js";
import {loadBuiltinDisplayPolicy} from "../gis/builtin-display-policy.mjs";
import {encodeBuiltinCountries,finalizeBuiltinWorldFiles,readBuiltinCountryStoredBytes,readBuiltinCountry} from "../data/builtin-country-bytes.mjs";
import {isDeepStrictEqual} from 'node:util';
import {readProjectGenerationContext} from './project-generation-context.mjs';
import {assertTerritorialRetirement,assertBuiltinRetirement,readRetirementReceipt,planTerritorialRetirement,mixedRetirementPublicationPlan,verifiedMixedCurrentWorld} from '../gis/territorial-retirement.mjs';
export {finalizeBuiltinWorldFiles};

const output=fileURLToPath(new URL("../../assets/data/builtin-world/generated/v1/",import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// A removal can be activated only from this owner's executed producer, not a
// caller-authored file map. The proof binds immutable content, not mutable state.
const retirementPublications=new WeakMap();
const retirementInputDigest=({retirement,sourceIndex,previousSourceIndex,view,policy,displayPolicy})=>sha(JSON.stringify({retirement,sourceIndex,previousSourceIndex,view,policy,displayPolicy}));
function rememberRetirementPublication(files,input){
 retirementPublications.set(files,{input:retirementInputDigest(input),files:new Map([...files].map(([file,bytes])=>[file,sha(bytes)]))});
 return files;
}
export function recordBuiltinWorldInputs(index,sourceRevisions,view,policy){
 const ordered=Object.fromEntries(Object.entries(sourceRevisions).sort(([a],[b])=>a.localeCompare(b,'en')));
 index.inputHashes={entities:sha(JSON.stringify(ordered)),sourceRevisions:ordered,view:sha(JSON.stringify(view)),policy:sha(JSON.stringify(policy))};
 return index;
}
export function buildBuiltinWorldPublication({input=null,previousIndex=null,policyFile=new URL("../../assets/data/historical-world/policy.json",import.meta.url)}={}){
 const policy=input?.policy||JSON.parse(fs.readFileSync(policyFile));
 // Explicit entities/readSource are caller-verified inputs (for example, an
 // already verified scoped authoring batch). Default readers verify stored chunks.
 const entities=input?.entities||readTerritorialSources(territorialSourceRoot,{sourceIndex:input?.sourceIndex});
 const view=input?.view||JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json')));
 const currentWorld=input?.currentWorld;
 const {index,countries,coverageReport}=compileBuiltinWorldCatalog({entities,view,currentWorld,policy,displayPolicy:input?.displayPolicy||loadBuiltinDisplayPolicy()});
 // In the full compiler, previously verified geometry resources are a
 // content-addressed cache. Name/flag/property changes may replace the small
 // country descriptor but cannot re-gzip the unchanged source coordinates.
 if(previousIndex?.geometryAssets?.length){
   const known=new Map(previousIndex.geometryAssets.map(asset=>[JSON.stringify([asset.id,asset.version]),asset]));
   for(const asset of index.geometryAssets||[])known.set(JSON.stringify([asset.id,asset.version]),asset);
   index.geometryAssets=[...known.values()];
 }
 const files=encodeBuiltinCountries(index,countries,new Map());
 recordBuiltinWorldInputs(index,input?.sourceIndex?Object.fromEntries(input.sourceIndex.entities.filter(row=>!['river','lake'].includes(row.entityType)).map(row=>[row.entityId,row.sha256])):
  Object.fromEntries(entities.map(row=>[row.entityId,sha(JSON.stringify(row))])),view,policy);
 finalizeBuiltinWorldFiles(index,files,{previousIndex});
 files.set('coverage-report.json',Buffer.from(JSON.stringify(coverageReport)+'\n'));
 return files;
}
export function buildBuiltinWorldNamePublication({entityIds,sourceIndex,previousIndex,readSource=null,readPreviousSource,readCountry}) {
 if(!entityIds?.length||new Set(entityIds).size!==entityIds.length)throw Error('Explicit unique name scope required');
 readSource??=id=>readTerritorialSource(id,territorialSourceRoot,{sourceIndex});
 const index=structuredClone(previousIndex),files=new Map();
 const revisions={...index.inputHashes.sourceRevisions};
 for(const id of entityIds){
  const mapping=index.sourceIdentities.filter(row=>row.sourceEntityIds.includes(id));
  if(mapping.length!==1||mapping[0].sourceEntityIds.length!==1)throw Error(`Name-only update requires one source identity: ${id}`);
  const entry=index.entities.find(row=>row.entityId===mapping[0].projectEntityId),source=sourceIndex.entities.find(row=>row.entityId===id);
  if(!entry||!source)throw Error(`Missing named country: ${id}`);
  const stored=readBuiltinCountryStoredBytes(entry,readCountry);
  const country=JSON.parse(gunzipSync(stored)),entity=readSource(id),prior=readPreviousSource(id);
  if(country.entityId!==entry.entityId||entity.entityId!==id)throw Error('Name scope identity mismatch');
  const unnamed=({names,alternateNames,nameVersions,...rest})=>rest;
  if(JSON.stringify(unnamed(entity))!==JSON.stringify(unnamed(prior)))throw Error(`Name-only scope includes non-name changes: ${id}`);
  const next=replaceBuiltinWorldCountryNames(country,entity);
  for(const [file,bytes] of encodeBuiltinCountries(index,[next],new Map()))files.set(file,bytes);
  revisions[id]=source.sha256;
 }
 const ordered=Object.fromEntries(Object.entries(revisions).sort(([a],[b])=>a.localeCompare(b,'en')));
 index.inputHashes.sourceRevisions=ordered;index.inputHashes.entities=sha(JSON.stringify(ordered));
 return finalizeBuiltinWorldFiles(index,files,{previousIndex});
}

/** Remove an explicitly disproven current identity without altering any surviving
 * country. Source updates already staged elsewhere remain uncompiled revisions. */
export function buildBuiltinWorldRetirementPublication({retirement,sourceIndex,previousSourceIndex,view,policy,
 previousIndex,previousCoverage,displayPolicy=loadBuiltinDisplayPolicy(),readRecovery}){
 const plan=assertTerritorialRetirement({manifest:retirement,previousIndex:previousSourceIndex,index:sourceIndex,displayPolicy,readRecovery});
 if(JSON.stringify(view)!==JSON.stringify(plan.index.views[0]))throw Error('Territorial retirement: unpaired world view');
 if(plan.mixed){const built=mixedRetirementPublicationPlan(plan,{readRecovery}),{index,coverage,files}=built,revisions={...previousIndex.inputHashes.sourceRevisions};for(const id of plan.sourceIds)delete revisions[id];for(const [id,row]of plan.metadataUpdates)revisions[id]=row.nextEntry.sha256;recordBuiltinWorldInputs(index,revisions,view,policy);files.set('coverage-report.json',Buffer.from(JSON.stringify(coverage)+'\n'));finalizeBuiltinWorldFiles(index,files,{previousIndex});assertBuiltinRetirement({plan,previousSourceIndex,sourceIndex,previousIndex,index,previousCoverage,coverage,policy,readRecovery,readDescriptor:entry=>JSON.parse(gunzipSync(readBuiltinCountryStoredBytes(entry,file=>files.get(file))))});return rememberRetirementPublication(files,{retirement,sourceIndex,previousSourceIndex,view,policy,displayPolicy});}
 const retired=new Set([...plan.featureIds].map(builtinSubunitId));
 const index=structuredClone(previousIndex),coverage=structuredClone(previousCoverage);
 index.entities=index.entities.filter(row=>!retired.has(row.entityId));
 const retainedGeometry=new Set(index.entities.flatMap(row=>row.geometryRefs.map(ref=>JSON.stringify([ref.id,ref.version]))));
 index.geometryAssets=index.geometryAssets.filter(asset=>retainedGeometry.has(JSON.stringify([asset.id,asset.version])));
 index.sourceIdentities=index.sourceIdentities.filter(row=>!retired.has(row.projectEntityId));
 coverage.entities=coverage.entities.filter(row=>!retired.has(row.entityId));
 const revisions={...previousIndex.inputHashes.sourceRevisions};for(const id of plan.sourceIds)delete revisions[id];
 recordBuiltinWorldInputs(index,revisions,view,policy);
 const files=new Map([['coverage-report.json',Buffer.from(JSON.stringify(coverage)+'\n')]]);
 finalizeBuiltinWorldFiles(index,files,{previousIndex});
 assertBuiltinRetirement({plan,previousSourceIndex,sourceIndex,previousIndex,index,previousCoverage,coverage,policy});
 return rememberRetirementPublication(files,{retirement,sourceIndex,previousSourceIndex,view,policy,displayPolicy});
}

/** The retirement baseline stays internal until all requested changes compile. */
export function buildBuiltinWorldRetiredPartialPublication(input){
 if(input.planOnly)throw Error('Retirement publication requires an executed source-paired compilation');
 if(input.retirement?.kind==='mixed-current-identity-retirement')throw Error('Mixed retirement forbids source-wide partial recompilation; use verified minimal runtime producer');
 input={...input,displayPolicy:input.displayPolicy||loadBuiltinDisplayPolicy()};
 const baseline=buildBuiltinWorldRetirementPublication(input);
 const files=buildBuiltinWorldPartialPublication({...input,previousIndex:JSON.parse(baseline.get('index.json')),
  previousCoverage:JSON.parse(baseline.get('coverage-report.json'))});
 return rememberRetirementPublication(files,input);
}

/** Recompile only connected spatial/hierarchy components. Unrelated payloads
 * are neither read nor returned: their verified descriptors stay in the index. */
export function buildBuiltinWorldPartialPublication({entityIds,sourceIndex,previousSourceIndex,view,policy,
 previousIndex,previousCoverage,readSource=null,currentWorld=null,onScope=()=>{},planOnly=false,displayPolicy=loadBuiltinDisplayPolicy()}){
 if(!entityIds?.length||new Set(entityIds).size!==entityIds.length)throw new Error('Explicit unique entity scope required');
 if(previousIndex.inputHashes.view!==sha(JSON.stringify(view))||previousIndex.inputHashes.policy!==sha(JSON.stringify(policy)))throw new Error('World view or policy changed; partial country scope is insufficient');
 const sources=new Map(sourceIndex.entities.map(row=>[row.entityId,row])),oldSources=new Map(previousSourceIndex.entities.map(row=>[row.entityId,row]));
 const mapping=new Map(previousIndex.sourceIdentities.flatMap(row=>row.sourceEntityIds.map(id=>[id,row.projectEntityId])));
 readSource??=id=>readTerritorialSource(id,territorialSourceRoot,{sourceIndex});
 const loadedSources=new Map(),loadSource=id=>{
  if(!loadedSources.has(id))loadedSources.set(id,readSource(id));
  return loadedSources.get(id);
 };
 // Reject stale selected metadata/bounds before trusting it for dependency scope.
 // A plan is metadata-only; execution must repeat this verified preflight.
 if(!planOnly)for(const id of entityIds){if(!mapping.has(id))throw new Error(`Unknown scoped source: ${id}`);loadSource(id);}
 const current=new Map(view.selections.map(row=>[row.entityId,row.geometryVersionId]));
 const subunits=new Map(displayPolicy.subunits.map(row=>[builtinSubunitId(row.sourceCountryId),row.parentId]));
 const nodes=previousIndex.sourceIdentities.map(row=>{
  const versions=row.sourceEntityIds.flatMap(id=>[sources.get(id),oldSources.get(id)]).filter(Boolean);
  const first=sources.get(row.sourceEntityIds[0])||oldSources.get(row.sourceEntityIds[0]);
  if(!first)throw new Error(`Missing catalog metadata: ${row.projectEntityId}`);
  const parents=new Set(versions.map(value=>subunits.get(row.projectEntityId)||mapping.get(value.parentEntityId)||value.parentEntityId));
  const bbox=[Math.min(...versions.map(v=>v.bbox[0])),Math.min(...versions.map(v=>v.bbox[1])),Math.max(...versions.map(v=>v.bbox[2])),Math.max(...versions.map(v=>v.bbox[3]))];
  if(bbox[0]<-180||bbox[2]>180||bbox[2]-bbox[0]>180){bbox[0]=-180;bbox[2]=180;}
  return {...row,parents,
   historical:versions.some(value=>!current.has(value.entityId)||value.geometryVersions.some(v=>v.versionId!==current.get(value.entityId))),
   bbox};
 });
 const edges=new Map(nodes.map(row=>[row.projectEntityId,new Set()]));
 const connect=(a,b)=>{edges.get(a).add(b);edges.get(b).add(a);};
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
  const a=nodes[i],b=nodes[j];
  const overlap=a.bbox[0]<=b.bbox[2]&&b.bbox[0]<=a.bbox[2]&&a.bbox[1]<=b.bbox[3]&&b.bbox[1]<=a.bbox[3];
  if(a.parents.has(b.projectEntityId)||b.parents.has(a.projectEntityId)||[...a.parents].some(parent=>b.parents.has(parent))&&(a.historical||b.historical)&&overlap)connect(a.projectEntityId,b.projectEntityId);
 }
 for (const row of policy.parentRelations || []) {
  const child=mapping.get(row.entityId)||row.entityId,parent=mapping.get(row.parentEntityId)||row.parentEntityId;
  if(edges.has(child)&&edges.has(parent))connect(child,parent);
 }
 for(const row of [...policy.replacements,...previousCoverage.adjustments]){
  const a=mapping.get(row.targetEntityId)||row.entityId||row.targetEntityId;
  for(const raw of row.relatedIds||[row.priorityEntityId]){const b=mapping.get(raw)||raw;if(edges.has(a)&&edges.has(b))connect(a,b);}
 }
 const pending=new Set(entityIds.map(id=>{if(!mapping.has(id))throw new Error(`Unknown scoped source: ${id}`);return mapping.get(id);}));
 const components=[],affected=new Set();
 for(const id of pending){
  if(affected.has(id))continue;
  const component=[id];affected.add(id);
  for(let i=0;i<component.length;i++)for(const peer of edges.get(component[i]))if(!affected.has(peer)){affected.add(peer);component.push(peer);}
  components.push(new Set(component));
 }
 const sourceIds=new Set(nodes.filter(row=>affected.has(row.projectEntityId)).flatMap(row=>row.sourceEntityIds));
 const revisions={...(previousIndex.inputHashes.sourceRevisions||Object.fromEntries(previousSourceIndex.entities.map(row=>[row.entityId,row.sha256])))};
 const requested=new Set(entityIds);
 for(const id of sourceIds){
  if(!sources.has(id))throw new Error(`Missing scoped source: ${id}`);
  if(!requested.has(id)&&revisions[id]!==sources.get(id).sha256)throw new Error(`Unselected modified dependency: ${id}`);
  revisions[id]=sources.get(id).sha256;
 }
 const scope={requested:entityIds.length,sourceIds:[...sourceIds],projectEntityIds:[...affected],components:components.map(component=>[...component])};
 onScope(scope);
 if(planOnly)return scope;
 const files=new Map(),replacements=new Map(),coverage=new Map(),adjustments=[];
 const geometryAssets=new Map((previousIndex.geometryAssets||[]).map(asset=>[JSON.stringify([asset.id,asset.version]),asset]));
 const availableSourceIds=new Set(previousIndex.sourceIdentities.flatMap(row=>row.sourceFeatureIds));
 if(currentWorld!==null){
  if(currentWorld.type!=='FeatureCollection'||!Array.isArray(currentWorld.features)
   ||new Set(currentWorld.features.map(row=>row.id)).size!==currentWorld.features.length
   ||currentWorld.features.some(row=>!availableSourceIds.has(row.id)))throw new Error('Current world source identity: invalid, duplicate or unknown supplied feature');
 }
 for(const component of components){
  const ids=new Set(nodes.filter(row=>component.has(row.projectEntityId)).flatMap(row=>row.sourceEntityIds));
  const entities=[...ids].map(loadSource);
  const scopedView={...view,selections:view.selections.filter(row=>ids.has(row.entityId))};
  const scopedPolicy={...policy,replacements:policy.replacements.filter(row=>ids.has(row.targetEntityId)&&ids.has(row.priorityEntityId)),
   ...(policy.parentRelations ? {parentRelations:policy.parentRelations.filter(row=>ids.has(row.entityId)&&ids.has(row.parentEntityId))} : {})};
  const selectedFeatureIds=new Set(scopedView.selections.map(row=>loadedSources.get(row.entityId).sourceInfo.featureId));
  const world=currentWorld?{...currentWorld,features:currentWorld.features.filter(row=>selectedFeatureIds.has(row.id))}:null;
  const compiled=compileBuiltinWorldCatalog({entities,view:scopedView,currentWorld:world,policy:scopedPolicy,availableSourceIds,displayPolicy});
  compiled.index.geometryAssets=previousIndex.geometryAssets;
  for(const [file,bytes] of encodeBuiltinCountries(compiled.index,compiled.countries,new Map()))files.set(file,bytes);
  for(const asset of compiled.index.geometryAssets)geometryAssets.set(JSON.stringify([asset.id,asset.version]),asset);
  for(const row of compiled.index.entities)replacements.set(row.entityId,row);
  for(const row of compiled.coverageReport.entities)coverage.set(row.entityId,row);
  adjustments.push(...compiled.coverageReport.adjustments);
 }
 const index=structuredClone(previousIndex);
 index.entities=[...index.entities.filter(row=>!affected.has(row.entityId)),...replacements.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId,'en'));
 const used=new Set(index.entities.flatMap(entry=>(entry.geometryRefs||[]).map(ref=>JSON.stringify([ref.id,ref.version]))));
 index.geometryAssets=[...geometryAssets].filter(([key])=>used.has(key)).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,value])=>value);
 recordBuiltinWorldInputs(index,revisions,view,policy);
 finalizeBuiltinWorldFiles(index,files,{previousIndex});
 files.set('coverage-report.json',Buffer.from(JSON.stringify({schemaVersion:2,
  adjustments:coalesceCoverageAdjustments([...previousCoverage.adjustments.filter(row=>!affected.has(row.entityId)),...adjustments]),
  entities:[...previousCoverage.entities.filter(row=>!affected.has(row.entityId)),...coverage.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId,'en'))})+'\n'));
 return files;
}
export function writeBuiltinWorldPublication(files,directory=output,{check=false,readPreviousCountry,retirementInputs=null,
 currentWorldTarget=path.join(territorialDataRoot,'generated/current-world.geojson'),
 displayPolicyTarget=fileURLToPath(new URL('../../assets/data/builtin-world/display-policy-v1.json',import.meta.url))}={}){
 // The index becomes visible only after the emitted payloads and diagnostics.
 // Deltas overlay an existing verified publication; old pinned assets are retained.
 const entries=[...files].filter(([file])=>file!=='index.json');
 if(files.has('index.json'))entries.push(['index.json',files.get('index.json')]);
 let verifiedMixedIds=new Set();
 const changed=[];
 for(const [file,bytes] of entries){
  const target=path.join(directory,file);
  if(fs.existsSync(target)&&fs.readFileSync(target).equals(bytes))continue;
  changed.push({target,bytes});
 }
 if(!files.has('index.json')&&[...files.keys()].some(file=>file.startsWith('countries/')||file.startsWith('country-parts/')))throw Error('Historical country publication requires its paired index');
 if(files.has('index.json')){
  const next=JSON.parse(files.get('index.json')),priorPath=path.join(directory,'index.json'),prior=fs.existsSync(priorPath)?JSON.parse(fs.readFileSync(priorPath)):{entities:[]},old=new Map(prior.entities.map(e=>[e.entityId,e]));
  if(prior.entities.some(entry=>!next.entities.some(row=>row.entityId===entry.entityId))&&!retirementInputs)throw Error('Territorial retirement requires an explicit paired publication manifest');
  if(retirementInputs){
   const {retirement,sourceIndex,previousSourceIndex,view,policy,displayPolicy=loadBuiltinDisplayPolicy(),readRecovery}=retirementInputs;
   const proof=retirementPublications.get(files);
   if(!proof||proof.input!==retirementInputDigest({...retirementInputs,displayPolicy})||proof.files.size!==files.size
    ||[...files].some(([file,bytes])=>proof.files.get(file)!==sha(bytes)))throw Error('Territorial retirement requires unchanged canonical producer output');
   const plan=assertTerritorialRetirement({manifest:retirement,previousIndex:previousSourceIndex,index:sourceIndex,displayPolicy,readRecovery});
   if(!isDeepStrictEqual(prior,plan.previousBuiltinIndex)&&!isDeepStrictEqual(prior,next))throw Error('Territorial retirement: active compiled baseline changed');
   const activeCoverage=JSON.parse(fs.readFileSync(path.join(directory,'coverage-report.json')));
   if(!isDeepStrictEqual(activeCoverage,isDeepStrictEqual(prior,plan.previousBuiltinIndex)?plan.previousCoverage:JSON.parse(files.get('coverage-report.json'))))throw Error('Territorial retirement: active coverage baseline changed');
   if(isDeepStrictEqual(prior,plan.previousBuiltinIndex)&&(!fs.existsSync(currentWorldTarget)||!fs.readFileSync(currentWorldTarget).equals(readRetirementReceipt(retirement.previousCurrentWorld,readRecovery))))throw Error('Territorial retirement: active current-world baseline changed');
   const policyBytes=Buffer.from(JSON.stringify(displayPolicy,null,2)+'\n');
   const activePolicy=fs.readFileSync(displayPolicyTarget);
   if(!activePolicy.equals(isDeepStrictEqual(prior,plan.previousBuiltinIndex)?readRetirementReceipt(retirement.displayPolicy,readRecovery):policyBytes))throw Error('Territorial retirement: active display-policy baseline changed');
   assertBuiltinRetirement({plan,previousSourceIndex,sourceIndex,previousIndex:plan.previousBuiltinIndex,index:next,
    previousCoverage:plan.previousCoverage,coverage:JSON.parse(files.get('coverage-report.json')),policy,
    readRecovery,readDescriptor:entry=>JSON.parse(gunzipSync(readBuiltinCountryStoredBytes(entry,file=>files.get(file)||fs.readFileSync(path.join(directory,file)))))});
   if(plan.mixed)verifiedMixedIds=new Set(plan.verifiedRuntimeCountries.keys());
   const sources=new Map(sourceIndex.entities.map(row=>[row.entityId,row]));
   if(!plan.mixed)for(const row of view.selections)if(next.inputHashes.sourceRevisions[row.entityId]!==sources.get(row.entityId)?.sha256)throw Error('Territorial retirement: current-world input remains uncompiled: '+row.entityId);
   const read=retirementInputs.readSource|| (id=>readTerritorialSource(id,territorialSourceRoot,{sourceIndex}));
   const world=plan.mixed?verifiedMixedCurrentWorld(plan,{readRecovery}):buildCurrentWorld({entities:view.selections.map(row=>read(row.entityId)),view});
   const bytes=Buffer.from(JSON.stringify(world)+'\n');
   for(const candidate of [{target:currentWorldTarget,bytes},{target:displayPolicyTarget,bytes:policyBytes}])if(!fs.existsSync(candidate.target)||!fs.readFileSync(candidate.target).equals(candidate.bytes)){
    const at=changed.findIndex(row=>row.target===path.join(directory,'index.json'));
    changed.splice(at<0?changed.length:at,0,candidate);
   }
  }
  for(const entry of next.entities){const before=old.get(entry.entityId);if(before?.sha256===entry.sha256||verifiedMixedIds.has(entry.entityId))continue;const read=entry=>readBuiltinCountry(entry,next,file=>files.get(file)||fs.readFileSync(path.join(directory,file))),readOld=entry=>readPreviousCountry?readPreviousCountry(entry,prior,file=>fs.readFileSync(path.join(directory,file))):readBuiltinCountry(entry,prior,file=>fs.readFileSync(path.join(directory,file)));assertHistoricalCompiledChanges(read(entry),before?readOld(before):null);}
 }
 if(check){if(changed.length)throw new Error(`Stale builtin world data: ${changed[0].target}`);return;}
 if(!changed.length)return;
 return withLibraryOutputs({paths:changed.map(({target})=>target)},()=>{
  // The old index remains the activation marker until the complete candidate is
  // ready. A failed write restores every changed target, including the projection.
  const backups=new Map(changed.map(({target})=>[target,fs.existsSync(target)?fs.readFileSync(target):null])),written=[];
  try{
   for(const {target,bytes} of changed){fs.mkdirSync(path.dirname(target),{recursive:true});written.push(target);fs.writeFileSync(target,bytes);}
  }catch(error){
   const failures=[];
   for(const target of written.reverse())try{const bytes=backups.get(target);if(bytes===null){if(fs.existsSync(target))fs.unlinkSync(target);}else fs.writeFileSync(target,bytes);}catch(cause){failures.push(new Error('Publication recovery failed: '+target,{cause}));}
   if(failures.length)throw new AggregateError([error,...failures],'Builtin publication failed; recovery is incomplete',{cause:error});
   throw error;
  }
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const projectId=process.argv.find(arg=>arg.startsWith('--project='))?.slice(10)||'default-world';
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const generation=readProjectGenerationContext({root,projectId});
 const sourceRoot=path.resolve(root,generation.source('territorialSourceRoot'));
 const sourceIndexPath=generation.source('territorialSourceIndex');
 const sourceIndexAbsolute=path.resolve(root,sourceIndexPath);
 const output=path.dirname(path.resolve(root,generation.catalogs.territorial));
 const selectedView=JSON.parse(fs.readFileSync(path.resolve(root,generation.source('worldView'))));
 const selectedPolicy=JSON.parse(fs.readFileSync(path.resolve(root,generation.source('historicalPolicy'))));
 const selectedDisplayPolicy=JSON.parse(fs.readFileSync(path.resolve(root,generation.source('displayPolicy'))));
 const selectedRead=id=>readTerritorialSource(id,sourceRoot,{sourceIndex,
  chunkRoot:path.dirname(sourceIndexAbsolute)});
 if(process.argv.includes('--pack-existing'))throw Error('--pack-existing is retired; use country-scoped --entities=<ids> generation');
 const selected=process.argv.find(arg=>arg.startsWith('--entities='));
 const retirementFile=process.argv.find(arg=>arg.startsWith('--retirement-manifest='));
 const namesOnly=process.argv.includes('--names-only');
 if(projectId!=='default-world'&&retirementFile)throw Error('Territorial retirement requires a project-paired archive and source retirement manifest');
 if(namesOnly&&!selected)throw Error('--names-only requires --entities');
 if(namesOnly&&process.argv.includes('--plan'))throw Error('--plan is only supported for geometry generation');
 if(process.argv.includes('--plan')&&!selected)throw new Error('--plan requires --entities');
 const sourceIndex=JSON.parse(fs.readFileSync(sourceIndexAbsolute));
 const priorCatalogPath=path.join(output,'index.json');
 const index=(selected||retirementFile||fs.existsSync(priorCatalogPath))
   ?JSON.parse(fs.readFileSync(priorCatalogPath)):null;
 let files,retirementInputs=null;
 if(retirementFile){
  if(namesOnly||process.argv.includes('--plan'))throw Error('Retirement publication requires source-paired geometry generation');
  const retirement=JSON.parse(fs.readFileSync(retirementFile.slice('--retirement-manifest='.length)));
  retirementInputs={retirement,sourceIndex,previousSourceIndex:JSON.parse(fs.readFileSync(retirement.previousIndex.path)),
   view:JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'))),
   policy:JSON.parse(fs.readFileSync(new URL('../../assets/data/historical-world/policy.json',import.meta.url))),displayPolicy:planTerritorialRetirement(retirement,JSON.parse(readRetirementReceipt(retirement.previousIndex))).displayPolicy};
  const input={...retirementInputs,previousIndex:JSON.parse(readRetirementReceipt(retirement.previousBuiltinIndex)),previousCoverage:JSON.parse(readRetirementReceipt(retirement.previousCoverage))};
  files=selected?buildBuiltinWorldRetiredPartialPublication({...input,entityIds:selected.slice('--entities='.length).split(',').filter(Boolean)}):buildBuiltinWorldRetirementPublication(input);
 }else if(selected){
  if(namesOnly){
   const ids=selected.slice('--entities='.length).split(',').filter(Boolean);
   const root=fileURLToPath(new URL("../../",import.meta.url)),config=libraryConfig(root),checkout=libraryCheckout(root);
   const archive=JSON.parse(execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','show',`${config.revision}:archive/index.json`],{cwd:checkout,maxBuffer:16*1024*1024}));
   files=buildBuiltinWorldNamePublication({entityIds:ids,sourceIndex,previousIndex:index,readSource:selectedRead,readCountry:file=>fs.readFileSync(path.join(output,file)),
    readPreviousSource:id=>normalizeTerritorialLibraryEntity(decodeTerritorialSource(JSON.parse(decodeArchiveEntry(checkout,archive.files[`${generation.source('territorialSourceRoot')}/countries/${entityFileName(id)}`],config.revision)),file=>decodeArchiveEntry(checkout,archive.files[generation.source('territorialSourceRoot')+'/'+file],config.revision)))});
   console.log(`Name-only generation: ${ids.length} selected source; geometry and coverage reused without recomputation.`);
  }else{
  const root=fileURLToPath(new URL("../../",import.meta.url)),config=libraryConfig(root),checkout=libraryCheckout(root);
  const archive=JSON.parse(execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','show',`${config.revision}:archive/index.json`],{cwd:checkout,maxBuffer:16*1024*1024}));
  const previousSourceIndex=JSON.parse(decodeArchiveEntry(checkout,archive.files[sourceIndexPath],config.revision));
  files=buildBuiltinWorldPartialPublication({entityIds:selected.slice('--entities='.length).split(',').filter(Boolean),sourceIndex,previousSourceIndex,
   view:selectedView,policy:selectedPolicy,displayPolicy:selectedDisplayPolicy,readSource:selectedRead,
   previousIndex:index,previousCoverage:JSON.parse(fs.readFileSync(path.join(output,'coverage-report.json'))),
   planOnly:process.argv.includes('--plan'),
   onScope:planned=>{console.log(`Scoped generation: ${planned.requested} requested; ${planned.sourceIds.length} connected source inputs in ${planned.components.length} components; other source and country payload files are not read.`);}});
  if(process.argv.includes('--plan')){console.log(JSON.stringify(files,null,2));process.exit(0);}
  }
 }else files=buildBuiltinWorldPublication({previousIndex:index,input:{sourceIndex,entities:readTerritorialSources(sourceRoot,{sourceIndex,chunkRoot:path.dirname(sourceIndexAbsolute)}),
   view:selectedView,policy:selectedPolicy,displayPolicy:selectedDisplayPolicy}});
 writeBuiltinWorldPublication(files,output,{check:process.argv.includes('--check'),retirementInputs});
 console.log(`Builtin world: ${JSON.parse(files.get('index.json')).entities.length} country references; ${[...files.keys()].filter(file=>file.startsWith('countries/')||file.startsWith('country-parts/')).length} bounded files emitted; ${[...files.values()].reduce((n,b)=>n+b.length,0)} output bytes; no aggregate transport`);
}
