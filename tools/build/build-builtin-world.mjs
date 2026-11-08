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
import {buildCurrentWorld} from "../data/territorial-current-world.mjs";
import {compileBuiltinWorldCatalog,coalesceCoverageAdjustments,replaceBuiltinWorldCountryNames} from "./builtin-world-compiler.mjs";
import {builtinSubunitId} from "../../src/document/builtin-subunits.js";
import {loadBuiltinDisplayPolicy} from "../gis/builtin-display-policy.mjs";
import {encodeBuiltinCountries,finalizeBuiltinWorldFiles,readBuiltinCountryStoredBytes,readBuiltinCountry} from "../data/builtin-country-bytes.mjs";
export {finalizeBuiltinWorldFiles};

const output=fileURLToPath(new URL("../../assets/data/builtin-world/generated/v1/",import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function recordBuiltinWorldInputs(index,sourceRevisions,view,policy){
 const ordered=Object.fromEntries(Object.entries(sourceRevisions).sort(([a],[b])=>a.localeCompare(b,'en')));
 index.inputHashes={entities:sha(JSON.stringify(ordered)),sourceRevisions:ordered,view:sha(JSON.stringify(view)),policy:sha(JSON.stringify(policy))};
 return index;
}
export function buildBuiltinWorldPublication({input=null,policyFile=new URL("../../assets/data/historical-world/policy.json",import.meta.url)}={}){
 const policy=input?.policy||JSON.parse(fs.readFileSync(policyFile));
 const entities=input?.entities||readTerritorialSources();
 const view=input?.view||JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json')));
 const currentWorld=input?.currentWorld||buildCurrentWorld({entities,view});
 const {index,countries,coverageReport}=compileBuiltinWorldCatalog({entities,view,currentWorld,policy});
 const files=encodeBuiltinCountries(index,countries,new Map());
 recordBuiltinWorldInputs(index,input?.sourceIndex?Object.fromEntries(input.sourceIndex.entities.filter(row=>!['river','lake'].includes(row.entityType)).map(row=>[row.entityId,row.sha256])):
  Object.fromEntries(entities.map(row=>[row.entityId,sha(JSON.stringify(row))])),view,policy);
 finalizeBuiltinWorldFiles(index,files);
 files.set('coverage-report.json',Buffer.from(JSON.stringify(coverageReport)+'\n'));
 return files;
}
export function buildBuiltinWorldNamePublication({entityIds,sourceIndex,previousIndex,readSource=readTerritorialSource,readPreviousSource,readCountry}) {
 if(!entityIds?.length||new Set(entityIds).size!==entityIds.length)throw Error('Explicit unique name scope required');
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

/** Recompile only connected spatial/hierarchy components. Unrelated payloads
 * are neither read nor returned: their verified descriptors stay in the index. */
export function buildBuiltinWorldPartialPublication({entityIds,sourceIndex,previousSourceIndex,view,policy,
 previousIndex,previousCoverage,readSource=readTerritorialSource,currentWorld=null,onScope=()=>{},planOnly=false}){
 if(!entityIds?.length||new Set(entityIds).size!==entityIds.length)throw new Error('Explicit unique entity scope required');
 if(previousIndex.inputHashes.view!==sha(JSON.stringify(view))||previousIndex.inputHashes.policy!==sha(JSON.stringify(policy)))throw new Error('World view or policy changed; partial country scope is insufficient');
 const sources=new Map(sourceIndex.entities.map(row=>[row.entityId,row])),oldSources=new Map(previousSourceIndex.entities.map(row=>[row.entityId,row]));
 const mapping=new Map(previousIndex.sourceIdentities.flatMap(row=>row.sourceEntityIds.map(id=>[id,row.projectEntityId])));
 const current=new Map(view.selections.map(row=>[row.entityId,row.geometryVersionId]));
 const subunits=new Map(loadBuiltinDisplayPolicy().subunits.map(row=>[builtinSubunitId(row.sourceCountryId),row.parentId]));
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
 for(const component of components){
  const ids=new Set(nodes.filter(row=>component.has(row.projectEntityId)).flatMap(row=>row.sourceEntityIds));
  const entities=[...ids].map(id=>readSource(id));
  const scopedView={...view,selections:view.selections.filter(row=>ids.has(row.entityId))};
  const scopedPolicy={...policy,replacements:policy.replacements.filter(row=>ids.has(row.targetEntityId)&&ids.has(row.priorityEntityId)),
   ...(policy.parentRelations ? {parentRelations:policy.parentRelations.filter(row=>ids.has(row.entityId)&&ids.has(row.parentEntityId))} : {})};
  const world=currentWorld?{...currentWorld,features:currentWorld.features.filter(row=>entities.some(e=>e.sourceInfo?.featureId===row.id))}:buildCurrentWorld({entities,view:scopedView});
  const compiled=compileBuiltinWorldCatalog({entities,view:scopedView,currentWorld:world,policy:scopedPolicy,availableSourceIds});
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
export function writeBuiltinWorldPublication(files,directory=output,{check=false,readPreviousCountry}={}){
 // The index becomes visible only after the emitted payloads and diagnostics.
 // Deltas overlay an existing verified publication; old pinned assets are retained.
 const entries=[...files].filter(([file])=>file!=='index.json');
 if(files.has('index.json'))entries.push(['index.json',files.get('index.json')]);
 const changed=[];
 for(const [file,bytes] of entries){
  const target=path.join(directory,file);
  if(fs.existsSync(target)&&fs.readFileSync(target).equals(bytes))continue;
  if(check)throw new Error(`Stale builtin world data: ${file}`);
  changed.push({target,bytes});
 }
 if(check||!changed.length)return;
 if(!files.has('index.json')&&[...files.keys()].some(file=>file.startsWith('countries/')||file.startsWith('country-parts/')))throw Error('Historical country publication requires its paired index');
 if(files.has('index.json')){
  const next=JSON.parse(files.get('index.json')),priorPath=path.join(directory,'index.json'),prior=fs.existsSync(priorPath)?JSON.parse(fs.readFileSync(priorPath)):{entities:[]},old=new Map(prior.entities.map(e=>[e.entityId,e]));
  for(const entry of next.entities){const before=old.get(entry.entityId);if(before?.sha256===entry.sha256)continue;const read=entry=>readBuiltinCountry(entry,next,file=>files.get(file)||fs.readFileSync(path.join(directory,file))),readOld=entry=>readPreviousCountry?readPreviousCountry(entry,prior,file=>fs.readFileSync(path.join(directory,file))):readBuiltinCountry(entry,prior,file=>fs.readFileSync(path.join(directory,file)));assertHistoricalCompiledChanges(read(entry),before?readOld(before):null);}
 }
 return withLibraryOutputs({paths:changed.map(({target})=>target)},()=>{
  for(const {target,bytes} of changed){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--pack-existing'))throw Error('--pack-existing is retired; use country-scoped --entities=<ids> generation');
 const selected=process.argv.find(arg=>arg.startsWith('--entities='));
 const namesOnly=process.argv.includes('--names-only');
 if(namesOnly&&!selected)throw Error('--names-only requires --entities');
 if(namesOnly&&process.argv.includes('--plan'))throw Error('--plan is only supported for geometry generation');
 if(process.argv.includes('--plan')&&!selected)throw new Error('--plan requires --entities');
 const sourceIndex=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v2/index.json')));
 const index=selected?JSON.parse(fs.readFileSync(path.join(output,'index.json'))):null;
 let files;
 if(selected){
  if(namesOnly){
   const ids=selected.slice('--entities='.length).split(',').filter(Boolean);
   const root=fileURLToPath(new URL("../../",import.meta.url)),config=libraryConfig(root),checkout=libraryCheckout(root);
   const archive=JSON.parse(execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','show',`${config.revision}:archive/index.json`],{cwd:checkout,maxBuffer:16*1024*1024}));
   files=buildBuiltinWorldNamePublication({entityIds:ids,sourceIndex,previousIndex:index,readCountry:file=>fs.readFileSync(path.join(output,file)),
    readPreviousSource:id=>normalizeTerritorialLibraryEntity(JSON.parse(decodeArchiveEntry(checkout,archive.files[`assets/data/territorial-entities/source/countries/${entityFileName(id)}`],config.revision)))});
   console.log(`Name-only generation: ${ids.length} selected source; geometry and coverage reused without recomputation.`);
  }else{
  const root=fileURLToPath(new URL("../../",import.meta.url)),config=libraryConfig(root),checkout=libraryCheckout(root);
  const archive=JSON.parse(execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','show',`${config.revision}:archive/index.json`],{cwd:checkout,maxBuffer:16*1024*1024}));
  const previousSourceIndex=JSON.parse(decodeArchiveEntry(checkout,archive.files['assets/data/territorial-entities/generated/v2/index.json'],config.revision));
  files=buildBuiltinWorldPartialPublication({entityIds:selected.slice('--entities='.length).split(',').filter(Boolean),sourceIndex,previousSourceIndex,
   view:JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'))),policy:JSON.parse(fs.readFileSync(new URL("../../assets/data/historical-world/policy.json",import.meta.url))),
   previousIndex:index,previousCoverage:JSON.parse(fs.readFileSync(path.join(output,'coverage-report.json'))),
   planOnly:process.argv.includes('--plan'),
   onScope:planned=>{console.log(`Scoped generation: ${planned.requested} requested; ${planned.sourceIds.length} connected source inputs in ${planned.components.length} components; other source and country payload files are not read.`);}});
  if(process.argv.includes('--plan')){console.log(JSON.stringify(files,null,2));process.exit(0);}
  }
 }else files=buildBuiltinWorldPublication({input:{sourceIndex}});
 writeBuiltinWorldPublication(files,output,{check:process.argv.includes('--check')});
 console.log(`Builtin world: ${JSON.parse(files.get('index.json')).entities.length} country references; ${[...files.keys()].filter(file=>file.startsWith('countries/')||file.startsWith('country-parts/')).length} bounded files emitted; ${[...files.values()].reduce((n,b)=>n+b.length,0)} output bytes; no aggregate transport`);
}
