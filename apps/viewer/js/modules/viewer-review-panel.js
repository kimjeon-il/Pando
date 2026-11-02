import {
  reviewChangeTypeLabels, reviewValueText, reviewChangeKey, reviewObjectMapRef,
  reviewEvidenceUrl, reviewEvidenceForObject, correctionRequest,
} from '../../../../shared/frontend/js/modules/review-inspection.js';
import {readReviewEvidenceFiles} from '../../../../shared/frontend/js/modules/review-evidence-files.js';

const SHA=/^[0-9a-f]{64}$/;
const safeName=id=>id.replace(/[^A-Za-z0-9_.-]/g,'-').slice(0,100);
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const no=message=>{throw Object.assign(new Error(message),{code:'PL-REVIEW-PREVIEW'});};
function text(node,value){node.textContent=String(value??'');}
function element(document,name,className,value){
  const node=document.createElement(name);
  if(className)node.className=className;
  if(value!==undefined)text(node,value);
  return node;
}
/** Only consume the immutable source objects recorded by E3, after checking both raw and geometry SHA. */
export async function readReviewGeometry(inspection,sourceEntityId,change,{
  fetchFn=globalThis.fetch,subtle=globalThis.crypto?.subtle,signal,
  sourceBytes=null,
}={}){
  if(!inspection||change?.kind!=='geometry'||change.sourceEntityId!==sourceEntityId)
    no('선택된 항목이 원본 형상 변경이 아닙니다.');
  if(!subtle)no('원본 SHA 검증에는 보안 연결이 필요합니다.');
  const dataset=inspection.diff.dataset,output=[];
  for(const [revision,expected,side] of [
    [dataset.baseRevision,change.before,'before'],
    [dataset.candidateRevision,change.after,'after'],
  ]){
    if(expected===null){output.push(null);continue;}
    const row=inspection.diff.readObjects.find(x=>x.revision===revision
      &&x.sourceEntityId===sourceEntityId);
    if(!row||!SHA.test(row.sha256))no('해당 리비전의 원본 객체 해시가 없습니다.');
    const url='https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/'
      +revision+'/objects/'+row.sha256+'.json';
    let raw=sourceBytes?.get(revision);
    if(!raw){
      if(sourceBytes)no('변경 전후 두 원본 JSON 파일이 모두 필요합니다.');
      if(typeof fetchFn!=='function')no('원본 자료를 가져올 연결이 없습니다.');
      const response=await fetchFn(url,{credentials:'omit',mode:'cors',signal});
      if(!response?.ok)no('원본 Git 객체를 가져오지 못했습니다 ('+side+').');
      const header=Number(response.headers?.get('content-length'));
      if(header>16*1024*1024)no('원본 파일이 허용된 용량을 초과합니다.');
      raw=new Uint8Array(await response.arrayBuffer());
    }
    if(!ArrayBuffer.isView(raw)||raw.byteLength>16*1024*1024||raw.byteLength===0)
      no('원본 파일의 형식 또는 크기가 올바르지 않습니다.');
    if(hex(await subtle.digest('SHA-256',raw))!==row.sha256)
      no('원본 Git 객체 SHA-256 불일치: '+side);
    let entity;
    try{entity=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{no('원본 객체 JSON을 읽을 수 없습니다.');}
    if(entity.entityId!==sourceEntityId||!Array.isArray(entity.geometryVersions))
      no('원본 객체 ID가 검수 대상과 일치하지 않습니다.');
    const versions=entity.geometryVersions.filter(x=>x.versionId===expected.versionId);
    if(versions.length!==1||!['Polygon','MultiPolygon'].includes(versions[0].geometry?.type))
      no('대상 형상 버전을 원본에서 찾을 수 없습니다.');
    const geometry=versions[0].geometry;
    const body=new TextEncoder().encode(JSON.stringify(geometry));
    if(hex(await subtle.digest('SHA-256',body))!==expected.sha256)
      no('형상 좌표 SHA-256이 검수 기록과 다릅니다: '+side);
    output.push(structuredClone(geometry));
  }
  return Object.freeze({before:output[0],after:output[1]});
}
/** Bounded UI-only lon/lat sketch: common frame, wrapped longitude seam, no runtime map owner. */
export function buildReviewPreviewPaths(geometries){
  const frames=[geometries?.before??null,geometries?.after??null];
  const allRings=[],separate=[],longitudes=[],latitudes=[];
  let total=0;
  for(const geometry of frames){
    if(geometry===null){separate.push(null);continue;}
    if(!['Polygon','MultiPolygon'].includes(geometry?.type))
      no('원본 형상 미리보기는 Polygon/MultiPolygon만 지원합니다.');
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    if(!Array.isArray(polygons)||!polygons.length)no('원본 형상 좌표가 비어 있습니다.');
    const own=[];
    for(const polygon of polygons){
      if(!Array.isArray(polygon)||!polygon.length)no('원본 다각형 링이 없습니다.');
      for(const ring of polygon){
        if(!Array.isArray(ring)||ring.length<4)no('다각형 링의 좌표가 부족합니다.');
        if(++total>100000)no('한 번에 표시할 원본 링의 수가 너무 많습니다.');
        const points=[];
        for(const pos of ring){
          if(!Array.isArray(pos)||pos.length<2||!Number.isFinite(pos[0])
            ||!Number.isFinite(pos[1])||pos[0]<-180||pos[0]>180||pos[1]<-90||pos[1]>90)
            no('경위도 좌표 값이 올바르지 않습니다.');
          points.push(pos);
          longitudes.push((pos[0]+360)%360);
          latitudes.push(pos[1]);
          if(longitudes.length>250000)no('원본 정점 수가 안전한 화면 비교 한도를 초과했습니다.');
        }
        own.push(points);allRings.push(points);
      }
    }
    separate.push(own);
  }
  if(!allRings.length)no('표시할 원본 형상이 없습니다.');
  // Pick the longest empty longitude gap as the common seam. This avoids
  // drawing a line across the entire map for a feature near the dateline.
  const sortedLon=[...longitudes].sort((a,b)=>a-b);
  let seam=sortedLon[0],largestGap=-1;
  for(let i=0;i<sortedLon.length;i++){
    const after=i+1<sortedLon.length?sortedLon[i+1]:sortedLon[0]+360;
    const gap=after-sortedLon[i];
    if(gap>largestGap){largestGap=gap;seam=after%360;}
  }
  const unwrap=lon=>{
    const normalized=(lon+360)%360;
    return normalized<seam?normalized+360:normalized;
  };
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let i=0;i<longitudes.length;i++){
    const x=longitudes[i]<seam?longitudes[i]+360:longitudes[i],y=latitudes[i];
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);
    minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  const availableWidth=296,availableHeight=166;
  const scale=Math.min(availableWidth/Math.max(maxX-minX,0.00001),
    availableHeight/Math.max(maxY-minY,0.00001));
  if(!Number.isFinite(scale)||scale<=0)no('형상 표시 축척을 계산하지 못했습니다.');
  const offsetX=160-(maxX-minX)*scale/2;
  const offsetY=95-(maxY-minY)*scale/2;
  const point=p=>(offsetX+(unwrap(p[0])-minX)*scale).toFixed(2)
    +' '+(offsetY+(maxY-p[1])*scale).toFixed(2);
  return Object.freeze({
    before:separate[0]===null?null:separate[0].map(ring=>
      'M'+ring.map(point).join('L')+'Z').join(''),
    after:separate[1]===null?null:separate[1].map(ring=>
      'M'+ring.map(point).join('L')+'Z').join(''),
  });
}
function renderGeometryPair(document,geometries){
  const paths=buildReviewPreviewPaths(geometries);
  for(const [id,key] of [['reviewBeforeMap','before'],['reviewAfterMap','after']]){
    const svg=document.getElementById(id);
    svg.replaceChildren();
    if(paths[key]!==null){
      const node=document.createElementNS('http://www.w3.org/2000/svg','path');
      node.setAttribute('d',paths[key]);
      svg.appendChild(node);
    }else{
      const node=document.createElementNS('http://www.w3.org/2000/svg','text');
      node.setAttribute('x','160');node.setAttribute('y','100');node.setAttribute('text-anchor','middle');
      text(node,'해당 기간 없음');svg.appendChild(node);
    }
  }
}

/** Overlay-only UI owner; does not own the map, Core document, or Git write access. */
export function createViewerReviewPanel({document,window,map,documentSession,isBuiltinMap,meta={},onError=()=>{}}={}){
  if(!document||!window||!map||!documentSession||typeof isBuiltinMap!=='function')
    throw new TypeError('Review presentation requires the current read-only map and document session.');
  const get=id=>document.getElementById(id);
  const panel=get('reviewPanel'),button=get('reviewPanelBtn'),mobileButton=get('mobileReviewBtn');
  if(!panel||!button)throw new TypeError('Review panel markup is missing.');
  const subscriptions=[];
  const listen=(node,type,fn)=>{node?.addEventListener(type,fn);subscriptions.push(()=>node?.removeEventListener(type,fn));};
  const err=(message)=>{const node=get('reviewLoadStatus');text(node,message);node.dataset.tone='error';};
  const feedback=(id,message,tone)=>{const node=get(id);text(node,message);if(node)node.dataset.tone=tone||'';};
  let current=null,chosenEntity=null,chosenChange=null,activeFetch=null,requestSerial=0;
  let trigger=null,disposed=false,rawObjectBytes=new Map(),loadSerial=0;
  function open(sourceButton=button){
    if(disposed)return;
    trigger=sourceButton;panel.hidden=false;
    button.setAttribute('aria-expanded','true');mobileButton?.setAttribute('aria-expanded','true');
    if(current){updateMapRevision();updateFocus();}
    if(current)get('reviewSearch').focus();else get('reviewLoadBtn').focus();
  }
  function close(){
    if(disposed)return;
    loadSerial++;abortFetch();panel.hidden=true;
    button.setAttribute('aria-expanded','false');mobileButton?.setAttribute('aria-expanded','false');
    trigger?.focus?.();
  }
  function abortFetch(){activeFetch?.abort();activeFetch=null;requestSerial++;get('reviewFetchGeometry').disabled=false;}
  function selectedChange(){
    if(!current||!chosenEntity)return null;
    return current.diff.changes.find(c=>c.sourceEntityId===chosenEntity
      &&reviewChangeKey(c)===chosenChange)||null;
  }
  function sourceMatch(){
    return current&&reviewObjectMapRef(documentSession.documentModel.snapshot(),chosenEntity);
  }
  function updateFocus(){
    if(!chosenEntity)return;
    const ref=sourceMatch(),valid=ref&&map.objectQuery.objectRefExists(ref);
    get('reviewFocusBtn').disabled=!valid;
    feedback('reviewFocusStatus',valid
      ?'현재 지도에서 같은 원본 ID의 객체를 찾았습니다. 이 지도는 선택된 데이터 리비전만 표시합니다.'
      :'현재 지도 시점·프로젝트에 일치하는 객체가 없습니다. 다른 역사 리비전의 지도를 임의로 표시하지 않습니다.');
  }
  function renderReportLinks(){
    const list=get('reviewSourceLinks');list.replaceChildren();
    const found=reviewEvidenceForObject(current,chosenEntity);
    if(!found.length){list.appendChild(element(document,'li','','연결된 근거 보고서가 없습니다.'));return;}
    for(const row of found){
      const li=element(document,'li'),link=element(document,'a','',row.reportPath);
      link.href=reviewEvidenceUrl(row);link.target='_blank';link.rel='noopener noreferrer';
      li.append(link);list.appendChild(li);
    }
  }
  function renderDetail(){
    if(!current||!chosenEntity){get('reviewDetail').hidden=true;return;}
    get('reviewDetail').hidden=false;
    text(get('reviewSelectedObject'),chosenEntity);
    updateFocus();
    const container=get('reviewChangeList');container.replaceChildren();
    const changes=current.diff.changes.filter(x=>x.sourceEntityId===chosenEntity);
    if(!changes.some(x=>reviewChangeKey(x)===chosenChange))
      chosenChange=changes[0]?reviewChangeKey(changes[0]):null;
    for(const change of changes){
      const item=element(document,'button','ui-button');
      item.type='button';item.setAttribute('aria-pressed',String(reviewChangeKey(change)===chosenChange));
      const title=element(document,'strong','',(reviewChangeTypeLabels[change.kind]||change.kind)+' · '+change.field);
      const dates=element(document,'span','',(change.validFrom??'시작 미정')+' ~ '+(change.validTo??'종료 없음'));
      const values=element(document,'div','viewer-review-diff-values');
      values.appendChild(element(document,'span','','이전: '+reviewValueText(change.kind,change.before)));
      values.appendChild(element(document,'span','','변경: '+reviewValueText(change.kind,change.after)));
      item.append(title,dates,values);
      item.addEventListener('click',()=>{abortFetch();chosenChange=reviewChangeKey(change);renderDetail();});
      container.appendChild(item);
    }
    const selected=selectedChange();
    get('reviewCompareSection').hidden=selected?.kind!=='geometry';
    get('reviewGeometryPreviews').hidden=true;
    feedback('reviewCompareStatus','원본 형상을 아직 비교하지 않았습니다.');
    get('reviewIssueKind').value=selected?.kind==='geometry'?'geometry':selected?.kind==='name'||selected?.kind==='flag'||selected?.kind==='parent'?'attribute':selected?.kind==='lifetime'?'date':'other';
    renderReportLinks();
  }
  function selectEntity(id){
    if(!current||!current.entities.some(x=>x.sourceEntityId===id))return;
    abortFetch();rawObjectBytes=new Map();chosenEntity=id;chosenChange=null;
    renderBrowse();renderDetail();
  }
  function renderBrowse(){
    if(!current)return;
    const search=get('reviewSearch').value.toLocaleLowerCase(),kind=get('reviewKindFilter').value;
    const list=get('reviewObjectList');list.replaceChildren();
    let visible=0;
    for(const row of current.entities){
      if(!row.sourceEntityId.toLocaleLowerCase().includes(search)||(kind&&!row.kinds.includes(kind)))continue;
      visible++;
      const button=element(document,'button','ui-button',row.sourceEntityId+' · '+row.count+'건');
      button.type='button';button.setAttribute('aria-current',String(row.sourceEntityId===chosenEntity));
      button.setAttribute('role','listitem');
      button.addEventListener('click',()=>selectEntity(row.sourceEntityId));
      list.appendChild(button);
    }
    if(!visible)list.appendChild(element(document,'p','viewer-review-hint','검색 조건에 해당하는 변경이 없습니다.'));
  }
  function updateMapRevision(){
    if(!current)return;
    const data=current.diff.dataset,runtimeSha=isBuiltinMap()?meta.dataCommit:null;
    text(get('reviewMapRevision'),runtimeSha===data.baseRevision?'변경 전 (현재 지도 pin)'
      :runtimeSha===data.candidateRevision?'변경 후 (현재 지도 pin)'
        :'다른 리비전 / 파일 지도. 두 지도가 동시에 표시되는 것은 아닙니다.');
  }
  function renderSummary(checksumVerified){
    const summary=get('reviewSummary');summary.hidden=false;
    const data=current.diff.dataset,state=current.state;
    const recorded=state.status;
    text(get('reviewState'),recorded+(current.proposal?' (Sidecar 기록·원격 승인 미확인)':' (제안서 미첨부)'));
    text(get('reviewCounts'),current.entities.length+'개 / '+current.diff.changes.length+'건');
    text(get('reviewBaseRevision'),data.baseRevision);
    text(get('reviewCandidateRevision'),data.candidateRevision);
    updateMapRevision();
    const scope=current.diff.scope;
    text(get('reviewTrustNotice'),(checksumVerified?'선택한 산출물 파일 SHA-256 일치. ':'산출물 목록 SHA 검증 없음. ')
      +(scope&&!scope.complete?'일부 배치 '+scope.batchIndex+'/'+scope.batchCount+'. ':'')
      +'시간·형상 출처의 역사적 정확성과 실제 검수 승인은 별도 확인 대상입니다.');
    const list=get('reviewChecks');list.replaceChildren();
    const rows=current.verification?.checks??[];
    for(const row of rows)list.appendChild(element(document,'li','',row.name+' : '+row.outcome));
    if(!rows.length)list.appendChild(element(document,'li','','검증 영수증 없음 (검증 완료로 표시하지 않음)'));
    for(const issue of current.diff.issues.slice(0,15))
      list.appendChild(element(document,'li','',issue.sourceEntityId+' · '+issue.code+' : '+issue.detail));
    get('reviewBrowse').hidden=false;
    text(get('reviewLoadStatus'),current.proposal?.proposal.proposalId
      ?'검수 자료 읽기 완료 · '+current.proposal.proposal.proposalId
      :'검수 자료 읽기 완료 · 제안서 없음');
    get('reviewLoadStatus').dataset.tone='';
  }
  async function loadEvidence(inputFiles){
    if(disposed)return;
    const ticket=++loadSerial;
    feedback('reviewLoadStatus','검수 파일과 SHA-256을 검사하는 중…');
    try{
      const result=await readReviewEvidenceFiles(inputFiles,{subtle:window.crypto?.subtle});
      if(ticket!==loadSerial||disposed)return;
      abortFetch();current=result.inspection;
      chosenEntity=null;chosenChange=null;rawObjectBytes=new Map();
      get('reviewSearch').value='';get('reviewKindFilter').value='';
      renderSummary(result.checksumVerified);
      if(current.entities.length)selectEntity(current.entities[0].sourceEntityId);
      else {get('reviewDetail').hidden=true;renderBrowse();}
    }catch(error){if(ticket===loadSerial&&!disposed){err('검수 파일을 적용하지 않았습니다: '+error.message);onError(error);}
    }finally{get('reviewEvidenceInput').value='';}
  }
  async function focusOnMap(){
    const ref=sourceMatch();
    if(!ref||!map.objectQuery.objectRefExists(ref))return updateFocus();
    await documentSession.selectionDomain.replace(ref,{scope:'review',reason:'review-map-focus'});
    const focused=map.objectQuery.focusObjectRef(ref,{announce:false});
    feedback('reviewFocusStatus',focused?'현재 자료의 객체로 이동했습니다. 변경 후 지도라는 뜻은 아닙니다.':'현재 지도에서 해당 형상을 표시할 수 없습니다.');
  }
  function clearPreview(){get('reviewGeometryPreviews').hidden=true;}
  async function compare({useLocal=false}={}){
    const change=selectedChange();
    if(change?.kind!=='geometry')return;
    const entity=chosenEntity,ticket=++requestSerial;
    activeFetch?.abort();activeFetch=new AbortController();
    get('reviewFetchGeometry').disabled=true;
    feedback('reviewCompareStatus','원본 객체·형상 SHA를 확인하는 중…');clearPreview();
    try {
      const pair=await readReviewGeometry(current,entity,change,{
        fetchFn:window.fetch?.bind(window),subtle:window.crypto?.subtle,
        signal:activeFetch.signal,sourceBytes:useLocal?rawObjectBytes:null,
      });
      if(disposed||ticket!==requestSerial)return;
      renderGeometryPair(document,pair);
      get('reviewGeometryPreviews').hidden=false;
      feedback('reviewCompareStatus','두 형상 원본 SHA-256 검증 완료. 같은 투영으로 비교 표시 중 (국경 위상·역사 정확성 미검증).');
    }catch(error){
      if(!disposed&&ticket===requestSerial){
        feedback('reviewCompareStatus','형상 비교 불가: '+error.message+' (원본 JSON을 직접 선택할 수 있습니다.)','error');
      }
    }finally{
      if(ticket===requestSerial){activeFetch=null;get('reviewFetchGeometry').disabled=false;}
    }
  }
  async function loadSourceFiles(files){
    if(!current||!selectedChange()||selectedChange().kind!=='geometry')return;
    const subject=chosenEntity;
    try{
      const records=new Map();
      for(const file of files){
        if(file.size<=0||file.size>16*1024*1024||!file.name.endsWith('.json'))no('원본 JSON 크기 또는 파일명을 확인하세요.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        const digest=hex(await window.crypto.subtle.digest('SHA-256',bytes));
        if(subject!==chosenEntity)no('원본 파일 선택 중 검수 대상이 바뀌었습니다.');
        const item=current.diff.readObjects.find(x=>x.sourceEntityId===chosenEntity&&x.sha256===digest);
        if(!item)no('이 파일은 선택된 객체의 E3 Git SHA와 일치하지 않습니다.');
        records.set(item.revision,bytes);
      }
      rawObjectBytes=records;
      await compare({useLocal:true});
    }catch(e){feedback('reviewCompareStatus','원본 JSON 검사 실패: '+e.message,'error');}
    finally{get('reviewSourceInput').value='';}
  }
  async function downloadCorrection(){
    const change=selectedChange();
    if(!current||!change)return;
    try {
      const request=correctionRequest({inspection:current,sourceEntityId:chosenEntity,change,
        kind:get('reviewIssueKind').value,reason:get('reviewIssueReason').value,
        createdAt:new Date().toISOString()});
      if(window.PANDOLAB_NATIVE_REVIEW===true){
        const invoke=window.__TAURI_INTERNALS__?.invoke;
        if(typeof invoke!=='function')no('Windows 수정 요청서 저장 기능을 사용할 수 없습니다.');
        const result=await invoke.call(window.__TAURI_INTERNALS__,'save_review_correction',{draft:request});
        feedback('reviewCorrectionStatus',result?.cancelled
          ?'수정 요청서 저장을 취소했습니다.'
          :'Windows에 수정 요청서를 저장했습니다. 실제 GIS나 GitHub에는 반영되지 않았습니다.');
        return;
      }
      const body=JSON.stringify(request,null,2)+'\n';
      const blob=new Blob([body],{type:'application/json'});
      const url=window.URL.createObjectURL(blob);
      try{
        const a=element(document,'a');a.href=url;
        a.download='pando-review-correction-'+safeName(chosenEntity)+'-'+Date.now()+'.json';
        document.body.appendChild(a);a.click();a.remove();
        feedback('reviewCorrectionStatus','로컬 수정 요청서가 생성됐습니다. GitHub나 데이터 저장소로 전송되지 않았습니다.');
      }finally{window.URL.revokeObjectURL(url);}
    }catch(error){feedback('reviewCorrectionStatus',error.message,'error');}
  }
  function syncMapSelection(snapshot){
    if(disposed||panel.hidden||!current)return;
    const ref=snapshot?.selection?.items?.find(x=>x.key===snapshot.selection.primaryKey);
    if(ref?.domain!=='territorial')return;
    const feature=documentSession.documentModel.snapshot()?.territorialEntities?.find(x=>x.id===ref.id);
    const source=feature?.properties?.sourceEntityId||feature?.id;
    if(source&&source!==chosenEntity&&current.entities.some(x=>x.sourceEntityId===source))selectEntity(source);
  }
  listen(get('reviewCloseBtn'),'click',close);
  listen(get('reviewLoadBtn'),'click',()=>get('reviewEvidenceInput').click());
  listen(get('reviewEvidenceInput'),'change',event=>{if(event.target.files?.length)loadEvidence(event.target.files);});
  listen(get('reviewSearch'),'input',renderBrowse);
  listen(get('reviewKindFilter'),'change',renderBrowse);
  listen(get('reviewFocusBtn'),'click',()=>focusOnMap().catch(e=>feedback('reviewFocusStatus',e.message,'error')));
  listen(get('reviewFetchGeometry'),'click',()=>compare());
  listen(get('reviewSourceBtn'),'click',()=>get('reviewSourceInput').click());
  listen(get('reviewSourceInput'),'change',e=>{if(e.target.files?.length)loadSourceFiles(e.target.files);});
  listen(get('reviewExportRequest'),'click',downloadCorrection);
  listen(window,'pandolab:project-changed',()=>{if(current){updateMapRevision();updateFocus();}});
  listen(document,'keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();close();}});
  return Object.freeze({
    open,close,syncMapSelection,
    get snapshot(){return current;},
    dispose(){if(disposed)return;close();disposed=true;abortFetch();rawObjectBytes.clear();
      for(const unsubscribe of subscriptions.splice(0))unsubscribe();},
  });
}
