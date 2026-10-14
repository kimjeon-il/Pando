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
    const cancelDraftGesture = async reason => {
      try { await dependencies.domains.editingDomain.cancelActiveGesture(reason); }
      catch (error) { dependencies.feedback.reportOperationError(error,'작성 중인 편집 동작을 취소하지 못했습니다.','PL-DRAFT-CANCEL-001',4200); }
    };
    installReferenceImageEditingBridge(() => dependencies.domains.editingDomain, error => dependencies.feedback.reportOperationError(error,
      '참조 이미지 추적선을 편집 초안에 적용하지 못했습니다.', 'PL-REFERENCE-DRAFT-001', 4200));
    document.addEventListener('keydown', async e => {
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
      if (e.code === 'Space' && !editingText && (dependencies.domains.editingDomain?.draftInputActive?.() || ['territorial-border', 'country-coast'].includes(dependencies.projectState.state.tool) || dependencies.projectState.state.selected?.domain === 'generic' || (dependencies.projectState.state.selected?.domain === 'hydro' && (0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id)))) {
        dependencies.projectState.state.spacePanActive = true;
        dependencies.lifecycleUi.mapInteractionGate.setForcedPan(true);
        dependencies.mapView.mapHost?.setForcedPan?.(true);
        (0, dependencies.platform.$)('map')?.classList.add('space-pan-active');
        try { await dependencies.domains.editingDomain.clearDraftHover('space-pan'); }
        catch (error) { dependencies.feedback.reportOperationError(error,'작성 중인 경로의 표시를 지우지 못했습니다.','PL-DRAFT-HOVER-001',4200); }
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if (dependencies.projectState.state.modeProcessing) { e.preventDefault(); return; }
        if (dependencies.domainControllers.closeTerritorialEditorTransient({ restoreFocus: true })) { e.preventDefault(); return; }
        if (!(0, dependencies.platform.$)('preferencesModal')?.classList.contains('hidden')) { (0, dependencies.platform.$)('preferencesCancelBtn')?.click(); return; }
        if (!(0, dependencies.platform.$)('objectChooser')?.classList.contains('hidden')) { (0, dependencies.objectPicking.closeObjectChooser)({ restoreFocus: true }); return; }
        if (!(0, dependencies.platform.$)('objectActionsMenu')?.classList.contains('hidden')) { (0, dependencies.objectOperationsA.closeObjectActionsMenu)({ restoreFocus: true }); return; }
        if (dependencies.libraryUi.territorialLibraryController?.isOpen()) { dependencies.libraryUi.territorialLibraryController.close(); return; }
        if (!(0, dependencies.platform.$)('gisImportModal')?.classList.contains('hidden')) { (0, dependencies.platform.$)('gisImportCancelBtn')?.click(); return; }
        if (!(0, dependencies.platform.$)('gisExportModal')?.classList.contains('hidden')) { dependencies.gisServicesA.gisExportController?.close(); return; }
        if (dependencies.projectRestore.confirmModalController?.isOpen()) { (0, dependencies.projectRestore.closeConfirmModal)(); return; }
        if (document.body.classList.contains('file-menu-open')) { (0, dependencies.workspaceUiA.closeFileMenu)({ restoreFocus: true }); return; }
        if (dependencies.workspaceUiB.surfaceController.isOpen('create')) { (0, dependencies.workspaceUiA.closeSurface)('create', { restoreFocus: true }); return; }
        if (dependencies.workspaceUiB.surfaceController.isOpen('search')) { e.preventDefault(); (0, dependencies.workspaceUiA.closeSurface)('search', { restoreFocus: true }); return; }
        if (dependencies.draftPresentation.editingDraftSnapshot().vertexInsertMode) {
          try { await dependencies.domains.editingDomain.setDraftVertexInsertMode(false); }
          catch (error) { dependencies.feedback.reportOperationError(error,'꼭짓점 삽입 모드를 종료하지 못했습니다.','PL-DRAFT-INSERT-001',4200); }
          return;
        }
        if (dependencies.projectState.state.territorySelectionSession) { (0, dependencies.platform.$)('modeCancelBtn')?.click(); return; }
        if (dependencies.projectState.state.geometryPreview.session) {
          try {await dependencies.geometryOperations.discardActiveGeometryPreview();}
          catch(error){dependencies.feedback.reportOperationError(error,'미리보기를 취소하지 못했습니다.','PL-PREVIEW-CANCEL',4200);}
          return;
        }
        const cancellingMode = ['new-country', 'annex-territory', 'draw-territorial-unit', 'merge-country', 'merge-generic-feature', 'territorial-border', 'country-coast'].includes(dependencies.projectState.state.tool);
        if (dependencies.projectState.state.labelPlacementMode || dependencies.domains.editingDomain.draftInputActive()
          || cancellingMode || dependencies.countryEditingA.editingDraftCoordinates().length) {
          try {
            if (dependencies.projectState.state.labelPlacementMode) await dependencies.countryEditingB.exitLabelMode();
            else if (dependencies.domains.editingDomain.draftInputActive()) await dependencies.genericEditingB.requestDraftDiscard(async () =>
              dependencies.surfaces.isGenericFeatureDraftTool(dependencies.projectState.state.tool)
                ? await dependencies.genericEditingA.cancelDraft(true) : await dependencies.countryEditingA.cancelActiveMode());
            else if (cancellingMode) await dependencies.countryEditingA.cancelActiveMode();
            else await dependencies.genericEditingA.cancelDraft(true);
          } catch (error) { dependencies.feedback.reportOperationError(error,'작성 중인 작업을 취소하지 못했습니다.','PL-EDIT-CANCEL-001',4200); }
          return;
        }
        if ((0, dependencies.platform.$)('editorSurface')?.classList.contains('mobile-open')) {
          (0, dependencies.workspaceUiA.closeSurface)('editor', { manual: dependencies.surfaces.layoutMode === 'wide', restoreFocus: true });
        }
        else if ((0, dependencies.platform.$)('mapDisplaySurface')?.classList.contains('surface-open')) (0, dependencies.workspaceUiA.closeSurface)('display', { restoreFocus: true });
        else if (!(0, dependencies.platform.$)('actionStatus')?.classList.contains('hidden')) (0, dependencies.readinessUi.clearNotification)();
        else {
          try { await dependencies.domains.selectionUiController.clear({ reason: 'escape-selection-clear' }); }
          catch (error) { dependencies.feedback.reportOperationError(error,'선택을 해제하지 못했습니다.','PL-SELECTION-CLEAR-001',4200); }
        }
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
        try { await dependencies.domains.editingDomain?.moveSelectedDraftPointByPixels(...offsets[e.key]); }
        catch (error) { dependencies.feedback.reportOperationError(error, '작성 중인 꼭짓점을 이동하지 못했습니다.', 'PL-DRAFT-MOVE-001', 4200); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        try { await (await (0, dependencies.gisRuntime.getGisFileController)()).saveProject(); }
        catch (error) { dependencies.feedback.reportOperationError(error, '프로젝트를 저장하지 못했습니다.', 'PL-PROJECT-SAVE-001', 4200); }
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
          try { await dependencies.domains.editingDomain?.deleteSelectedDraftPoint(); }
          catch (error) { dependencies.feedback.reportOperationError(error, '작성 중인 꼭짓점을 삭제하지 못했습니다.', 'PL-DRAFT-DELETE-001', 4200); }
          return;
        }
        if (dependencies.projectState.state.selected) {
          e.preventDefault();
          if (dependencies.domains.selectionDomain.size() > 1) (0, dependencies.objectOperationsA.requestObjectDeletion)();
          else {
            try { await (0, dependencies.objectDeletion.deleteSelected)(); }
            catch (error) { dependencies.feedback.reportOperationError(error, '객체를 삭제하지 못했습니다.', 'PL-OBJECT-DELETE-001', 4200); }
          }
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
      cancelDraftGesture('window-blur');
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
    (0, dependencies.platform.$)('map')?.addEventListener('pointercancel', () => { clearAssistedPan(); cancelDraftGesture('pointercancel'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearAssistedPan(); dependencies.lifecycleUi.mapInputController?.cancel?.(); cancelDraftGesture('document-hidden'); } });
    (0, dependencies.platform.$)('map')?.addEventListener('touchcancel', () => cancelDraftGesture('touchcancel'), { passive: true });

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
        cancelDraftGesture('document-hidden');
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
