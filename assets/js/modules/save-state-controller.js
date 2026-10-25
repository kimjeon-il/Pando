export const AUTOSAVE_STATES = Object.freeze({
  IDLE: 'idle', QUEUED: 'queued', SAVING: 'saving', SAVED: 'saved', ERROR: 'error',
});
export const FILE_SAVE_STATES = Object.freeze({
  NEVER_SAVED: 'never-saved', CLEAN: 'clean', DIRTY: 'dirty', SAVING: 'saving',
  SAVED: 'saved', DOWNLOAD_CREATED: 'download-created', ERROR: 'error',
});

/** Device I/O status reads Core document checkpoints. */
export function createSaveStateController({ getDocumentState,onChange = () => {},now = () => new Date() } = {}) {
  if (typeof getDocumentState!=='function') throw new TypeError('The canonical C++ document state reader is required.');
  let fileDisposition=FILE_SAVE_STATES.NEVER_SAVED;
  let fileOperation=null;
  let operationEpoch=null;
  const io={ autosave: AUTOSAVE_STATES.IDLE,lastAutosavedAt: null,lastFileSavedAt: null,
    autosaveFallback: '',autosaveRecovery: false };
  function snapshot() {
    const core=getDocumentState();
    if (core!==null && (!Number.isSafeInteger(core?.epoch) || typeof core.documentDirty!=='boolean'
      || typeof core.presentationDirty!=='boolean' || !Number.isSafeInteger(core.checkpoint)
      || !Number.isSafeInteger(core.presentationCheckpoint))) throw new TypeError('A complete C++ dirty/checkpoint state is required.');
    const dirty=core!==null && (core.documentDirty || core.presentationDirty);
    const file=fileOperation && core?.epoch===operationEpoch ? fileOperation : dirty ? FILE_SAVE_STATES.DIRTY : fileDisposition;
    return Object.freeze({ ...io,file,documentDirty: core?.documentDirty ?? false,
      presentationDirty: core?.presentationDirty ?? false,hasUnsavedChanges: dirty,
      currentContentToken: core===null ? null : `content:${core.checkpoint}`,
      currentPresentationToken: core===null ? null : `presentation:${core.presentationCheckpoint}`,
      savedContentToken: core===null || dirty || fileDisposition===FILE_SAVE_STATES.NEVER_SAVED ? null : `content:${core.checkpoint}` });
  }
  const emit=reason => { const accepted=snapshot();onChange(accepted,reason);return accepted; };
  const disposition=(file,reason) => { fileDisposition=file;fileOperation=null;operationEpoch=null;return emit(reason); };
  const operation=(file,reason) => { fileOperation=file;operationEpoch=getDocumentState()?.epoch ?? null;return emit(reason); };
  return Object.freeze({
    snapshot,
    // This receipt contains platform statuses only; Core replacement capsules
    // preserve the canonical ledger and saved checkpoints separately.
    checkpoint: () => Object.freeze({ ...io,fileDisposition,fileOperation,operationEpoch }),
    restore(receipt) {
      if (!receipt || !Object.hasOwn(receipt,'fileDisposition')) throw new TypeError('A device I/O status receipt is required.');
      for(const key of Object.keys(io)) io[key]=receipt[key];
      fileDisposition=receipt.fileDisposition;fileOperation=null;operationEpoch=null;return emit('restore');
    },
    sync: () => emit('core-state'),
    markOpenedFile: () => disposition(FILE_SAVE_STATES.CLEAN,'opened-file'),
    markNewProject: () => disposition(FILE_SAVE_STATES.NEVER_SAVED,'new-project'),
    markFileSaving: () => operation(FILE_SAVE_STATES.SAVING,'file-saving'),
    markFileError: () => operation(FILE_SAVE_STATES.ERROR,'file-error'),
    markFileSaved({ downloaded = false } = {}) {
      io.lastFileSavedAt=now();return disposition(downloaded ? FILE_SAVE_STATES.DOWNLOAD_CREATED : FILE_SAVE_STATES.SAVED,
        downloaded ? 'download-created':'file-saved');
    },
    setAutosave(value,{ fallback = '' } = {}) {
      io.autosave=value;io.autosaveFallback=fallback;if(value===AUTOSAVE_STATES.SAVED)io.lastAutosavedAt=now();return emit(`autosave-${value}`);
    },
    setAutosaveRecovery: value => { io.autosaveRecovery=!!value;return emit('autosave-recovery'); },
  });
}
