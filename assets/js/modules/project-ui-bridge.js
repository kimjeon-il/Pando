import {createProjectSetupDialog} from './project-setup-dialog.js';
import { AUTOSAVE_STATES } from './save-state-controller.js';
const historyNames = Object.freeze({
 'territorial.edit':'영역 변경','territorial.geometry':'경계 변경','territorial.patch':'영역 변경','territorial.border':'국경 변경','territorial.coast':'해안선 변경',
 'territorial.annex':'영토 편입','territorial.merge':'국가 합병','territorial.new-country':'국가 생성',
 'territorial.field':'속성 변경','territorial.color':'색 변경','territorial.batch-color':'색 변경','territorial.service-color':'색 변경',
 'territorial.parent':'소속 변경','content.edit':'객체 변경','hydro.edit':'수계 변경','label.gesture.begin':'이름표 이동',
});
export const historyActionName = id => historyNames[id] || '프로젝트 변경';
export function createProjectUiBridge({
  getElement: $,
  getSaveSnapshot,
  getEditingSnapshot,
  getDraftSnapshot,
  getProjectGeneration,
  requireCanonicalData,
  returnToEditing,
  draftInputActive,
  undoDraft,
  redoDraft,
  canUndo,
  canRedo,
  undoProject,
  redoProject,
  createProject,
  projectSetupPorts,
  setupDialogFactory=createProjectSetupDialog,
  isProjectReplacing = () => false,
  setActionStatus,
  closeFileMenu,
  openConfirmModal,
  getAutosaveRecovery,
  restoreAutosave,
  resolveAutosaveRecovery,
  completeAutosaveRecovery,
  loadAutosave,
  queueAutosave,
} = {}) {
  let setupDialog;
  const openSetup=()=>{setupDialog ||= setupDialogFactory({...projectSetupPorts,createProject,confirmDiscard:async()=>{
    if(!getSaveSnapshot().hasUnsavedChanges&&!draftInputActive()&&!getEditingSnapshot().previewActive)return true;
    return !!await confirm({title:'새 프로젝트 생성',message:'저장되지 않은 변경 사항과 미적용 초안, 실행 취소 기록을 버리고 새 프로젝트를 생성합니다.',confirmText:'초안과 변경 버리고 생성',danger:true});
  }});setupDialog.open();};
  let recoveryRequest = null;
  let pendingHistory = 0;
  const confirm = options => new Promise(resolve => openConfirmModal({ ...options,
    onConfirm: value => resolve(value ?? true), onCancel: () => resolve(null),
  }));

  async function chooseAutosave({ startup = false } = {}) {
    if (!startup && (isProjectReplacing() || !requireCanonicalData() || getEditingSnapshot().processing)) return null;
    if (!startup && getAutosaveRecovery()?.kind === 'read-error') await restoreAutosave({ deferResolution: true });
    const recovery = getAutosaveRecovery();
    if (!recovery || recovery.kind !== 'conflict') return null;
    const source = await confirm({ title: '저장본 선택',
      message: '자동저장본의 순서를 확인할 수 없습니다. 복원할 저장본을 선택하세요. 선택하지 않은 저장본은 복구 기록으로 보존합니다.',
      confirmText: '선택한 저장본 복원', cancelText: '나중에 선택',
      choices: recovery.candidates.map(candidate => ({ value: candidate.source,
        label: candidate.source === 'indexeddb' ? 'IndexedDB' : '브라우저 로컬 저장소' })),
    });
    if (!source) return null;
    if (!startup && (getSaveSnapshot().hasUnsavedChanges || draftInputActive() || getEditingSnapshot().previewActive)) {
      const accepted = await confirm({ title: '저장된 프로젝트 복원',
        message: '현재 작업을 선택한 저장본으로 교체합니다. 저장되지 않은 변경 사항과 작성 중인 작업이 사라집니다.',
        confirmText: '교체 후 복원', danger: true });
      if (!accepted) return null;
    }
    const checkpoint = { save: getSaveSnapshot(), editing: getEditingSnapshot().revision,
      generation: getProjectGeneration() };
    const apply = async project => {
      const current = getSaveSnapshot();
      if (isProjectReplacing() || !requireCanonicalData() || getEditingSnapshot().processing
        || getProjectGeneration() !== checkpoint.generation
        || current.currentContentToken !== checkpoint.save.currentContentToken
        || current.currentPresentationToken !== checkpoint.save.currentPresentationToken
        || getEditingSnapshot().revision !== checkpoint.editing) {
        throw new Error('복원 준비 중 작업이 변경되었습니다. 저장본을 다시 선택하세요.');
      }
      await loadAutosave(project);
    };
    const result = await resolveAutosaveRecovery(source, startup ? undefined : apply, { deferApplication: startup });
    if (!startup) queueAutosave();
    return result;
  }

  function requestAutosaveRecovery(options) {
    if (recoveryRequest) return recoveryRequest;
    recoveryRequest = chooseAutosave(options).catch(error => {
      setActionStatus(`저장본을 복원하지 못했습니다. ${error.message}`, 'error', 0);
      return null;
    }).finally(() => { recoveryRequest = null; syncProjectSaveStatus(); });
    return recoveryRequest;
  }

  $('autosaveRecoveryFileBtn')?.addEventListener('click', () => { closeFileMenu(); void requestAutosaveRecovery(); });

  function syncProjectSaveStatus(snapshot = getSaveSnapshot()) {
    const status = $('projectSaveStatus');
    if (!status) return;
    const fileState = String(snapshot.file || 'never-saved');
    const autosaveState = String(snapshot.autosave || '');
    const paused = snapshot.autosaveRecovery === true;
    const fileRecoveryButton = $('autosaveRecoveryFileBtn');
    if (fileRecoveryButton) fileRecoveryButton.hidden = !paused;
    const isSaving = fileState === 'saving' || autosaveState === AUTOSAVE_STATES.QUEUED || autosaveState === AUTOSAVE_STATES.SAVING;
    const isError = fileState === 'error' || autosaveState === AUTOSAVE_STATES.ERROR;
    const saveStateLabel = paused ? '자동저장 중지' : isSaving
      ? '저장 중'
      : isError
        ? '저장 오류'
        : fileState === 'saved' || fileState === 'clean'
        ? '저장됨'
        : '미저장';
    const saveStateDescription = paused ? '저장본 선택이 필요하여 자동저장을 중지했습니다.' : isSaving
      ? '변경 사항을 저장하는 중입니다.'
      : isError
        ? '저장하지 못했습니다.'
        : fileState === 'saved' || fileState === 'clean'
        ? '모든 변경 사항이 저장되었습니다.'
        : '저장되지 않은 변경 사항이 있습니다.';
    status.hidden = false;
    status.dataset.saveState = paused ? 'error' : isSaving ? 'saving' : isError ? 'error' : fileState;
    $('projectSaveStatusText').textContent = saveStateLabel;
    status.dataset.tooltip = saveStateDescription;
    status.setAttribute('aria-label', saveStateDescription);
  }

  async function handleUndoRequest() {
    if (pendingHistory || isProjectReplacing()) return;
    if (!requireCanonicalData()) return;
    if (getEditingSnapshot().processing) return;
    try {
      pendingHistory += 1;
      updateHistoryButtons();
      if (getEditingSnapshot().previewActive) {
        await returnToEditing();
        return;
      }
      if (draftInputActive()) {
        if (getDraftSnapshot().historyCount > 0) await undoDraft();
        return;
      }
      const name = historyActionName(getEditingSnapshot().undoCommandId);
      if (!await undoProject({ description: '작업 실행취소' })) return;
      setActionStatus(name + ' 실행 취소됨', 'success');
    } catch (error) { setActionStatus(`실행 취소하지 못했습니다. ${error.message}`, 'error', 0); }
    finally { pendingHistory -= 1; updateHistoryButtons(); }
  }

  async function handleRedoRequest() {
    if (pendingHistory || isProjectReplacing()) return;
    if (!requireCanonicalData()) return;
    if (getEditingSnapshot().processing) return;
    if (getEditingSnapshot().previewActive) {
      setActionStatus('변경 미리보기를 먼저 적용하거나 취소하세요.', 'error', 2600);
      return;
    }
    try {
      pendingHistory += 1;
      updateHistoryButtons();
      if (draftInputActive()) {
        if (getDraftSnapshot().futureCount > 0) await redoDraft();
        return;
      }
      const name = historyActionName(getEditingSnapshot().redoCommandId);
      if (!await redoProject({ description: '작업 다시 실행' })) return;
      setActionStatus(name + ' 다시 실행됨', 'success');
    } catch (error) { setActionStatus(`다시 실행하지 못했습니다. ${error.message}`, 'error', 0); }
    finally { pendingHistory -= 1; updateHistoryButtons(); }
  }

  function updateHistoryButtons() {
    const draftMode = draftInputActive();
    const draft = getDraftSnapshot();
    const preview = getEditingSnapshot().previewActive;
    const undoAvailable = preview || (draftMode ? draft.historyCount > 0 : (canUndo() || false));
    const redoAvailable = !preview && (draftMode ? draft.futureCount > 0 : (canRedo() || false));
    const controls = [
      [$('undoBtn'), pendingHistory > 0 || getEditingSnapshot().processing || !undoAvailable, preview ? '미리보기에서 수정으로 돌아가기' : draftMode ? '초안 실행 취소' : historyActionName(getEditingSnapshot().undoCommandId) + ' 실행 취소'],
      [$('redoBtn'), pendingHistory > 0 || getEditingSnapshot().processing || !redoAvailable, draftMode ? '초안 다시 실행' : historyActionName(getEditingSnapshot().redoCommandId) + ' 다시 실행'],
      [$('mobileUndoBtn'), pendingHistory > 0 || getEditingSnapshot().processing || !undoAvailable, preview ? '미리보기에서 수정으로 돌아가기' : draftMode ? '초안 실행 취소' : historyActionName(getEditingSnapshot().undoCommandId) + ' 실행 취소'],
      [$('mobileRedoBtn'), pendingHistory > 0 || getEditingSnapshot().processing || !redoAvailable, draftMode ? '초안 다시 실행' : historyActionName(getEditingSnapshot().redoCommandId) + ' 다시 실행'],
    ];
    for (const [button, disabled, label] of controls) {
      if (!button) continue;
      button.disabled = disabled;
      button.dataset.tooltip = label;
      button.setAttribute('aria-label', label);
      button.removeAttribute('aria-expanded');
    }
  }

  function requestNewProject(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (pendingHistory || isProjectReplacing()) return;
    if (getAutosaveRecovery()?.kind==='conflict') {
      void requestAutosaveRecovery();
      return;
    }

    closeFileMenu();
    openSetup();
  }

  return Object.freeze({
    syncSaveStatus: syncProjectSaveStatus,
    undo: handleUndoRequest,
    redo: handleRedoRequest,
    syncHistory: updateHistoryButtons,
    requestNew: requestNewProject,
    requestAutosaveRecovery,
    completeAutosaveRecovery: async () => {
      try { await completeAutosaveRecovery(); }
      catch (error) { setActionStatus(`저장본 보호를 유지했습니다. ${error.message}`, 'error', 0); }
      syncProjectSaveStatus();
    },
    restoreAutosave: async () => {
      const result = await restoreAutosave();
      if (getAutosaveRecovery()?.kind === 'conflict') return await requestAutosaveRecovery({ startup: true }) || result;
      return result;
    },
  });
}
