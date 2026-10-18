import { createDocumentSession } from './document-session.js';
import { createViewerSession } from './viewer-session.js';
import { createViewerMap } from './viewer-map.js';
import { readBuiltinProject, readProjectFile } from './viewer-project-reader.js';
import { MAP_DISPLAY_TARGETS } from './map-display-catalog.js';
import { createSurfaceController } from './surface-controller.js';
import { loadUserPreferences } from './user-preferences.js';

export async function composeViewer({ productMode, meta }) {
  if(productMode!=='viewer'||!meta?.assetRevision)throw new Error('실행 설정이 올바르지 않습니다.');
  const get=id=>document.getElementById(id),status=get('viewerStatus');
  const preferences=loadUserPreferences();
  const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme=()=>{document.documentElement.dataset.theme=preferences.appearance.theme==='system'?(systemTheme.matches?'dark':'light'):preferences.appearance.theme;};
  applyTheme();systemTheme.addEventListener('change',applyTheme);
  const surfaceIds={objectSearchSurface:'viewerSearchPanel',mapDisplaySurface:'viewerDisplayPanel',editorSurface:'viewerInfoPanel',
    objectSearchBtn:'viewerSearchToggle',mapDisplayBtn:'viewerDisplayToggle'};
  const surfaces=createSurfaceController({getElement:id=>get(surfaceIds[id]||id),getLayout:()=>window.innerWidth<800?'mobile':'compact',document});
  const presentSurfaces=()=>{
    surfaces.render();
    for(const [surface,id] of [['search','viewerSearchPanel'],['display','viewerDisplayPanel'],['editor','viewerInfoPanel']])get(id).hidden=!surfaces.isOpen(surface);
  };
  const report=error=>{console.error('[PL-VIEWER-OPERATION]',error);status.textContent=`작업을 완료하지 못했습니다. ${error.message}`;};
  let map,previousView;
  const session=createViewerSession({createSession:project=>createDocumentSession({productMode,initialProject:project}),
    prepare:candidate=>{previousView=map.capturePresentation();return map.setSession(candidate);},
    restore:previous=>previous?map.setSession(previous,{view:previousView}):map.clear() });
  const featureName=feature=>feature.properties?.name || feature.name || feature.id;
  const show=async(feature,options)=>{
    if(opening)return;
    if(!await map.select(feature,options)||opening)return;
    const info=get('viewerInfo');info.replaceChildren();const title=document.createElement('h2');title.textContent=featureName(feature);info.append(title);
    const list=document.createElement('dl');
    for(const [label,value] of [['ID',feature.id],['종류',feature.properties?.entityKind||feature.geometry?.type],['상위 영역',feature.properties?.parentId],['시작',feature.properties?.validFrom],['종료',feature.properties?.validTo],['설명',feature.properties?.notes]]){
      if(value==null||value==='')continue;const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=String(value);list.append(term,detail);
    }info.append(list);surfaces.open('editor',{explicit:true});presentSurfaces();
  };
  map=createViewerMap({element:get('map'),canvas:get('viewerCanvas'),labelLayer:get('viewerLabels'),meta,languages:preferences.labels.place.languages,onSelect:feature=>show(feature).catch(report),onError:report});
  let searchRequest=0;
  const search=async()=>{
    const ticket=++searchRequest;
    const query=get('viewerSearch').value.trim().toLocaleLowerCase(),container=get('viewerResults');container.replaceChildren();
    if(!query||!session.current())return;
    const rows=map.searchItems();
    const append=features=>{for(const feature of features.slice(0,80)){
      const button=document.createElement('button');button.textContent=featureName(feature);button.addEventListener('click',()=>{show(feature,{focus:true}).catch(report);});container.append(button);
    }};
    append(rows.filter(row=>`${featureName(row)} ${row.id}`.toLocaleLowerCase().includes(query)));
    try {const places=await map.searchPlaces(query);if(ticket===searchRequest)append(places);}
    catch(error){if(ticket===searchRequest&&!error.cancelled&&error.code!=='PL-CORE-STALE')throw error;}
  };
  let openRequest=0,opening=false;
  const open=async reader=>{
    const request=++openRequest;
    opening=true;
    status.textContent='지도를 여는 중…';
    status.dataset.ready='false';
    try {
    if(!await session.open(reader))return;
    if(request!==openRequest)return;
    get('viewerMonth').value=session.current().commandOwner.state().timelineCursor;
    for(const input of get('viewerLayers').querySelectorAll('input'))input.checked=map.visibility[input.value];
    for(const input of document.querySelectorAll('[name="viewerTerrain"]'))input.checked=input.value===(map.physicalSettings().terrainVisible?map.physicalSettings().terrainStyle:'none');
    search().catch(report);get('viewerInfo').replaceChildren();status.textContent=`객체 ${map.features().length}개`;status.dataset.ready='true';
    } catch(error){if(request===openRequest)throw error;}
    finally {if(request===openRequest)opening=false;}
  };
  const action=(element,event,task)=>element.addEventListener(event,e=>{Promise.resolve().then(()=>task(e)).catch(report);});
  for(const input of get('viewerLayers').querySelectorAll('[data-viewer-layer]')){
    const key=input.value,target=MAP_DISPLAY_TARGETS[key];
    if(!target)throw new Error(`알 수 없는 표시 항목: ${key}`);
    input.setAttribute('aria-label',`${target.label} 표시`);
    action(input,'change',()=>map.setLayer(key,input.checked));
  }
  for(const input of document.querySelectorAll('[name="viewerTerrain"]'))action(input,'change',()=>map.setTerrain(input.value));
  get('viewerOpen').addEventListener('click',()=>get('viewerFile').click());
  action(get('viewerFile'),'change',async event=>{const file=event.target.files[0];event.target.value='';if(file)await open(()=>readProjectFile(file));});
  action(get('viewerBuiltin'),'click',()=>open(()=>readBuiltinProject(meta)));
  action(get('viewerMonth'),'change',async()=>{
    const current=session.current(),month=get('viewerMonth').value;
    if(opening||!current)return;
    try {await current.commandOwner.setTimelineCursor(month);await map.update();await search();}
    catch(error){if(current===session.current()&&!opening)throw error;}
    finally {if(current===session.current())get('viewerMonth').value=current.commandOwner.state().timelineCursor;}
  });
  for(const [id,kind] of [['viewerGlobe','globe'],['viewerFlat','flat']])action(get(id),'click',()=>{
    map.setProjection(kind);
    for(const [button,value] of [['viewerGlobe','globe'],['viewerFlat','flat']]){
      get(button).setAttribute('aria-pressed',String(kind===value));get(button).classList.toggle('active',kind===value);
    }
  });
  action(get('viewerSearch'),'input',search);
  action(get('viewerZoomIn'),'click',()=>map.zoomBy(1.4));action(get('viewerZoomOut'),'click',()=>map.zoomBy(1/1.4));action(get('viewerFit'),'click',()=>map.fit());
  for(const [surface,trigger,close] of [['search','viewerSearchToggle','viewerSearchClose'],['display','viewerDisplayToggle','viewerDisplayClose']]){
    get(trigger).addEventListener('click',()=>{surfaces.isOpen(surface)?surfaces.close(surface):surfaces.open(surface,{explicit:true});presentSurfaces();if(surface==='search'&&surfaces.isOpen(surface))get('viewerSearch').focus();});
    get(close).addEventListener('click',()=>{surfaces.close(surface);presentSurfaces();get(trigger).focus();});
  }
  get('viewerInfoClose').addEventListener('click',()=>{surfaces.close('editor');presentSurfaces();});
  let fileOpen=false;
  const presentFile=()=>{get('viewerFileMenu').hidden=!fileOpen;get('viewerFileMenu').classList.toggle('mobile-open',fileOpen);get('viewerFileToggle').setAttribute('aria-expanded',String(fileOpen));};
  get('viewerFileToggle').addEventListener('click',()=>{fileOpen=!fileOpen;presentFile();});
  for(const id of ['viewerOpen','viewerBuiltin'])get(id).addEventListener('click',()=>{fileOpen=false;presentFile();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){surfaces.close('search');surfaces.close('display');surfaces.close('editor');presentSurfaces();fileOpen=false;presentFile();}});
  window.addEventListener('resize',presentSurfaces);presentSurfaces();
  globalThis.__PANDOLAB_VIEWER__=Object.freeze({productMode,documentState:()=>session.current()?.commandOwner.state(),
    documentSnapshot:()=>session.current()?.documentModel.snapshot(),selectionSnapshot:()=>session.current()?.commandOwner.selectionSnapshot(),
    rendererStats:()=>map.renderer.getStats(),openFile:file=>open(()=>readProjectFile(file))});
  window.addEventListener('pagehide',()=>{map.dispose();session.dispose();},{once:true});
  await open(()=>readBuiltinProject(meta));
}
