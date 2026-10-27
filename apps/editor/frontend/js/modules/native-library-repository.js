import {normalizeTerritorialLibraryIndex,normalizeTerritorialLibraryEntity,assertTerritorialIndexEntity} from './territorial-library.js';
import {validateGeometry} from "../../../../../shared/frontend/js/modules/geometry-validation.js";

// Platform port only. Tokens, files, Git history and remote conflict state stay native.
export function createNativeLibraryRepository({invoke}={}){
 if(typeof invoke!=='function')throw new Error('네이티브 library bridge가 필요합니다.');
 let receipt=null;
 function accept(value){
  if(typeof value?.revision!=='string'||!value.revision)throw new Error('라이브러리 revision 판본이 없습니다.');
  const index=normalizeTerritorialLibraryIndex(value.index);
  receipt=Object.freeze({...value,index});return receipt;
 }
 async function sync(){
  let validatedRevision=null;
  for(let attempt=0;attempt<3;attempt++){
   const result=await invoke('library_sync',{validatedRevision});
   if(result.state!=='validation-required')return result;
   const revision=result.candidateRevision;
   if(!/^[a-f0-9]{64}$/.test(revision||''))throw new Error('원격 라이브러리 후보 판본이 올바르지 않습니다.');
   try{
    const index=normalizeTerritorialLibraryIndex(await invoke('library_read_candidate',{revision,entityId:null}));
    for(const entry of index.entities){
     const entity=normalizeTerritorialLibraryEntity(await invoke('library_read_candidate',{revision,entityId:entry.entityId}));
     assertTerritorialIndexEntity(entry,entity);
     for(const version of entity.geometryVersions){
      const errors=validateGeometry({type:'Feature',properties:{},geometry:version.geometry});
      if(errors.length)throw new Error(`${entry.entityId}: ${errors[0].message||errors[0].kind}`);
     }
    }
   }catch(cause){throw Object.assign(new Error(`원격 라이브러리 검증 실패: ${cause.message}`,{cause}),{code:'PL-LIB-REMOTE-VALIDATION'});}
   validatedRevision=revision;
  }
  throw new Error('동기화 중 원격 자료가 계속 변경되었습니다. 다시 시도하세요.');
 }
 return Object.freeze({
  open:async()=>accept(await invoke('library_open',{})),
  readEntity:entityId=>invoke('library_read_entity',{entityId}),
  externalChanges:()=>invoke('library_read_external_changes',{}),
  commit:async request=>accept(await invoke('library_commit',{request})),
  sync,
  resolveConflict:async choice=>accept(await invoke('library_conflict',{choice})),
  openGeometry:(entityId,versionId)=>invoke('library_open_geometry',{entityId,versionId}),
  snapshot:()=>receipt,
 });
}
