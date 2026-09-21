import { installReferenceImageEditingBridge } from './reference-image-editing-bridge.js';
import { cancelReferenceImageInput, handleReferenceImageKey, referenceImageInputActive } from './reference-image-input.js';

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
    installReferenceImageEditingBridge(() => dependencies.domains.editingDomain);
    document.addEventListener('keydown', e => {
      if (dependencies.projectState.state.projectReplacing) {
        e.preventDefault();
        return;
      }
      const helpModal = (0, dependencies.platform.$)('helpModal');
      if (helpModal && !helpModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
          e.preventDefault();
          (0, dependencies.platform.$)('helpCloseBtn')?.click();
        } else if (
          e.key === 'Delete'
          || e.key === 'Backspace'
          || ((e.ctrlKey || e.metaKey) && ['s', 'y', 'z'].includes(e.key.toLowerCase()))
        ) {
          e.preventDefault();
        }
        return;
      }
      const tag = document.activeElement?.tagName;
      const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement?.isContentEditable;
      const blockingModal = [...document.querySelectorAll('[aria-modal="true"]')].some(node => !node.hidden && !node.classList.contains('hidden') && node.getClientRects().length);
      if (!blockingModal && !editingText && handleReferenceImageKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!blockingModal && !editingText && e.code === 'Space' && referenceImageInputActive()) {
        dependencies.projectState.state.spacePanActive = true;
        dependencies.lifecycleUi.mapInteractionGate.setForcedPan(true);
        dependencies.mapView.mapHost?.setForcedPan?.(true);
        e.preventDefault(); return;
      }
      // Let focused controls handle Enter/Space once, through their normal click/change event.
      if (['Enter', ' '].includes(e.key) && document.activeElement?.closest('button, [role="button"]')) return;
      if (e.code === 'Space' && !editingText && (dependencies.domains.editingDomain?.draftInputActive?.() || ['country-border', 'country-coast'].includes(dependencies.projectState.state.tool) || dependencies.projectState.state.selected?.domain === 'generic' || (dependencies.projectState.state.selected?.domain === 'hydro' && (0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id)))) {
        dependencies.projectState.state.spacePanActive = true;
        dependencies.lifecycleUi.mapInteractionGate.setForcedPan(true);
        dependencies.mapView.mapHost?.setForcedPan?.(true);
        (0, dependencies.platform.$)('map')?.classList.add('space-pan-active');
        dependencies.domains.editingDomain?.clearDraftHover?.('space-pan');
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (dependencies.projectState.state.modeProcessing) { e.preventDefault(); return; }
        if (dependencies.domainControllers.closeSelectionToolbarTransient?.({ restoreFocus: true })) { e.preventDefault(); return; }
        if (!(0, dependencies.platform.$)('preferencesModal')?.classList.contains('hidden')) { (0, dependencies.platform.$)('preferencesCancelBtn')?.click(); return; }
        if (!(0, dependencies.platform.$)('objectChooser')?.classList.contains('hidden')) { (0, dependencies.objectPicking.closeObjectChooser)({ restoreFocus: true }); return; }
        if (!(0, dependencies.platform.$)('objectActionsMenu')?.classList.contains('hidden')) { (0, dependencies.objectOperationsA.closeObjectActionsMenu)({ restoreFocus: true }); return; }
        if (dependencies.libraryUi.historicalLibraryController?.isOpen()) { dependencies.libraryUi.historicalLibraryController.close(); return; }
        if (!(0, dependencies.platform.$)('territorialTypeModal')?.classList.contains('hidden')) { (0, dependencies.territorialConversion.closeTerritorialTypeModal)(); return; }
        if (!(0, dependencies.platform.$)('distributionTypeModal')?.classList.contains('hidden')) { (0, dependencies.platform.$)('distributionTypeCancelBtn')?.click(); return; }
        if (!(0, dependencies.platform.$)('gisImportModal')?.classList.contains('hidden')) { (0, dependencies.platform.$)('gisImportCancelBtn')?.click(); return; }
        if (!(0, dependencies.platform.$)('gisExportModal')?.classList.contains('hidden')) { dependencies.gisServicesA.gisExportController?.close(); return; }
        if (dependencies.projectRestore.confirmModalController?.isOpen()) { (0, dependencies.projectRestore.closeConfirmModal)(); return; }
        if (document.body.classList.contains('file-menu-open')) { (0, dependencies.workspaceUiA.closeFileMenu)({ restoreFocus: true }); return; }
        if (dependencies.workspaceUiB.surfaceController.isOpen('create')) { (0, dependencies.workspaceUiA.closeSurface)('create', { restoreFocus: true }); return; }
        if (dependencies.workspaceUiB.surfaceController.isOpen('search')) { e.preventDefault(); (0, dependencies.workspaceUiA.closeSurface)('search', { restoreFocus: true }); return; }
        if (dependencies.draftPresentation.editingDraftSnapshot().vertexInsertMode) { dependencies.domains.editingDomain.setDraftVertexInsertMode(false); return; }
        if (dependencies.projectState.state.territorySelectionSession) { (0, dependencies.platform.$)('modeCancelBtn')?.click(); return; }
        if (dependencies.projectState.state.geometryPreview.session) { (0, dependencies.geometryOperations.discardActiveGeometryPreview)(); return; }
        if (dependencies.projectState.state.labelPlacementMode) (0, dependencies.countryEditingB.exitLabelMode)();
        else if (dependencies.domains.editingDomain?.draftInputActive?.()) (0, dependencies.genericEditingB.requestDraftDiscard)(() => (0, dependencies.surfaces.isGenericFeatureDraftTool)(dependencies.projectState.state.tool) ? (0, dependencies.genericEditingA.cancelDraft)(true) : (0, dependencies.countryEditingA.cancelActiveMode)());
        else if (['new-country', 'annex-territory', 'draw-territorial-unit', 'merge-country', 'merge-generic-feature', 'country-border', 'country-coast'].includes(dependencies.projectState.state.tool)) (0, dependencies.countryEditingA.cancelActiveMode)();
        else if ((0, dependencies.countryEditingA.editingDraftCoordinates)().length) (0, dependencies.genericEditingA.cancelDraft)(true);
        else if ((0, dependencies.platform.$)('editorSurface')?.classList.contains('mobile-open')) {
          (0, dependencies.workspaceUiA.closeSurface)('editor', { manual: dependencies.surfaces.layoutMode === 'wide', restoreFocus: true });
        }
        else if ((0, dependencies.platform.$)('mapDisplaySurface')?.classList.contains('surface-open')) (0, dependencies.workspaceUiA.closeSurface)('display', { restoreFocus: true });
        else if (!(0, dependencies.platform.$)('actionStatus')?.classList.contains('hidden')) (0, dependencies.readinessUi.clearNotification)();
        else dependencies.domains.selectionUiController.clear({ reason: 'escape-selection-clear' });
      }
      if (e.key === 'Enter' && !editingText) {
        const drawing = dependencies.domains.editingDomain?.draftInputActive?.() && !dependencies.projectState.state.geometryPreview.session;
        const action = dependencies.platform.$(drawing ? 'modeDraftDoneBtn' : 'modePrimaryBtn');
        if (action && !action.closest('.hidden, [hidden]')) {
          e.preventDefault();
          if (!dependencies.projectState.state.modeProcessing && !action.disabled) action.click();
          return;
        }
      }
      if (!editingText && Number.isInteger((0, dependencies.draftPresentation.editingDraftSnapshot)().selectedVertexIndex) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && dependencies.domains.editingDomain?.draftInputActive?.()) {
        const distance = e.shiftKey ? 10 : 1;
        const offsets = {
          ArrowLeft: [-distance, 0],
          ArrowRight: [distance, 0],
          ArrowUp: [0, -distance],
          ArrowDown: [0, distance],
        };
        e.preventDefault();
        dependencies.domains.editingDomain?.moveSelectedDraftPointByPixels(...offsets[e.key]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void (0, dependencies.gisRuntime.getGisFileController)().then(controller => controller.saveProject());
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !editingText) {
        e.preventDefault(); dependencies.lifecycleUi.projectUi.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !editingText) {
        e.preventDefault(); dependencies.lifecycleUi.projectUi.redo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingText) {
        if (dependencies.domains.editingDomain?.draftInputActive?.()) {
          e.preventDefault();
          dependencies.domains.editingDomain?.deleteSelectedDraftPoint();
          return;
        }
        if (dependencies.projectState.state.selected) {
          e.preventDefault();
          if (dependencies.domains.selectionDomain.size() > 1) (0, dependencies.objectOperationsA.requestBatchDelete)();
          else (0, dependencies.objectDeletion.deleteSelected)();
        }
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code !== 'Space') return;
      dependencies.projectState.state.spacePanActive = false;
      dependencies.lifecycleUi.mapInteractionGate.setForcedPan(false);
      dependencies.mapView.mapHost?.setForcedPan?.(false);
      (0, dependencies.platform.$)('map')?.classList.remove('space-pan-active');
    });
    window.addEventListener('blur', () => {
      cancelReferenceImageInput();
      dependencies.lifecycleUi.mapInputController?.cancel?.();
      dependencies.domains.editingDomain?.cancelActiveGesture?.('window-blur');
      dependencies.projectState.state.spacePanActive = false;
      dependencies.lifecycleUi.mapInteractionGate.setForcedPan(false);
      dependencies.mapView.mapHost?.setForcedPan?.(false);
      (0, dependencies.platform.$)('map')?.classList.remove('space-pan-active');
    });
    const clearAssistedPan = () => {
      dependencies.projectState.state.spacePanActive = false;
      dependencies.lifecycleUi.mapInteractionGate.setForcedPan(false);
      dependencies.mapView.mapHost?.setForcedPan?.(false);
      (0, dependencies.platform.$)('map')?.classList.remove('space-pan-active');
    };
    (0, dependencies.platform.$)('map')?.addEventListener('pointercancel', () => { clearAssistedPan(); dependencies.domains.editingDomain?.cancelActiveGesture?.('pointercancel'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearAssistedPan(); dependencies.lifecycleUi.mapInputController?.cancel?.(); dependencies.domains.editingDomain?.cancelActiveGesture?.('document-hidden'); } });
    (0, dependencies.platform.$)('map')?.addEventListener('touchcancel', () => dependencies.domains.editingDomain?.cancelActiveGesture?.('touchcancel'), { passive: true });

    window.addEventListener('resize', () => {
      (0, dependencies.objectOperationsA.closeObjectActionsMenu)();
      const layoutChanged = (0, dependencies.workspaceUiA.applyLayoutMode)();
      if (!layoutChanged) {
        (0, dependencies.workspaceUiB.refreshMapSheetMetrics)();
        if (!dependencies.mapHostViewB.mapResizeObserver) (0, dependencies.mapHostViewB.queueMapResize)('window-resize-fallback');
      }
    });
    window.addEventListener('orientationchange', () => {
      (0, dependencies.workspaceUiB.refreshMapSheetMetrics)();
      (0, dependencies.mapHostViewB.queueMapResize)('orientation-change');
    });
    window.visualViewport?.addEventListener?.('resize', dependencies.objectOperationsA.closeObjectActionsMenu);
    const onSystemThemeChange = event => (0, dependencies.platformConfigurationB.applySystemTheme)(!!event.matches);
    if (typeof dependencies.platformConfigurationB.systemThemeQuery.addEventListener === 'function') dependencies.platformConfigurationB.systemThemeQuery.addEventListener('change', onSystemThemeChange);
    else if (typeof dependencies.platformConfigurationB.systemThemeQuery.addListener === 'function') dependencies.platformConfigurationB.systemThemeQuery.addListener(onSystemThemeChange);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        dependencies.lifecycleUi.mapInputController?.cancel?.();
        dependencies.domains.editingDomain?.cancelActiveGesture?.('document-hidden');
        dependencies.projectState.mapWorkScheduler.cancel('autosave');
        dependencies.projectState.mapWorkScheduler.cancel('view-autosave');
        dependencies.domains.projectDomain.persistAutosave().catch(error => console.warn('Immediate autosave failed', error));
      }
    });
    window.addEventListener('beforeunload', () => {
      if (!(0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness)) return;
      try { dependencies.domains.projectDomain.flushAutosave().catch(() => {}); } catch (_) {}
    });
    window.addEventListener('popstate', event => {
      if (dependencies.workspaceUiB.ignoreNextMobileSheetPopstate) {
        dependencies.surfaceCommands.setIgnoreNextMobileSheetPopstate(false);
        return;
      }
      if ((0, dependencies.surfaces.isMobile)() && dependencies.workspaceUiB.surfaceController.activeMobileSheet) {
        const openSelect = document.querySelector('.ui-select-popover:not([hidden])');
        if (openSelect) {
          dependencies.platformConfigurationB.selectController.closeAll({ restoreFocus: true });
          (0, dependencies.workspaceUiC.trackMobileSheetHistory)(dependencies.workspaceUiB.surfaceController.activeMobileSheet);
          return;
        }
        const openPicker = document.querySelector('[data-color-picker].is-open');
        if (openPicker) {
          (0, dependencies.colorPicker.closeColorPicker)(openPicker, { restoreFocus: true });
          (0, dependencies.workspaceUiC.trackMobileSheetHistory)(dependencies.workspaceUiB.surfaceController.activeMobileSheet);
          return;
        }
        (0, dependencies.workspaceUiA.closeActiveMobileSheet)({ restoreFocus: true, syncHistory: false });
        return;
      }
      if (event.state?.[dependencies.workspaceUiA.MOBILE_SHEET_HISTORY_KEY]) {
        const nextState = { ...event.state };
        delete nextState[dependencies.workspaceUiA.MOBILE_SHEET_HISTORY_KEY];
        window.history.replaceState(nextState, '', window.location.href);
      }
    });
  }

  return Object.freeze({
    connect,
    get bindGlobalInputUI() { return bindGlobalInputUI; },
  });
}
