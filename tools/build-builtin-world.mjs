import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {withLibraryOutputs,libraryConfig,libraryCheckout,decodeArchiveEntry} from './library-data.mjs';
import {readTerritorialSources,readTerritorialSource,territorialSourceRoot,territorialDataRoot} from './territorial-entity-sources.mjs';
import {buildCurrentWorld} from './territorial-current-world.mjs';
import {compileBuiltinWorldCatalog,coalesceCoverageAdjustments} from './builtin-world-compiler.mjs';
import {BUILTIN_SUBUNITS} from "../shared/frontend/js/modules/builtin-subunits.js";

const output=fileURLToPath(new URL('../assets/data/builtin-world/generated/v1/',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function recordBuiltinWorldInputs(index,sourceRevisions,view,policy){
 const ordered=Object.fromEntries(Object.entries(sourceRevisions).sort(([a],[b])=>a.localeCompare(b,'en')));
 index.inputHashes={entities:sha(JSON.stringify(ordered)),sourceRevisions:ordered,view:sha(JSON.stringify(view)),policy:sha(JSON.stringify(policy))};
 return index;
}
export function packBuiltinWorldFiles(index, files, {verifyEntityIds=null}={}) {
 let offset=0;
 const chunks=index.entities.map(entry=>{
  const bytes=files.get(entry.file);
  if(!bytes||((!verifyEntityIds||verifyEntityIds.has(entry.entityId))&&(bytes.length!==entry.compressedBytes||sha(bytes)!==entry.sha256)))throw new Error(`Missing exact country bytes: ${entry.entityId}`);
  entry.offset=offset;offset+=bytes.length;return bytes;
 });
 const bytes=Buffer.concat(chunks),digest=sha(bytes),url=`transport/countries-sha256-${digest}.bin`;
 files.set(url,bytes);
 index.transport={schemaVersion:1,url,encoding:'identity',sha256:digest,compressedBytes:bytes.length,decodedBytes:bytes.length};
 files.set('index.json',Buffer.from(JSON.stringify(index)+'\n'));
 return files;
}
export function buildBuiltinWorldPublication({input=null,policyFile=new URL('../assets/data/historical-world/policy.json',import.meta.url)}={}){
 const policy=input?.policy||JSON.parse(fs.readFileSync(policyFile));
 const entities=input?.entities||readTerritorialSources();
 const view=input?.view||JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json')));
 const currentWorld=input?.currentWorld||buildCurrentWorld({entities,view});
 const {index,countries,coverageReport}=compileBuiltinWorldCatalog({entities,view,currentWorld,policy});
 const files=encodeCountries(index,countries);
 recordBuiltinWorldInputs(index,input?.sourceIndex?Object.fromEntries(input.sourceIndex.entities.map(row=>[row.entityId,row.sha256])):
  Object.fromEntries(entities.map(row=>[row.entityId,sha(JSON.stringify(row))])),view,policy);
 packBuiltinWorldFiles(index,files);
 files.set('coverage-report.json',Buffer.from(JSON.stringify(coverageReport)+'\n'));
 return files;
}
function encodeCountries(index,countries){
 const files=new Map();
 for(const country of countries){
  const decoded=Buffer.from(JSON.stringify(country)+'\n'),stored=gzipSync(decoded,{level:9,mtime:0});stored[9]=3;
  const digest=sha(stored),file=`countries/${country.entityId.replaceAll(':','-')}-sha256-${digest}.json.gz`;
  files.set(file,stored);
  Object.assign(index.entities.find(row=>row.entityId===country.entityId),{file,encoding:'gzip',sha256:digest,
   compressedBytes:stored.length,decodedBytes:decoded.length});
 }
 return files;
}

/** Recompile only connected spatial/hierarchy components; untouched country
 * payloads remain opaque stored bytes, not inputs to country validation. */
export function buildBuiltinWorldPartialPublication({entityIds,sourceIndex,previousSourceIndex,view,policy,
 previousIndex,previousCoverage,readSource=readTerritorialSource,readCountry,currentWorld=null,onScope=()=>{},planOnly=false}){
 if(!entityIds?.length||new Set(entityIds).size!==entityIds.length)throw new Error('Explicit unique entity scope required');
 if(previousIndex.inputHashes.view!==sha(JSON.stringify(view))||previousIndex.inputHashes.policy!==sha(JSON.stringify(policy)))throw new Error('World view or policy changed; partial country scope is insufficient');
 const sources=new Map(sourceIndex.entities.map(row=>[row.entityId,row])),oldSources=new Map(previousSourceIndex.entities.map(row=>[row.entityId,row]));
 const mapping=new Map(previousIndex.sourceIdentities.flatMap(row=>row.sourceEntityIds.map(id=>[id,row.projectEntityId])));
 const current=new Map(view.selections.map(row=>[row.entityId,row.geometryVersionId]));
 const subunits=new Map(BUILTIN_SUBUNITS.map(row=>[row.id,row.parentId]));
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
 const availableSourceIds=new Set(previousIndex.sourceIdentities.flatMap(row=>row.sourceFeatureIds));
 for(const component of components){
  const ids=new Set(nodes.filter(row=>component.has(row.projectEntityId)).flatMap(row=>row.sourceEntityIds));
  const entities=[...ids].map(id=>readSource(id));
  const scopedView={...view,selections:view.selections.filter(row=>ids.has(row.entityId))};
  const scopedPolicy={...policy,replacements:policy.replacements.filter(row=>ids.has(row.targetEntityId)&&ids.has(row.priorityEntityId))};
  const world=currentWorld?{...currentWorld,features:currentWorld.features.filter(row=>entities.some(e=>e.sourceInfo?.featureId===row.id))}:buildCurrentWorld({entities,view:scopedView});
  const compiled=compileBuiltinWorldCatalog({entities,view:scopedView,currentWorld:world,policy:scopedPolicy,availableSourceIds});
  for(const [file,bytes] of encodeCountries(compiled.index,compiled.countries))files.set(file,bytes);
  for(const row of compiled.index.entities)replacements.set(row.entityId,row);
  for(const row of compiled.coverageReport.entities)coverage.set(row.entityId,row);
  adjustments.push(...compiled.coverageReport.adjustments);
 }
 const index=structuredClone(previousIndex);
 index.entities=[...index.entities.filter(row=>!affected.has(row.entityId)),...replacements.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId,'en'));
 for(const row of index.entities)if(!files.has(row.file))files.set(row.file,readCountry(row.file));
 recordBuiltinWorldInputs(index,revisions,view,policy);
 packBuiltinWorldFiles(index,files,{verifyEntityIds:affected});
 files.set('coverage-report.json',Buffer.from(JSON.stringify({schemaVersion:2,
  adjustments:coalesceCoverageAdjustments([...previousCoverage.adjustments.filter(row=>!affected.has(row.entityId)),...adjustments]),
  entities:[...previousCoverage.entities.filter(row=>!affected.has(row.entityId)),...coverage.values()].sort((a,b)=>a.entityId.localeCompare(b.entityId,'en'))})+'\n'));
 return files;
}
export function writeBuiltinWorldPublication(files,directory=output,{check=false}={}){
 const publish=()=>{
 for(const [file,bytes] of files){
  const target=path.join(directory,file);
  if(check){if(!fs.existsSync(target)||!fs.readFileSync(target).equals(bytes))throw new Error(`Stale builtin world data: ${file}`);}
  else if(!fs.existsSync(target)||!fs.readFileSync(target).equals(bytes)){
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
  }
 }
 };
 if(check)return publish();
 const paths=[...files].filter(([file,bytes])=>!fs.existsSync(path.join(directory,file))||!fs.readFileSync(path.join(directory,file)).equals(bytes)).map(([file])=>path.join(directory,file));
 return withLibraryOutputs({paths},publish);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const existing=process.argv.includes('--pack-existing');
 const selected=process.argv.find(arg=>arg.startsWith('--entities='));
 if(existing&&selected)throw new Error('Choose either --pack-existing or --entities');
 if(process.argv.includes('--plan')&&!selected)throw new Error('--plan requires --entities');
 const sourceIndex=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v2/index.json')));
 const index=existing||selected?JSON.parse(fs.readFileSync(path.join(output,'index.json'))):null;
 let files,scope;
 if(selected){
  const root=fileURLToPath(new URL('../',import.meta.url)),config=libraryConfig(root),checkout=libraryCheckout(root);
  const archive=JSON.parse(execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','show',`${config.revision}:archive/index.json`],{cwd:checkout,maxBuffer:16*1024*1024}));
  const previousSourceIndex=JSON.parse(decodeArchiveEntry(checkout,archive.files['assets/data/territorial-entities/generated/v2/index.json'],config.revision));
  files=buildBuiltinWorldPartialPublication({entityIds:selected.slice('--entities='.length).split(',').filter(Boolean),sourceIndex,previousSourceIndex,
   view:JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'))),policy:JSON.parse(fs.readFileSync(new URL('../assets/data/historical-world/policy.json',import.meta.url))),
   previousIndex:index,previousCoverage:JSON.parse(fs.readFileSync(path.join(output,'coverage-report.json'))),
   readCountry:file=>fs.readFileSync(path.join(output,file)),planOnly:process.argv.includes('--plan'),
   onScope:planned=>{scope=planned;console.log(`Scoped generation: ${scope.requested} requested; ${scope.sourceIds.length} connected source inputs in ${scope.components.length} components; other source files are not read.`);}});
  if(process.argv.includes('--plan')){console.log(JSON.stringify(files,null,2));process.exit(0);}
 }else files=existing?packBuiltinWorldFiles(index,new Map(index.entities.map(entry=>[entry.file,fs.readFileSync(path.join(output,entry.file))]))):buildBuiltinWorldPublication({input:{sourceIndex}});
 const affectedFiles=scope&&new Set(JSON.parse(files.get('index.json')).entities.filter(row=>scope.projectEntityIds.includes(row.entityId)).map(row=>row.file));
 const outputs=scope?new Map([...files].filter(([file])=>!file.startsWith('countries/')||affectedFiles.has(file))):files;
 writeBuiltinWorldPublication(outputs,output,{check:process.argv.includes('--check')});
 console.log(`Builtin world: ${existing?index.entities.length:JSON.parse(files.get('index.json')).entities.length} country files retained; packed transport, ${[...files.values()].reduce((n,b)=>n+b.length,0)} bytes`);
}
