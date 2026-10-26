import {createTerritorialLibraryEditor} from './territorial-library-editor.js';

const endpoint=value=>String(value||'').trim()||null;
export function applyLibrarySourceFields(source,fields){
 const entity=structuredClone(source);
 for(const [language,value]of [['ko',fields.nameKo],['en',fields.nameEn]]){
  if(String(value||'').trim())entity.names[language]=value.trim();else delete entity.names[language];
 }
 entity.lifetime={validFrom:endpoint(fields.validFrom),validTo:endpoint(fields.validTo)};
 entity.sourceInfo={...entity.sourceInfo,title:String(fields.sourceTitle||'').trim(),url:String(fields.sourceUrl||'').trim(),license:String(fields.sourceLicense||'').trim()};
 const version=entity.geometryVersions.find(v=>v.versionId===fields.versionId);
 if(!version)throw new Error('편집할 경계 버전을 선택하세요.');
 Object.assign(version,{validFrom:endpoint(fields.versionFrom),validTo:endpoint(fields.versionTo),certainty:fields.certainty});
 if(fields.representativeGeometryVersionId){
  if(!entity.geometryVersions.some(v=>v.versionId===fields.representativeGeometryVersionId))throw new Error('대표 형상 버전이 없습니다.');
  entity.metadata={...entity.metadata,representativeGeometryVersionId:fields.representativeGeometryVersionId};
 }
 return entity;
}

// This owner-only surface is constructed only by the native editor composition.
export function createTerritorialLibraryEditingUi({document,window,host,service,repository,refresh,reportError}){
 let editor=createTerritorialLibraryEditor({service,repository,revision:repository.snapshot().revision});
 let working=null,editingId='',versionId='',formDirty=false,running=false,backgroundFailure='';
 const conflictButtons=[];
 const section=document.createElement('section');section.className='territorial-library-source-editor';section.hidden=true;
 section.setAttribute('aria-label','라이브러리 원본 편집');
 const title=document.createElement('h3');title.textContent='라이브러리 원본 편집';
 const description=document.createElement('p');description.className='editor-help';description.textContent='프로젝트와 별도로 저장합니다. 공개 Web은 게시한 판본만 사용합니다.';
 const status=document.createElement('p');status.setAttribute('role','status');status.className='editor-help';
 const folder=document.createElement('p');folder.className='editor-help';folder.setAttribute('aria-label','라이브러리 자료 폴더');
 const toolbar=document.createElement('div');toolbar.className='territorial-library-source-actions';
 const form=document.createElement('div');form.className='territorial-library-source-fields';
 const controls={};
 function field(key,label,kind='text'){
  const row=document.createElement('label');row.className='ui-field field-group';
  const caption=document.createElement('span');caption.textContent=label;
  const input=document.createElement(kind==='select'?'select':'input');if(kind!=='select')input.type=kind;
  input.dataset.libraryField=key;input.setAttribute('aria-label',label);row.append(caption,input);form.append(row);controls[key]=input;
  input.addEventListener('input',()=>{formDirty=true;updateStatus();});return input;
 }
 field('nameKo','한국어 이름');field('nameEn','영어 이름');field('validFrom','존속 시작일');field('validTo','존속 종료일');
 field('sourceTitle','출처 이름');field('sourceUrl','출처 주소');field('sourceLicense','이용 조건');
 const versionSelect=field('versionId','경계 버전','select');field('versionFrom','경계 시작일');field('versionTo','경계 종료일');
 const representativeSelect=field('representativeGeometryVersionId','대표 형상','select');
 const certainty=field('certainty','경계 확실성','select');
 function option(select,value,label){const node=document.createElement('option');node.value=value;node.textContent=label;select.append(node);}
 for(const [value,label]of [['high','확인됨'],['medium','일부 불확실'],['low','낮음']])option(certainty,value,label);
 const flag=field('flag','국기 이미지','file');flag.accept='image/png,image/jpeg,image/webp,image/svg+xml';
 const flagPreview=document.createElement('img');flagPreview.className='territorial-library-source-flag';flagPreview.alt='국기 미리보기';form.append(flagPreview);
 section.append(title,description,form,toolbar);host.append(section);
 const globalActions=document.createElement('div');globalActions.className='territorial-library-source-actions';globalActions.setAttribute('aria-label','라이브러리 동기화');
 host.append(globalActions,status,folder);
 function displayState(value){return ({synced:'GitHub 동기화 완료',queued:'로컬 저장됨 · GitHub 동기화 대기',conflict:'다른 기기의 수정본과 충돌',offline:'오프라인 · 수정본 보존 중'})[value]||value||'로컬 자료';}
 function workingWarning(warning){return warning?`원본 저장됨 · 작업 파일 갱신 대기: ${warning.message}`:null;}
 function updateStatus(text){status.textContent=text||((formDirty||editor.snapshot().dirty)?'저장하지 않은 라이브러리 변경이 있습니다.':displayState(repository.snapshot().status?.state));
  for(const button of conflictButtons)button.hidden=repository.snapshot().status?.state!=='conflict';
  folder.textContent=repository.snapshot().status?.workingDirectory||'';folder.hidden=!folder.textContent;}
 async function run(operation){if(running)return;running=true;section.setAttribute('aria-busy','true');
  try{return await operation();}catch(error){updateStatus(error.message);reportError(error,'라이브러리 작업을 완료하지 못했습니다.','PL-LIB-WRITE-001',6000);}
  finally{running=false;section.setAttribute('aria-busy','false');}}
 function action(parent,label,operation,key){const button=document.createElement('button');button.type='button';button.className='ui-button btn ghost';button.textContent=label;
  if(key)button.dataset.libraryAction=key;button.addEventListener('click',()=>{run(operation).catch(error=>reportError(error,'라이브러리 작업 오류','PL-LIB-WRITE-002'));});parent.append(button);return button;}
 function readFields(){return Object.fromEntries(Object.entries(controls).filter(([key])=>key!=='flag').map(([key,node])=>[key,node.value]));}
 function collect(){if(working)working=applyLibrarySourceFields(working,{...readFields(),versionId});}
 function fill(){
  if(!working)return;
  for(const key of ['nameKo','nameEn','validFrom','validTo','sourceTitle','sourceUrl','sourceLicense'])controls[key].value=({
   nameKo:working.names.ko,nameEn:working.names.en,validFrom:working.lifetime.validFrom,validTo:working.lifetime.validTo,
   sourceTitle:working.sourceInfo.title,sourceUrl:working.sourceInfo.url,sourceLicense:working.sourceInfo.license})[key]||'';
  versionSelect.replaceChildren();representativeSelect.replaceChildren();for(const v of working.geometryVersions){
   const label=`${v.validFrom||'시작 미상'} ~ ${v.validTo||'계속'} · ${v.versionId}`;
   option(versionSelect,v.versionId,label);option(representativeSelect,v.versionId,label);
  }
  representativeSelect.value=working.metadata.representativeGeometryVersionId||'';
  versionSelect.value=versionId;const version=working.geometryVersions.find(v=>v.versionId===versionId)||working.geometryVersions[0];versionId=version.versionId;
  controls.versionFrom.value=version.validFrom||'';controls.versionTo.value=version.validTo||'';certainty.value=version.certainty||'medium';
  const url=working.metadata.defaultFlagDataUrl||'';flagPreview.hidden=!url;if(url)flagPreview.src=url;else flagPreview.removeAttribute('src');flag.value='';
 }
 async function open(entity,version){
  if(formDirty||editor.snapshot().dirty)throw new Error('현재 변경을 저장하거나 변경 취소를 누른 뒤 다른 항목을 여세요.');
  working=structuredClone(await service.loadEntity(entity.entityId));editingId=working.entityId;versionId=version?.versionId||working.geometryVersions[0].versionId;section.hidden=false;fill();updateStatus();
 }
 async function apply(){collect();await editor.apply({entities:[working]});formDirty=false;updateStatus();}
 async function showCommitted(result){
  formDirty=false;working=null;section.hidden=true;await refresh();updateStatus(workingWarning(result.warning));return result;
 }
 async function reload({discard=false,external=false}={}){
  if((formDirty||editor.snapshot().dirty)&&!discard)throw new Error('저장하지 않은 변경이 있습니다. 먼저 저장하거나 변경 취소를 누르세요.');
  let result=await repository.open();service.replaceCatalog(result.index);editor=createTerritorialLibraryEditor({service,repository,revision:result.revision});
  if(external&&!result.warning){
   const changes=await repository.externalChanges();
   if(changes.expectedRevision!==result.revision)throw new Error('라이브러리 판본이 바뀌었습니다. 다시 읽으세요.');
   if(changes.entities.length||changes.deletedEntityIds.length){await editor.apply(changes);result=await editor.save();}
  }
  return showCommitted(result);
 }
 async function sync(){
  if(formDirty||editor.snapshot().dirty)throw new Error('변경을 먼저 저장하세요.');
  const result=await repository.sync();const opened=await reload();updateStatus(workingWarning(result.warning||opened.warning)||displayState(result.state));return result;
 }
 versionSelect.addEventListener('change',()=>{run(async()=>{const next=versionSelect.value;collect();versionId=next;fill();formDirty=true;}).catch(error=>reportError(error,'경계 버전 선택 오류','PL-LIB-WRITE-003'));});
 flag.addEventListener('change',()=>{run(async()=>{const file=flag.files[0];if(!file||!working)return;collect();
  if(file.size>8*1024*1024)throw new Error('국기 이미지는 8 MiB 이하여야 합니다.');
  working.metadata.defaultFlagDataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});
  formDirty=true;fill();updateStatus();}).catch(error=>reportError(error,'국기 읽기 오류','PL-LIB-WRITE-004'));});
 action(toolbar,'국기 지우기',async()=>{collect();delete working.metadata.defaultFlagDataUrl;formDirty=true;fill();},'remove-flag');
 action(toolbar,'변경 적용',apply,'apply');
 action(toolbar,'저장',async()=>{await apply();const saved=await editor.save();await showCommitted(saved);if(!saved.warning)await sync();},'save');
 async function restoreForm(){
  formDirty=false;
  if(editor.get(editingId)){working=structuredClone(await editor.readEntity(editingId));section.hidden=false;fill();}
  else{working=null;section.hidden=true;}
  updateStatus();
 }
 action(globalActions,'실행 취소',async()=>{if(formDirty)await restoreForm();else if(editor.undo())await restoreForm();},'undo');
 action(globalActions,'다시 실행',async()=>{if(editor.redo())await restoreForm();},'redo');
 action(toolbar,'변경 취소',async()=>{editor.discard();await reload({discard:true});},'discard');
 action(toolbar,'지도에서 경계 편집',async()=>{if(formDirty||editor.snapshot().dirty)throw new Error('메타데이터 변경을 먼저 저장하세요.');await repository.openGeometry(working.entityId,versionId);},'geometry');
 action(toolbar,'시기 버전 추가',async()=>{collect();const current=working.geometryVersions.find(v=>v.versionId===versionId);const next={...structuredClone(current),versionId:`${working.entityId}:${crypto.randomUUID()}`,validFrom:null,validTo:null,certainty:'medium'};
  working.geometryVersions.push(next);versionId=next.versionId;formDirty=true;fill();updateStatus('새 버전과 기존 버전의 기간이 겹치지 않도록 지정하세요.');},'add-version');
 action(toolbar,'선택 버전 삭제',async()=>{if(working.geometryVersions.length===1)throw new Error('마지막 경계 버전은 삭제할 수 없습니다.');collect();working.geometryVersions=working.geometryVersions.filter(v=>v.versionId!==versionId);versionId=working.geometryVersions[0].versionId;if(!working.geometryVersions.some(v=>v.versionId===working.metadata.representativeGeometryVersionId))working.metadata.representativeGeometryVersionId=versionId;formDirty=true;fill();},'delete-version');
 action(toolbar,'이 경계로 새 자료 만들기',async()=>{collect();if(editor.snapshot().dirty)throw new Error('현재 변경을 먼저 저장하세요.');const identity=crypto.randomUUID().replaceAll('-','');working.entityId=`state:custom_${identity}`;working.lineageId=`custom-${identity}`;working.names={ko:'새 자료'};
  editingId=working.entityId;working.parentEntityId='';working.instantiation={mode:'independent',countryUpdates:{}};working.geometryVersions=working.geometryVersions.map((v,i)=>({...v,versionId:`${working.entityId}:${i+1}`}));versionId=working.geometryVersions[0].versionId;working.metadata.representativeGeometryVersionId=versionId;formDirty=true;fill();},'add-entity');
 action(toolbar,'자료 삭제',async()=>{if(!window.confirm('이 자료를 라이브러리에서 삭제할까요? 기존 프로젝트는 유지됩니다.'))return;await editor.apply({deletedEntityIds:[working.entityId]});const saved=await editor.save();await showCommitted(saved);if(!saved.warning)await sync();},'delete-entity');
 action(globalActions,'자료 다시 읽기',()=>reload({external:true}),'reload');action(globalActions,'GitHub 동기화',sync,'sync');
 for(const [choice,label]of [['local','충돌: 내 수정본 유지'],['remote','충돌: 원격 수정본 선택']])conflictButtons.push(action(globalActions,label,async()=>{if(formDirty||editor.snapshot().dirty)throw new Error('현재 변경을 먼저 저장하세요.');const result=await repository.resolveConflict(choice);service.replaceCatalog(result.index);editor=createTerritorialLibraryEditor({service,repository,revision:result.revision});await showCommitted(result);},`conflict-${choice}`));
 const background=()=>{if(running||formDirty||editor.snapshot().dirty)return;running=true;
  sync().then(()=>{backgroundFailure='';}).catch(error=>{updateStatus(error.message);if(backgroundFailure!==error.message){backgroundFailure=error.message;reportError(error,'자동 동기화 대기','PL-LIB-SYNC-001');}}).finally(()=>{running=false;});};
 window.addEventListener('focus',background);window.addEventListener('online',background);
 const timer=window.setInterval(background,60_000);
 window.addEventListener('beforeunload',event=>{if(formDirty||editor.snapshot().dirty){event.preventDefault();event.returnValue='';}});
 updateStatus();
 return Object.freeze({decorate({entity,version,host:preview}){action(preview,'원본 편집',()=>open(entity,version),'edit');},
  hasUnsavedChanges:()=>formDirty||editor.snapshot().dirty,dispose(){window.clearInterval(timer);window.removeEventListener('focus',background);window.removeEventListener('online',background);},reload,sync});
}
