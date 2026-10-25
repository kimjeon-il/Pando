import {createInitialDocument} from "../../../../../shared/frontend/js/modules/initial-document.js";
import {createTerritorialFeature, normalizeTerritorialIdentity,
  TERRITORIAL_IDENTITY_FIELDS} from "../../../../../shared/frontend/js/modules/territorial-units.js";
import {normalizeTerritorialLibraryEntity, selectGeometryVersion} from './territorial-library.js';
import {createTerritorialLibraryEditor} from './territorial-library-editor.js';
import {parseTemporal} from "../../../../../shared/frontend/js/modules/temporal.js";

const copy=value=>structuredClone(value);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const bounds=geometry=>{
  const box=[Infinity,Infinity,-Infinity,-Infinity];
  const visit=value=>{
    if(typeof value[0]==='number'){
      box[0]=Math.min(box[0],value[0]);box[1]=Math.min(box[1],value[1]);
      box[2]=Math.max(box[2],value[0]);box[3]=Math.max(box[3],value[1]);
    }else for(const child of value)visit(child);
  };
  visit(geometry.coordinates);
  return box;
};
const touches=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
const fullDay=value=>{
  const point=parseTemporal(value,{nullable:false});
  return point.canonical+(point.precision==='year'?'-01-01':point.precision==='month'?'-01':'');
};
const interval=version=>[version.validFrom??null,version.validTo??null];

export function parseNativeLibraryGeometryRequest(search,hasNativeBridge){
  if(!hasNativeBridge)return null;
  const params=new URLSearchParams(search);
  const entityId=params.get('libraryEntity'),versionId=params.get('libraryVersion');
  if(!entityId&&!versionId)return null;
  if(!/^[a-z]+:[A-Za-z0-9_-]+$/.test(entityId||'')||!versionId||versionId.length>160)
    throw new Error('라이브러리 형상 편집 대상이 올바르지 않습니다.');
  return Object.freeze({entityId,versionId});
}

/** A throwaway C++ document holds one static projection of the external dated source. */
export async function prepareLibraryGeometryWorkspace({index,readEntity,entityId,versionId,appVersion,today=()=>new Date().toISOString().slice(0,10)}){
  if(!index?.entities||typeof readEntity!=='function'||!appVersion)throw new TypeError('Library source and application version are required');
  const selected=normalizeTerritorialLibraryEntity(await readEntity(entityId));
  if(selected.entityId!==entityId)
    throw new Error('선택한 라이브러리 자료 ID가 다릅니다.');
  const chosen=selected.geometryVersions.find(row=>row.versionId===versionId);
  if(!chosen)throw new Error('선택한 라이브러리 형상 버전을 찾을 수 없습니다.');
  const referenceDate=fullDay(chosen.validFrom||chosen.validTo||selected.metadata?.referenceDate||today());
  if(selectGeometryVersion(selected,referenceDate)?.versionId!==versionId)
    throw new Error('선택한 날짜와 형상 버전이 일치하지 않습니다.');
  const selectedBox=bounds(chosen.geometry);
  const candidates=index.entities.filter(row=>row.entityId===entityId||(
    row.entityKind===selected.entityKind&&row.parentEntityId===selected.parentEntityId
    &&Array.isArray(row.bbox)&&touches(selectedBox,row.bbox)));
  const source=new Map([[entityId,selected]]);
  for(const row of candidates){
    if(source.has(row.entityId))continue;
    const loaded=normalizeTerritorialLibraryEntity(await readEntity(row.entityId));
    if(loaded.entityId!==row.entityId)throw new Error('라이브러리 자료 ID가 색인과 다릅니다.');
    if(selectGeometryVersion(loaded,referenceDate))source.set(row.entityId,loaded);
  }
  const project=createInitialDocument({appVersion,baseDataset:'external-territorial-entities'});
  project.projectSetup.initialMonth=referenceDate.slice(0,-3);
  const initialFeatures=[],byProjectId=new Map();
  for(const [id,entity]of source){
    const version=selectGeometryVersion(entity,referenceDate);
    if(!version)throw new Error(`${id}: 선택 날짜에 사용할 형상이 없습니다.`);
    const feature=createTerritorialFeature({id,entityKind:'general',name:entity.names.ko||entity.names.en||id,
      geometry:version.geometry,sourceEntityId:id,sourceGeometryVersion:version.versionId});
    initialFeatures.push(feature);
    byProjectId.set(id,Object.freeze({entityId:id,versionId:version.versionId}));
    const properties=Object.fromEntries(TERRITORIAL_IDENTITY_FIELDS.filter(key=>Object.hasOwn(feature.properties,key))
      .map(key=>[key,feature.properties[key]]));
    project.territorialEntities.push(normalizeTerritorialIdentity({type:'Feature',id,geometry:null,properties}));
    const geometryRef={id:`library-geometry:${id}`,version:1};
    project.geometries.push({...geometryRef,geojson:copy(version.geometry)});
    const base={entityId:id,validFrom:null,validTo:null};
    project.timelineRecords.lifetimes.push({id:`library-lifetime:${id}`,...base});
    project.timelineRecords.geometryBindings.push({id:`library-geometry:${id}`,...base,geometryRef});
    project.timelineRecords.parentRelations.push({id:`library-parent:${id}`,...base,parentId:'',coverageMode:'explicit'});
  }
  return {project,referenceDate,selectedEntityId:entityId,selectedVersionId:versionId,
    source,initialFeatures,byProjectId};
}

/** Extract only accepted C++ geometry; source dates stay on their existing versions. */
export function collectLibraryGeometryChanges(workspace,acceptedFeatures){
  const baseline=new Map(workspace.initialFeatures.map(row=>[row.id,row]));
  const accepted=new Map(acceptedFeatures.map(row=>[String(row.id),row]));
  if(accepted.size!==baseline.size||[...baseline.keys()].some(id=>!accepted.has(id)))
    throw new Error('라이브러리 형상 작업 중 객체 집합이 달라졌습니다. 다시 여세요.');
  const selectedVersion=workspace.source.get(workspace.selectedEntityId).geometryVersions
    .find(row=>row.versionId===workspace.selectedVersionId);
  const changed=[];
  for(const [id,before]of baseline){
    const after=accepted.get(id),mapping=workspace.byProjectId.get(id);
    if(!mapping||after.properties?.sourceEntityId!==mapping.entityId
      ||after.properties?.sourceGeometryVersion!==mapping.versionId||!same(after.properties,before.properties))
      throw new Error(`${id}: 형상 편집 작업에서 자료 정체성이 바뀌었습니다.`);
    if(same(before.geometry,after.geometry))continue;
    const entity=workspace.source.get(mapping.entityId);
    const version=entity.geometryVersions.find(row=>row.versionId===mapping.versionId);
    if(id!==workspace.selectedEntityId&&!same(interval(version),interval(selectedVersion)))
      throw new Error(`${id}: 공유 경계 이웃의 원본 유효기간이 다릅니다. 일치하는 기간을 선택하세요.`);
    const updated=copy(entity);
    updated.geometryVersions=updated.geometryVersions.map(row=>row.versionId===mapping.versionId
      ? {...row,geometry:copy(after.geometry)}:row);
    changed.push(normalizeTerritorialLibraryEntity(updated));
  }
  return changed;
}

export function createLibraryGeometryContext({repository,service,entityId,versionId,appVersion}){
  if(!repository?.open||!service?.load||!entityId||!versionId)throw new TypeError('Native library geometry source is required');
  let workspace=null,editor=null,runtime=null,saving=false;
  async function prepare(){
    if(workspace)return workspace;
    const index=await service.load();
    const receipt=repository.snapshot();
    if(!receipt?.revision)throw new Error('라이브러리 저장 판본을 확인할 수 없습니다.');
    const prepared=await prepareLibraryGeometryWorkspace({index,readEntity:id=>service.loadEntity(id),
      entityId,versionId,appVersion});
    editor=createTerritorialLibraryEditor({service,repository,revision:receipt.revision});
    workspace=prepared;
    return workspace;
  }
  function attachRuntime(value){
    if(runtime)throw new Error('Library geometry runtime is already attached');
    if(typeof value?.entityRepository?.list!=='function'||typeof value?.projectDomain?.snapshot!=='function'
      ||typeof value?.editingDomain?.snapshot!=='function'||typeof value?.getState!=='function')
      throw new TypeError('Accepted editor runtime is required');
    runtime=value;
  }
  function hasActiveDraft(){
    const draft=runtime.editingDomain.snapshot();
    return !!(runtime.getState().geometryPreview?.session||draft.boundaryDraft||draft.selectionDraft
      ||draft.objectVertexEditing||draft.draftCoords?.length);
  }
  function hasUnsavedChanges(){
    if(saving)return true;
    if(!workspace||!runtime)return false;
    if(hasActiveDraft())return true;
    const accepted=runtime.entityRepository.list({kind:'general',parentId:''});
    const baseline=new Map(workspace.initialFeatures.map(row=>[row.id,row]));
    if(accepted.length!==baseline.size)return true;
    const seen=new Set();
    for(const after of accepted){
      const id=String(after.id),before=baseline.get(id);
      if(!before||seen.has(id)||!same(before.geometry,after.geometry)
        ||!same(before.properties,after.properties))return true;
      seen.add(id);
    }
    return seen.size!==baseline.size;
  }
  async function save(){
    if(saving)throw new Error('라이브러리 저장이 진행 중입니다.');
    if(!workspace||!runtime)throw new Error('라이브러리 형상 편집기가 준비되지 않았습니다.');
    if(hasActiveDraft())
      throw new Error('경계 미리보기를 적용하거나 취소한 뒤 저장하세요.');
    saving=true;
    try{
      const accepted=runtime.entityRepository.list({kind:'general',parentId:''});
      const changed=collectLibraryGeometryChanges(workspace,accepted);
      if(!changed.length)return {changed:false,revision:editor.snapshot().revision};
      await editor.apply({entities:changed,editMethod:'user-map-editor'});
      const result=await editor.save();
      workspace.source=new Map([...workspace.source].map(([id,old])=>[id,changed.find(row=>row.entityId===id)||old]));
      workspace.initialFeatures=accepted.map(copy);
      return {...result,changed:true};
    }finally{saving=false;}
  }
  return Object.freeze({kind:'library-geometry',prepare,attachRuntime,save,hasUnsavedChanges,
    get workspace(){return workspace;},get project(){return workspace?.project||null;},
    get title(){
      const source=workspace?.source.get(entityId);
      return source?`라이브러리 경계 편집 · ${source.names.ko||source.names.en||entityId}`:null;
    }});
}
