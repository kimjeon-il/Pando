import { exitMenuOnTab } from './menu-presentation.js';

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

  function bindSurfaceTabs() {
    dependencies.surfaceCommands.installEditorSurfaceTabs((0, dependencies.uiFactoriesB.createSurfaceTabsController)({
      tablist: document.querySelector('.editor-view-tabs'),
      onSelect: (key, options) => (0, dependencies.propertyEditingB.setEditorShellView)(key, options),
    }));
    dependencies.workspaceUiA.editorSurfaceTabs.bind();
    (0, dependencies.objectModelB.syncMapObjectCategoryLabels)();
    (0, dependencies.propertyEditingB.setEditorShellView)('info');
  }

  function toggleWorkspaceSurface(surface, trigger) {
    const wasOpen = surface === 'display' && (0, dependencies.platform.$)('mapDisplaySurface')?.classList.contains('surface-open');
    (0, dependencies.workspaceUiC.toggleSurface)(surface, trigger);
    if (surface === 'display' && wasOpen) (0, dependencies.mapSettingsUi.closeDesktopViewMenuGroup)();
    if (surface === 'display') (0, dependencies.mapSettingsUi.renderMapDisplaySettings)();
  }

  function bindNavigationUI() {
    bindSurfaceTabs();
    (0, dependencies.mapSettingsUi.bindMapDisplayUI)();
    let displayPointerStartedInside = false;
    let searchToolbarPointer = false;
    const closeDesktopDisplayMenu = () => {
      const display = (0, dependencies.platform.$)('mapDisplaySurface');
      if (dependencies.surfaces.layoutMode === 'mobile' || !display?.classList.contains('surface-open')) return;
      (0, dependencies.mapSettingsUi.closeDesktopViewMenuGroup)();
      (0, dependencies.workspaceUiA.closeSurface)('display', { restoreFocus: false });
    };
    document.addEventListener('pointerdown', event => {
      displayPointerStartedInside = !!event.target.closest('#mapDisplaySurface');
      searchToolbarPointer = !!event.target.closest('#createMenuBtn, #resetViewBtn');
      if (!event.target.closest('#notificationCloseBtn')) (0, dependencies.readinessUi.clearErrorNotification)();
    }, true);
    document.addEventListener('click', e => {
      if (!e.target.closest('.top-actions') && !e.target.closest('#mobileFileBtn')) {
        (0, dependencies.workspaceUiA.closeFileMenu)();
      }
      if (!e.target.closest('#mapDisplaySurface, #mapDisplayBtn') && !(e.detail && displayPointerStartedInside)) {
        closeDesktopDisplayMenu();
      }
      if (!e.target.closest('#objectActionsMenu') && !e.target.closest('[data-layer-item-menu]')) (0, dependencies.objectOperationsA.closeObjectActionsMenu)();
      if (!e.target.closest('#objectChooser, #map')) (0, dependencies.objectPicking.closeObjectChooser)();
    });
    (0, dependencies.platform.$)('objectChooserCloseBtn')?.addEventListener('click', () => (0, dependencies.objectPicking.closeObjectChooser)({ restoreFocus: true }));
    (0, dependencies.platform.$)('objectChooserList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-object-chooser-index]');
      if (!button) return;
      (0, dependencies.objectPicking.chooseObjectCandidate)(button.dataset.objectChooserIndex, { toggle: event.ctrlKey || event.metaKey });
    });
    (0, dependencies.platform.$)('objectChooserList')?.addEventListener('keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('[data-object-chooser-index]')];
      const current = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      event.stopPropagation();
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
        return;
      }
      if (delta) {
        event.preventDefault();
        items[(current + delta + items.length) % items.length]?.focus();
      }
    });

    (0, dependencies.platform.$)('globeBtn').addEventListener('click', () => (0, dependencies.mapSettingsUi.setProjection)('globe'));
    (0, dependencies.platform.$)('flatBtn').addEventListener('click', () => (0, dependencies.mapSettingsUi.setProjection)('flat'));

    (0, dependencies.platform.$)('mobileFileBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      closeDesktopDisplayMenu();
      (0, dependencies.workspaceUiB.toggleFileMenu)();
    });
    (0, dependencies.platform.$)('notificationCloseBtn')?.addEventListener('click', dependencies.readinessUi.clearNotification);
    (0, dependencies.platform.$)('createMenuBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      closeDesktopDisplayMenu();
      (0, dependencies.workspaceUiC.toggleSurface)('create', event.currentTarget);
    });
    (0, dependencies.platform.$)('objectSearchBtn')?.addEventListener('click', event => toggleWorkspaceSurface('search', event.currentTarget));
    (0, dependencies.platform.$)('resetViewBtn')?.addEventListener('click', () => {
      if (dependencies.surfaces.layoutMode !== 'mobile') (0, dependencies.workspaceUiA.closeSurface)('search');
    });
    const searchPanel = (0, dependencies.platform.$)('objectSearchSurface');
    searchPanel?.addEventListener('keydown', event => {
      if (dependencies.projectState.state.projectReplacing) { event.preventDefault(); event.stopPropagation(); return; }
      if (event.isComposing || event.key !== 'Escape') event.stopPropagation();
      // Escape is handled after dialogs, but before map-edit commands, globally.
    });
    searchPanel?.addEventListener('focusout', event => {
      if (dependencies.surfaces.layoutMode === 'mobile' || searchToolbarPointer) return;
      const next = event.relatedTarget;
      if (!next || next.closest('#objectSearchSurface, #objectSearchBtn, .ui-modal, [role="dialog"], .ui-overlay-scrollbar[aria-controls="layerSearchResults"]')) return;
      queueMicrotask(() => {
        if (dependencies.surfaces.layoutMode !== 'mobile' && !searchPanel.contains(document.activeElement)) {
          (0, dependencies.workspaceUiA.closeSurface)('search');
        }
      });
    });
    document.addEventListener('pointerup', () => { searchToolbarPointer = false; });
    document.addEventListener('pointercancel', () => { searchToolbarPointer = false; });
    (0, dependencies.platform.$)('mapDisplayBtn')?.addEventListener('click', event => toggleWorkspaceSurface('display', event.currentTarget));
    (0, dependencies.platform.$)('objectLockBtn')?.addEventListener('click', () => dependencies.objectOperationsA.batchToggleLocked());
    (0, dependencies.platform.$)('objectVisibilityBtn')?.addEventListener('click', () => dependencies.objectOperationsA.batchSetVisibility());
    (0, dependencies.platform.$)('objectDeleteBtn')?.addEventListener('click', () => dependencies.objectOperationsA.deleteSelectedFromObjectMenu());
    (0, dependencies.platform.$)('mobileBackdrop')?.addEventListener('click', () => {
      (0, dependencies.workspaceUiA.closeFileMenu)({ restoreFocus: true });
    });
    Object.values(dependencies.workspaceUiA.MOBILE_SHEET_IDS).forEach(id => (0, dependencies.workspaceUiA.bindMobileSheetSurface)((0, dependencies.platform.$)(id)));
    (0, dependencies.platform.$)('mobileCreateBtn')?.addEventListener('click', event => (0, dependencies.workspaceUiC.toggleSurface)('create', event.currentTarget));
    (0, dependencies.platform.$)('mobileSearchBtn')?.addEventListener('click', event => toggleWorkspaceSurface('search', event.currentTarget));
    (0, dependencies.platform.$)('mobileEditBtn')?.addEventListener('click', event => (0, dependencies.workspaceUiC.toggleSurface)('editor', event.currentTarget));
    (0, dependencies.platform.$)('mobileDisplayBtn')?.addEventListener('click', event => toggleWorkspaceSurface('display', event.currentTarget));
    (0, dependencies.platform.$)('objectSearchCloseBtn')?.addEventListener('click', () => (0, dependencies.workspaceUiA.closeSurface)('search', { restoreFocus: true }));
    (0, dependencies.platform.$)('mapDisplayCloseBtn')?.addEventListener('click', () => (0, dependencies.workspaceUiA.closeSurface)('display', { restoreFocus: true }));
    (0, dependencies.platform.$)('mobileCloseRightBtn')?.addEventListener('click', () => {
      (0, dependencies.workspaceUiA.closeSurface)('editor', { manual: dependencies.surfaces.layoutMode === 'wide', restoreFocus: true });
    });
    (0, dependencies.platform.$)('createMenu')?.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        (0, dependencies.workspaceUiA.closeSurface)('create', { restoreFocus: true }); return;
      }
      if (dependencies.surfaces.layoutMode === 'mobile') return;
      if (event.key === 'Tab') {
        exitMenuOnTab(event, {
          menus: event.currentTarget,
          trigger: (0, dependencies.platform.$)('createMenuBtn'),
          close: () => (0, dependencies.workspaceUiA.closeSurface)('create', { restoreFocus: false }),
        });
        return;
      }
      const items = (0, dependencies.workspaceUiA.activeCreateMenuItems)();
      const index = items.indexOf(document.activeElement);
      let nextIndex;
      if (event.key === 'ArrowDown') nextIndex = (index + 1 + items.length) % items.length;
      else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = items.length - 1;
      else return;
      event.preventDefault();
      items[nextIndex]?.focus();
    });
    document.addEventListener('pointerdown', event => {
      const scrollbarOwner = event.target.closest('.ui-overlay-scrollbar')?.getAttribute('aria-controls');
      if (scrollbarOwner === 'createMenu') return;
      if (dependencies.workspaceUiB.surfaceController.isOpen('create') && !event.target.closest('#createMenu, #createMenuBtn, .mobile-bottom-bar, .ui-modal, [role="dialog"]')) (0, dependencies.workspaceUiA.closeSurface)('create');
      if (dependencies.workspaceUiB.surfaceController.isOpen('search')
        && scrollbarOwner !== 'layerSearchResults'
        && !event.target.closest('#objectSearchSurface, #objectSearchBtn, #mobileSearchBtn, .map-command-toolbar, .mobile-bottom-bar, .ui-modal, [role="dialog"]')) {
        (0, dependencies.workspaceUiA.closeSurface)('search');
      }
    }, true);
    (0, dependencies.platform.$)('createMenu')?.addEventListener('focusout', event => {
      if (dependencies.surfaces.layoutMode === 'mobile') return;
      const next = event.relatedTarget;
      if (next && !next.closest('#createMenu, #createMenuBtn, .ui-modal, [role="dialog"]')) {
        (0, dependencies.workspaceUiA.closeSurface)('create');
      }
    });

  }

  function bindLayerUI() {
    dependencies.uiRegistryCommands.installLayerTreeController((0, dependencies.uiFactoriesA.createAppLayerTreeController)({
      window, document, getElement: dependencies.platform.$, state: dependencies.projectState.state, layerSearchGroupKeys: dependencies.objectModelA.LAYER_SEARCH_GROUP_KEYS,
      layerGroupNames: dependencies.layerPresentation.layerGroupNames, createIcon: (name, className) => (0, dependencies.applicationFactories.createSemanticIcon)(document, name, className),
      createEmptyState: dependencies.platformConfigurationB.createEmptyState, layerTreeItems: dependencies.layerTree.layerTreeItems, layerItemObjectRef: dependencies.objectLookup.layerItemObjectRef, normalizeObjectRef: dependencies.selectionServices.normalizeObjectRef, selectionDomain: dependencies.domains.selectionDomain,
      hydroCategoryKey: dependencies.hydroPresentation.hydroCategoryKey,
      compareItems: (left, right) => dependencies.objectModelA.layerNameCollator.compare(left.name, right.name) || dependencies.objectModelA.layerNameCollator.compare(left.id, right.id),
      syncCanonicalControls: dependencies.readinessUi.syncCanonicalControls, syncSearchClearButton: dependencies.platformConfigurationB.syncSearchClearButton,
      markLayerTreeDirty: dependencies.layers.markLayerTreeDirty, selectLayerTreeItem: dependencies.navigation.selectLayerTreeItem,
      focusObjectRef: dependencies.objectOperationsA.focusObjectRef,
      closeSearchAfterSingleSelection: () => (0, dependencies.workspaceUiA.closeSurface)('search'),
    }));
    dependencies.domains.layerTreeController.bind();
  }



  return Object.freeze({
    connect,

    get bindLayerUI() { return bindLayerUI; },
    get bindNavigationUI() { return bindNavigationUI; },
  });
}
