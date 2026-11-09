import {presentViewerLoadStatus} from "./viewer-load-status.js";
import {createRuntimeContext} from "../runtime/runtime-context.js";
import {createPlatformPorts} from "../runtime/platform-ports.js";
import {createBrowserFileAccess} from "../data/browser-file-access.js";
import {connectMapOwner} from "./map-owner-ports.js";
import {createBrowserProjectStorage} from "../data/browser-project-storage.js";
import {initialBoundsView} from "../document/project-setup.js";
import {createNotificationPresentation} from "../ui/notification-presentation.js";
import {createApplicationLifecycle} from "./application-lifecycle.js";
import {createPreferencePresentation} from "../ui/preference-presentation.js";
import {createMapOwners} from "./map-owner-composition.js";
import {saveUserPreferences} from "../ui/user-preferences.js";
import {createDiagnosticLog,isRecoverableLoadError} from "../runtime/reliability-core.js";
import {createNavigationBindings} from "../ui/navigation-bindings.js";
import {createSelectController} from "../ui/select-controller.js";
import { createSelectionUiController } from "../ui/selection-ui-controller.js";
import { createTooltipController } from "../ui/tooltip-controller.js";
import { installTimelineControls } from "../ui/timeline-controls.js";
import { createAppObjectSearchController } from "../ui/object-search-controller.js";
import { createSemanticIcon } from "../ui/icon-utils.js";
import { createEmptyState } from "../ui/empty-state.js";
import { createSelectionDomain } from "../document/selection-domain.js";
import { coreSelectionRefToWeb,webSelectionRefToCore } from "../document/core-object-ref.js";
import { createDocumentSession } from "../document/document-session.js";
import { createProjectDomain } from "../document/project-domain.js";
import {bindProjectDocumentIdentity} from '../data/map-project-identity.js';
import { createInitialDocument } from "../document/initial-document.js";
import { createViewerMap } from "./viewer-map.js";
import {createViewerInitialPresentation} from "./viewer-initial-presentation.js";
import {createViewerPostPresentation} from "./viewer-post-presentation.js";
import {createViewerInspectorController} from "../ui/inspector/viewer-inspector-controller.js";
import { createFileController } from "../ui/file-controller.js";
import { readProjectFile } from "../data/project-file-reader.js";
import {createProjectReader} from "../data/project-open-adapter.js";
import { createMapSettings } from "../ui/app-map-settings.js";
import { layerStyle } from "../ui/layer-presentation.js";
import { DISTRIBUTION_RENDER_MODES } from "../document/distribution-model.js";
import { createSurfaceController } from "../ui/surface-controller.js";
import { createPreferencesDialog } from "../ui/preferences-dialog.js";
import {createBuiltinMonthClock} from "../document/builtin-month-clock.js";
import {territorialMembershipDelta} from "../document/territorial-entity-store.js";

export async function composeViewer({ productMode, meta }) {
  const runtimeContext=createRuntimeContext({productMode,meta,assetBaseUrl:new URL('../',import.meta.url),platform:createPlatformPorts({kind:'browser'})});
  if(productMode!=='viewer')throw new Error('실행 설정이 올바르지 않습니다.');
  const projection='globe';
  const get=id=>document.getElementById(id),status=get('viewerStatus');
  let map,previousView,display,builtinClock,syncStatus,builtinActive=true;
  const inspectParams=new URLSearchParams(window.location.search);
  let inspectorController=null;
  const initialPresentation=createViewerInitialPresentation({onPresented:()=>{get('viewer').dataset.initialLoading='false';map.finishInitialPreview();}});
  get('viewer').dataset.initialLoading='true';
  const preferencePresentation=createPreferencePresentation({document,window,productMode,onChange:change=>{if(map)map.refreshAppearance(change);}});
  const diagnostics=createDiagnosticLog({limit:250});
  const tooltipController=createTooltipController({document,window,tooltip:get('uiTooltip'),clamp:(value,min,max)=>Math.max(min,Math.min(max,value))});
  tooltipController.bind();
  const viewStorage=createBrowserProjectStorage({productMode,indexedDB:window.indexedDB,databaseName:'pandolab-viewer',storeName:'views',viewKey:'active-view'});
  const owners=createMapOwners({productMode,readOnly:true,projection,buildMeta:runtimeContext.meta,platform:runtimeContext.platform,onViewingChange:()=>{if(!map)return;const record={documentId:documentSession.documentModel.snapshot().documentId,viewingPresentation:map.capturePresentation(),savedAt:new Date().toISOString()};viewStorage.writeView(record).catch(error=>report(error,'보기 설정을 저장하지 못했습니다.','PL-WORKSPACE-WRITE-001'));syncStatus();},resolveVisibilityGroup:ref=>map.objectQuery.layerGroupForObjectRef(ref),isObjectVisible:(group,id)=>map.objectQuery.objectRefVisible(map.objectQuery.layerItemObjectRef(group,id)),closeActiveOverlay:()=>surfaces.closeMobileSheets()});
  const surfaces=owners.workspaceSurfaces;
  const selectController=createSelectController({document,window});selectController.enhanceAll();
  const notifications=createNotificationPresentation({document,getElement:get,isMobile:()=>surfaces.isMobile(),protectErrorNotices:true});
  const report=(error,message='작업을 완료하지 못했습니다.',code='PL-MAP-OPERATION')=>notifications.reportOperationError(error,message,code);
  const documentSession=createDocumentSession({productMode,readOnly:true,initialProject:createInitialDocument({appVersion:meta.appVersion})});
  const disposables=[tooltipController,selectController,preferencePresentation,surfaces,notifications,documentSession.commandOwner,initialPresentation];
  async function composeMap() {
  let openingPreserved=null;
  const projectDomain=createProjectDomain({productMode,readOnly:true,commandOwner:documentSession.commandOwner,documentModel:documentSession.documentModel,
    admitImportedProject:project=>bindProjectDocumentIdentity(project,runtimeContext.meta),
    readBuiltinSelectionCatalogs:()=>map?[{domain:'placeBuiltin',refs:map.placeSelectionReferences()},{domain:'hydroBuiltin',refs:map.hydroSelectionReferences()}]:[],publishCommand:()=>map.refreshSelection(),
    onProjectReset:async event=>{postPresentation.invalidate();searchController.cancelSearch();previousView=map.capturePresentation();await selectionDomain.resetProject(event.generation);selectionUiController.resetProject();map.renderingDomain.resetProjectGeneration(event.generation,{presentation:event.presentation,isCurrent:event.isCurrent,onPresented:event.onPresented});},
    replaceSnapshot:async(_document,{contentProject=null}={})=>{await map.setSession(activeSession,{contentProject,prepareView:async()=>{
      const project=activeSession.documentModel.snapshot(),bounds=project.projectSetup.initialMapBounds;
      if(openingPreserved)map.projectSession.restoreViewingPresentation({documentId:project.documentId,viewingPresentation:openingPreserved});
      else {
        const initial=initialBoundsView(bounds,map.mapProjection.projectionLayoutMetrics(),projection);
        map.viewState.projection=initial.projection;map.viewState.view=initial.view;
        let workspace=null;
        try{workspace=await viewStorage.readView(project.documentId);}catch(error){report(error,'보기 설정을 복원하지 못했습니다.','PL-WORKSPACE-READ-001');}
        map.projectSession.restoreViewingPresentation(workspace);
      }
      await map.loadPhysicalLandMask();
      map.loadPhysicalResources();
      if(!openingPreserved&&!bounds&&map.features().length)map.navigation.fitMapToFeature({type:'FeatureCollection',features:map.features()});
    }});await map.renderer.waitForTemporalPresentation();return true;},
    restoreReplacement:async()=>{await map.setSession(activeSession,{contentProject:projectDomain.activeContentProject(),view:previousView});await map.renderer.waitForTemporalPresentation();}});
  disposables.push(projectDomain);
  let selectionUiController;
  const selectionDomain=createSelectionDomain({commandOwner:documentSession.commandOwner,projectDomain,
    refAdapter:{fromCore:coreSelectionRefToWeb,toCore:ref=>webSelectionRefToCore(ref,{isStoredHydro:id=>documentSession.documentModel.get({domain:'hydro',id})!==null})},
    onSelectionChanged:snapshot=>{selectionUiController.sync(snapshot);inspectorController?.syncMapSelection(snapshot);},
    onHoverChanged:snapshot=>tooltipController.setMapHover(snapshot.hover?map.objectQuery.objectDisplayInfo(snapshot.hover):null),
    requestRender:()=>map.refreshSelection()});
  disposables.push(selectionDomain);
  const selectionStatus=get('viewerSelectionStatus');
  selectionUiController=createSelectionUiController({window,document,selectionDomain,elements:{selectionStatus},
    resolveRef:value=>value,refExists:ref=>map.objectQuery.objectRefExists(ref),displayInfo:ref=>map.objectQuery.objectDisplayInfo(ref),
    presenters:{default:ref=>{selectionStatus.textContent=map.objectQuery.objectDisplayInfo(ref).name;}},
    uiActions:{closeChooser:()=>map.closeObjectChooser(),clearPresenter:()=>{selectionStatus.textContent='';},syncLayerRows:()=>searchController.syncSelection()}});
  disposables.push(selectionUiController);
  const activeSession=Object.freeze({...documentSession,projectDomain,selectionDomain,selectionUiController});
  connectMapOwner('workspaceSurfaces',surfaces,{platform:{$:id=>get(id==='app'?'viewer':id)},projectState:{get state(){return map.viewState;}},
    uiFactoriesB:{createSurfaceController},domains:{get objectSearchController(){return searchController;}},
    mapHostViewB:{queueMapResize:()=>{owners.mapHost.queueMapResize('panel-layout');}},
    platformConfigurationB:{selectController},get mapNavigation(){return map.navigation;}});
  surfaces.initializeWorkspaceSurfaces();
  map=createViewerMap({owners,runtimeContext,element:get('map'),canvas:get('viewerCanvas'),labelLayer:get('viewerLabels'),projectDomain,documentSession:activeSession,isMobile:()=>surfaces.isMobile(),diagnostics,getInteractionStyle:()=>preferencePresentation.interactionStyle,onStatus:notifications.setActionStatus,isSafeKoreanErrorMessage:notifications.isSafeKoreanErrorMessage,getPreferences:()=>preferencePresentation.current,onPlacesSettled:action=>{if(action==='cancel')searchController.cancelSearch();else searchController.render();},onError:report,
    onMapPreparationStatus:initialPresentation.observe,isInitialPresentation:()=>!initialPresentation.hasPresented()});
  disposables.push(map);
  // One read-only inspector lifecycle for desktop, mobile, URL and keyboard.
  // The evidence UI remains an on-demand dynamic module, never a Viewer boot
  // dependency or a second document/selection owner.
  inspectorController=createViewerInspectorController({
    document,window,readOnly:documentSession.readOnly,
    inspectRequested:inspectParams.get('inspect')==='1',
    debugEnabled:inspectParams.get('debug')==='1',
    closeMobileSheets:()=>surfaces.closeMobileSheets(),
    createPanel:async()=>{
      const {createViewerReviewPanel}=await import("../ui/inspector/viewer-review-panel.js");
      return createViewerReviewPanel({document,window,map,documentSession:activeSession,
        isBuiltinMap:()=>builtinActive,meta:runtimeContext.meta,
        readMonth:()=>builtinActive?(builtinClock?.month()||activeSession.commandOwner.state().timelineCursor)
          :activeSession.commandOwner.state().timelineCursor,
        readDiagnostics:()=>diagnostics.snapshot(),
        readPerformance:()=>typeof window.__PANDOLAB_PERFORMANCE_REPORT__==='function'
          ?window.__PANDOLAB_PERFORMANCE_REPORT__():null,
        onError:error=>diagnostics.push({category:'e4-review-data',
          errorCode:error?.code||'PL-E4-REVIEW',technicalMessage:error?.message||String(error)})});
    },
    onError:report,
  });
  disposables.push(inspectorController);
  // One complete historical project needs no neighbouring-month prefetch.
  const searchController=createAppObjectSearchController({window,document,getElement:get,state:map.viewState,
    objectSearchGroupKeys:map.objectPresentation.LAYER_SEARCH_GROUP_KEYS,listObjectSearchItems:map.objectCatalog.listObjectSearchItems,
    layerItemObjectRef:map.objectQuery.layerItemObjectRef,selectionDomain,
    isSearchOpen:()=>surfaces.surfaceController.isOpen('search')&&map.searchActive(),isSearchSurfaceOpen:()=>surfaces.surfaceController.isOpen('search'),
    createIcon:(name,className)=>createSemanticIcon(document,name,className),createEmptyState:createEmptyState.bind(null,document),
    onSearchError:report,cancelBuiltinSearch:()=>map.cancelSearch(),builtinSearch:value=>map.searchPlaces(value),
    selectObjectSearchItem:map.navigation.selectObjectSearchItem,focusObjectRef:map.objectQuery.focusObjectRef,
    closeSearchAfterSingleSelection:()=>surfaces.closeSurface('search')});
  disposables.push(searchController);
  searchController.bind();surfaces.applyLayoutMode({initial:true});
  map.refreshAppearance({rerender:false});
  // Background assets are global; hydro identities must wait for the Core
  // replacement below. The resource owner handles errors and shared requests.
  map.loadPhysicalResources({includeHydro:false});
  syncStatus=()=>{if(map&&!projectDomain.isOpening())selectionUiController.syncNow(null,{force:true});};
  // Scene updates own catalog revisions. Search rendering only filters
  // the current prepared catalog; it does not manufacture data changes.
  const search=()=>searchController.render();
  // Accepted map frames are published independently of optional search/overlay
  // hydration. Each post task is generation-scoped and may never roll a map back.
  const postPresentation=createViewerPostPresentation({
    hydrate:async isCurrent=>{await searchController.completeHydration({isCurrent});},
    refresh:search,
    // replaceSnapshot.prepareView already launched physical background loading.
    afterMap:[()=>surfaces.syncOverlayState(),()=>syncStatus()],
    onError:(error,stage)=>{
      diagnostics.push({category:'viewer-post-presentation',errorCode:'PL-VIEWER-POST-001',
        stage,technicalMessage:error?.message||String(error),stack:error?.stack||''});
      report(error,stage==='hydrate'?'검색 준비를 완료하지 못했습니다.':'지도 보조 정보를 갱신하지 못했습니다.','PL-VIEWER-POST-001');
    },
  });
  disposables.push(postPresentation);
  // Both imported files and the builtin map use the same C++ time cursor.
  const applyDocumentMonth=async(month,{isCurrent=()=>true,waitForFrame=false,onCursorAccepted=null}={})=>{
    const before=map.features(),generation=projectDomain.getGeneration();
    await activeSession.commandOwner.setTimelineCursor(month,{isCurrent});
    if(!isCurrent()||projectDomain.getGeneration()!==generation)return false;
    // The new dated source is authoritative now. Its next frame may stage;
    // never expose that frame while the C++ cursor is still unaccepted.
    if(onCursorAccepted && onCursorAccepted()===false)return false;
    if(territorialMembershipDelta(before,map.features()).changed)
      await map.objectCatalog.pruneLayerItemVisibility();
    await map.update();
    if(!isCurrent()||projectDomain.getGeneration()!==generation)return false;
    if(waitForFrame)await map.renderer.waitForMapPresentation(generation);
    if(!isCurrent()||projectDomain.getGeneration()!==generation)return false;
    search();syncStatus();
    return true;
  };
  const disposeTimeline=installTimelineControls({document,window,getMonth:()=>builtinActive&&builtinClock?.month() ? builtinClock.month() : activeSession?.commandOwner.state().timelineCursor,
    setMonth:async month=>{
      if(builtinActive)return builtinClock.selectMonth(month);
      if(projectDomain.isOpening())throw new Error('지도를 여는 중입니다.');
      await applyDocumentMonth(month);
    },
  });
  disposables.push({dispose:disposeTimeline});
  const open=async (reader,options)=>{
    if (initialPresentation.hasPresented()) {
      // First-page effects must not replay or overlap later date/file opens.
      get('viewer').dataset.initialReveal = 'complete';
      map.cancelInitialReveal();
    }
    postPresentation.invalidate();
    const searchTicket=searchController.beginProjectTransition?.();
    const preserved=options?.preserveView?map.capturePresentation():null;
    openingPreserved=preserved;
    const request=projectDomain.getOpenRevision()+1;
    const previouslyReady=status.dataset.ready==='true';
    // The prior dated map remains visible, but the requested new frame is
    // not ready until its generation has actually been presented. Keep the
    // existing presentation-commit and benchmark ordering intact.
    const retainingDatedFrame=options?.presentation==='temporal' && builtinClock.month()!==null;
    const firstMap=initialPresentation.track(()=>request===projectDomain.getOpenRevision()&&(options?.isCurrent?.()??true));
    status.dataset.loadingKind=initialPresentation.hasPresented()?(options?.presentation==='temporal'?'temporal':'project'):'initial';
    presentViewerLoadStatus(status,options?.presentation==='temporal'?'다음 시점 준비 중…':'지도 불러오는 중…');
    status.dataset.ready='false';
    try {
    const outcome=await projectDomain.openProject(reader,options);
    if(!outcome.accepted){
      firstMap.cancel();
      if(request===projectDomain.getOpenRevision())status.dataset.ready=String(previouslyReady);
      return false;
    }
    if(request!==projectDomain.getOpenRevision()){firstMap.cancel();return false;}
    const presentedGeneration=outcome.generation;
    firstMap.accept(presentedGeneration);
    // setSession already built the scene with the pruned viewing state.
    // Admit remaining Core/selection catalogs after the replacement transaction.
    await map.objectCatalog.pruneLayerItemVisibility();
    if(request!==projectDomain.getOpenRevision()||(options?.isCurrent?.()===false)
      ||projectDomain.getGeneration()!==presentedGeneration)return false;
    // Completion belongs to the actual current-generation bitmap/frame, not
    // the decoded document, a queued repaint or optional DEM completion.
    await map.renderer.waitForMapPresentation(presentedGeneration);
    if(request!==projectDomain.getOpenRevision()||(options?.isCurrent?.()===false)
      ||projectDomain.getGeneration()!==presentedGeneration)return false;
    window.dispatchEvent(new CustomEvent('pandolab:project-changed'));
    status.dataset.ready='true';
    presentViewerLoadStatus(status,'지도 준비 완료.');
    postPresentation.schedule(()=>request===projectDomain.getOpenRevision()
      &&projectDomain.getGeneration()===presentedGeneration&&(options?.isCurrent?.()??true));
    return true;
    } catch(error){firstMap.cancel();if(request===projectDomain.getOpenRevision()){
      // A rejected source read or successfully rolled-back candidate still
      // leaves the previous dated map active. A failed restoration does not.
      status.dataset.ready=String(!error.restoreError
        &&(previouslyReady||retainingDatedFrame||initialPresentation.hasPresented()));
      presentViewerLoadStatus(status,'지도를 불러오지 못했습니다.');throw error;
    }return false;}
    finally {
      // Search never owns map readiness: a failed optional refresh cannot
      // roll back an accepted frame. Tickets prevent an older read from
      // releasing another request's disabled result rows.
      if(searchTicket!=null)try{searchController.endProjectTransition?.(searchTicket);}
      catch(error){
        diagnostics.push({category:'viewer-membership-search',errorCode:'PL-VIEWER-MEMBERSHIP-001',
          technicalMessage:error?.message||String(error)});
      }
    }
  };
  const actionSubscriptions=[];
  let actionsDisposed=false;
  const action=(element,event,task)=>{
    if(!element)return;
    const handler=e=>{Promise.resolve().then(()=>{if(!actionsDisposed)return task(e);}).catch(report);};
    element.addEventListener(event,handler);
    actionSubscriptions.push(()=>element.removeEventListener(event,handler));
  };
  disposables.push({dispose(){
    actionsDisposed=true;
    for(const unsubscribe of actionSubscriptions.splice(0))unsubscribe();
  }});
  const changeBuiltinCursor=async(month,{isCurrent,commit})=>{
    const previous=activeSession.commandOwner.state().timelineCursor;
    const previouslyReady=status.dataset.ready==='true';
    const temporalTicket=map.renderer.beginTemporalViewTransition(isCurrent);
    status.dataset.loadingKind='temporal';status.dataset.ready='false';
    presentViewerLoadStatus(status,'다음 시점 준비 중…');
    try{
      // Date-dependent physical reference data stays outside the project.
      await owners.physicalResources.preparePhysicalContext(month,{isCurrent});
      if(!isCurrent())return false;
      if(!await applyDocumentMonth(month,{isCurrent,waitForFrame:true,
        onCursorAccepted:()=>map.renderer.admitTemporalViewTransition(temporalTicket)}))return false;
      if(!isCurrent()||!commit())return false;
      status.dataset.ready='true';presentViewerLoadStatus(status,'지도 준비 완료.');
      postPresentation.schedule(isCurrent);
      return true;
    }catch(error){
      map.renderer.finishTemporalViewTransition(temporalTicket);
      if(isCurrent()){
        // Restore the previous view of the *same* document after a render error.
        if(previous&&previous!==month&&activeSession.commandOwner.state().timelineCursor===month)
          try{await applyDocumentMonth(previous);}catch(restoreError){error.restoreError=restoreError;}
        status.dataset.ready=String(previouslyReady&&!error.restoreError);
      }
      throw error;
    }finally{
      map.renderer.finishTemporalViewTransition(temporalTicket);
    }
  };
  builtinClock=createBuiltinMonthClock({coalesceRequests:true,window,document,applyMonth:async(month,{isCurrent,commit})=>{
    if(builtinActive&&builtinClock.month()!==null
      &&activeSession.documentModel.snapshot().projectSetup?.sourceMode==='builtin')
      return changeBuiltinCursor(month,{isCurrent,commit});
    // Startup/return-from-file admits the full project once. Subsequent
    // months do not create C++ candidates or replace the active document.
    return open(createProjectReader({source:'builtin',
      read:()=>map.prepareBuiltinProject(month,{isCurrent,transition:false})}),{
      isCurrent,presentation:'default'});
  },onCommitted:month=>{builtinActive=true;syncStatus();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));},onError:report});
  disposables.push(builtinClock);
  const openUserProject=async(reader,options)=>{
    const previous=builtinActive,resume=builtinClock.suspend();builtinActive=false;
    try {const result=await open(createProjectReader({source:'project',read:reader}),options);
      if(!result&&resume())builtinActive=previous;return result;}
    catch(error){if(resume())builtinActive=previous;throw error;}
  };
  const fileElements={projectOpen:get('openProjectBtn'),projectInput:get('projectFileInput')};
  const files=createFileController({productMode,elements:fileElements,fileAccess:createBrowserFileAccess({productMode,elements:fileElements,window,document}),projectDomain,openProject:openUserProject,reportOperationError:report,window,document});
  disposables.push(files);
  files.bind();action(get('openProjectBtn'),'click',()=>files.openProjectPicker());
  action(get('builtinMapBtn'),'click',()=>builtinClock.followNow());
  display=createMapSettings({capabilities:owners.capabilities,viewPresentation:map});
  display.connect({
    layerResources:{loadHydroData:owners.physicalResources.loadHydroData,preparePlaces:owners.territorialLabels.preparePlaces},
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
  disposables.push(display);
  const navigationBindings=createNavigationBindings();
  navigationBindings.connect({platform:{$:get},workspaceUiA:surfaces,workspaceUiB:surfaces,workspaceUiC:surfaces,surfaces,
    mapSettingsUi:display,navigation:map.navigation,projectState:{state:map.viewState},objectPicking:map.objectPicking,
    readinessUi:notifications});
  navigationBindings.bindNavigationUI();
  disposables.push(navigationBindings);
  for(const id of ['openProjectBtn','builtinMapBtn']){
    const element=get(id),handler=()=>surfaces.closeFileMenu();
    element.addEventListener('click',handler);
    actionSubscriptions.push(()=>element.removeEventListener('click',handler));
  }
  const preferencesDialog=createPreferencesDialog({document,productMode,returnFocus:()=>get(surfaces.isMobile()?'mobileMenuBtn':'preferencesBtn'),getPreferences:()=>preferencePresentation.current,
    applyPreferences:value=>preferencePresentation.apply(value,{persist:false}),beforeOpen:()=>surfaces.closeFileMenu()});
  disposables.push(preferencesDialog);
  if(inspectParams.get('debug')==='1')globalThis.__PANDOLAB_VIEWER__=Object.freeze({initialMapPresented:initialPresentation.hasPresented,productMode,documentState:()=>activeSession?.commandOwner.state(),
    documentSnapshot:()=>activeSession?.documentModel.snapshot(),resolvedWorld:()=>activeSession?.documentModel.world(),selectionSnapshot:()=>activeSession?.selectionDomain.snapshot().selection,
    diagnostics:diagnostics.snapshot,rendererStats:()=>map.renderer.getStats(),visibleTerritorialCount:()=>map.objectQuery.visibleTerritorialCount(),
    mapProjection:()=>map.viewState.projection,readOnly:documentSession.readOnly,
    openFile:file=>openUserProject(()=>readProjectFile(file)),builtinMonth:()=>({month:builtinClock.month(),automatic:builtinClock.isAutomatic()})});
  }
  const lifecycle=createApplicationLifecycle({window,document,
    // Only initial engine admission is safe to repeat. DOM/map composition is not.
    compose:[()=>documentSession.commandOwner.load(JSON.stringify(documentSession.documentModel.snapshot())),composeMap],
    startup:()=>builtinClock.refresh(),
    shouldRetryCompose:(error,index)=>index===0&&isRecoverableLoadError(error),
    shouldRetryStartup:isRecoverableLoadError,
    getDisposables:()=>[...disposables].reverse(),
    onRecoverableError:(error,{retry})=>{
      console.warn('[PL-MAP-START-RETRY]',error);
      status.dataset.ready='false';
      presentViewerLoadStatus(status,'연결이 복구되면 지도를 다시 불러옵니다. ',{error:true});
      const button=document.createElement('button');button.type='button';button.className='ui-button btn';button.textContent='다시 시도';
      button.addEventListener('click',()=>{retry().catch(report);});status.appendChild(button);
    },
    onError:error=>{presentViewerLoadStatus(status,'지도를 불러오지 못했습니다. 새로고침해 다시 시도하세요.',{error:true});report(error,'지도를 불러오지 못했습니다.','PL-MAP-START');},reportDisposeError:error=>console.error('[PL-DISPOSE]',error)});
  await lifecycle.start();
  await inspectorController?.openAfterStartup();
}
