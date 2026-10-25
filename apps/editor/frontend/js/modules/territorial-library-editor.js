import {normalizeTerritorialLibraryEntity,normalizeTerritorialLibraryIndex} from './territorial-library.js';
import {encodeTerritorialIndexEntry} from './territorial-index-entry.js';
import {validateGeometry} from "../../../../../shared/frontend/js/modules/geometry-validation.js";
import {markEditedLibrarySource} from './territorial-library-provenance.js';

// Owns unsaved source transactions only. The library service owns committed data;
// the project document and its history are never accessed here.
export function createTerritorialLibraryEditor({service,repository,revision}) {
 if(!service||typeof repository?.commit!=='function'||!revision)throw new TypeError('Library service, repository and revision are required');
 let changes=new Map(),removed=new Set(),undo=[],redo=[],busy=false,epoch=0,externalRevision=null;
 const copy=()=>({changes:new Map(changes),removed:new Set(removed),externalRevision});
 const snapshot=()=>({revision,dirty:!!(changes.size||removed.size),busy,canUndo:!!undo.length,canRedo:!!redo.length,
  changedEntityIds:[...changes.keys()],deletedEntityIds:[...removed],epoch});
 const get=id=>removed.has(id)?null:changes.get(id)||service.get(id);
 const guard=()=>{if(busy)throw new Error('라이브러리 저장 작업을 기다리세요.');};
 async function candidate(nextChanges,nextRemoved){
  const base=await service.load();
  const entries=new Map(base.entities.filter(e=>!nextRemoved.has(e.entityId)).map(e=>[e.entityId,e]));
  for(const [id,entity]of nextChanges)entries.set(id,await encodeTerritorialIndexEntry(entity));
  const entities=[...entries.values()];
  for(const e of entities)if(e.parentEntityId&&!entries.has(e.parentEntityId))throw new Error('소속 parent 자료가 남아 있어 삭제할 수 없습니다.');
  const lineages=base.lineages.map(l=>({...l,entityRefs:l.entityRefs.filter(id=>entries.has(id)),
   relations:l.relations.filter(r=>entries.has(r.from)&&entries.has(r.to))})).filter(l=>l.entityRefs.length);
  for(const e of entities){
   let lineage=lineages.find(l=>l.lineageId===e.lineageId);
   if(!lineage){lineage={schemaVersion:2,lineageId:e.lineageId,names:e.names,entityRefs:[],relations:[]};lineages.push(lineage);}
   if(!lineage.entityRefs.includes(e.entityId))lineage.entityRefs.push(e.entityId);
  }
  const snapshots=base.snapshots.map(s=>({...s,entityRefs:s.entityRefs.filter(id=>entries.has(id))}));
  const views=(base.views || []).map(view=>({...view,selections:view.selections.filter(row=>
    entries.get(row.entityId)?.geometryVersions.some(v=>v.versionId===row.geometryVersionId))}));
  return normalizeTerritorialLibraryIndex({...base,entities,lineages,snapshots,views});
 }
 async function apply({entities=[],deletedEntityIds=[],editMethod='user-library-editor',externalRevision:externalGuard}){
  guard();const start=epoch;
  const next=new Map(changes),deleted=new Set(removed);
  for(const raw of entities){
   const previous=service.get(raw.entityId)?await service.loadEntity(raw.entityId):null;
   const entity=normalizeTerritorialLibraryEntity(markEditedLibrarySource(raw,previous,editMethod));
   if(!entity.lineageId)throw new Error('자료 계보 lineageId가 필요합니다.');
   for(const v of entity.geometryVersions){const errors=validateGeometry({type:'Feature',properties:{},geometry:v.geometry});
    if(errors.length)throw new Error(`${entity.entityId}: ${errors[0].message||errors[0].kind}`);}
   next.set(entity.entityId,entity);deleted.delete(entity.entityId);
  }
  for(const id of deletedEntityIds){if(!get(id))throw new Error(`Unknown library entity: ${id}`);next.delete(id);deleted.add(id);}
  await candidate(next,deleted);
  if(epoch!==start||busy)throw new Error('편집 내용이 변경되었습니다. 다시 적용하세요.');
  undo.push(copy());redo=[];changes=next;removed=deleted;if(externalGuard!==undefined)externalRevision=externalGuard;epoch++;return snapshot();
 }
 function restore(from,to){guard();if(!from.length)return false;to.push(copy());const state=from.pop();changes=state.changes;removed=state.removed;externalRevision=state.externalRevision;epoch++;return true;}
 async function save(){
  guard();if(!snapshot().dirty)return snapshot();busy=true;
  try{
   const index=await candidate(changes,removed);
   const result=await repository.commit({expectedRevision:revision,index,entities:[...changes.values()],deletedEntityIds:[...removed],...(externalRevision?{externalRevision}:{})});
   const accepted=normalizeTerritorialLibraryIndex(result.index);
   service.replaceCatalog(accepted);revision=result.revision;changes=new Map();removed=new Set();undo=[];redo=[];externalRevision=null;epoch++;
   return result;
  }finally{busy=false;}
 }
 function discard(){guard();changes.clear();removed.clear();undo=[];redo=[];externalRevision=null;epoch++;}
 return Object.freeze({apply,save,get,readEntity:async id=>changes.get(id)||await service.loadEntity(id),snapshot,discard,undo:()=>restore(undo,redo),redo:()=>restore(redo,undo)});
}
