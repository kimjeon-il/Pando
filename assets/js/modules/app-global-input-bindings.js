/** GlobalInputBindings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGlobalInputBindings() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('global-input-bindings already connected');
    dependencies = ports;
  }

  function bindGlobalInputUI() {
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement?.isContentEditable;
      // Let focused controls handle Enter/Space once, through their normal click/change event.
      if (['Enter', ' '].includes(e.key) && document.activeElement?.closest('button, [role="button"]')) return;
      if (e.code === 'Space' && !editingText && (dependencies.editingDomain?.draftInputActive?.() || ['country-border', 'country-coast'].includes(dependencies.state.tool) || dependencies.state.selected?.domain === 'generic' || (dependencies.state.selected?.domain === 'hydro' && (0, dependencies.hydroEditById)(dependencies.state.selected.id)))) {
        dependencies.state.spacePanActive = true;
        dependencies.mapInteractionGate.setForcedPan(true);
        dependencies.mapHost?.setForcedPan?.(true);
        (0, dependencies.$)('map')?.classList.add('space-pan-active');
        dependencies.editingDomain?.clearDraftHover?.('space-pan');
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (dependencies.state.modeProcessing) { e.preventDefault(); return; }
        if (!(0, dependencies.$)('preferencesModal')?.classList.contains('hidden')) { (0, dependencies.$)('preferencesCancelBtn')?.click(); return; }
        if (!(0, dependencies.$)('objectChooser')?.classList.contains('hidden')) { (0, dependencies.closeObjectChooser)({ restoreFocus: true }); return; }
        if (!(0, dependencies.$)('objectActionsMenu')?.classList.contains('hidden')) { (0, dependencies.closeObjectActionsMenu)({ restoreFocus: true }); return; }
        if (dependencies.historicalLibraryController?.isOpen()) { dependencies.historicalLibraryController.close(); return; }
        if (!(0, dependencies.$)('territorialTypeModal')?.classList.contains('hidden')) { (0, dependencies.closeTerritorialTypeModal)(); return; }
        if (!(0, dependencies.$)('distributionTypeModal')?.classList.contains('hidden')) { (0, dependencies.$)('distributionTypeCancelBtn')?.click(); return; }
        if (!(0, dependencies.$)('territorialCreateModal')?.classList.contains('hidden')) { (0, dependencies.closeTerritorialCreateModal)(); return; }
        if (!(0, dependencies.$)('gisImportModal')?.classList.contains('hidden')) { (0, dependencies.$)('gisImportCancelBtn')?.click(); return; }
        if (!(0, dependencies.$)('gisExportModal')?.classList.contains('hidden')) { dependencies.gisExportController?.close(); return; }
        if (dependencies.confirmModalController?.isOpen()) { (0, dependencies.closeConfirmModal)(); return; }
        if (document.body.classList.contains('file-menu-open')) { (0, dependencies.closeFileMenu)({ restoreFocus: true }); return; }
        if ((0, dependencies.isCreateMenuOpen)()) { (0, dependencies.closeCreateMenu)({ restoreFocus: true }); return; }
        if (dependencies.editingDraftSnapshot().vertexInsertMode) { dependencies.editingDomain.setDraftVertexInsertMode(false); return; }
        if (dependencies.state.geometryPreview.session) { (0, dependencies.discardActiveGeometryPreview)(); return; }
        if (dependencies.state.labelPlacementMode) (0, dependencies.exitLabelMode)();
        else if (dependencies.editingDomain?.draftInputActive?.()) (0, dependencies.requestDraftDiscard)(() => (0, dependencies.isGenericFeatureDraftTool)(dependencies.state.tool) ? (0, dependencies.cancelDraft)(true) : (0, dependencies.cancelActiveMode)());
        else if (['new-country', 'annex-territory', 'merge-country', 'merge-generic-feature', 'country-border', 'country-coast'].includes(dependencies.state.tool)) (0, dependencies.cancelActiveMode)();
        else if ((0, dependencies.editingDraftCoordinates)().length) (0, dependencies.cancelDraft)(true);
        else if ((0, dependencies.$)('rightPanel')?.classList.contains('mobile-open')) {
          (0, dependencies.closeSurface)('editor', { manual: dependencies.layoutMode === 'wide', restoreFocus: true });
        }
        else if (dependencies.layoutMode !== 'wide' && (0, dependencies.$)('leftPanel')?.classList.contains('mobile-open')) (0, dependencies.closeSurface)('layers', { restoreFocus: true });
        else if (!(0, dependencies.$)('actionStatus')?.classList.contains('hidden')) (0, dependencies.clearNotification)();
        else dependencies.selectionUiController.clear({ reason: 'escape-selection-clear' });
      }
      if (e.key === 'Enter' && !editingText) {
        const drawing = dependencies.editingDomain?.draftInputActive?.() && !dependencies.state.geometryPreview.session;
        const action = dependencies.$(drawing ? 'modeDraftDoneBtn' : 'modePrimaryBtn');
        if (action && !action.closest('.hidden, [hidden]')) {
          e.preventDefault();
          if (!dependencies.state.modeProcessing && !action.disabled) action.click();
          return;
        }
      }
      if (!editingText && Number.isInteger((0, dependencies.editingDraftSnapshot)().selectedVertexIndex) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && dependencies.editingDomain?.draftInputActive?.()) {
        const distance = e.shiftKey ? 10 : 1;
        const offsets = {
          ArrowLeft: [-distance, 0],
          ArrowRight: [distance, 0],
          ArrowUp: [0, -distance],
          ArrowDown: [0, distance],
        };
        e.preventDefault();
        dependencies.editingDomain?.moveSelectedDraftPointByPixels(...offsets[e.key]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void (0, dependencies.getGisFileController)().then(controller => controller.saveProject());
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !editingText) {
        e.preventDefault(); dependencies.projectUi.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !editingText) {
        e.preventDefault(); dependencies.projectUi.redo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingText) {
        if (dependencies.editingDomain?.draftInputActive?.()) {
          e.preventDefault();
          dependencies.editingDomain?.deleteSelectedDraftPoint();
          return;
        }
        if (dependencies.state.selected) {
          e.preventDefault();
          if (dependencies.selectionDomain.size() > 1) (0, dependencies.requestBatchDelete)();
          else (0, dependencies.deleteSelected)();
        }
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code !== 'Space') return;
      dependencies.state.spacePanActive = false;
      dependencies.mapInteractionGate.setForcedPan(false);
      dependencies.mapHost?.setForcedPan?.(false);
      (0, dependencies.$)('map')?.classList.remove('space-pan-active');
    });
    window.addEventListener('blur', () => {
      dependencies.mapInputController?.cancel?.();
      dependencies.editingDomain?.cancelActiveGesture?.('window-blur');
      dependencies.state.spacePanActive = false;
      dependencies.mapInteractionGate.setForcedPan(false);
      dependencies.mapHost?.setForcedPan?.(false);
      (0, dependencies.$)('map')?.classList.remove('space-pan-active');
    });
    const clearAssistedPan = () => {
      dependencies.state.spacePanActive = false;
      dependencies.mapInteractionGate.setForcedPan(false);
      dependencies.mapHost?.setForcedPan?.(false);
      (0, dependencies.$)('map')?.classList.remove('space-pan-active');
    };
    (0, dependencies.$)('map')?.addEventListener('pointercancel', () => { clearAssistedPan(); dependencies.editingDomain?.cancelActiveGesture?.('pointercancel'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearAssistedPan(); dependencies.mapInputController?.cancel?.(); dependencies.editingDomain?.cancelActiveGesture?.('document-hidden'); } });
    (0, dependencies.$)('map')?.addEventListener('touchcancel', () => dependencies.editingDomain?.cancelActiveGesture?.('touchcancel'), { passive: true });

    window.addEventListener('resize', () => {
      (0, dependencies.closeObjectActionsMenu)();
      const layoutChanged = (0, dependencies.applyLayoutMode)();
      if (!layoutChanged) {
        (0, dependencies.refreshMapSheetMetrics)();
        if (!dependencies.mapResizeObserver) (0, dependencies.queueMapResize)('window-resize-fallback');
      }
    });
    window.addEventListener('orientationchange', () => {
      (0, dependencies.refreshMapSheetMetrics)();
      (0, dependencies.queueMapResize)('orientation-change');
    });
    window.visualViewport?.addEventListener?.('resize', dependencies.closeObjectActionsMenu);
    const onSystemThemeChange = event => (0, dependencies.applySystemTheme)(!!event.matches);
    if (typeof dependencies.systemThemeQuery.addEventListener === 'function') dependencies.systemThemeQuery.addEventListener('change', onSystemThemeChange);
    else if (typeof dependencies.systemThemeQuery.addListener === 'function') dependencies.systemThemeQuery.addListener(onSystemThemeChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        dependencies.mapInputController?.cancel?.();
        dependencies.editingDomain?.cancelActiveGesture?.('document-hidden');
        dependencies.mapWorkScheduler.cancel('autosave');
        dependencies.mapWorkScheduler.cancel('view-autosave');
        dependencies.projectDomain.persistAutosave().catch(error => console.warn('Immediate autosave failed', error));
      }
    });
    window.addEventListener('beforeunload', () => {
      if (!(0, dependencies.canMutateProject)(dependencies.state.dataReadiness)) return;
      try { dependencies.projectDomain.flushAutosave().catch(() => {}); } catch (_) {}
    });
    window.addEventListener('popstate', event => {
      if (dependencies.ignoreNextMobileSheetPopstate) {
        dependencies.ignoreNextMobileSheetPopstate = false;
        return;
      }
      if ((0, dependencies.isMobile)() && dependencies.surfaceController.activeMobileSheet) {
        const openSelect = document.querySelector('.ui-select-popover:not([hidden])');
        if (openSelect) {
          dependencies.selectController.closeAll({ restoreFocus: true });
          (0, dependencies.trackMobileSheetHistory)(dependencies.surfaceController.activeMobileSheet);
          return;
        }
        const openPicker = document.querySelector('[data-color-picker].is-open');
        if (openPicker) {
          (0, dependencies.closeColorPicker)(openPicker, { restoreFocus: true });
          (0, dependencies.trackMobileSheetHistory)(dependencies.surfaceController.activeMobileSheet);
          return;
        }
        (0, dependencies.closeActiveMobileSheet)({ restoreFocus: true, syncHistory: false });
        return;
      }
      if (event.state?.[dependencies.MOBILE_SHEET_HISTORY_KEY]) {
        const nextState = { ...event.state };
        delete nextState[dependencies.MOBILE_SHEET_HISTORY_KEY];
        window.history.replaceState(nextState, '', window.location.href);
      }
    });
  }



  return Object.freeze({
    connect,

    get bindGlobalInputUI() { return bindGlobalInputUI; },
  });
}
