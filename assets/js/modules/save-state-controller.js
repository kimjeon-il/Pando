export const AUTOSAVE_STATES = Object.freeze({
  IDLE: 'idle', QUEUED: 'queued', SAVING: 'saving', SAVED: 'saved', ERROR: 'error',
});

export const FILE_SAVE_STATES = Object.freeze({
  NEVER_SAVED: 'never-saved', CLEAN: 'clean', DIRTY: 'dirty', SAVING: 'saving',
  SAVED: 'saved', DOWNLOAD_CREATED: 'download-created', ERROR: 'error',
});

export function createSaveStateController({ onChange = () => {}, now = () => new Date() } = {}) {
  let sequence = 0;
  let currentContentToken = 'content:0';
  let cleanContentToken = currentContentToken;
  let savedContentToken = null;
  let currentPresentationToken = 'presentation:0';
  let cleanPresentationToken = currentPresentationToken;
  const state = {
    autosave: AUTOSAVE_STATES.IDLE,
    file: FILE_SAVE_STATES.NEVER_SAVED,
    lastAutosavedAt: null,
    lastFileSavedAt: null,
    currentContentToken,
    currentPresentationToken,
    savedContentToken,
    documentDirty: false,
    presentationDirty: false,
    hasUnsavedChanges: false,
    autosaveFallback: '',
  };

  const snapshot = () => Object.freeze({ ...state });
  const emit = reason => {
    onChange(snapshot(), reason);
    return snapshot();
  };

  function syncDirtyState() {
    state.documentDirty = cleanContentToken !== currentContentToken;
    state.presentationDirty = cleanPresentationToken !== currentPresentationToken;
    state.hasUnsavedChanges = state.documentDirty || state.presentationDirty;
    state.file = state.hasUnsavedChanges
      ? FILE_SAVE_STATES.DIRTY
      : savedContentToken === currentContentToken
        ? FILE_SAVE_STATES.CLEAN
        : FILE_SAVE_STATES.NEVER_SAVED;
  }

  function setContentToken(token, { markDirty = true } = {}) {
    currentContentToken = String(token || `content:${++sequence}`);
    state.currentContentToken = currentContentToken;
    if (markDirty) syncDirtyState();
    return emit('content');
  }

  function markContentChanged() {
    sequence += 1;
    return setContentToken(`content:${sequence}`);
  }

  function markPresentationChanged() {
    sequence += 1;
    currentPresentationToken = `presentation:${sequence}`;
    state.currentPresentationToken = currentPresentationToken;
    syncDirtyState();
    return emit('presentation');
  }

  function markOpenedFile(token = currentContentToken) {
    currentContentToken = String(token);
    cleanContentToken = currentContentToken;
    savedContentToken = currentContentToken;
    cleanPresentationToken = currentPresentationToken;
    state.currentContentToken = currentContentToken;
    state.savedContentToken = savedContentToken;
    state.documentDirty = false;
    state.presentationDirty = false;
    state.hasUnsavedChanges = false;
    state.file = FILE_SAVE_STATES.CLEAN;
    return emit('opened-file');
  }

  function markNewProject(token = currentContentToken) {
    currentContentToken = String(token);
    cleanContentToken = currentContentToken;
    savedContentToken = null;
    cleanPresentationToken = currentPresentationToken;
    state.currentContentToken = currentContentToken;
    state.savedContentToken = null;
    state.documentDirty = false;
    state.presentationDirty = false;
    state.hasUnsavedChanges = false;
    state.file = FILE_SAVE_STATES.NEVER_SAVED;
    return emit('new-project');
  }

  function markFileSaving() {
    state.file = FILE_SAVE_STATES.SAVING;
    return emit('file-saving');
  }

  function markFileSaved({ downloaded = false } = {}) {
    cleanContentToken = currentContentToken;
    cleanPresentationToken = currentPresentationToken;
    savedContentToken = currentContentToken;
    state.savedContentToken = savedContentToken;
    state.lastFileSavedAt = now();
    state.documentDirty = false;
    state.presentationDirty = false;
    state.hasUnsavedChanges = false;
    state.file = downloaded ? FILE_SAVE_STATES.DOWNLOAD_CREATED : FILE_SAVE_STATES.SAVED;
    return emit(downloaded ? 'download-created' : 'file-saved');
  }

  function markFileError() {
    state.file = FILE_SAVE_STATES.ERROR;
    return emit('file-error');
  }

  function setAutosave(value, { fallback = '' } = {}) {
    state.autosave = value;
    state.autosaveFallback = fallback;
    if (value === AUTOSAVE_STATES.SAVED) state.lastAutosavedAt = now();
    return emit(`autosave-${value}`);
  }

  return Object.freeze({
    snapshot,
    setContentToken,
    markContentChanged,
    markDocumentChanged: markContentChanged,
    markPresentationChanged,
    markOpenedFile,
    markNewProject,
    markFileSaving,
    markFileSaved,
    markFileError,
    setAutosave,
  });
}
