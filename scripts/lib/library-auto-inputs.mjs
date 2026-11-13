import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {normalizeTerritorialGeometryVersion} from '../../tools/gis/territorial-library.js';
import {normalizeTerritorialSourceDescriptor} from '../../tools/data/territorial-entity-sources.mjs';
import {territorialSourceIndex} from '../../tools/data/territorial-source-archive.mjs';
const MAX=32*1024*1024;
const FAMILIES=Object.freeze(['territorial','current-world','world-mesh','world-country-packet','world-bundle','shared-boundaries','builtin-world','prepared-mesh']);
const hash=b=>createHash('sha256').update(b).digest('hex');
const stable=v=>JSON.stringify(canonical(v));
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
function fail(code,message=code){throw Object.assign(new Error(message),{code});}
function sha(v,n=64){if(typeof v!=='string'||!new RegExp(`^[a-f0-9]{${n}}$`).test(v)||/^0+$/.test(v))fail('INVALID_HASH');return v;}
function plain(v){if(v===null||typeof v!=='object')return;if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)fail('INVALID_JSON');for(const [k,c] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail('INVALID_JSON');plain(c);}}
function json(b){let v;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}catch{fail('INVALID_JSON');}plain(v);if(!v||Array.isArray(v)||typeof v!=='object')fail('INVALID_JSON');return v;}
const entityKeys=new Set(['schemaVersion','storageLayout','entityId','entityKind','lineageId','names','alternateNames','nameVersions','lifetime','parentEntityId','geometryVersions','instantiation','metadata','sourceInfo']);
function normalize(raw){for(const k of Object.keys(raw))if(!entityKeys.has(k))fail('UNKNOWN_ENTITY_FIELD');return normalizeTerritorialSourceDescriptor(raw);}
function path(p){if(typeof p!=='string'||!p||p.startsWith('/')||p.includes('\\')||p.split('/').some(s=>!s||s==='.'||s==='..')||!/^[A-Za-z0-9_./-]+$/.test(p))fail('INVALID_ARCHIVE_PATH');return p;}

const SOURCE='assets/data/territorial-entities/source/';
const worldPath=SOURCE+'views/world.json';
const logicalIdentity=d=>d?{sha256:d.sha256,bytes:d.bytes}:null;

/** Inspect the editable source archive. Generated chunks and former native
 * objects are outputs or migration inputs, never automatic edit authority. */
export function inspectCanonicalInputs({revision,baselineRevision,readBlob,verifiedGeneratedPaths=[],changedPaths=null}){
 sha(revision,40);sha(baselineRevision,40);
 if(typeof readBlob!=='function')fail('INVALID_READER');
 if(!Array.isArray(verifiedGeneratedPaths)||new Set(verifiedGeneratedPaths).size!==verifiedGeneratedPaths.length)fail('INVALID_VERIFIED_GENERATED_PATHS');
 const verifiedGenerated=new Set(verifiedGeneratedPaths.map(path));
 if(changedPaths!==null&&(!Array.isArray(changedPaths)||changedPaths.some(p=>typeof p!=='string')))fail('INVALID_CHANGED_PATHS');
 const changedStored=changedPaths===null?null:new Set(changedPaths),cache=new Map();
 function read(rev,p){
  path(p);const key=rev+':'+p;
  if(!cache.has(key)){const b=readBlob(rev,p);if(!Buffer.isBuffer(b)||b.length>MAX)fail('INVALID_BLOB');cache.set(key,Buffer.from(b));}
  return cache.get(key);
 }
 function load(rev){
  const archive=json(read(rev,'archive/index.json'));
  if(archive.schemaVersion!==1||!archive.files||typeof archive.files!=='object'||Array.isArray(archive.files))fail('INVALID_ARCHIVE');
  const countries=Object.values(territorialSourceIndex(archive).sources).map(entry=>entry.path).sort();
  if(!countries.length)fail('MISSING_ARCHIVE_SOURCE');
  for(const p of countries)path(p);
  return {archive,rev,countries};
 }
 function readDecoded(state,p){
  const d=state.archive.files[p];if(!d)fail('MISSING_ARCHIVE_SOURCE');
  path(d.stored);sha(d.sha256);
  if(!Number.isInteger(d.bytes)||d.bytes<0||d.bytes>MAX||!['identity','gzip'].includes(d.encoding))fail('INVALID_ARCHIVE_DESCRIPTOR');
  const stored=read(state.rev,d.stored);let b;
  try{b=d.encoding==='gzip'?gunzipSync(stored,{maxOutputLength:MAX}):stored;}catch{fail('INVALID_ARCHIVE_GZIP');}
  if(b.length!==d.bytes||hash(b)!==d.sha256)fail('ARCHIVE_HASH_MISMATCH');
  return b;
 }
 const archived=(state,p)=>json(readDecoded(state,p));
 function entity(state,p){
  const e=normalize(archived(state,p));
  if(p!==SOURCE+'countries/'+e.entityId.replace(':','-')+'.json')fail('ENTITY_ID_MISMATCH');
  return e;
 }
 const base=load(baselineRevision),next=load(revision);
 if(stable(base.countries)!==stable(next.countries))fail('UNSUPPORTED_MEMBERSHIP_CHANGE');
 const managed=new Set([...next.countries,worldPath]),generatedChanges=[];
 const changedEntityIds=[],inspectedEntityIds=[],writes=[],fingerprintFiles={};
 for(const [p,entry]of Object.entries(next.archive.files))if(p.startsWith(SOURCE+'geometries/')){
  if(p!==SOURCE+'geometries/sha256-'+entry.sha256+'.json')fail('SOURCE_GEOMETRY_IDENTITY');
  fingerprintFiles[p]=logicalIdentity(entry);
  if(changedStored?.has(entry.stored))readDecoded(next,p);
 }
 for(const p of next.countries){
  const a=base.archive.files[p],b=next.archive.files[p];
  fingerprintFiles[p]=logicalIdentity(b);
  const selected=changedStored===null||stable(a)!==stable(b)||changedStored.has(a.stored)||changedStored.has(b.stored);
  if(!selected)continue;
  const prior=entity(base,p),e=entity(next,p);inspectedEntityIds.push(e.entityId);
  for(const version of e.geometryVersions){
   const resource=version.geometryResource,geometryPath=SOURCE+resource.file,entry=next.archive.files[geometryPath];
   if(!entry||entry.sha256!==resource.sha256||entry.bytes!==resource.bytes)fail('SOURCE_GEOMETRY_IDENTITY');
   managed.add(geometryPath);
   fingerprintFiles[geometryPath]=logicalIdentity(entry);
   const previous=prior.geometryVersions.find(v=>v.versionId===version.versionId)?.geometryResource;
   if(stable(resource)===stable(previous)&&stable(logicalIdentity(base.archive.files[geometryPath]))===stable(logicalIdentity(entry))
     &&!changedStored?.has(entry.stored))continue;
   const geometry=archived(next,geometryPath);
   normalizeTerritorialGeometryVersion({geometry},e.entityKind,version.versionId,e.entityId);
   if(stable(logicalIdentity(base.archive.files[geometryPath]))!==stable(logicalIdentity(entry)))writes.push({path:geometryPath,bytes:readDecoded(next,geometryPath)});
  }
  if(stable(prior)===stable(e))continue;
  if(!/^state:[A-Za-z0-9_-]+$/.test(e.entityId)||!['general','regional'].includes(e.entityKind))fail('UNSUPPORTED_ENTITY_KIND');
  for(const k of ['entityId','entityKind','lineageId','parentEntityId','lifetime'])if(stable(e[k])!==stable(prior[k]))fail('UNSUPPORTED_IDENTITY_CHANGE');
  const bytes=Buffer.from(JSON.stringify(e,null,2)+'\n');
  changedEntityIds.push(e.entityId);writes.push({path:p,bytes});
  fingerprintFiles[p]={sha256:hash(bytes),bytes:bytes.length};
 }
 for(const p of [...new Set([...Object.keys(base.archive.files),...Object.keys(next.archive.files)])].sort()){
  path(p);
  if(stable(logicalIdentity(base.archive.files[p]))===stable(logicalIdentity(next.archive.files[p]))||p.startsWith('reports/')||managed.has(p))continue;
  const authoritative=p.startsWith(SOURCE)||/^assets\/data\/(?:hydro|terrain|physical-land|places)(?:\/|\.)/.test(p);
  if(authoritative||!p.startsWith('assets/data/')||!verifiedGenerated.has(p))fail('UNSUPPORTED_ARCHIVE_INPUT','UNSUPPORTED_ARCHIVE_INPUT: '+p);
  generatedChanges.push(p);
 }
 const a=base.archive.files[worldPath],b=next.archive.files[worldPath];let viewChanged=false;
 if(a||b){
  if(!a||!b)fail('MISSING_ARCHIVE_SOURCE');
  fingerprintFiles[worldPath]=logicalIdentity(b);
  if(changedStored===null||stable(a)!==stable(b)||changedStored.has(a.stored)||changedStored.has(b.stored)){
   const prior=archived(base,worldPath),view=archived(next,worldPath);viewChanged=stable(prior)!==stable(view);
   if(viewChanged){
    if(view.schemaVersion!==1||view.id!=='world:catalog'||prior.id!==view.id||!Array.isArray(view.selections)
     ||new Set(view.selections.map(row=>row.entityId)).size!==view.selections.length)fail('UNSUPPORTED_VIEW_CHANGE');
    const byId=new Map(next.countries.map(p=>[p.slice((SOURCE+'countries/').length,-5).replace('-',':'),p]));
    for(const selection of view.selections){
     const p=byId.get(selection.entityId);
     if(!p||!entity(next,p).geometryVersions.some(v=>v.versionId===selection.geometryVersionId))fail('UNKNOWN_VIEW_GEOMETRY');
    }
    const bytes=Buffer.from(JSON.stringify(view,null,2)+'\n');writes.push({path:worldPath,bytes});
    fingerprintFiles[worldPath]={sha256:hash(bytes),bytes:bytes.length};
   }
  }
 }
 const inputFingerprint=hash(Buffer.from(stable({kind:'canonical-territorial-source-v1',files:fingerprintFiles}))),noop=!changedEntityIds.length&&!viewChanged;
 return {inputFingerprint,changedEntityIds,inspectedEntityIds,viewChanged,requiredFamilies:noop?[]:[...FAMILIES],writes:[...new Map(writes.map(row=>[row.path,row])).values()],noop,generatedChanges};
}
