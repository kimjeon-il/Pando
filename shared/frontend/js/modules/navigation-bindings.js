import { isMobileWorkspaceLayout } from './workspace-layout.js';

/** NavigationBindings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createNavigationBindings() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('navigation-bindings already connected');
    dependencies = ports;
  }

  function toggleWorkspaceSurface(surface, trigger) {
    const wasOpen = surface === 'display' && dependencies.workspaceUiB.surfaceController.isOpen('display');
    (0, dependencies.workspaceUiC.toggleSurface)(surface, trigger);
    if (surface === 'display' && wasOpen) (0, dependencies.mapSettingsUi.closeDesktopViewMenuGroup)();
    if (surface === 'display') (0, dependencies.mapSettingsUi.renderMapDisplaySettings)();
  }

  function bindNavigationUI() {
    (0, dependencies.mapSettingsUi.bindMapDisplayUI)();
    let mobileMenuOpen=false;
    const mobileMenu = () => (0, dependencies.platform.$)('mobileGlobalMenu');
    const closeMobileMenu = ({ restoreFocus = false } = {}) => {
      const menu = mobileMenu();
      if (!menu || !mobileMenuOpen) return;
      mobileMenuOpen=false;menu.hidden = true;
      (0, dependencies.platform.$)('mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) (0, dependencies.platform.$)('mobileMenuBtn')?.focus({ preventScroll: true });
    };
    const openMobileMenu = () => {
      const menu = mobileMenu();
      if (!menu) return;
      (0, dependencies.workspaceUiA.closeFileMenu)();
      (0, dependencies.workspaceUiA.closeSurface)('create');
      mobileMenuOpen=true;menu.hidden = false;
      (0, dependencies.platform.$)('mobileMenuBtn')?.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }));
    };
    let displayPointerStartedInside = false;
    let searchToolbarPointer = false;
    const closeDesktopDisplayMenu = () => {
      const display = (0, dependencies.platform.$)('mapDisplaySurface');
      if (isMobileWorkspaceLayout(dependencies.surfaces.layoutMode) || !display||!dependencies.workspaceUiB.surfaceController.isOpen('display')) return;
      (0, dependencies.mapSettingsUi.closeDesktopViewMenuGroup)();
      (0, dependencies.workspaceUiA.closeSurface)('display', { restoreFocus: false });
    };
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('.ui-modal:not(.hidden),[aria-modal="true"]:not(.hidden):not([hidden])'))return;
      if(mobileMenuOpen){closeMobileMenu({restoreFocus:true});event.preventDefault();event.stopImmediatePropagation();return;}
      if(dependencies.workspaceUiB.isFileMenuOpen){dependencies.workspaceUiA.closeFileMenu({restoreFocus:true});event.preventDefault();event.stopImmediatePropagation();return;}
      for(const surface of ['search','display'])if(dependencies.workspaceUiB.surfaceController.isOpen(surface)){dependencies.workspaceUiA.closeSurface(surface,{restoreFocus:true});event.preventDefault();event.stopImmediatePropagation();return;}
    });
    document.addEventListener('pointerdown', event => {
      displayPointerStartedInside = !!event.target.closest('#mapDisplaySurface');
      searchToolbarPointer = !!event.target.closest('#resetViewBtn');
      if (!event.target.closest('#notificationCloseBtn')) (0, dependencies.readinessUi.clearErrorNotification)();
    }, true);
    document.addEventListener('click', e => {
      if (!e.target.closest('.top-actions') && !e.target.closest('#mobileFileBtn')) {
        (0, dependencies.workspaceUiA.closeFileMenu)();
      }
      if (!e.target.closest('#mobileGlobalMenu, #mobileMenuBtn')) closeMobileMenu();
      if (!e.target.closest('#mapDisplaySurface, #mapDisplayBtn') && !(e.detail && displayPointerStartedInside)) {
        closeDesktopDisplayMenu();
      }
    });

    (0, dependencies.platform.$)('mobileFileBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      closeDesktopDisplayMenu();
      (0, dependencies.workspaceUiB.toggleFileMenu)();
    });
    (0, dependencies.platform.$)('mobileMenuBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      if (!mobileMenuOpen) openMobileMenu(); else closeMobileMenu({ restoreFocus: true });
    });
    for (const id of ['mobileUndoBtn', 'mobileRedoBtn']) {
      (0, dependencies.platform.$)(id)?.addEventListener('click', () => closeMobileMenu());
    }
    (0, dependencies.platform.$)('mobileMenuFileBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      closeMobileMenu();
      (0, dependencies.workspaceUiB.toggleFileMenu)();
    });
    (0, dependencies.platform.$)('mobileFileBackBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      (0, dependencies.workspaceUiA.closeFileMenu)();
      openMobileMenu();
    });
    (0, dependencies.platform.$)('mobilePreferencesBtn')?.addEventListener('click', () => {
      closeMobileMenu();
      (0, dependencies.platform.$)('preferencesBtn')?.click();
    });
    (0, dependencies.platform.$)('mobileHelpBtn')?.addEventListener('click', () => {
      closeMobileMenu();
      (0, dependencies.platform.$)('helpBtn')?.click();
    });
    (0, dependencies.platform.$)('mobileGlobalMenu')?.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeMobileMenu({ restoreFocus: true });
    });
    (0, dependencies.platform.$)('notificationCloseBtn')?.addEventListener('click', dependencies.readinessUi.clearNotification);
    (0, dependencies.platform.$)('objectSearchBtn')?.addEventListener('click', event => toggleWorkspaceSurface('search', event.currentTarget));
    (0, dependencies.platform.$)('resetViewBtn')?.addEventListener('click', () => {
      if (!isMobileWorkspaceLayout(dependencies.surfaces.layoutMode)) (0, dependencies.workspaceUiA.closeSurface)('search');
      (0, dependencies.navigation.resetView)();
    });
    const searchPanel = (0, dependencies.platform.$)('objectSearchSurface');
    searchPanel?.addEventListener('keydown', event => {
      if (dependencies.projectState.state.projectReplacing) { event.preventDefault(); event.stopPropagation(); return; }
      if (event.isComposing || event.key !== 'Escape') event.stopPropagation();
      // Escape is handled after dialogs, but before map-edit commands, globally.
    });
    searchPanel?.addEventListener('focusout', event => {
      if (isMobileWorkspaceLayout(dependencies.surfaces.layoutMode) || searchToolbarPointer) return;
      const next = event.relatedTarget;
      if (!next || next.closest('#objectSearchSurface, #objectSearchBtn, .ui-modal, [role="dialog"], .ui-overlay-scrollbar[aria-controls="objectSearchResults"]')) return;
      queueMicrotask(() => {
        if (!isMobileWorkspaceLayout(dependencies.surfaces.layoutMode) && !searchPanel.contains(document.activeElement)) {
          (0, dependencies.workspaceUiA.closeSurface)('search');
        }
      });
    });
    document.addEventListener('pointerup', () => { searchToolbarPointer = false; });
    document.addEventListener('pointercancel', () => { searchToolbarPointer = false; });
    (0, dependencies.platform.$)('mapDisplayBtn')?.addEventListener('click', event => toggleWorkspaceSurface('display', event.currentTarget));
    (0, dependencies.platform.$)('objectLockBtn')?.addEventListener('click', async () => {
      try { await dependencies.objectOperationsA.batchToggleLocked(); }
      catch (error) { dependencies.feedback.reportOperationError(error, '객체 잠금을 변경하지 못했습니다.', 'PL-OBJECT-LOCK-001', 4200); }
    });
    (0, dependencies.platform.$)('objectVisibilityBtn')?.addEventListener('click', async () => {
      try { await dependencies.objectOperationsA.batchSetVisibility(); }
      catch(error) { dependencies.feedback.reportOperationError(error,'객체 표시를 변경하지 못했습니다.','PL-VIEW-COMMAND-001',4200); }
    });
    (0, dependencies.platform.$)('objectDeleteBtn')?.addEventListener('click', () => dependencies.objectOperationsA.deleteSelectedFromObjectMenu());
    (0, dependencies.platform.$)('mobileBackdrop')?.addEventListener('click', () => {
      (0, dependencies.workspaceUiA.closeFileMenu)({ restoreFocus: true });
      closeMobileMenu({ restoreFocus: true });
    });
    Object.values(dependencies.workspaceUiA.MOBILE_SHEET_IDS).forEach(id => (0, dependencies.workspaceUiA.bindMobileSheetSurface)((0, dependencies.platform.$)(id)));
    (0, dependencies.platform.$)('mobileSearchBtn')?.addEventListener('click', event => toggleWorkspaceSurface('search', event.currentTarget));
    (0, dependencies.platform.$)('mobileDisplayBtn')?.addEventListener('click', event => {
      closeMobileMenu();
      toggleWorkspaceSurface('display', event.currentTarget);
    });
    (0, dependencies.platform.$)('objectSearchCloseBtn')?.addEventListener('click', () => (0, dependencies.workspaceUiA.closeSurface)('search', { restoreFocus: true }));
    (0, dependencies.platform.$)('mapDisplayCloseBtn')?.addEventListener('click', () => (0, dependencies.workspaceUiA.closeSurface)('display', { restoreFocus: true }));
    document.addEventListener('pointerdown', event => {
      const scrollbarOwner = event.target.closest('.ui-overlay-scrollbar')?.getAttribute('aria-controls');
      if (dependencies.workspaceUiB.surfaceController.isOpen('search')
        && scrollbarOwner !== 'objectSearchResults'
        && !event.target.closest('#objectSearchSurface, #objectSearchBtn, #mobileSearchBtn, .map-command-toolbar, .mobile-bottom-bar, .ui-modal, [role="dialog"]')) {
        (0, dependencies.workspaceUiA.closeSurface)('search');
      }
    }, true);

  }

  function bindLayerUI() {
    dependencies.uiRegistryCommands.installObjectSearchController((0, dependencies.uiFactoriesA.createAppObjectSearchController)({
      window, document, getElement: dependencies.platform.$, state: dependencies.projectState.state, objectSearchGroupKeys: dependencies.objectModelA.LAYER_SEARCH_GROUP_KEYS,
      layerGroupNames: dependencies.layerPresentation.layerGroupNames, createIcon: (name, className) => (0, dependencies.applicationFactories.createSemanticIcon)(document, name, className),
      createEmptyState: dependencies.platformConfigurationB.createEmptyState, listObjectSearchItems: dependencies.objectCatalogView.listObjectSearchItems, layerItemObjectRef: dependencies.objectLookup.layerItemObjectRef, normalizeObjectRef: dependencies.selectionServices.normalizeObjectRef, selectionDomain: dependencies.domains.selectionDomain,
      hydroCategoryKey: dependencies.hydroPresentation.hydroCategoryKey,
      isSearchOpen: () => dependencies.workspaceUiB.surfaceController.isOpen('search') && dependencies.labelPresentation.builtinPlaces.isSearchOpen(),
      isSearchSurfaceOpen: () => dependencies.workspaceUiB.surfaceController.isOpen('search'),
      builtinSearch: query => dependencies.labelPresentation.builtinPlaces.search(query),
      cancelBuiltinSearch: () => dependencies.labelPresentation.builtinPlaces.cancelSearch(),
      onSearchError: error => dependencies.feedback.reportOperationError(error, '내장 지명 검색에 실패했습니다.', 'PL-PLACE-SEARCH-001'),
      syncCanonicalControls: dependencies.readinessUi.syncCanonicalControls,
      invalidateObjectPresentation: dependencies.objectDisplay.invalidateObjectPresentation, selectObjectSearchItem: dependencies.navigation.selectObjectSearchItem,
      focusObjectRef: dependencies.objectOperationsA.focusObjectRef,
      closeSearchAfterSingleSelection: () => (0, dependencies.workspaceUiA.closeSurface)('search'),
    }));
    dependencies.domains.objectSearchController.bind();
  }



  return Object.freeze({
    connect,

    get bindLayerUI() { return bindLayerUI; },
    get bindNavigationUI() { return bindNavigationUI; },
  });
}
