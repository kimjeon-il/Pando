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
    dependencies.editorSurfaceTabs = (0, dependencies.createSurfaceTabsController)({
      tablist: document.querySelector('.editor-view-tabs'),
      onSelect: (key, options) => (0, dependencies.setEditorShellView)(key, options),
    });
    dependencies.editorSurfaceTabs.bind();
    (0, dependencies.syncMapObjectCategoryLabels)();
    (0, dependencies.setEditorShellView)('info');
  }

  function toggleWorkspaceSurface(surface, trigger) {
    const wasOpen = surface === 'display' && (0, dependencies.$)('mapDisplaySurface')?.classList.contains('surface-open');
    (0, dependencies.toggleSurface)(surface, trigger);
    if (surface === 'display' && wasOpen) (0, dependencies.closeDesktopViewMenuGroup)();
    if (surface === 'display') (0, dependencies.renderMapDisplaySettings)();
  }

  function bindNavigationUI() {
    bindSurfaceTabs();
    (0, dependencies.bindMapDisplayUI)();
    let displayPointerStartedInside = false;
    let searchToolbarPointer = false;
    const closeDesktopDisplayMenu = () => {
      const display = (0, dependencies.$)('mapDisplaySurface');
      if (dependencies.layoutMode === 'mobile' || !display?.classList.contains('surface-open')) return;
      (0, dependencies.closeDesktopViewMenuGroup)();
      (0, dependencies.closeSurface)('display', { restoreFocus: false });
    };
    document.addEventListener('pointerdown', event => {
      displayPointerStartedInside = !!event.target.closest('#mapDisplaySurface');
      searchToolbarPointer = !!event.target.closest('#createMenuBtn, #resetViewBtn');
      if (!event.target.closest('#notificationCloseBtn')) (0, dependencies.clearErrorNotification)();
    }, true);
    document.addEventListener('click', e => {
      if (!e.target.closest('.top-actions') && !e.target.closest('#mobileFileBtn')) {
        (0, dependencies.closeFileMenu)();
      }
      if (!e.target.closest('#mapDisplaySurface, #mapDisplayBtn') && !(e.detail && displayPointerStartedInside)) {
        closeDesktopDisplayMenu();
      }
      if (!e.target.closest('#objectActionsMenu') && !e.target.closest('[data-layer-item-menu]')) (0, dependencies.closeObjectActionsMenu)();
      if (!e.target.closest('#objectChooser, #map')) (0, dependencies.closeObjectChooser)();
    });
    (0, dependencies.$)('objectChooserCloseBtn')?.addEventListener('click', () => (0, dependencies.closeObjectChooser)({ restoreFocus: true }));
    (0, dependencies.$)('objectChooserList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-object-chooser-index]');
      if (!button) return;
      (0, dependencies.chooseObjectCandidate)(button.dataset.objectChooserIndex, { toggle: event.ctrlKey || event.metaKey });
    });
    (0, dependencies.$)('objectChooserList')?.addEventListener('keydown', event => {
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

    (0, dependencies.$)('globeBtn').addEventListener('click', () => (0, dependencies.setProjection)('globe'));
    (0, dependencies.$)('flatBtn').addEventListener('click', () => (0, dependencies.setProjection)('flat'));

    (0, dependencies.$)('mobileFileBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      closeDesktopDisplayMenu();
      (0, dependencies.toggleFileMenu)();
    });
    (0, dependencies.$)('notificationCloseBtn')?.addEventListener('click', dependencies.clearNotification);
    (0, dependencies.$)('createMenuBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      closeDesktopDisplayMenu();
      (0, dependencies.toggleSurface)('create', event.currentTarget);
    });
    (0, dependencies.$)('objectSearchBtn')?.addEventListener('click', event => toggleWorkspaceSurface('search', event.currentTarget));
    (0, dependencies.$)('resetViewBtn')?.addEventListener('click', () => {
      if (dependencies.layoutMode !== 'mobile') (0, dependencies.closeSurface)('search');
    });
    const searchPanel = (0, dependencies.$)('objectSearchSurface');
    searchPanel?.addEventListener('keydown', event => {
      if (dependencies.state.projectReplacing) { event.preventDefault(); event.stopPropagation(); return; }
      if (event.isComposing || event.key !== 'Escape') event.stopPropagation();
      // Escape is handled after dialogs, but before map-edit commands, globally.
    });
    searchPanel?.addEventListener('focusout', event => {
      if (dependencies.layoutMode === 'mobile' || searchToolbarPointer) return;
      const next = event.relatedTarget;
      if (!next || next.closest('#objectSearchSurface, #objectSearchBtn, .ui-modal, [role="dialog"], .ui-overlay-scrollbar[aria-controls="layerSearchResults"]')) return;
      queueMicrotask(() => {
        if (dependencies.layoutMode !== 'mobile' && !searchPanel.contains(document.activeElement)) {
          (0, dependencies.closeSurface)('search');
        }
      });
    });
    document.addEventListener('pointerup', () => { searchToolbarPointer = false; });
    document.addEventListener('pointercancel', () => { searchToolbarPointer = false; });
    (0, dependencies.$)('mapDisplayBtn')?.addEventListener('click', event => toggleWorkspaceSurface('display', event.currentTarget));
    (0, dependencies.$)('objectLockBtn')?.addEventListener('click', () => dependencies.batchToggleLocked());
    (0, dependencies.$)('objectVisibilityBtn')?.addEventListener('click', () => dependencies.batchSetVisibility());
    (0, dependencies.$)('objectDeleteBtn')?.addEventListener('click', () => dependencies.deleteSelectedFromObjectMenu());
    (0, dependencies.$)('mobileBackdrop')?.addEventListener('click', () => {
      (0, dependencies.closeFileMenu)({ restoreFocus: true });
    });
    Object.values(dependencies.MOBILE_SHEET_IDS).forEach(id => (0, dependencies.bindMobileSheetSurface)((0, dependencies.$)(id)));
    (0, dependencies.$)('mobileCreateBtn')?.addEventListener('click', event => (0, dependencies.toggleSurface)('create', event.currentTarget));
    (0, dependencies.$)('mobileSearchBtn')?.addEventListener('click', event => toggleWorkspaceSurface('search', event.currentTarget));
    (0, dependencies.$)('mobileEditBtn')?.addEventListener('click', event => (0, dependencies.toggleSurface)('editor', event.currentTarget));
    (0, dependencies.$)('mobileDisplayBtn')?.addEventListener('click', event => toggleWorkspaceSurface('display', event.currentTarget));
    (0, dependencies.$)('objectSearchCloseBtn')?.addEventListener('click', () => (0, dependencies.closeSurface)('search', { restoreFocus: true }));
    (0, dependencies.$)('mapDisplayCloseBtn')?.addEventListener('click', () => (0, dependencies.closeSurface)('display', { restoreFocus: true }));
    (0, dependencies.$)('mobileCloseRightBtn')?.addEventListener('click', () => {
      (0, dependencies.closeSurface)('editor', { manual: dependencies.layoutMode === 'wide', restoreFocus: true });
    });
    (0, dependencies.$)('createMenu')?.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        (0, dependencies.closeSurface)('create', { restoreFocus: true }); return;
      }
      if (dependencies.layoutMode === 'mobile') return;
      if (event.key === 'Tab') {
        exitMenuOnTab(event, {
          menus: event.currentTarget,
          trigger: (0, dependencies.$)('createMenuBtn'),
          close: () => (0, dependencies.closeSurface)('create', { restoreFocus: false }),
        });
        return;
      }
      const items = (0, dependencies.activeCreateMenuItems)();
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
      if (dependencies.surfaceController.isOpen('create') && !event.target.closest('#createMenu, #createMenuBtn, .mobile-bottom-bar, .ui-modal, [role="dialog"]')) (0, dependencies.closeSurface)('create');
      if (dependencies.surfaceController.isOpen('search')
        && scrollbarOwner !== 'layerSearchResults'
        && !event.target.closest('#objectSearchSurface, #objectSearchBtn, #mobileSearchBtn, .map-command-toolbar, .mobile-bottom-bar, .ui-modal, [role="dialog"]')) {
        (0, dependencies.closeSurface)('search');
      }
    }, true);
    (0, dependencies.$)('createMenu')?.addEventListener('focusout', event => {
      if (dependencies.layoutMode === 'mobile') return;
      const next = event.relatedTarget;
      if (next && !next.closest('#createMenu, #createMenuBtn, .ui-modal, [role="dialog"]')) {
        (0, dependencies.closeSurface)('create');
      }
    });

  }

  function bindLayerUI() {
    dependencies.layerTreeController = (0, dependencies.createAppLayerTreeController)({
      window, document, getElement: dependencies.$, state: dependencies.state, layerSearchGroupKeys: dependencies.LAYER_SEARCH_GROUP_KEYS,
      layerGroupNames: dependencies.layerGroupNames, createIcon: (name, className) => (0, dependencies.createSemanticIcon)(document, name, className),
      createEmptyState: dependencies.createEmptyState, layerTreeItems: dependencies.layerTreeItems, layerItemObjectRef: dependencies.layerItemObjectRef, normalizeObjectRef: dependencies.normalizeObjectRef, selectionDomain: dependencies.selectionDomain,
      hydroCategoryKey: dependencies.hydroCategoryKey,
      compareItems: (left, right) => dependencies.layerNameCollator.compare(left.name, right.name) || dependencies.layerNameCollator.compare(left.id, right.id),
      syncCanonicalControls: dependencies.syncCanonicalControls, syncSearchClearButton: dependencies.syncSearchClearButton,
      markLayerTreeDirty: dependencies.markLayerTreeDirty, selectLayerTreeItem: dependencies.selectLayerTreeItem,
      closeSearchAfterSingleSelection: () => (0, dependencies.closeSurface)('search'),
    });
    dependencies.layerTreeController.bind();
  }



  return Object.freeze({
    connect,

    get bindLayerUI() { return bindLayerUI; },
    get bindNavigationUI() { return bindNavigationUI; },
  });
}
