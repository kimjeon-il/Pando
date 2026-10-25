import {saveBoundDocument} from './app-file-bindings.js';

export function confirmLibraryGeometryBeforeUnload(event,context){
  if(typeof context?.hasUnsavedChanges!=='function')throw new TypeError('Library geometry dirty-state owner is required');
  if(!context.hasUnsavedChanges())return false;
  event.preventDefault();
  event.returnValue='';
  return true;
}

/** GlobalInputBindings: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGlobalInputBindings({libraryGeometryContext=null}={}) {
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
    document.addEventListener('keydown', async e => {
      if (dependencies.projectState.state.projectReplacing) {
        e.preventDefault();
        return;
      }
      if(document.getElementById('projectSetupDialog').open)return;
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
      // Let focused controls handle Enter/Space once, through their normal click/change event.
      if (['Enter', ' '].includes(e.key) && document.activeElement?.closest('button, [role="button"]')) return;
      if (e.code === 'Space' && !editingText && (dependencies.domains.editingDomain?.draftInputActive?.() || ['territorial-border', 'country-coast'].includes(dependencies.projectState.state.tool) || dependencies.projectState.state.selected?.domain === 'generic' || (dependencies.projectState.state.selected?.domain === 'hydro' && (0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id)))) {
        dependencies.projectState.state.spacePanActive = true;
        dependencies.lifecycleUi.mapInteractionGate.setForcedPan(true);
        dependencies.mapView.mapHost?.setForcedPan?.(true);
        (0, dependencies.platform.$)('map')?.classList.add('space-pan-active');
        dependencies.taskPresentation.syncEditingContext();
        try { await dependencies.domains.editingDomain.clearDraftHover('space-pan'); }
        catch (error) { dependencies.feedback.reportOperationError(error,'작성 중인 경로의 표시를 지우지 못했습니다.','PL-DRAFT-HOVER-001',4200); }
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        if(document.getElementById('projectSetupDialog').open)return;
        if (e.repeat) { e.preventDefault(); return; }
        if (dependencies.projectState.state.modeProcessing) { e.preventDefault(); return; }
        if (dependencies.domainControllers.closeTerritorialEditorTransient({ restoreFocus: true })) { e.preventDefault(); return; }
        if (!(0, dependencies.platform.$)('preferencesModal')?.classList.contains('hidden')) { (0, dependencies.platform.$)('preferencesCancelBtn')?.click(); return; }
        if (!(0, dependencies.platform.$)('objectChooser')?.classList.contains('hidden')) { (0, dependencies.objectPicking.closeObjectChooser)({ restoreFocus: true }); return; }
        if (!(0, dependencies.platform.$)('objectActionsMenu')?.classList.contains('hidden')) { (0, dependencies.objectOperationsA.closeObjectActionsMenu)({ restoreFocus: true }); return; }
        if (dependencies.libraryUi.territorialLibraryController?.isOpen()) { dependencies.libraryUi.territorialLibraryController.close(); return; }
        if (!(0, dependencies.platform.$)('gisImportModal')?.classList.contains('hidden')) { (0, dependencies.platform.$)('gisImportCancelBtn')?.click(); return; }
        if (!(0, dependencies.platform.$)('gisExportModal')?.classList.contains('hidden')) { dependencies.gisServicesA.gisExportController?.close(); return; }
        if (dependencies.projectRestore.confirmModalController?.isOpen()) { (0, dependencies.projectRestore.closeConfirmModal)(); return; }
        if (dependencies.projectState.state.territorySelectionSession?.methodChangeConfirmation) {
          e.preventDefault();
          try { await dependencies.territorySelectionB.territorySelectionBack(); }
          catch(error) { dependencies.feedback.reportOperationError(error,'방식 변경 확인을 닫지 못했습니다.','PL-EDIT-METHOD-CANCEL',4200); }
          return;
        }
        if (dependencies.domains.editingDomain.snapshot().gestureActive) { e.preventDefault(); await cancelDraftGesture('escape'); return; }
        if(dependencies.domains.editingDomain.snapshot().vertexPlacement){e.preventDefault();await dependencies.domains.editingDomain.handleInteraction({type:'vertex-placement-cancel'});return;}
        if(dependencies.domains.editingDomain.snapshot().objectVertexEditing){e.preventDefault();await dependencies.domains.editingDomain.handleInteraction({type:'object-edit-end'});return;}
        if (dependencies.draftPresentation.editingDraftSnapshot().vertexInsertMode) {
          try { await dependencies.domains.editingDomain.setDraftVertexInsertMode(false); }
          catch (error) { dependencies.feedback.reportOperationError(error,'꼭짓점 삽입 모드를 종료하지 못했습니다.','PL-DRAFT-INSERT-001',4200); }
          return;
        }
        const selection = dependencies.projectState.state.territorySelectionSession;
        const preview = selection ? selection.stage === 'review' : !!dependencies.projectState.state.geometryPreview.session;
        if (preview) {
          e.preventDefault();
          try { await dependencies.taskPresentation.returnToEditing(); }
          catch(error) { dependencies.feedback.reportOperationError(error,'수정으로 돌아가지 못했습니다.','PL-PREVIEW-CANCEL',4200); }
          return;
        }
        const cancellingMode = ['new-country', 'annex-territory', 'draw-territorial-unit', 'merge-country', 'merge-generic-feature', 'territorial-border', 'country-coast'].includes(dependencies.projectState.state.tool);
        if (selection || dependencies.projectState.state.labelPlacementMode || dependencies.domains.editingDomain.draftInputActive()
          || cancellingMode || dependencies.domains.editingDomain.snapshot().selectionDraft || dependencies.countryEditingA.editingDraftCoordinates().length) {
          e.preventDefault();
          try { await dependencies.taskPresentation.cancelCurrentEditing(); }
          catch (error) { dependencies.feedback.reportOperationError(error,'작성 중인 작업을 취소하지 못했습니다.','PL-EDIT-CANCEL-001',4200); }
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
        try { await saveBoundDocument({libraryGeometryContext,getGisFileController:dependencies.gisRuntime.getGisFileController,
          setActionStatus:dependencies.feedback.setActionStatus}); }
        catch (error) { dependencies.feedback.reportOperationError(error,
          libraryGeometryContext?'라이브러리 경계를 저장하지 못했습니다.':'프로젝트를 저장하지 못했습니다.',
          libraryGeometryContext?'PL-LIB-GEOMETRY-SAVE':'PL-PROJECT-SAVE-001',4200); }
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
      dependencies.taskPresentation.syncEditingContext();
    });
    window.addEventListener('blur', () => {
      dependencies.lifecycleUi.mapInputController?.cancel?.();
      cancelDraftGesture('window-blur');
      dependencies.projectState.state.spacePanActive = false;
      dependencies.lifecycleUi.mapInteractionGate.setForcedPan(false);
      dependencies.mapView.mapHost?.setForcedPan?.(false);
      (0, dependencies.platform.$)('map')?.classList.remove('space-pan-active');
      dependencies.taskPresentation.syncEditingContext();
    });
    const clearAssistedPan = () => {
      dependencies.projectState.state.spacePanActive = false;
      dependencies.lifecycleUi.mapInteractionGate.setForcedPan(false);
      dependencies.mapView.mapHost?.setForcedPan?.(false);
      (0, dependencies.platform.$)('map')?.classList.remove('space-pan-active');
      dependencies.taskPresentation.syncEditingContext();
    };
    (0, dependencies.platform.$)('map')?.addEventListener('pointercancel', () => { clearAssistedPan(); cancelDraftGesture('pointercancel'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearAssistedPan(); dependencies.lifecycleUi.mapInputController?.cancel?.(); cancelDraftGesture('document-hidden'); } });
    (0, dependencies.platform.$)('map')?.addEventListener('touchcancel', () => cancelDraftGesture('touchcancel'), { passive: true });

    window.visualViewport?.addEventListener?.('resize', dependencies.objectOperationsA.closeObjectActionsMenu);
    document.addEventListener('visibilitychange', () => {
      if(libraryGeometryContext)return;
      if (document.visibilityState === 'hidden') {
        dependencies.lifecycleUi.mapInputController?.cancel?.();
        cancelDraftGesture('document-hidden');
        dependencies.projectState.mapWorkScheduler.cancel('autosave');
        dependencies.projectState.mapWorkScheduler.cancel('view-autosave');
        dependencies.domains.projectDomain.persistAutosave().catch(error => console.warn('Immediate autosave failed', error));
      }
    });
    window.addEventListener('beforeunload', event => {
      if(libraryGeometryContext){confirmLibraryGeometryBeforeUnload(event,libraryGeometryContext);return;}
      if (!(0, dependencies.readiness.canMutateProject)(dependencies.projectState.state.dataReadiness)) return;
      try { dependencies.domains.projectDomain.flushAutosave().catch(() => {}); } catch (_) {}
    });

  }

  return Object.freeze({
    connect,
    get bindGlobalInputUI() { return bindGlobalInputUI; },
  });
}
