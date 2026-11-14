import { createMobileSheetPresentation } from "./mobile-sheet-presentation.js";
import { createWorkspaceLayoutDetector, isMobileWorkspaceLayout } from "./workspace-layout.js";
import { clearMenuPosition, createMenuPositionScheduler, positionRootMenu } from "./menu-presentation.js";
import { createSearchToolbarPresentation } from "./search-toolbar-presentation.js";

/** WorkspaceSurfaces: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createWorkspaceSurfaces() {
  const registeredSurfaces=['search'];
  const listeners=[];
  const listen=(target,type,listener)=>{target.addEventListener(type,listener);listeners.push(()=>target.removeEventListener(type,listener));};
  let fileMenuOpen=false;
  let dependencies, mobileSheets;
  let detectLayoutMode;
  let layoutMode;
  let isMobile;
  let lastOverlayTrigger;
  let fileMenuTrigger;
  let pendingLayoutChange = false;
  let surfaceController;
  let MOBILE_SHEET_IDS;
  let MOBILE_SHEET_HISTORY_KEY;
  let ignoreNextMobileSheetPopstate;
  let mobileViewportHeight;
  let menuPositionScheduler;
  let searchToolbarPresentation;
  let searchFocusFrame = 0;
  let searchComposing = false;
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

  function applyLayoutMode({ initial = false } = {}) {
    const nextLayout = detectLayoutMode();
    if (nextLayout !== layoutMode && (mobileSheets.activeDrag || mobileSheets.settling || searchComposing)) {
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
    if (!surfaceController.isOpen('search')) {
      dependencies.domains.objectSearchController?.cancelSearch();
      cancelAnimationFrame(searchFocusFrame);
      searchFocusFrame = 0;
    } else {
      dependencies.domains.objectSearchController?.render(true);
    }
    searchToolbarPresentation.sync();
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
    syncOverlayState();
    if (restoreFocus) {
      const focusTarget = isMobile()
        ? ((0, dependencies.platform.$)('mobileMenuFileBtn') || (0, dependencies.platform.$)('mobileMenuBtn'))
        : trigger;
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    }
  }

  function focusSurfaceTrigger(surface) {
    const ids = isMobile()
      ? { search: 'mobileSearchBtn' }
      : { search: 'objectSearchBtn' };
    const panelId = { search: 'objectSearchSurface' }[surface];
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


  function positionWorkspaceMenus() {
    searchToolbarPresentation.position();
    const fileMenu = document.querySelector('.top-actions');
    if (isMobile()) {
      clearMenuPosition(fileMenu);
      return;
    }
    if(fileMenuOpen){
      positionRootMenu({ menu: fileMenu, trigger: (0, dependencies.platform.$)('mobileFileBtn') });
    }
  }

  function closeActiveMobileSheet({ restoreFocus = false, syncHistory = true } = {}) {
    if (!isMobile() || !surfaceController.activeMobileSheet) return;
    const kind = surfaceController.activeMobileSheet;
    const surface = kind;
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
      const exceptKind = except === 'search' ? 'search' : null;
      if (surfaceController.activeMobileSheet && surfaceController.activeMobileSheet !== exceptKind) closeActiveMobileSheet({ restoreFocus });
      return;
    }
    for(const surface of registeredSurfaces) if (surface !== except) surfaceController.close(surface);
    syncOverlayState();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function openFileMenu({trigger=null}={}){
    if(!document.querySelector('.top-actions'))return false;
    fileMenuOpen=true;fileMenuTrigger=trigger||dependencies.platform.$('mobileFileBtn');
    syncOverlayState();requestAnimationFrame(()=>document.querySelector('.top-actions [role="menuitem"]:not(:disabled)')?.focus({preventScroll:true}));return true;
  }
  function toggleFileMenu(){if(fileMenuOpen){closeFileMenu();return false;}return openFileMenu();}


  function openSurface(surface, { trigger = null } = {}) {
    if(!registeredSurfaces.includes(surface))return false;
    if (dependencies.projectState.state.projectReplacing) return false;
    closeFileMenu();
    const activeTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!surfaceController.open(surface)) return false;
    if (activeTrigger) lastOverlayTrigger = activeTrigger;
    if (isMobile()) {
      const kind = surface;
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
    return true;
  }

  function closeSurface(surface, { restoreFocus = false, syncHistory = true } = {}) {
    if(!registeredSurfaces.includes(surface))return false;
    const mobileKind = isMobile() ? surface : null;
    const mobilePanel = mobileKind ? mobileSheets.mobileSheetPanel(mobileKind) : null;
    if (!surfaceController.close(surface)) return;
    if (mobilePanel) mobileSheets.resetMobileSheetSession(mobilePanel);
    syncOverlayState();
    if (mobilePanel && syncHistory) releaseMobileSheetHistory();
    if (restoreFocus) focusSurfaceTrigger(surface);
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function toggleSurface(surface, trigger = null) {
    if (surfaceController.isOpen(surface)) {
      closeSurface(surface, { restoreFocus: true });
    } else {
      openSurface(surface, { trigger });
    }
  }

  function initializeWorkspaceSurfaces() {
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

















    (MOBILE_SHEET_IDS = Object.freeze({search:'objectSearchSurface'}));
    mobileSheets=createMobileSheetPresentation({document,window,getElement:dependencies.platform.$,getLayout:()=>layoutMode,panelIds:MOBILE_SHEET_IDS,
      onSync:syncOverlayState,onClose:closeActiveMobileSheet,
      onResumeLayout:()=>{if(pendingLayoutChange){pendingLayoutChange=false;applyLayoutMode();}},
      onLayoutChange:()=>dependencies.mapHostViewB.queueMapResize('panel-layout'),
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
        if(select)dependencies.platformConfigurationB.selectController.closeAll({restoreFocus:true});
        else {closeActiveMobileSheet({restoreFocus:true,syncHistory:false});return;}
        trackMobileSheetHistory(surfaceController.activeMobileSheet);return;
      }
      if(event.state?.[MOBILE_SHEET_HISTORY_KEY]){const next={...event.state};delete next[MOBILE_SHEET_HISTORY_KEY];window.history.replaceState(next,'',window.location.href);}
    });
    if(window.visualViewport)listen(window.visualViewport,'resize', () => {
      refreshMapSheetMetrics();
      menuPositionScheduler.schedule();
    });
    if(window.visualViewport)listen(window.visualViewport,'scroll', () => { syncVisibleViewport(); menuPositionScheduler.schedule(); });
  }

  return Object.freeze({
    connect,
    initializeWorkspaceSurfaces,openFileMenu,
    dispose(){listeners.forEach(remove=>remove());if(mobileSheets)mobileSheets.dispose();if(menuPositionScheduler)menuPositionScheduler.cancel();if(searchToolbarPresentation)searchToolbarPresentation.dispose();cancelAnimationFrame(searchFocusFrame);},
    get MOBILE_SHEET_IDS() { return MOBILE_SHEET_IDS; },
    get applyLayoutMode() { return applyLayoutMode; },
    get bindMobileSheetSurface() { return mobileSheets.bindMobileSheetSurface; },
    get closeActiveMobileSheet() { return closeActiveMobileSheet; },
    get closeFileMenu() { return closeFileMenu; },
    get closeMobileSheets() { return closeMobileSheets; },
    get closeSurface() { return closeSurface; },
    get isMobile() { return isMobile; },
    get isFileMenuOpen(){return fileMenuOpen;},
    get layoutMode() { return layoutMode; },
    get openSurface() { return openSurface; },
    get refreshMapSheetMetrics() { return refreshMapSheetMetrics; },
    get focusSurfaceTrigger() { return focusSurfaceTrigger; },
    get setMobileSheetHeight() { return mobileSheets.setMobileSheetHeight; },
    get surfaceController() { return surfaceController; },
    get syncOverlayState() { return syncOverlayState; },
    get toggleFileMenu() { return toggleFileMenu; },
    get toggleSurface() { return toggleSurface; },
    get trackMobileSheetHistory() { return trackMobileSheetHistory; },
  });
}
