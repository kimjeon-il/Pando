import { createMobileSheetPresentation } from './mobile-sheet-presentation.js';
import { presentObjectHeading } from './object-property-presentation.js';
import { resolveMapInteractionStyle } from './map-interaction-style.js';
import { installTimelineControls } from './timeline-controls.js';
import { createObjectSearchController } from './object-search-controller.js';
import { createSearchToolbarPresentation } from './search-toolbar-presentation.js';
import { normalizeObjectRef } from './object-selection-controller.js';
import { createSemanticIcon } from './icon-utils.js';
import { createEmptyState } from './empty-state.js';
import { effectiveTerritorialFlagUrl } from './country-flags.js';
import { createDocumentSession } from './document-session.js';
import { createViewerSession } from './viewer-session.js';
import { createViewerMap } from './viewer-map.js';
import { readBuiltinProject, readProjectFile } from './viewer-project-reader.js';
import { createMapSettings } from './app-map-settings.js';
import { layerStyle } from './layer-presentation.js';
import { DISTRIBUTION_RENDER_MODES } from './distribution-model.js';
import { createSurfaceController } from './surface-controller.js';
import { loadUserPreferences, saveUserPreferences } from './user-preferences.js';
import { createPreferencesDialog } from './preferences-dialog.js';
import { applyAppAccent } from './app-accent.js';
import { positionRootMenu } from './menu-presentation.js';

export async function composeViewer({ productMode, meta }) {
  if(productMode!=='viewer'||!meta?.assetRevision)throw new Error('실행 설정이 올바르지 않습니다.');
  const get=id=>document.getElementById(id),status=get('viewerStatus');
  let preferences=loadUserPreferences(),map,previousView,display,searchPresentation,mobileSheets;
  const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme=()=>{
    const root=document.documentElement;
    root.dataset.theme=preferences.appearance.theme==='system'?(systemTheme.matches?'dark':'light'):preferences.appearance.theme;
    root.dataset.statusBarVisible=String(preferences.appearance.statusBarVisible);
    root.dataset.smoothLines=String(preferences.appearance.smoothLines);
    get('mapBottomStatus').hidden=!preferences.appearance.statusBarVisible;
    const accent=applyAppAccent(document,preferences.appearance.accentPreset);
    if(map)map.refreshAppearance(resolveMapInteractionStyle({theme:root.dataset.theme,
      selectionColor:preferences.selection.color||accent,outlineVisible:preferences.selection.outlineVisible,
      fillStrength:preferences.selection.fillStrength,antiAlias:preferences.appearance.smoothLines,
      tokens:{accent,textStrong:getComputedStyle(root).getPropertyValue('--text-strong').trim()}}));
  };
  applyTheme();systemTheme.addEventListener('change',applyTheme);
  const surfaceIds={objectSearchSurface:'objectSearchSurface',mapDisplaySurface:'mapDisplaySurface',editorSurface:'viewerInfoPanel',
    objectSearchBtn:'objectSearchBtn',mapDisplayBtn:'mapDisplayBtn'};
  const surfaces=createSurfaceController({getElement:id=>get(surfaceIds[id]||id),getLayout:()=>window.innerWidth<800?'mobile':window.innerWidth>=1280?'wide':'compact',document});
  const presentSurfaces=()=>{
    const layout=window.innerWidth<800?'mobile':window.innerWidth>=1280?'wide':'compact';
    get('viewer').dataset.layout=layout;document.body.dataset.layout=layout;
    surfaces.render();
    if(searchPresentation)searchPresentation.sync();
    if(mobileSheets)for(const id of ['objectSearchSurface','mapDisplaySurface','viewerInfoPanel']){
      const panel=get(id);if(layout==='mobile')mobileSheets.setMobileSheetHeight(panel,mobileSheets.snapIndex.get(id)??1);
      else {panel.style.removeProperty('--sheet-height');panel.removeAttribute('data-sheet-snap');}
    }
    for(const [surface,id] of [['search','objectSearchSurface'],['display','mapDisplaySurface'],['editor','viewerInfoPanel']])get(id).hidden=!surfaces.isOpen(surface);
  };
  const report=error=>{console.error('[PL-VIEWER-OPERATION]',error);status.textContent=`작업을 완료하지 못했습니다. ${error.message}`;};
  const session=createViewerSession({createSession:project=>createDocumentSession({productMode,initialProject:project}),
    prepare:candidate=>{previousView=map.capturePresentation();return map.setSession(candidate);},
    restore:previous=>previous?map.setSession(previous,{view:previousView}):map.clear() });
  const featureName=feature=>feature.properties?.name || feature.name || feature.id;
  const show=async(feature,options)=>{
    if(opening)return;
    if(!await map.select(feature,options)||opening)return;
    const properties=feature.properties||{};
    const type=properties.entityKind?'entity':feature.group==='labels'?'label':feature.group==='distributions'?'distribution':feature.group==='hydro'||feature.selectionRef?.domain==='hydroBuiltin'?'hydro':'generic';
    presentObjectHeading({document,getElement:get,type,title:featureName(feature),
      typeLabel:type==='hydro'?(properties.category==='lake'?'호수':'강'):''});
    const list=get('viewerInfoRows');list.replaceChildren();
    const parent=properties.parentId?map.entityRepository.get(properties.parentId):null;
    for(const [label,value] of [['ID',feature.id],['상위 영역',parent?.properties.name||properties.parentId],['시작',properties.validFrom],['종료',properties.validTo],['설명',properties.notes]]){
      if(value==null||value==='')continue;
      const row=document.createElement('div'),term=document.createElement('span'),detail=document.createElement('strong');
      term.textContent=label;detail.textContent=String(value);row.append(term,detail);list.append(row);
    }
    surfaces.open('editor',{explicit:true});presentSurfaces();searchController.syncSelection();
  };
  map=createViewerMap({element:get('map'),canvas:get('viewerCanvas'),labelLayer:get('viewerLabels'),meta,languages:preferences.labels.place.languages,onSelect:feature=>show(feature).catch(report),onError:report});
  applyTheme();
  let query='', searchRevision=0;
  const searchFeature=(group,id)=>map.searchItems().find(feature=>feature.group===group&&String(feature.id)===String(id))||(group==='labels'?map.resolvePlace(id):null);
  const searchRef=feature=>{
    const [domain,type,...id]=(feature.objectKey||`territorial:entity:${feature.id}`).split(':');
    return normalizeObjectRef({domain:domain==='placeBuiltin'?'label':domain,type,id:id.join(':')});
  };
  const choose=(group,id,focus=false)=>{
    const feature=searchFeature(group,id);
    if(feature)show(feature,{focus}).then(()=>searchController.syncSelection()).catch(report);
  };
  const searchController=createObjectSearchController({window,document,
    elements:{search:get('objectSearchInput'),searchClear:get('objectSearchClearBtn'),searchResults:get('objectSearchResults'),section:get('objectSearchSection')},
    groups:{search:['countries','subunits','regions','hydro','labels','genericFeatures','distributions']},
    createIcon:(name,className)=>createSemanticIcon(document,name,className),createEmptyState:createEmptyState.bind(null,document),
    onSearchError:report,cancelBuiltinSearch:()=>map.cancelSearch(),
    builtinSearch:async value=>{const result=await map.searchPlaces(value);return {...result,records:result.records.map(feature=>({...feature.place,name:featureName(feature)}))};},
    model:{snapshot:()=>({revision:searchRevision,search:query,searchActive:surfaces.isOpen('search'),searchSurfaceOpen:surfaces.isOpen('search')}),
      items:group=>map.searchItems().filter(feature=>feature.group===group).map(feature=>({id:feature.id,name:featureName(feature),
        layerGroup:group,hydroCategory:feature.properties.category,parentId:feature.properties.parentId,
        ...(feature.properties.entityKind?{flagUrl:effectiveTerritorialFlagUrl(feature,{assetRevision:meta.assetRevision})}:{})})),
      itemRef:(group,id)=>searchRef(searchFeature(group,id)),compare:(a,b)=>a.name.localeCompare(b.name,'ko'),
      selectionSnapshot:()=>{const feature=map.selectedFeature();
        const refs=feature?[searchRef(feature)]:[];
        return {selection:{items:refs,primaryKey:refs[0]?.key}};},
    },
    commands:{setSearchValue:value=>{query=value;get('objectSearchClearBtn').classList.toggle('hidden',!value);},
      selectItem:({group,id})=>{choose(group,id);return false;},focusItem:(group,id)=>choose(group,id,true),clearSearchHover:()=>{},
    },
  });
  searchController.bind();
  const search=()=>{searchRevision++;searchController.cancelSearch();searchController.render(true);};
  searchPresentation=createSearchToolbarPresentation({document,panel:get('objectSearchSurface'),toolbar:document.querySelector('.map-command-toolbar'),
    slot:document.querySelector('.map-command-search'),results:get('objectSearchResults'),isOpen:()=>surfaces.isOpen('search'),isMobile:()=>window.innerWidth<800,
    schedulePosition:()=>requestAnimationFrame(()=>searchPresentation.position())});
  const disposeTimeline=installTimelineControls({document,window,getMonth:()=>session.current()?.commandOwner.state().timelineCursor,
    setMonth:async month=>{
      const current=session.current();if(opening||!current)throw new Error('지도를 여는 중입니다.');
      try {await current.commandOwner.setTimelineCursor(month);await map.update();search();}
      catch(error){if(current===session.current()&&!opening)throw error;}
    },
  });
  let openRequest=0,opening=false;
  const open=async reader=>{
    const request=++openRequest;
    opening=true;
    status.textContent='지도를 여는 중…';
    status.dataset.ready='false';
    try {
    if(!await session.open(reader))return;
    if(request!==openRequest)return;
    window.dispatchEvent(new CustomEvent('pandolab:project-changed'));
    await searchController.completeHydration();
    display.renderMapDisplaySettings();
    search();get('viewerInfoRows').replaceChildren();presentObjectHeading({document,getElement:get,type:null});surfaces.close('editor');presentSurfaces();status.textContent=`객체 ${map.features().length}개`;status.dataset.ready='true';
    } catch(error){if(request===openRequest)throw error;}
    finally {if(request===openRequest)opening=false;}
  };
  const action=(element,event,task)=>element.addEventListener(event,e=>{Promise.resolve().then(()=>task(e)).catch(report);});
  get('viewerOpen').addEventListener('click',()=>get('viewerFile').click());
  action(get('viewerFile'),'change',async event=>{const file=event.target.files[0];event.target.value='';if(file)await open(()=>readProjectFile(file));});
  action(get('viewerBuiltin'),'click',()=>open(()=>readBuiltinProject(meta)));
  for(const [id,kind] of [['globeBtn','globe'],['flatBtn','flat']])action(get(id),'click',()=>display.setProjection(kind));
  action(get('viewerZoomIn'),'click',()=>map.zoomBy(1.4));action(get('viewerZoomOut'),'click',()=>map.zoomBy(1/1.4));action(get('viewerFit'),'click',()=>map.fit());
  for(const [surface,trigger,close] of [['search','objectSearchBtn','objectSearchCloseBtn'],['display','mapDisplayBtn','mapDisplayCloseBtn']]){
    get(trigger).addEventListener('click',()=>{surfaces.isOpen(surface)?surfaces.close(surface):surfaces.open(surface,{explicit:true});presentSurfaces();if(surface==='search'){if(surfaces.isOpen(surface)){search();get('objectSearchInput').focus();}else searchController.cancelSearch();}});
    get(close).addEventListener('click',()=>{surfaces.close(surface);presentSurfaces();get(trigger).focus();});
  }
  get('viewerInfoClose').addEventListener('click',()=>{surfaces.close('editor');presentSurfaces();});
  let mobileMenuOpen=false;
  const closeMobileMenu=()=>{mobileMenuOpen=false;get('mobileGlobalMenu').hidden=true;get('mobileMenuBtn').setAttribute('aria-expanded','false');};
  get('mobileMenuBtn').addEventListener('click',()=>{mobileMenuOpen=!mobileMenuOpen;get('mobileGlobalMenu').hidden=!mobileMenuOpen;get('mobileMenuBtn').setAttribute('aria-expanded',String(mobileMenuOpen));if(mobileMenuOpen)positionRootMenu({menu:get('mobileGlobalMenu'),trigger:get('mobileMenuBtn')});});
  for(const [id,target]of [['mobileMenuFileBtn','viewerFileToggle'],['mobileDisplayBtn','mapDisplayBtn'],['mobilePreferencesBtn','preferencesBtn']])get(id).addEventListener('click',()=>{closeMobileMenu();get(target).click();});
  document.addEventListener('pointerdown',event=>{if(!get('mobileGlobalMenu').contains(event.target)&&!get('mobileMenuBtn').contains(event.target))closeMobileMenu();});
  let fileOpen=false;
  const presentFile=()=>{get('viewerFileMenu').hidden=!fileOpen;get('viewerFileMenu').classList.toggle('mobile-open',fileOpen);get('viewerFileToggle').setAttribute('aria-expanded',String(fileOpen));};
  get('viewerFileToggle').addEventListener('click',()=>{fileOpen=!fileOpen;presentFile();});
  for(const id of ['viewerOpen','viewerBuiltin'])get(id).addEventListener('click',()=>{fileOpen=false;presentFile();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMobileMenu();surfaces.close('search');surfaces.close('display');surfaces.close('editor');presentSurfaces();fileOpen=false;presentFile();}});
  mobileSheets=createMobileSheetPresentation({document,window,getElement:get,getLayout:()=>get('viewer').dataset.layout,
    panelIds:{search:'objectSearchSurface',display:'mapDisplaySurface',edit:'viewerInfoPanel'},onSync:presentSurfaces,
    onClose:()=>{for(const name of ['search','display','editor'])surfaces.close(name);presentSurfaces();},
    onResumeLayout:presentSurfaces,onLayoutChange:()=>{},
  });
  for(const id of ['objectSearchSurface','mapDisplaySurface','viewerInfoPanel'])mobileSheets.bindMobileSheetSurface(get(id));
  window.visualViewport?.addEventListener('resize',presentSurfaces);
  window.addEventListener('resize',presentSurfaces);presentSurfaces();
  display=createMapSettings({viewPresentation:map});
  display.connect({
    platform:{$:id=>get(id==='app'?'viewer':id)},feedback:{reportOperationError:report},
    projectState:{get state(){return map.displayState();}},
    objectModelA:{expandedMapDisplayGroups:new Set()},territorialModel:{entityRepository:map.entityRepository},
    applicationServicesB:{layerStyle},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
    preferences:{get userPreferences(){return preferences;},saveUserPreferences,setUserPreferences:value=>{preferences=value;}},
    readinessUi:{syncStatusBar:()=>{}},
    hydroModel:{syncRangeProgress:input=>input.style.setProperty('--range-progress',`${input.value}%`),
      syncPhysicalControls:()=>{const physical=map.physicalSettings();for(const input of document.querySelectorAll('[name="terrainStyle"]'))input.checked=input.value===(physical.terrainVisible?physical.terrainStyle:'none');}},
    workspaceUiA:{closeSurface:(name)=>{surfaces.close(name);presentSurfaces();}},
  });
  display.initializeLAYER_STYLE_TARGETS();
  createPreferencesDialog({document,returnFocus:()=>get(window.innerWidth<800?'mobileMenuBtn':'preferencesBtn'),getPreferences:()=>preferences,
    applyPreferences:value=>{preferences=value;applyTheme();},
    beforeOpen:()=>{fileOpen=false;presentFile();},
  });
  globalThis.__PANDOLAB_VIEWER__=Object.freeze({productMode,documentState:()=>session.current()?.commandOwner.state(),
    documentSnapshot:()=>session.current()?.documentModel.snapshot(),selectionSnapshot:()=>session.current()?.commandOwner.selectionSnapshot(),
    presentationState:()=>map.capturePresentation(),rendererStats:()=>map.renderer.getStats(),openFile:file=>open(()=>readProjectFile(file))});
  window.addEventListener('pagehide',()=>{disposeTimeline();mobileSheets.dispose();searchController.dispose();map.dispose();session.dispose();},{once:true});
  await open(()=>readBuiltinProject(meta));
  display.bindMapDisplayUI();
}
