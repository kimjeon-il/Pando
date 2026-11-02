import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {normalizeTerritorialLibraryEntity,normalizeTerritorialLibraryIndex,assertTerritorialIndexEntity} from '../../apps/editor/frontend/js/modules/territorial-library.js';
import {territorialIndexEntry} from '../../apps/editor/frontend/js/modules/territorial-index-entry.js';
const MAX=32*1024*1024;
const FAMILIES=Object.freeze(['territorial','current-world','world-mesh','world-preview','world-bundle','shared-boundaries','builtin-world','prepared-mesh']);
const hash=b=>createHash('sha256').update(b).digest('hex');
const stable=v=>JSON.stringify(canonical(v));
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
function fail(code,message=code){throw Object.assign(new Error(message),{code});}
function sha(v,n=64){if(typeof v!=='string'||!new RegExp(`^[a-f0-9]{${n}}$`).test(v)||/^0+$/.test(v))fail('INVALID_HASH');return v;}
function plain(v){if(v===null||typeof v!=='object')return;if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)fail('INVALID_JSON');for(const [k,c] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail('INVALID_JSON');plain(c);}}
function json(b){let v;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}catch{fail('INVALID_JSON');}plain(v);if(!v||Array.isArray(v)||typeof v!=='object')fail('INVALID_JSON');return v;}
const entityKeys=new Set(['schemaVersion','entityId','entityKind','lineageId','names','alternateNames','nameVersions','lifetime','parentEntityId','geometryVersions','instantiation','metadata','sourceInfo']);
function normalize(raw){for(const k of Object.keys(raw))if(!entityKeys.has(k))fail('UNKNOWN_ENTITY_FIELD');return normalizeTerritorialLibraryEntity(raw);}
function path(p){if(typeof p!=='string'||!p||p.startsWith('/')||p.includes('\\')||p.split('/').some(s=>!s||s==='.'||s==='..')||!/^[A-Za-z0-9_./-]+$/.test(p))fail('INVALID_ARCHIVE_PATH');return p;}
function semanticIndex(index){return {...index,entities:index.entities.map(e=>{const {sha256,compressedBytes,decodedBytes,...rest}=e;return rest;}).sort((a,b)=>a.entityId.localeCompare(b.entityId))};}
/** Inspect immutable native inputs and return verified, normalized source projection bytes. No I/O except readBlob. */
export function inspectCanonicalInputs({revision,baselineRevision,readBlob,verifiedGeneratedPaths=[],changedPaths=null}){
 // Trust boundary: caller must verify official generation receipt/output hashes before supplying exact paths.
 if(!Array.isArray(verifiedGeneratedPaths)||new Set(verifiedGeneratedPaths).size!==verifiedGeneratedPaths.length)fail('INVALID_VERIFIED_GENERATED_PATHS');
 const verifiedGenerated=new Set(verifiedGeneratedPaths.map(path));
 sha(revision,40);sha(baselineRevision,40);if(typeof readBlob!=='function')fail('INVALID_READER');
 if(changedPaths!==null&&(!Array.isArray(changedPaths)||changedPaths.some(p=>typeof p!=='string')))fail('INVALID_CHANGED_PATHS');
 // changedPaths is trusted Git diff provenance; null retains conservative full inspection.
 const changedStored=changedPaths===null?null:new Set(changedPaths);
 const cache=new Map();
 function read(rev,p){const key=rev+':'+p;if(!cache.has(key)){const b=readBlob(rev,p);if(!Buffer.isBuffer(b)||b.length>MAX)fail('INVALID_BLOB');cache.set(key,Buffer.from(b));}return cache.get(key);}
 function object(rev,h){sha(h);const b=read(rev,`objects/${h}.json`);if(hash(b)!==h)fail('OBJECT_HASH_MISMATCH');return json(b);}
 function load(rev){
  const m=json(read(rev,'library.json'));if(m.schemaVersion!==1||!m.entities||Array.isArray(m.entities)||typeof m.entities!=='object')fail('INVALID_MANIFEST');
  const index=normalizeTerritorialLibraryIndex(object(rev,m.indexHash));
  const ids=Object.keys(m.entities).sort();if(stable(ids)!==stable(index.entities.map(e=>e.entityId).sort()))fail('INDEX_MEMBERSHIP_MISMATCH');
  for(const h of Object.values(m.entities))sha(h);
  const entities={};
  const archive=json(read(rev,'archive/index.json'));if(archive.schemaVersion!==1||!archive.files||typeof archive.files!=='object'||Array.isArray(archive.files))fail('INVALID_ARCHIVE');
  return {m,index,entities,archive,rev};
 }
 const base=load(baselineRevision),next=load(revision);
 if(stable(Object.keys(base.m.entities).sort())!==stable(Object.keys(next.m.entities).sort()))fail('UNSUPPORTED_MEMBERSHIP_CHANGE');
 for(const key of ['lineages','snapshots'])if(stable(base.index[key])!==stable(next.index[key]))fail('UNSUPPORTED_'+key.toUpperCase()+'_CHANGE');
 function archived(state,logical){
  const d=state.archive.files['assets/data/territorial-entities/'+logical];if(!d)fail('MISSING_ARCHIVE_SOURCE');
  path(d.stored);sha(d.sha256);if(!Number.isInteger(d.bytes)||d.bytes<0||d.bytes>MAX||!['identity','gzip'].includes(d.encoding))fail('INVALID_ARCHIVE_DESCRIPTOR');
  const stored=read(state.rev,d.stored);let b;try{b=d.encoding==='gzip'?gunzipSync(stored,{maxOutputLength:MAX}):stored;}catch{fail('INVALID_ARCHIVE_GZIP');}
  if(b.length!==d.bytes||hash(b)!==d.sha256)fail('ARCHIVE_HASH_MISMATCH');return json(b);
 }
 const generatedChanges=[];
 const managedSources=new Set(Object.keys(next.m.entities).map(id=>'assets/data/territorial-entities/source/countries/'+id.replace(':','-')+'.json'));
 managedSources.add('assets/data/territorial-entities/source/views/world.json');
 for(const logical of [...new Set([...Object.keys(base.archive.files),...Object.keys(next.archive.files)])].sort()){
  path(logical);
  const old=base.archive.files[logical],now=next.archive.files[logical];
  // Compare decoded logical identity, never archive transport location or gzip bytes.
  if(old&&now&&old.sha256===now.sha256&&old.bytes===now.bytes)continue;
  if(logical.startsWith('reports/'))continue;
  if(managedSources.has(logical))continue;
  const authoritative=logical.startsWith('assets/data/territorial-entities/source/')
   || /^assets\/data\/(?:hydro|terrain|physical-land|places)(?:\/|\.)/.test(logical);
  if(authoritative||!verifiedGenerated.has(logical))fail('UNSUPPORTED_ARCHIVE_INPUT',`UNSUPPORTED_ARCHIVE_INPUT: ${logical}`);
  // Caller supplied exact trusted output evidence; this is not input authority.
  generatedChanges.push(logical);
 }
 function entryMeaning(entry){const {sha256,compressedBytes,decodedBytes,...semantic}=entry;return semantic;}
 const inspectedEntityIds=[];
 for(const id of Object.keys(next.m.entities)){
  const logical='assets/data/territorial-entities/source/countries/'+id.replace(':','-')+'.json';
  const a=base.archive.files[logical],b=next.archive.files[logical];
  const sourceChanged=stable(a)!==stable(b);
  const oldEntry=base.index.entities.find(e=>e.entityId===id),newEntry=next.index.entities.find(e=>e.entityId===id);
  const selected=changedStored===null||base.m.entities[id]!==next.m.entities[id]||sourceChanged||stable(entryMeaning(oldEntry))!==stable(entryMeaning(newEntry))||[base,next].some(state=>changedStored.has('objects/'+state.m.entities[id]+'.json')||changedStored.has(state.archive.files[logical]?.stored));
  if(!selected)continue;
  inspectedEntityIds.push(id);
  for(const state of [base,next]){const e=normalize(object(state.rev,state.m.entities[id]));if(e.entityId!==id)fail('ENTITY_ID_MISMATCH');const entry=state.index.entities.find(e=>e.entityId===id);assertTerritorialIndexEntity(entry,e);
   const projected=territorialIndexEntry(e,entry);for(const key of ['bbox','geometryVersionCount','sourceInfo'])if(stable(entry[key])!==stable(projected[key]))fail('INDEX_METADATA_MISMATCH');state.entities[id]=e;
  }
 }
 const changedEntityIds=[],writes=[];
 for(const [id,e] of Object.entries(next.entities)){
  const prior=base.entities[id],changed=stable(e)!==stable(prior);
  if(changed){if(!/^state:[A-Za-z0-9_-]+$/.test(id)||!['general','regional'].includes(e.entityKind))fail('UNSUPPORTED_ENTITY_KIND');for(const k of ['entityId','entityKind','lineageId','parentEntityId','lifetime'])if(stable(e[k])!==stable(prior[k]))fail('UNSUPPORTED_IDENTITY_CHANGE');}
  const logical=`source/countries/${id.replace(':','-')}.json`;
  const oldSource=normalize(archived(base,logical)),newSource=normalize(archived(next,logical));
  const sourceChanged=stable(oldSource)!==stable(newSource);
  if(sourceChanged&&(!id.startsWith('state:')||!['general','regional'].includes(e.entityKind)))fail('UNSUPPORTED_ENTITY_KIND');
  if(sourceChanged&&!changed)fail('SOURCE_WITHOUT_NATIVE');if(sourceChanged&&stable(newSource)!==stable(e))fail('NATIVE_ARCHIVE_CONFLICT');
  if(changed){changedEntityIds.push(id);writes.push({path:'assets/data/territorial-entities/'+logical,bytes:Buffer.from(JSON.stringify(e,null,2)+'\n')});}
 }
 const viewChanged=stable(base.index.views||[])!==stable(next.index.views||[]);
 if(viewChanged){if((base.index.views||[]).length!==1||(next.index.views||[]).length!==1||base.index.views[0].id!=='world:catalog'||next.index.views[0].id!=='world:catalog')fail('UNSUPPORTED_VIEW_CHANGE');}
 // World source may be absent only in a catalog with no world view.
 if((next.index.views||[]).length){
  const logical='source/views/world.json';const a=base.archive.files['assets/data/territorial-entities/'+logical],b=next.archive.files['assets/data/territorial-entities/'+logical];
  if(a||b||viewChanged){const old=archived(base,logical),now=archived(next,logical),changed=stable(old)!==stable(now);if(changed&&!viewChanged)fail('SOURCE_WITHOUT_NATIVE');if(changed&&stable(now)!==stable(next.index.views[0]))fail('NATIVE_ARCHIVE_CONFLICT');}
  if(viewChanged)writes.push({path:'assets/data/territorial-entities/'+logical,bytes:Buffer.from(JSON.stringify(next.index.views[0],null,2)+'\n')});
 }
 // The official store persists changed generated native chunks as compact JSON + LF.
 // Predict those exact references, so the receipt is stable before and after store.
 const persistedRefs={...next.m.entities};
 for(const id of changedEntityIds)persistedRefs[id]=hash(Buffer.from(JSON.stringify(next.entities[id])+'\n'));
 const inputFingerprint=hash(Buffer.from(stable({kind:'canonical-native-storage-v2',entities:persistedRefs,index:semanticIndex(next.index)}))),noop=changedEntityIds.length===0&&!viewChanged;
 return {inputFingerprint,changedEntityIds,inspectedEntityIds,viewChanged,requiredFamilies:noop?[]:[...FAMILIES],writes,noop,generatedChanges};
}

