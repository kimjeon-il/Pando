import { AUTOSAVE_STATES } from './save-state-controller.js';
export function createProjectUiBridge({
  getElement: $,
  getSaveSnapshot,
  getEditingSnapshot,
  getDraftSnapshot,
  getProjectGeneration,
  requireCanonicalData,
  discardActiveGeometryPreview,
  draftInputActive,
  undoDraft,
  redoDraft,
  canUndo,
  canRedo,
  undoProject,
  redoProject,
  createEmptyProject,
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
  let recoveryRequest = null;
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

  $('autosaveRecoveryBtn')?.addEventListener('click', () => { void requestAutosaveRecovery(); });
  $('autosaveRecoveryFileBtn')?.addEventListener('click', () => { closeFileMenu(); void requestAutosaveRecovery(); });

  function syncProjectSaveStatus(snapshot = getSaveSnapshot()) {
    const status = $('projectSaveStatus');
    if (!status) return;
    const fileState = String(snapshot.file || 'never-saved');
    const autosaveState = String(snapshot.autosave || '');
    const paused = snapshot.autosaveRecovery === true;
    const recoveryButton = $('autosaveRecoveryBtn');
    if (recoveryButton) recoveryButton.hidden = !paused;
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

  function handleUndoRequest() {
    if (isProjectReplacing()) return;
    if (!requireCanonicalData()) return;
    if (getEditingSnapshot().processing) return;
    if (getEditingSnapshot().previewActive) {
      discardActiveGeometryPreview();
      return;
    }
    if (draftInputActive()) {
      undoDraft();
      return;
    }
    if (!undoProject({ description: '작업 실행취소' })) return;
    setActionStatus('이전 작업을 실행 취소했습니다.', 'success');
  }

  function handleRedoRequest() {
    if (isProjectReplacing()) return;
    if (!requireCanonicalData()) return;
    if (getEditingSnapshot().processing) return;
    if (getEditingSnapshot().previewActive) {
      setActionStatus('변경 미리보기를 먼저 적용하거나 취소하세요.', 'error', 2600);
      return;
    }
    if (draftInputActive()) {
      redoDraft();
      return;
    }
    if (!redoProject({ description: '작업 다시 실행' })) return;
    setActionStatus('작업을 다시 실행했습니다.', 'success');
  }

  function updateHistoryButtons() {
    const draftMode = draftInputActive();
    const draft = getDraftSnapshot();
    const undoAvailable = draftMode ? draft.historyCount > 0 : (canUndo() || false);
    const redoAvailable = draftMode ? draft.futureCount > 0 : (canRedo() || false);
    const controls = [
      [$('undoBtn'), getEditingSnapshot().processing || !undoAvailable, draftMode ? '작성 중 실행 취소' : '실행 취소'],
      [$('redoBtn'), getEditingSnapshot().processing || !redoAvailable, draftMode ? '작성 중 다시 실행' : '다시 실행'],
      [$('mobileUndoBtn'), getEditingSnapshot().processing || !undoAvailable, draftMode ? '작성 중 실행 취소' : '실행 취소'],
      [$('mobileRedoBtn'), getEditingSnapshot().processing || !redoAvailable, draftMode ? '작성 중 다시 실행' : '다시 실행'],
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
    if (isProjectReplacing()) return;
    if (getAutosaveRecovery()) {
      void requestAutosaveRecovery();
      return;
    }

    closeFileMenu();
    const hasUnsavedChanges = getSaveSnapshot().hasUnsavedChanges;
    openConfirmModal({
      title: '새 프로젝트',
      message: hasUnsavedChanges
        ? '파일에 저장되지 않은 변경 사항이 있습니다. 현재 편집 내용, 실행취소 기록과 자동저장을 모두 지우고\n내장된 최초 세계 국경으로 돌아갑니다.'
        : '현재 편집 내용, 실행취소 기록과 자동저장을 모두 지우고\n내장된 최초 세계 국경으로 돌아갑니다.',
      impacts: hasUnsavedChanges ? ['파일에 저장되지 않은 변경 사항 삭제', '현재 실행취소 기록 초기화', '내장된 최초 세계 국경 복원'] : ['현재 실행취소 기록 초기화', '내장된 최초 세계 국경 복원'],
      confirmText: '초기 상태로 시작',
      danger: true,
      onConfirm: () => createEmptyProject(),
    });
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
