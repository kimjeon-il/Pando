import { createMobileSheetPresentation } from './mobile-sheet-presentation.js';
import { createWorkspaceLayoutDetector, isMobileWorkspaceLayout } from './workspace-layout.js';
import { clearMenuPosition, createMenuPositionScheduler, positionRootMenu } from './menu-presentation.js';
import { createSearchToolbarPresentation } from './search-toolbar-presentation.js';

/** WorkspaceSurfaces: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createWorkspaceSurfaces({productMode='editor'}={}) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Workspace surfaces require immutable product mode.');
  const registeredSurfaces=productMode==='editor'?['create','search','display','editor','reference']:['search','display'];
  const listeners=[];
  const listen=(target,type,listener)=>{target.addEventListener(type,listener);listeners.push(()=>target.removeEventListener(type,listener));};
  let fileMenuOpen=false;
  let fileMenuPage='main';
  let dependencies, mobileSheets;
  let isPolygonDraftTool;
  let isGenericFeatureDraftTool;
  let uid;
  let detectLayoutMode;
  let layoutMode;
  let isMobile;
  let lastOverlayTrigger;
  let fileMenuTrigger;
  let pendingLayoutChange = false;
  let surfaceController;
  let surfaceState;
  let editorWorkspacePresentation;
  let editorSurfaceTabs;
  let MOBILE_SHEET_IDS;
  let MOBILE_SHEET_HISTORY_KEY;
  let ignoreNextMobileSheetPopstate;
  let mobileViewportHeight;
  let menuPositionScheduler;
  let searchToolbarPresentation;
  let searchFocusFrame = 0;
  let searchComposing = false;
  let referenceSurface = null;
  let referenceGestureActive = false;
  function connect(ports) {
    if (dependencies) throw new Error('workspace-surfaces already connected');
    dependencies = ports;
  }






  function mobileSheetHistoryKind() {
    return window.history.state?.[MOBILE_SHEET_HISTORY_KEY] || null;
  }

  function trackMobileSheetHistory(kind) {
    if (!isMobile() || !kind) return;
    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    const nextState = { ...currentState, [MOBILE_SHEET_HISTORY_KEY]: kind };
    if (mobileSheetHistoryKind()) window.history.replaceState(nextState, '', window.location.href);
    else window.history.pushState(nextState, '', window.location.href);
  }

  function releaseMobileSheetHistory() {
    if (!mobileSheetHistoryKind()) return;
    ignoreNextMobileSheetPopstate = true;
    window.history.back();
  }



  function syncVisibleViewport() {
    const app = (0, dependencies.platform.$)('app');
    if (!app) return;
    app.style.setProperty('--workspace-visible-height', Math.round(mobileViewportHeight()) + 'px');
    app.style.setProperty('--workspace-visible-top', Math.round(window.visualViewport?.offsetTop || 0) + 'px');
  }

  function refreshMapSheetMetrics() {
    const panels = Object.values(MOBILE_SHEET_IDS).map(id => (0, dependencies.platform.$)(id)).filter(Boolean);
    syncVisibleViewport();
    if (layoutMode !== 'mobile') {
      panels.forEach(panel => {
        panel.style.removeProperty('--sheet-height');
        panel.removeAttribute('data-sheet-snap');
      });
      document.body.classList.remove('map-sheet-dragging');
      return;
    }
    panels.forEach(panel => {
      if (mobileSheets.activeDrag?.panel !== panel) mobileSheets.setMobileSheetHeight(panel, mobileSheets.snapIndex.get(panel.id) ?? 1);
    });
  }

  function syncEditorPanelControls() {
    const headerToggle = (0, dependencies.platform.$)('mobileCloseRightBtn');
    if (!headerToggle) return;
    const label = layoutMode === 'wide' ? '편집창 접기' : '편집창 닫기';
    headerToggle.setAttribute('aria-label', label);
    headerToggle.dataset.tooltip = label;
  }

  function syncEditingSurfaces(){
    if(productMode!=='editor')return;
    editorWorkspacePresentation.sync();
    dependencies.domains.renderingDomain?.setCountryPropertyEditingActive?.(surfaceController.isOpen('editor')&&!!dependencies.projectState.state.selected);
    dependencies.domainControllers.syncTerritorialEditorInteraction();
    syncEditorPanelControls();requestAnimationFrame(dependencies.taskPresentation.syncMapHudBounds);syncCreateSurface();
  }
  function applyLayoutMode({ initial = false } = {}) {
    const nextLayout = detectLayoutMode();
    if (nextLayout !== layoutMode && (mobileSheets.activeDrag || mobileSheets.settling || searchComposing || referenceGestureActive)) {
      pendingLayoutChange = true;
      return false;
    }
    const previous = layoutMode;
    if (previous !== nextLayout) {
      cancelAnimationFrame(searchFocusFrame);
      searchFocusFrame = 0;
    }
    pendingLayoutChange = false;
    layoutMode = nextLayout;
    const app = (0, dependencies.platform.$)('app');
    surfaceController.syncLayout(previous);
    if (isMobileWorkspaceLayout(previous) && !isMobile()) releaseMobileSheetHistory();
    else if (isMobile() && !isMobileWorkspaceLayout(previous) && surfaceController.activeMobileSheet) {
      trackMobileSheetHistory(surfaceController.activeMobileSheet);
    }
    const fileOpen=fileMenuOpen;
    surfaceController.render({ fileOpen });
    // Publish the layout only after its open-surface classes are in place.
    // A transient hidden sheet can blur an existing input in WebView2.
    if (app) app.dataset.layout = layoutMode;
    document.body.dataset.layout = layoutMode;
    searchToolbarPresentation.sync();
    referenceSurface?.sync();
    syncEditingSurfaces();
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    refreshMapSheetMetrics();
    menuPositionScheduler.schedule();
    if (!initial && previous !== layoutMode) (0, dependencies.mapHostViewB.queueMapResize)('layout-mode-change');
    return previous !== layoutMode;
  }

  function syncOverlayState() {
    const fileOpen=fileMenuOpen;
    const menu=document.querySelector('.top-actions');
    if(menu){menu.hidden=!fileOpen;menu.classList.toggle('mobile-open',fileOpen);}
    const view = surfaceController.render({ fileOpen });
    referenceSurface?.sync();
    if (!surfaceController.isOpen('search')) {
      dependencies.domains.objectSearchController?.cancelSearch();
      cancelAnimationFrame(searchFocusFrame);
      searchFocusFrame = 0;
    } else {
      dependencies.domains.objectSearchController?.render(true);
    }
    searchToolbarPresentation.sync();
    syncEditingSurfaces();
    refreshMapSheetMetrics();
    menuPositionScheduler.schedule();
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    else (0, dependencies.platform.$)('app')?.style.removeProperty('--file-menu-notification-top');
    if (layoutMode !== 'wide') (0, dependencies.mapHostViewB.queueMapResize)('panel-layout');
    return view;
  }

  function syncFileMenuNotificationOffset() {
    const app = (0, dependencies.platform.$)('app');
    const menu = document.querySelector('.top-actions.mobile-open');
    if (!app || layoutMode !== 'mobile' || !menu) {
      app?.style.removeProperty('--file-menu-notification-top');
      return;
    }
    app.style.setProperty('--file-menu-notification-top', `${Math.ceil(menu.getBoundingClientRect().bottom)}px`);
  }

  function closeFileMenu({ restoreFocus = false } = {}) {
    const menu = document.querySelector('.top-actions');
    if(!menu||!fileMenuOpen)return;
    const trigger = fileMenuTrigger;
    fileMenuTrigger = null;
    fileMenuOpen=false;
    setFileMenuPage('main',{focus:false});
    syncOverlayState();
    if (restoreFocus) {
      const focusTarget = isMobile()
        ? ((0, dependencies.platform.$)('mobileMenuFileBtn') || (0, dependencies.platform.$)('mobileMenuBtn'))
        : trigger;
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    }
  }

  function activeCreateMenuItems() {
    const panel = (0, dependencies.platform.$)('createMenu');
    return panel ? [...panel.querySelectorAll('.ui-menu-item:not([disabled])')]
      .filter(item => !item.closest('.hidden, [hidden]') && item.getClientRects().length > 0) : [];
  }

  function focusSurfaceTrigger(surface) {
    const ids = isMobile()
      ? { create: 'mobileCreateBtn', search: 'mobileSearchBtn', display: 'mobileDisplayBtn', editor: 'mobileEditBtn', reference: 'referenceImageBtn' }
      : { create: 'createMenuBtn', search: 'objectSearchBtn', display: 'mapDisplayBtn', reference: 'referenceImageBtn' };
    const panelId = { create: 'createMenu', search: 'objectSearchSurface', display: 'mapDisplaySurface', editor: 'editorSurface', reference: 'referenceImageSurface' }[surface];
    const rememberedTrigger = lastOverlayTrigger?.isConnected
      && lastOverlayTrigger.getClientRects().length > 0
      && lastOverlayTrigger.getAttribute('aria-controls') === panelId
      ? lastOverlayTrigger
      : null;
    const trigger = rememberedTrigger || [(0, dependencies.platform.$)(ids[surface]),
      isMobile() ? (0, dependencies.platform.$)('mobileMenuBtn') : lastOverlayTrigger,
      (0, dependencies.platform.$)('map')].find(candidate => candidate?.getClientRects().length > 0);
    trigger?.focus({ preventScroll: true });
  }

  function syncCreateSurface() {
    const panel = (0, dependencies.platform.$)('createMenu');
    if (!panel) return;
    const mobile = isMobile();
    panel.classList.toggle('ui-menu-surface', !mobile);
    panel.classList.toggle('ui-command-menu', !mobile);
    for (const button of panel.querySelectorAll('.ui-menu-item')) {
      button.tabIndex = mobile ? 0 : -1;
      if (mobile) button.removeAttribute('role');
      else button.setAttribute('role', 'menuitem');
    }
    (0, dependencies.platform.$)('createMenuBtn')?.setAttribute('aria-haspopup', 'menu');
    (0, dependencies.platform.$)('mobileCreateBtn')?.setAttribute('aria-haspopup', 'dialog');
    if (mobile) {
      clearMenuPosition(panel);
    } else if (surfaceController.isOpen('create')) {
      menuPositionScheduler.schedule();
    }
  }

  function positionWorkspaceMenus() {
    searchToolbarPresentation.position();
    const fileMenu = document.querySelector('.top-actions');
    const createMenu = (0, dependencies.platform.$)('createMenu');
    if (isMobile()) {
      clearMenuPosition(fileMenu);
      clearMenuPosition(createMenu);
      return;
    }
    if(fileMenuOpen){
      positionRootMenu({ menu: fileMenu, trigger: (0, dependencies.platform.$)('mobileFileBtn') });
    }
    if (surfaceController.isOpen('create')) {
      positionRootMenu({ menu: createMenu, trigger: (0, dependencies.platform.$)('createMenuBtn') });
    }
  }

  function closeActiveMobileSheet({ restoreFocus = false, syncHistory = true } = {}) {
    if (!isMobile() || !surfaceController.activeMobileSheet) return;
    const kind = surfaceController.activeMobileSheet;
    const surface = { create: 'create', search: 'search', display: 'display', edit: 'editor', reference: 'reference' }[kind];
    const panel = mobileSheets.mobileSheetPanel(kind);
    surfaceController.close(surface);
    mobileSheets.resetMobileSheetSession(panel);
    syncOverlayState();
    if (syncHistory) releaseMobileSheetHistory();
    if (restoreFocus) focusSurfaceTrigger(surface);
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function closeMobileSheets(except = null, { restoreFocus = false } = {}) {
    if (isMobile()) {
      const exceptKind = { create: 'create', search: 'search', display: 'display', editor: 'edit', reference: 'reference' }[except] || null;
      if (surfaceController.activeMobileSheet && surfaceController.activeMobileSheet !== exceptKind) closeActiveMobileSheet({ restoreFocus });
      return;
    }
    for(const surface of registeredSurfaces) if (surface !== except) surfaceController.close(surface);
    syncOverlayState();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function setFileMenuPage(page,{focus=true}={}){
    if(!['main','advanced'].includes(page)||(page==='advanced'&&productMode!=='editor'))throw new TypeError('Unsupported file menu page.');
    fileMenuPage=page;
    for(const panel of document.querySelectorAll('[data-file-menu-page]'))panel.hidden=panel.dataset.fileMenuPage!==page;
    dependencies.platform.$('fileAdvancedBtn')?.setAttribute('aria-expanded',String(page==='advanced'));
    if(focus){
      const target=page==='main'?dependencies.platform.$('fileAdvancedBtn'):dependencies.platform.$('fileAdvancedBackBtn');
      target.focus({preventScroll:true});
    }
    menuPositionScheduler.schedule();
  }

  function openFileMenu({trigger=null}={}){
    if(!document.querySelector('.top-actions'))return false;
    closeSurface('create');fileMenuOpen=true;fileMenuTrigger=trigger||dependencies.platform.$('mobileFileBtn');
    setFileMenuPage('main',{focus:false});
    syncOverlayState();requestAnimationFrame(()=>document.querySelector('.top-actions [role="menuitem"]:not(:disabled)')?.focus({preventScroll:true}));return true;
  }
  function toggleFileMenu(){if(fileMenuOpen){closeFileMenu();return false;}return openFileMenu();}

  function openSelectionEditor({ explicit = false, trigger = null, focus = false } = {}) {
    if(productMode!=='editor')return false;
    const panel = (0, dependencies.platform.$)('editorSurface');
    if (!panel) return false;
    let opened = surfaceController.isOpen('editor');
    if (!opened && explicit) opened = openSurface('editor', { trigger, automatic: false });
    else if (!opened && (layoutMode !== 'wide' || !surfaceState.editorManuallyCollapsed)) {
      opened = openSurface('editor', { automatic: true });
    }
    if (!opened) return false;
    if (panel.classList.contains('mobile-open')) (0, dependencies.platform.$)('editorScrollBody')?.scrollTo?.({ top: 0, behavior: 'instant' });
    if (focus) requestAnimationFrame(() => {
      if (!surfaceController.isOpen('editor')) return;
      const visible = element => element.getClientRects().length > 0 && !element.closest('[hidden], .hidden');
      const target = [...panel.querySelectorAll('[role="tab"][aria-selected="true"]:not([aria-disabled="true"])')].find(visible)
        || [...panel.querySelectorAll('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')].find(visible);
      target?.focus({ preventScroll: true });
    });
    dependencies.domainControllers.syncTerritorialEditorInteraction();
    return true;
  }

  function openSurface(surface, { trigger = null, automatic = false } = {}) {
    if(!registeredSurfaces.includes(surface))return false;
    if (dependencies.projectState.state.projectReplacing) return false;
    closeFileMenu();
    const activeTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!surfaceController.open(surface, { automatic })) return false;
    if (activeTrigger) lastOverlayTrigger = activeTrigger;
    if (isMobile()) {
      const kind = { create: 'create', search: 'search', display: 'display', editor: 'edit', reference: 'reference' }[surface];
      const panel = mobileSheets.mobileSheetPanel(kind);
      mobileSheets.resetMobileSheetSession(panel);
      trackMobileSheetHistory(kind);
    }
    syncOverlayState();
    if (surface === 'search') {
      cancelAnimationFrame(searchFocusFrame);
      searchFocusFrame = requestAnimationFrame(() => {
        searchFocusFrame = 0;
        if (surfaceController.isOpen('search') && !dependencies.projectState.state.projectReplacing
          && !document.activeElement?.closest('.ui-modal, [aria-modal="true"]')) {
          (0, dependencies.platform.$)('objectSearchInput')?.focus({ preventScroll: true });
        }
      });
    }
    if (surface === 'create' && !isMobile()) {
      requestAnimationFrame(() => {
        if (surfaceController.isOpen('create') && !isMobile()) activeCreateMenuItems()[0]?.focus({ preventScroll: true });
      });
    }
    return true;
  }

  function closeSurface(surface, { manual = false, restoreFocus = false, syncHistory = true } = {}) {
    if(!registeredSurfaces.includes(surface))return false;
    if (surface === 'editor' && editorWorkspacePresentation.isDocked() && layoutMode !== 'phone-landscape') return;
    const mobileKind = isMobile() ? { create: 'create', search: 'search', display: 'display', editor: 'edit', reference: 'reference' }[surface] : null;
    const mobilePanel = mobileKind ? mobileSheets.mobileSheetPanel(mobileKind) : null;
    if (!surfaceController.close(surface, { manual, selected: !!dependencies.projectState.state?.selected })) return;
    if (mobilePanel) mobileSheets.resetMobileSheetSession(mobilePanel);
    if (surface === 'editor') (0, dependencies.colorPicker.closeAllColorPickers)();
    syncOverlayState();
    if (mobilePanel && syncHistory) releaseMobileSheetHistory();
    if (restoreFocus) focusSurfaceTrigger(surface);
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function completeToolStart(started, { destination = 'map' } = {}) {
    if (!started) return false;
    if (destination === 'editor') {
      openSurface('editor');
      requestAnimationFrame(() => {
        if (!surfaceController.isOpen('editor')) return;
        const panel = (0, dependencies.platform.$)('editorSurface');
        const input = [...panel.querySelectorAll('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
          .find(element => element.getClientRects().length > 0 && !element.closest('[hidden], .hidden'));
        input?.focus({ preventScroll: true });
      });
    } else if (isMobile()) {
      if (editorWorkspacePresentation.isDocked() && layoutMode !== 'phone-landscape') openSurface('editor');
      else closeMobileSheets();
      requestAnimationFrame(() => (0, dependencies.platform.$)('map')?.focus({ preventScroll: true }));
    } else {
      closeSurface('create');
    }
    return true;
  }

  function toggleSurface(surface, trigger = null) {
    if (surfaceController.isOpen(surface)) {
      closeSurface(surface, { manual: surface === 'editor', restoreFocus: true });
    } else {
      openSurface(surface, { trigger });
    }
  }

  function initializeWorkspaceSurfaces() {
    if(productMode==='editor'){
      isPolygonDraftTool=tool=>dependencies.countryEditingA.draftToolConfig(tool)?.shape==='polygon';
      isGenericFeatureDraftTool=tool=>!!dependencies.countryEditingA.draftToolConfig(tool);
      uid=()=>dependencies.projectServices.createProjectObjectId();
    }
    const detect = createWorkspaceLayoutDetector();
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    detectLayoutMode = () => detect({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      coarse: coarsePointer.matches,
      editingText: searchComposing || !!document.activeElement?.matches('input, textarea, select, [contenteditable="true"]'),
    });
    listen(coarsePointer,'change', () => applyLayoutMode());

    (layoutMode = detectLayoutMode());

    (isMobile = () => isMobileWorkspaceLayout(layoutMode));

    (lastOverlayTrigger = null);

    (fileMenuTrigger = null);


    (surfaceController = (0, dependencies.uiFactoriesB.createSurfaceController)({ getElement: dependencies.platform.$, getLayout: () => layoutMode, document }));

    (surfaceState = surfaceController.state);

    if(productMode==='editor')(editorWorkspacePresentation = (0, dependencies.uiFactoriesA.createEditorWorkspacePresentation)({
      document,
      panel: (0, dependencies.platform.$)('editorSurface'), task: (0, dependencies.platform.$)('modeEditingContext'),
      dockSlot: (0, dependencies.platform.$)('editorTaskSlot'),
      isEditorOpen: () => surfaceController.isOpen('editor'),
      openEditor: () => {
        if (!surfaceController.isOpen('create')) openSurface('editor');
      },
      onLayoutChange: () => (0, dependencies.mapHostViewB.queueMapResize)('editor-task-layout'),
    }));

    (editorSurfaceTabs = null);















    (MOBILE_SHEET_IDS = Object.freeze(productMode==='editor'?{create:'createMenu',search:'objectSearchSurface',display:'mapDisplaySurface',edit:'editorSurface',reference:'referenceImageSurface'}:{search:'objectSearchSurface',display:'mapDisplaySurface'}));
    mobileSheets=createMobileSheetPresentation({document,window,getElement:dependencies.platform.$,getLayout:()=>layoutMode,panelIds:MOBILE_SHEET_IDS,
      onSync:syncOverlayState,onClose:closeActiveMobileSheet,
      onResumeLayout:()=>{if(pendingLayoutChange){pendingLayoutChange=false;applyLayoutMode();}},
      onLayoutChange:()=>{syncEditingSurfaces();dependencies.mapHostViewB.queueMapResize('panel-layout');},
    });








    (MOBILE_SHEET_HISTORY_KEY = '__atlaswrightMobileSheet');

    (ignoreNextMobileSheetPopstate = false);

    (mobileViewportHeight = () => window.visualViewport?.height || window.innerHeight);



    (menuPositionScheduler = createMenuPositionScheduler(positionWorkspaceMenus));
    searchToolbarPresentation = createSearchToolbarPresentation({
      document,
      panel: (0, dependencies.platform.$)('objectSearchSurface'),
      toolbar: document.querySelector('.map-command-toolbar'),
      slot: document.querySelector('.map-command-search'),
      results: (0, dependencies.platform.$)('objectSearchResults'),
      isOpen: () => surfaceController.isOpen('search'),
      isMobile,
      schedulePosition: () => menuPositionScheduler.schedule(),
    });
    listen(dependencies.platform.$('objectSearchInput'),'compositionstart', () => { searchComposing = true; });
    listen(dependencies.platform.$('objectSearchInput'),'compositionend', () => {
      searchComposing = false;
      if (pendingLayoutChange) applyLayoutMode();
    });
    listen(window,'resize',()=>{if(!applyLayoutMode())refreshMapSheetMetrics();menuPositionScheduler.schedule();});
    listen(window,'orientationchange',()=>{refreshMapSheetMetrics();dependencies.mapHostViewB.queueMapResize('orientation-change');});
    listen(window,'popstate',event=>{
      if(ignoreNextMobileSheetPopstate){ignoreNextMobileSheetPopstate=false;return;}
      if(isMobile()&&surfaceController.activeMobileSheet){
        const select=document.querySelector('.ui-select-popover:not([hidden])');
        const picker=document.querySelector('[data-color-picker].is-open');
        if(select)dependencies.platformConfigurationB.selectController.closeAll({restoreFocus:true});
        else if(picker)dependencies.colorPicker.closeColorPicker(picker,{restoreFocus:true});
        else {closeActiveMobileSheet({restoreFocus:true,syncHistory:false});return;}
        trackMobileSheetHistory(surfaceController.activeMobileSheet);return;
      }
      if(event.state?.[MOBILE_SHEET_HISTORY_KEY]){const next={...event.state};delete next[MOBILE_SHEET_HISTORY_KEY];window.history.replaceState(next,'',window.location.href);}
    });
    if(window.visualViewport)listen(window.visualViewport,'resize', () => { refreshMapSheetMetrics(); menuPositionScheduler.schedule(); });
    if(window.visualViewport)listen(window.visualViewport,'scroll', () => { syncVisibleViewport(); menuPositionScheduler.schedule(); });
  }

  return Object.freeze({
    connect,
    registerReferenceImageSurface(adapter) {
      referenceSurface = adapter;
      mobileSheets.bindMobileSheetSurface(adapter.panel);
      syncOverlayState();
      return () => { if (referenceSurface === adapter) referenceSurface = null; };
    },
    setReferenceImageGestureActive(active) {
      referenceGestureActive = active === true;
      if (!referenceGestureActive && pendingLayoutChange) applyLayoutMode();
    },
    initializeWorkspaceSurfaces,openFileMenu,
    dispose(){listeners.forEach(remove=>remove());if(mobileSheets)mobileSheets.dispose();if(menuPositionScheduler)menuPositionScheduler.cancel();if(searchToolbarPresentation)searchToolbarPresentation.dispose();cancelAnimationFrame(searchFocusFrame);},
    get MOBILE_SHEET_IDS() { return MOBILE_SHEET_IDS; },
    get activeCreateMenuItems() { return activeCreateMenuItems; },
    get applyLayoutMode() { return applyLayoutMode; },
    get bindMobileSheetSurface() { return mobileSheets.bindMobileSheetSurface; },
    get closeActiveMobileSheet() { return closeActiveMobileSheet; },
    get closeFileMenu() { return closeFileMenu; },
    get closeMobileSheets() { return closeMobileSheets; },
    get closeSurface() { return closeSurface; },
    get editorSurfaceTabs() { return editorSurfaceTabs; },
    set editorSurfaceTabs(value) { editorSurfaceTabs = value; },
    get editorWorkspacePresentation() { return editorWorkspacePresentation; },
    get isGenericFeatureDraftTool() { return isGenericFeatureDraftTool; },
    get isMobile() { return isMobile; },
    get isFileMenuOpen(){return fileMenuOpen;},
    get fileMenuPage(){return fileMenuPage;},
    setFileMenuPage,
    get isPolygonDraftTool() { return isPolygonDraftTool; },
    get layoutMode() { return layoutMode; },
    get openSelectionEditor() { return openSelectionEditor; },
    get openSurface() { return openSurface; },
    get refreshMapSheetMetrics() { return refreshMapSheetMetrics; },
    get completeToolStart() { return completeToolStart; },
    get focusSurfaceTrigger() { return focusSurfaceTrigger; },
    get setMobileSheetHeight() { return mobileSheets.setMobileSheetHeight; },
    get surfaceController() { return surfaceController; },
    get surfaceState() { return surfaceState; },
    get syncOverlayState() { return syncOverlayState; },
    get toggleFileMenu() { return toggleFileMenu; },
    get toggleSurface() { return toggleSurface; },
    get trackMobileSheetHistory() { return trackMobileSheetHistory; },
    get uid() { return uid; },
  });
}
