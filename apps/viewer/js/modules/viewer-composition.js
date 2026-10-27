import {createRuntimeContext} from '../../../../shared/frontend/js/modules/runtime-context.js';
import {createBrowserFileAccess} from '../../../../shared/frontend/js/modules/browser-file-access.js';
import {connectMapOwner} from "../../../../shared/frontend/js/modules/map-owner-ports.js";
import {createBrowserProjectStorage} from "../../../../shared/frontend/js/modules/browser-project-storage.js";
import {initialBoundsView} from "../../../../shared/frontend/js/modules/project-setup.js";
import {createNotificationPresentation} from "../../../../shared/frontend/js/modules/notification-presentation.js";
import {createApplicationLifecycle} from "../../../../shared/frontend/js/modules/application-lifecycle.js";
import {createPreferencePresentation} from "../../../../shared/frontend/js/modules/preference-presentation.js";
import {createMapOwners} from "../../../../shared/frontend/js/modules/map-owner-composition.js";
import {saveUserPreferences} from "../../../../shared/frontend/js/modules/user-preferences.js";
import {createDiagnosticLog} from "../../../../shared/frontend/js/modules/reliability-core.js";
import {createNavigationBindings} from "../../../../shared/frontend/js/modules/navigation-bindings.js";
import {createSelectController} from "../../../../shared/frontend/js/modules/select-controller.js";
import { createSelectionUiController } from "../../../../shared/frontend/js/modules/selection-ui-controller.js";
import { createTooltipController } from "../../../../shared/frontend/js/modules/tooltip-controller.js";
import { installTimelineControls } from "../../../../shared/frontend/js/modules/timeline-controls.js";
import { createAppObjectSearchController } from "../../../../shared/frontend/js/modules/object-search-controller.js";
import { createSemanticIcon } from "../../../../shared/frontend/js/modules/icon-utils.js";
import { createEmptyState } from "../../../../shared/frontend/js/modules/empty-state.js";
import { createSelectionDomain } from "../../../../shared/frontend/js/modules/selection-domain.js";
import { coreSelectionRefToWeb,webSelectionRefToCore } from "../../../../shared/frontend/js/modules/core-object-ref.js";
import { createDocumentSession } from "../../../../shared/frontend/js/modules/document-session.js";
import { createProjectDomain } from "../../../../shared/frontend/js/modules/project-domain.js";
import { createInitialDocument } from "../../../../shared/frontend/js/modules/initial-document.js";
import { createViewerMap } from './viewer-map.js';
import { createFileController } from "../../../../shared/frontend/js/modules/file-controller.js";
import { readProjectFile } from "../../../../shared/frontend/js/modules/project-file-reader.js";
import { createMapSettings } from "../../../../shared/frontend/js/modules/app-map-settings.js";
import { layerStyle } from "../../../../shared/frontend/js/modules/layer-presentation.js";
import { DISTRIBUTION_RENDER_MODES } from "../../../../shared/frontend/js/modules/distribution-model.js";
import { createSurfaceController } from "../../../../shared/frontend/js/modules/surface-controller.js";
import { createPreferencesDialog } from "../../../../shared/frontend/js/modules/preferences-dialog.js";
import {createBuiltinMonthClock} from "../../../../shared/frontend/js/modules/builtin-month-clock.js";

export async function composeViewer({ productMode, meta }) {
  const runtimeContext=createRuntimeContext({productMode,meta,assetBaseUrl:new URL('../',import.meta.url)});
  if(productMode!=='viewer')throw new Error('실행 설정이 올바르지 않습니다.');
  const get=id=>document.getElementById(id),status=get('viewerStatus');
  let map,previousView,display,builtinClock,builtinActive=true;
  const preferencePresentation=createPreferencePresentation({document,window,productMode,onChange:change=>{if(map)map.refreshAppearance(change);}});
  const diagnostics=createDiagnosticLog({limit:250});
  const tooltipController=createTooltipController({document,window,tooltip:get('uiTooltip'),clamp:(value,min,max)=>Math.max(min,Math.min(max,value))});
  tooltipController.bind();
  const viewStorage=createBrowserProjectStorage({productMode,indexedDB:window.indexedDB,localStorage:window.localStorage,databaseName:'pandolab-viewer',storeName:'views',viewKey:'active-view'});
  const owners=createMapOwners({productMode,buildMeta:runtimeContext.meta,platform:runtimeContext.platform,onViewingChange:()=>{if(!map)return;const record={documentId:documentSession.documentModel.snapshot().documentId,viewingPresentation:map.capturePresentation(),savedAt:new Date().toISOString()};viewStorage.writeView(record).catch(error=>report(error,'보기 설정을 저장하지 못했습니다.','PL-WORKSPACE-WRITE-001'));syncStatus();},resolveVisibilityGroup:ref=>map.objectQuery.layerGroupForObjectRef(ref),isObjectVisible:(group,id)=>map.objectQuery.objectRefVisible(map.objectQuery.layerItemObjectRef(group,id)),closeActiveOverlay:()=>surfaces.closeMobileSheets()});
  const surfaces=owners.workspaceSurfaces;
  const selectController=createSelectController({document,window});selectController.enhanceAll();
  const notifications=createNotificationPresentation({document,getElement:get,isMobile:()=>surfaces.isMobile()});
  const report=(error,message='작업을 완료하지 못했습니다.',code='PL-MAP-OPERATION')=>notifications.reportOperationError(error,message,code);
  const documentSession=createDocumentSession({productMode,initialProject:createInitialDocument({appVersion:meta.appVersion})});
  await documentSession.commandOwner.load(JSON.stringify(documentSession.documentModel.snapshot()));
  let openingPreserved=null;
  const projectDomain=createProjectDomain({productMode,commandOwner:documentSession.commandOwner,documentModel:documentSession.documentModel,
    readBuiltinSelectionCatalogs:()=>map?[{domain:'placeBuiltin',refs:map.placeSelectionReferences()},{domain:'hydroBuiltin',refs:map.hydroSelectionReferences()}]:[],publishCommand:()=>map.refreshSelection(),
    onProjectReset:async event=>{previousView=map.capturePresentation();await selectionDomain.resetProject(event.generation);selectionUiController.resetProject();map.renderingDomain.resetProjectGeneration(event.generation);},
    replaceSnapshot:async()=>{await map.setSession(activeSession,{prepareView:async()=>{
      const project=activeSession.documentModel.snapshot(),bounds=project.projectSetup.initialMapBounds;
      if(openingPreserved)map.projectSession.restoreViewingPresentation({documentId:project.documentId,viewingPresentation:openingPreserved});
      else {
        const initial=initialBoundsView(bounds,map.mapProjection.projectionLayoutMetrics(),'globe');
        map.viewState.projection=initial.projection;map.viewState.view=initial.view;
        let workspace=null;
        try{workspace=await viewStorage.readView(project.documentId);}catch(error){report(error,'보기 설정을 복원하지 못했습니다.','PL-WORKSPACE-READ-001');}
        map.projectSession.restoreViewingPresentation(workspace);
      }
      await map.loadPhysicalLandMask();
      map.loadPhysicalResources();
      if(!openingPreserved&&!bounds&&map.features().length)map.navigation.fitMapToFeature({type:'FeatureCollection',features:map.features()});
    }});return true;},
    restoreReplacement:()=>map.setSession(activeSession,{view:previousView})});
  let selectionUiController;
  const selectionDomain=createSelectionDomain({commandOwner:documentSession.commandOwner,projectDomain,
    refAdapter:{fromCore:coreSelectionRefToWeb,toCore:ref=>webSelectionRefToCore(ref,{isStoredHydro:id=>documentSession.documentModel.get({domain:'hydro',id})!==null})},
    onSelectionChanged:snapshot=>selectionUiController.sync(snapshot),
    onHoverChanged:snapshot=>tooltipController.setMapHover(snapshot.hover?map.objectQuery.objectDisplayInfo(snapshot.hover):null),
    requestRender:()=>map.refreshSelection()});
  const selectionStatus=get('viewerSelectionStatus');
  selectionUiController=createSelectionUiController({window,document,selectionDomain,elements:{selectionStatus},
    resolveRef:value=>value,refExists:ref=>map.objectQuery.objectRefExists(ref),displayInfo:ref=>map.objectQuery.objectDisplayInfo(ref),
    presenters:{default:ref=>{selectionStatus.textContent=map.objectQuery.objectDisplayInfo(ref).name;}},
    uiActions:{closeChooser:()=>map.closeObjectChooser(),clearPresenter:()=>{selectionStatus.textContent='';},syncLayerRows:()=>searchController.syncSelection()}});
  const activeSession=Object.freeze({...documentSession,projectDomain,selectionDomain,selectionUiController});
  connectMapOwner('workspaceSurfaces',surfaces,{platform:{$:id=>get(id==='app'?'viewer':id)},projectState:{get state(){return map.viewState;}},
    uiFactoriesB:{createSurfaceController},domains:{get objectSearchController(){return searchController;}},
    mapHostViewB:{queueMapResize:()=>{owners.mapHost.queueMapResize('panel-layout');}},
    platformConfigurationB:{selectController},get mapNavigation(){return map.navigation;}});
  surfaces.initializeWorkspaceSurfaces();
  map=createViewerMap({owners,runtimeContext,element:get('map'),canvas:get('viewerCanvas'),labelLayer:get('viewerLabels'),projectDomain,documentSession:activeSession,isMobile:()=>surfaces.isMobile(),diagnostics,getInteractionStyle:()=>preferencePresentation.interactionStyle,onStatus:notifications.setActionStatus,isSafeKoreanErrorMessage:notifications.isSafeKoreanErrorMessage,getPreferences:()=>preferencePresentation.current,onPlacesSettled:action=>{if(action==='cancel')searchController.cancelSearch();else searchController.render();},onError:report});
  const searchController=createAppObjectSearchController({window,document,getElement:get,state:map.viewState,
    objectSearchGroupKeys:map.objectPresentation.LAYER_SEARCH_GROUP_KEYS,listObjectSearchItems:map.objectCatalog.listObjectSearchItems,
    layerItemObjectRef:map.objectQuery.layerItemObjectRef,selectionDomain,
    isSearchOpen:()=>surfaces.surfaceController.isOpen('search')&&map.searchActive(),isSearchSurfaceOpen:()=>surfaces.surfaceController.isOpen('search'),
    createIcon:(name,className)=>createSemanticIcon(document,name,className),createEmptyState:createEmptyState.bind(null,document),
    onSearchError:report,cancelBuiltinSearch:()=>map.cancelSearch(),builtinSearch:value=>map.searchPlaces(value),
    invalidateObjectPresentation:map.objectCatalog.invalidateObjectPresentation,
    selectObjectSearchItem:map.navigation.selectObjectSearchItem,focusObjectRef:map.objectQuery.focusObjectRef,
    closeSearchAfterSingleSelection:()=>surfaces.closeSurface('search')});
  searchController.bind();surfaces.applyLayoutMode({initial:true});
  map.refreshAppearance({rerender:false});
  // Background assets are global; hydro identities must wait for the Core
  // replacement below. The resource owner handles errors and shared requests.
  map.loadPhysicalResources({includeHydro:false});
  const syncStatus=()=>{if(map&&!projectDomain.isOpening())selectionUiController.syncNow(null,{force:true});};
  const search=()=>{map.objectCatalog.invalidateObjectPresentation();searchController.render();};
  const disposeTimeline=installTimelineControls({document,window,getMonth:()=>activeSession?.commandOwner.state().timelineCursor,
    setMonth:async month=>{
      if(builtinActive){await builtinClock.selectMonth(month);return;}
      const current=activeSession;if(projectDomain.isOpening()||!current)throw new Error('지도를 여는 중입니다.');
      try {await current.commandOwner.setTimelineCursor(month);await map.update();search();syncStatus();}
      catch(error){if(current===activeSession&&!projectDomain.isOpening())throw error;}
    },
  });
  const open=async (reader,options)=>{
    const preserved=options?.preserveView?map.capturePresentation():null;
    openingPreserved=preserved;
    const request=projectDomain.getOpenRevision()+1;
    status.textContent='지도 불러오는 중…';status.hidden=false;
    status.dataset.ready='false';
    try {
    if(!await projectDomain.open(reader,options))return;
    if(request!==projectDomain.getOpenRevision())return;
    await map.loadPhysicalLandMask();
    await map.objectCatalog.pruneLayerItemVisibility();
    await map.update();
    window.dispatchEvent(new CustomEvent('pandolab:project-changed'));
    await searchController.completeHydration();
    if(request!==projectDomain.getOpenRevision())return;
    map.loadPhysicalResources();
    search();surfaces.syncOverlayState();syncStatus();status.dataset.ready='true';status.hidden=true;
    return true;
    } catch(error){if(request===projectDomain.getOpenRevision()){
      status.dataset.ready='true';status.hidden=true;throw error;
    }}
  };
  const action=(element,event,task)=>element.addEventListener(event,e=>{Promise.resolve().then(()=>task(e)).catch(report);});
  builtinClock=createBuiltinMonthClock({window,document,applyMonth:(month,{isCurrent})=>open(()=>map.prepareBuiltinProject(month,{isCurrent}),{source:'builtin',preserveView:builtinClock.month()!==null}),onCommitted:()=>{builtinActive=true;syncStatus();},onError:report});
  const openUserProject=async(reader,options)=>{
    const previous=builtinActive,resume=builtinClock.suspend();builtinActive=false;
    try {const result=await open(reader,options);if(!result&&resume())builtinActive=previous;return result;}
    catch(error){if(resume())builtinActive=previous;throw error;}
  };
  const fileElements={projectOpen:get('openProjectBtn'),projectInput:get('projectFileInput')};
  const files=createFileController({productMode,elements:fileElements,fileAccess:createBrowserFileAccess({productMode,elements:fileElements,window,document}),projectDomain,openProject:openUserProject,reportOperationError:report,window,document});
  files.bind();action(get('openProjectBtn'),'click',()=>files.openProjectPicker());
  action(get('builtinMapBtn'),'click',()=>builtinClock.followNow());
  display=createMapSettings({capabilities:owners.capabilities,viewPresentation:map,onLayerVisibilityChange:async(key,enabled)=>{if(enabled&&(key==='rivers'||key==='lakes'))await owners.physicalResources.loadHydroData(true);if(enabled&&key==='labels')await owners.territorialLabels.preparePlaces({force:true});}});
  display.connect({
    platform:{$:id=>get(id==='app'?'viewer':id),deepClone:structuredClone,clamp:(value,min,max)=>Math.max(min,Math.min(max,value))},
    navigation:map.navigation,domains:{renderingDomain:map.renderingDomain,objectSearchController:searchController},rendering:{gpuMapRenderer:map.renderer},objectDisplay:map.objectCatalog,distributionPresentation:map.distributionPresentation,feedback:{reportOperationError:report},
    projectState:{get state(){return map.displayState();}},
    objectModelA:{expandedMapDisplayGroups:map.objectPresentation.expandedMapDisplayGroups},territorialModel:{entityRepository:map.entityRepository},
    applicationServicesB:{layerStyle},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
    preferences:{saveUserPreferences,get userPreferences(){return preferencePresentation.current;},setUserPreferences:value=>{preferencePresentation.current=value;}},
    hydroModel:owners.hydroSettings,
    workspaceUiA:surfaces,workspaceUiB:surfaces,
  });
  display.initializeLAYER_STYLE_TARGETS();
  const navigationBindings=createNavigationBindings({productMode});
  navigationBindings.connect({platform:{$:get},workspaceUiA:surfaces,workspaceUiB:surfaces,workspaceUiC:surfaces,surfaces,
    mapSettingsUi:display,navigation:map.navigation,projectState:{state:map.viewState},objectPicking:map.objectPicking,
    readinessUi:notifications});
  navigationBindings.bindNavigationUI();
  for(const id of ['openProjectBtn','builtinMapBtn'])get(id).addEventListener('click',()=>surfaces.closeFileMenu());
  createPreferencesDialog({document,productMode,returnFocus:()=>get(surfaces.isMobile()?'mobileMenuBtn':'preferencesBtn'),getPreferences:()=>preferencePresentation.current,
    applyPreferences:value=>preferencePresentation.apply(value,{persist:false}),beforeOpen:()=>surfaces.closeFileMenu()});
  if(new URLSearchParams(window.location.search).get('debug')==='1')globalThis.__PANDOLAB_VIEWER__=Object.freeze({productMode,documentState:()=>activeSession?.commandOwner.state(),
    documentSnapshot:()=>activeSession?.documentModel.snapshot(),selectionSnapshot:()=>activeSession?.selectionDomain.snapshot().selection,
    diagnostics:diagnostics.snapshot,rendererStats:()=>map.renderer.getStats(),visibleTerritorialCount:()=>map.objectQuery.visibleTerritorialCount(),
    openFile:file=>openUserProject(()=>readProjectFile(file)),builtinMonth:()=>({month:builtinClock.month(),automatic:builtinClock.isAutomatic()})});
  const lifecycle=createApplicationLifecycle({window,startup:()=>builtinClock.followNow(),
    getDisposables:()=>[files,builtinClock,{dispose:disposeTimeline},preferencePresentation,surfaces,notifications,searchController,map,selectionUiController,selectionDomain,projectDomain,documentSession.commandOwner],
    onError:error=>{status.hidden=true;report(error,'지도를 불러오지 못했습니다.','PL-MAP-START');},reportDisposeError:error=>console.error('[PL-DISPOSE]',error)});
  await lifecycle.start();
}
