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
    if (surface === 'search' && (0, dependencies.$)('objectSearchSurface')?.classList.contains('surface-open')) {
      requestAnimationFrame(() => (0, dependencies.$)('layerSearchInput')?.focus({ preventScroll: true }));
    }
  }

  function bindNavigationUI() {
    bindSurfaceTabs();
    (0, dependencies.bindMapDisplayUI)();
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('#notificationCloseBtn')) (0, dependencies.clearErrorNotification)();
    }, true);
    document.addEventListener('click', e => {
      if (!e.target.closest('.top-actions') && !e.target.closest('#mobileFileBtn')) {
        (0, dependencies.closeFileMenu)();
      }
      const display = (0, dependencies.$)('mapDisplaySurface');
      if (dependencies.layoutMode !== 'mobile' && display?.classList.contains('surface-open') && !e.target.closest('#mapDisplaySurface, #mapDisplayBtn')) {
        (0, dependencies.closeDesktopViewMenuGroup)();
        (0, dependencies.closeSurface)('display');
      }
      if (!e.target.closest('#objectActionsMenu') && !e.target.closest('[data-layer-item-menu]')) (0, dependencies.closeObjectActionsMenu)();
      if (!e.target.closest('#objectChooser')) (0, dependencies.closeObjectChooser)();
    });
    (0, dependencies.$)('objectChooserCloseBtn')?.addEventListener('click', () => (0, dependencies.closeObjectChooser)({ restoreFocus: true }));
    (0, dependencies.$)('objectChooserList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-object-chooser-index]');
      const ref = button ? dependencies.objectChooserCandidates[Number(button.dataset.objectChooserIndex)] : null;
      if (!ref) return;
      dependencies.selectionUiController.applyIntent(ref, { mode: event.ctrlKey || event.metaKey ? 'toggle' : 'replace', scope: 'map' });
    });
    (0, dependencies.$)('objectChooserList')?.addEventListener('keydown', event => {
      const items = [...event.currentTarget.querySelectorAll('[data-object-chooser-index]')];
      const current = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!delta) return;
      event.preventDefault();
      items[(current + delta + items.length) % items.length]?.focus();
    });

    (0, dependencies.$)('globeBtn').addEventListener('click', () => (0, dependencies.setProjection)('globe'));
    (0, dependencies.$)('flatBtn').addEventListener('click', () => (0, dependencies.setProjection)('flat'));

    (0, dependencies.$)('mobileFileBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      (0, dependencies.toggleFileMenu)();
    });
    (0, dependencies.$)('notificationCloseBtn')?.addEventListener('click', dependencies.clearNotification);
    (0, dependencies.$)('createMenuBtn')?.addEventListener('click', event => {
      event.stopPropagation();
      (0, dependencies.toggleCreateMenu)(event.currentTarget);
    });
    (0, dependencies.$)('objectSearchBtn')?.addEventListener('click', event => toggleWorkspaceSurface('search', event.currentTarget));
    (0, dependencies.$)('mapDisplayBtn')?.addEventListener('click', event => toggleWorkspaceSurface('display', event.currentTarget));
    (0, dependencies.$)('objectLockBtn')?.addEventListener('click', () => dependencies.batchToggleLocked());
    (0, dependencies.$)('objectVisibilityBtn')?.addEventListener('click', () => dependencies.batchSetVisibility());
    (0, dependencies.$)('objectDeleteBtn')?.addEventListener('click', () => dependencies.deleteSelectedFromObjectMenu());
    (0, dependencies.$)('mobileBackdrop')?.addEventListener('click', () => {
      (0, dependencies.closeFileMenu)({ restoreFocus: true });
    });
    Object.values(dependencies.MOBILE_SHEET_IDS).forEach(id => (0, dependencies.bindMobileSheetSurface)((0, dependencies.$)(id)));
    (0, dependencies.$)('mobileSearchBtn')?.addEventListener('click', event => toggleWorkspaceSurface('search', event.currentTarget));
    (0, dependencies.$)('mobileEditBtn')?.addEventListener('click', event => (0, dependencies.toggleSurface)('editor', event.currentTarget));
    (0, dependencies.$)('mobileDisplayBtn')?.addEventListener('click', event => toggleWorkspaceSurface('display', event.currentTarget));
    (0, dependencies.$)('objectSearchCloseBtn')?.addEventListener('click', () => (0, dependencies.closeSurface)('search', { restoreFocus: true }));
    (0, dependencies.$)('mapDisplayCloseBtn')?.addEventListener('click', () => (0, dependencies.closeSurface)('display', { restoreFocus: true }));
    (0, dependencies.$)('mobileCloseRightBtn')?.addEventListener('click', () => {
      (0, dependencies.closeSurface)('editor', { manual: dependencies.layoutMode === 'wide', restoreFocus: true });
    });
    (0, dependencies.$)('createMenu')?.addEventListener('keydown', event => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        (0, dependencies.closeCreateMenu)({ restoreFocus: true }); return;
      }
      if (event.key === 'Tab') { (0, dependencies.closeCreateMenu)({ restoreFocus: true }); return; }
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
      if (event.target.closest('.ui-overlay-scrollbar')?.getAttribute('aria-controls') === 'createMenu') return;
      if ((0, dependencies.isCreateMenuOpen)() && !event.target.closest('#createMenu, #createMenuBtn')) (0, dependencies.closeCreateMenu)({ restoreFocus: true });
    }, true);
    (0, dependencies.$)('createMenu')?.addEventListener('click', event => {
      if (event.target.closest('[role="menuitem"]')) (0, dependencies.closeCreateMenu)();
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
