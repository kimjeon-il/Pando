import { AUTOSAVE_STATES } from './save-state-controller.js';
export function createProjectUiBridge({
  getElement: $,
  getSaveSnapshot,
  getEditingSnapshot,
  getDraftSnapshot,
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
  setActionStatus,
  closeFileMenu,
  openConfirmModal,
} = {}) {

  function syncProjectSaveStatus(snapshot = getSaveSnapshot()) {
    const status = $('projectSaveStatus');
    if (!status) return;
    const fileState = String(snapshot.file || 'never-saved');
    const autosaveState = String(snapshot.autosave || '');
    const isSaving = fileState === 'saving' || autosaveState === AUTOSAVE_STATES.QUEUED || autosaveState === AUTOSAVE_STATES.SAVING;
    const isError = fileState === 'error' || autosaveState === AUTOSAVE_STATES.ERROR;
    const saveStateLabel = isSaving
      ? '저장 중'
      : isError
        ? '저장 오류'
        : fileState === 'saved' || fileState === 'clean'
        ? '저장됨'
        : '미저장';
    const saveStateDescription = isSaving
      ? '변경 사항을 저장하는 중입니다.'
      : isError
        ? '저장하지 못했습니다.'
        : fileState === 'saved' || fileState === 'clean'
        ? '모든 변경 사항이 저장되었습니다.'
        : '저장되지 않은 변경 사항이 있습니다.';
    status.hidden = false;
    status.dataset.saveState = isSaving ? 'saving' : isError ? 'error' : fileState;
    $('projectSaveStatusText').textContent = saveStateLabel;
    status.dataset.tooltip = saveStateDescription;
    status.setAttribute('aria-label', saveStateDescription);
  }

  function handleUndoRequest() {
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
    $('undoBtn').disabled = getEditingSnapshot().processing || !undoAvailable;
    $('redoBtn').disabled = getEditingSnapshot().processing || !redoAvailable;
    $('undoBtn').dataset.tooltip = draftMode ? '작성 중 실행 취소' : '실행 취소';
    $('redoBtn').dataset.tooltip = draftMode ? '작성 중 다시 실행' : '다시 실행';
    $('undoBtn').setAttribute('aria-label', draftMode ? '작성 중 실행 취소' : '실행 취소');
    $('redoBtn').setAttribute('aria-label', draftMode ? '작성 중 다시 실행' : '다시 실행');
  }

  function requestNewProject(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

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
  });
}
