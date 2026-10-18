import { createMobileSheetPresentation } from './mobile-sheet-presentation.js';
import { createWorkspaceLayoutDetector, isMobileWorkspaceLayout } from './workspace-layout.js';
import { clearMenuPosition, createMenuPositionScheduler, positionRootMenu } from './menu-presentation.js';
import { createSearchToolbarPresentation } from './search-toolbar-presentation.js';

/** WorkspaceSurfaces: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createWorkspaceSurfaces() {
  let dependencies, mobileSheets;
  let isPolygonDraftTool;
  let isGenericFeatureDraftTool;
  let clampViewZooms;
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
  let mapModeContextWasActive;
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
    if (app) app.dataset.layout = layoutMode;
    document.body.dataset.layout = layoutMode;
    surfaceController.syncLayout(previous);
    if (isMobileWorkspaceLayout(previous) && !isMobile()) releaseMobileSheetHistory();
    else if (isMobile() && !isMobileWorkspaceLayout(previous) && surfaceController.activeMobileSheet) {
      trackMobileSheetHistory(surfaceController.activeMobileSheet);
    }
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
    surfaceController.render({ fileOpen });
    referenceSurface?.sync();
    searchToolbarPresentation.sync();
    editorWorkspacePresentation.sync();
    dependencies.domains.renderingDomain?.setCountryPropertyEditingActive?.(
      surfaceController.isOpen('editor') && !!dependencies.projectState.state.selected,
    );
    dependencies.domainControllers.syncTerritorialEditorInteraction();
    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);
    refreshMapSheetMetrics();
    syncEditorPanelControls();
    requestAnimationFrame(dependencies.taskPresentation.syncMapHudBounds);
    syncCreateSurface();
    menuPositionScheduler.schedule();
    if (!initial && previous !== layoutMode) (0, dependencies.mapHostViewB.queueMapResize)('layout-mode-change');
    return previous !== layoutMode;
  }

  function syncOverlayState() {
    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');
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
    editorWorkspacePresentation.sync();
    dependencies.domains.renderingDomain?.setCountryPropertyEditingActive?.(
      surfaceController.isOpen('editor') && !!dependencies.projectState.state.selected,
    );
    dependencies.domainControllers.syncTerritorialEditorInteraction();
    syncEditorPanelControls();
    refreshMapSheetMetrics();
    requestAnimationFrame(dependencies.taskPresentation.syncMapHudBounds);
    syncCreateSurface();
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
    if (!menu?.classList.contains('mobile-open')) return;
    const trigger = fileMenuTrigger;
    fileMenuTrigger = null;
    menu.classList.remove('mobile-open');
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
    const trigger = rememberedTrigger || (0, dependencies.platform.$)(ids[surface])
      || (lastOverlayTrigger?.getClientRects().length ? lastOverlayTrigger : (0, dependencies.platform.$)('map'));
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
    if (fileMenu?.classList.contains('mobile-open')) {
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
    for (const surface of ['create', 'search', 'display', 'editor', 'reference']) if (surface !== except) surfaceController.close(surface);
    syncOverlayState();
    if (restoreFocus && lastOverlayTrigger?.isConnected) lastOverlayTrigger.focus({ preventScroll: true });
    if (restoreFocus) lastOverlayTrigger = null;
  }

  function toggleFileMenu() {
    closeSurface('create');
    const menu = document.querySelector('.top-actions');
    if (!menu) return;
    const willOpen = !menu.classList.contains('mobile-open');
    if (willOpen) fileMenuTrigger = (0, dependencies.platform.$)('mobileFileBtn');
    menu.classList.toggle('mobile-open', willOpen);
    syncOverlayState();
    if (willOpen) requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }));
  }











  function openSelectionEditor({ explicit = false, trigger = null, focus = false } = {}) {
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
    if (!['create', 'search', 'display', 'editor', 'reference'].includes(surface)) return false;
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
      closeMobileSheets();
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

  function initializeIsPolygonDraftTool() {
    (isPolygonDraftTool = tool => (0, dependencies.countryEditingA.draftToolConfig)(tool)?.shape === 'polygon');

    (isGenericFeatureDraftTool = tool => !!(0, dependencies.countryEditingA.draftToolConfig)(tool));

    (clampViewZooms = view => {
      if (!view) return view;
      view.globeZoom = (0, dependencies.platform.clamp)(Number(view.globeZoom) || 1, dependencies.mapNavigation.ZOOM_LIMITS.globe.min, dependencies.mapNavigation.ZOOM_LIMITS.globe.max);
      view.flatZoom = (0, dependencies.platform.clamp)(Number(view.flatZoom) || 1, dependencies.mapNavigation.ZOOM_LIMITS.flat.min, dependencies.mapNavigation.ZOOM_LIMITS.flat.max);
      return view;
    });

    (uid = () => (0, dependencies.projectServices.createProjectObjectId)());

    const detect = createWorkspaceLayoutDetector();
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    detectLayoutMode = () => detect({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      coarse: coarsePointer.matches,
      editingText: searchComposing || !!document.activeElement?.matches('input, textarea, select, [contenteditable="true"]'),
    });
    coarsePointer.addEventListener('change', () => applyLayoutMode());

    (layoutMode = detectLayoutMode());

    (isMobile = () => isMobileWorkspaceLayout(layoutMode));

    (lastOverlayTrigger = null);

    (fileMenuTrigger = null);


    (surfaceController = (0, dependencies.uiFactoriesB.createSurfaceController)({ getElement: dependencies.platform.$, getLayout: () => layoutMode, document }));

    (surfaceState = surfaceController.state);

    (editorWorkspacePresentation = (0, dependencies.uiFactoriesA.createEditorWorkspacePresentation)({
      document,
      panel: (0, dependencies.platform.$)('editorSurface'), task: (0, dependencies.platform.$)('modeEditingContext'),
      dockSlot: (0, dependencies.platform.$)('editorTaskSlot'), floatingSlot: (0, dependencies.platform.$)('mapTopContextSlot'),
      isEditorOpen: () => surfaceController.isOpen('editor'),
      openEditor: () => {
        if (!surfaceController.isOpen('create')) openSurface('editor');
      },
      onLayoutChange: () => (0, dependencies.mapHostViewB.queueMapResize)('editor-task-layout'),
    }));

    (editorSurfaceTabs = null);















    (MOBILE_SHEET_IDS = Object.freeze({ create: 'createMenu', search: 'objectSearchSurface', display: 'mapDisplaySurface', edit: 'editorSurface', reference: 'referenceImageSurface' }));
    mobileSheets=createMobileSheetPresentation({document,window,getElement:dependencies.platform.$,getLayout:()=>layoutMode,panelIds:MOBILE_SHEET_IDS,
      onSync:syncOverlayState,onClose:closeActiveMobileSheet,
      onResumeLayout:()=>{if(pendingLayoutChange){pendingLayoutChange=false;applyLayoutMode();}},
      onLayoutChange:()=>{requestAnimationFrame(dependencies.taskPresentation.syncMapHudBounds);dependencies.mapHostViewB.queueMapResize('panel-layout');},
    });







    (mapModeContextWasActive = false);

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
    (0, dependencies.platform.$)('objectSearchInput')?.addEventListener('compositionstart', () => { searchComposing = true; });
    (0, dependencies.platform.$)('objectSearchInput')?.addEventListener('compositionend', () => {
      searchComposing = false;
      if (pendingLayoutChange) applyLayoutMode();
    });
    window.addEventListener('resize', () => menuPositionScheduler.schedule());
    window.visualViewport?.addEventListener?.('resize', () => { refreshMapSheetMetrics(); menuPositionScheduler.schedule(); });
    window.visualViewport?.addEventListener?.('scroll', () => { syncVisibleViewport(); menuPositionScheduler.schedule(); });
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
    initializeIsPolygonDraftTool,
    get MOBILE_SHEET_HISTORY_KEY() { return MOBILE_SHEET_HISTORY_KEY; },
    get MOBILE_SHEET_IDS() { return MOBILE_SHEET_IDS; },
    get activeCreateMenuItems() { return activeCreateMenuItems; },
    get applyLayoutMode() { return applyLayoutMode; },
    get bindMobileSheetSurface() { return mobileSheets.bindMobileSheetSurface; },
    get clampViewZooms() { return clampViewZooms; },
    get closeActiveMobileSheet() { return closeActiveMobileSheet; },
    get closeFileMenu() { return closeFileMenu; },
    get closeMobileSheets() { return closeMobileSheets; },
    get closeSurface() { return closeSurface; },
    get editorSurfaceTabs() { return editorSurfaceTabs; },
    set editorSurfaceTabs(value) { editorSurfaceTabs = value; },
    get editorWorkspacePresentation() { return editorWorkspacePresentation; },
    get fileMenuTrigger() { return fileMenuTrigger; },
    set fileMenuTrigger(value) { fileMenuTrigger = value; },
    get ignoreNextMobileSheetPopstate() { return ignoreNextMobileSheetPopstate; },
    set ignoreNextMobileSheetPopstate(value) { ignoreNextMobileSheetPopstate = value; },
    get isGenericFeatureDraftTool() { return isGenericFeatureDraftTool; },
    get isMobile() { return isMobile; },
    get isPolygonDraftTool() { return isPolygonDraftTool; },
    get layoutMode() { return layoutMode; },
    get mapModeContextWasActive() { return mapModeContextWasActive; },
    set mapModeContextWasActive(value) { mapModeContextWasActive = value; },
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
