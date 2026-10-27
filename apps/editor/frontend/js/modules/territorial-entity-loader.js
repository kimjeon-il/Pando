import {createStoredAssetLoader} from "../../../../../shared/frontend/js/modules/stored-asset-loader.js";
import {normalizeTerritorialLibraryEntity,normalizeTerritorialLibraryIndex,selectGeometryVersion,assertTerritorialIndexEntity} from './territorial-library.js';

/** Platform composition selects access; UI consumes the existing loader contract. */
export async function openTerritorialLibraryAccess({repository=null,source,onSyncError}={}){
  if(!repository)return Object.freeze({loader:createTerritorialEntityLoader(source),editingRepository:null});
  if(typeof onSyncError!=='function')throw new TypeError('Native library access requires its synchronization error boundary.');
  await repository.open();
  try{await repository.sync();await repository.open();}catch(error){onSyncError(error);}
  return Object.freeze({loader:createRepositoryTerritorialLoader(repository),editingRepository:repository});
}

export function createTerritorialEntityLoader({indexUrl,indexSpec,dataRevision,fetchFn=globalThis.fetch,cacheStorage=globalThis.caches}) {
  if(!indexUrl || !indexSpec?.sha256 || !dataRevision)throw new Error('Territorial index URL, integrity metadata and data revision are required');
  const base=new URL(indexUrl);
  const assets=createStoredAssetLoader({dataRevision,fetchFn,cacheStorage,resolveUrl:spec=>{const url=new URL(spec.url,base);url.searchParams.set('v',dataRevision);return url;}});
  const entities=new Map(), pending=new Map();
  let index=null,indexPromise=null;
  const parse=bytes=>JSON.parse(new TextDecoder().decode(bytes));
  async function loadIndex(){
    if(index)return index;
    if(!indexPromise)indexPromise=assets.loadAsset({...indexSpec,url:base.href},'catalog','index','Territorial index',parse).then(({value})=>{
      index=normalizeTerritorialLibraryIndex(value);return index;
    }).catch(error=>{indexPromise=null;throw error;});
    return indexPromise;
  }
  async function loadEntity(entityId){
    if(entities.has(entityId))return entities.get(entityId);
    if(!pending.has(entityId))pending.set(entityId,(async()=>{
      const catalog=await loadIndex();const entry=catalog.entities.find(e=>e.entityId===entityId);
      if(!entry)throw new Error(`Unknown territorial entity: ${entityId}`);
      const {value}=await assets.loadAsset({...entry,url:entry.file,encoding:'gzip'},'catalog',entityId,entityId,bytes=>normalizeTerritorialLibraryEntity(parse(bytes)));
      assertTerritorialIndexEntity(entry,value);
      entities.set(entityId,value);return value;
    })().finally(()=>pending.delete(entityId)));
    return pending.get(entityId);
  }
  return Object.freeze({loadIndex,loadEntity,peek:id=>entities.get(id)||null,
    loadGeometryVersion:async(id,date)=>selectGeometryVersion(await loadEntity(id),date)});
}

// Same catalog contract through the external owner-library repository.
export function createRepositoryTerritorialLoader(repository){
 if(!repository||typeof repository.open!=='function'||typeof repository.readEntity!=='function')throw new TypeError('Library repository is required');
 const loaded=new Map();
 const revision=()=>repository.snapshot()?.revision;
 const peek=id=>{const entry=loaded.get(id);return entry?.revision===revision()?entry.value:null;};
 async function loadIndex(){return (await repository.open()).index;}
 async function loadEntity(id){
  const cached=peek(id);if(cached)return cached;
  if(!repository.snapshot())await loadIndex();
  const start=revision(),value=normalizeTerritorialLibraryEntity(await repository.readEntity(id));
  if(value.entityId!==id)throw new Error('Library source identity mismatch');
  assertTerritorialIndexEntity(repository.snapshot().index.entities.find(e=>e.entityId===id),value);
  if(start!==revision())throw new Error('라이브러리 판본이 변경되었습니다. 다시 읽으세요.');
  loaded.set(id,{revision:start,value});return value;
 }
 return Object.freeze({loadIndex,loadEntity,peek,loadGeometryVersion:async(id,date)=>selectGeometryVersion(await loadEntity(id),date)});
}
