const cloneValue = value => {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) { /* fall through */ }
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
};

/**
 * Owns the canonical project boundary without exposing the mutable object
 * returned by the host application.
 */
export function createProjectDomain({
  context = null,
  getSnapshot = null,
  replaceSnapshot = () => false,
  commandPipeline = null,
  serializer = null,
  history = null,
  persistence = null,
  saveState = null,
  createProjectFile = null,
  prepareEmpty = async () => null,
  captureReplacement = null,
  restoreReplacement = null,
  invalidateProject = () => {},
  invalidateHistory = () => {},
  reportDiagnostic = () => {},
  invariants = null,
  restoreCountriesFromDelta = null,
  onProjectChanged = () => {},
  onProjectReset = () => {},
} = {}) {
  let generation = 0;
  let disposed = false;
  let replacing = false;
  let saving = false;

  const snapshot = () => cloneValue(
    typeof serializer?.buildProject === 'function'
      ? serializer.buildProject()
      : (typeof getSnapshot === 'function' ? getSnapshot() : context?.getProjectSnapshot?.()),
  );
  const buildProject = () => cloneValue(
    typeof serializer?.buildProject === 'function'
      ? serializer.buildProject()
      : (typeof getSnapshot === 'function' ? getSnapshot() : context?.getProjectSnapshot?.()),
  );
  const buildAutosave = () => cloneValue(
    typeof serializer?.buildAutosave === 'function' ? serializer.buildAutosave() : buildProject(),
  );
  const countriesFromAutosaveDelta = (project, suppliedBase = null) => {
    if (typeof restoreCountriesFromDelta !== 'function') return cloneValue(project?.countriesData || project);
    return restoreCountriesFromDelta(project, suppliedBase);
  };
  const emitChanged = (reason, detail = null) => {
    const event = Object.freeze({ generation, reason: String(reason || 'project-changed'), detail: cloneValue(detail) });
    onProjectChanged(event);
    return event;
  };
  const bumpGeneration = reason => {
    generation += 1;
    onProjectReset(Object.freeze({ generation, reason: String(reason || 'project-reset') }));
    return generation;
  };
  const assertActive = () => {
    if (disposed) throw new Error('Project domain is disposed.');
  };

  const dispatch = async command => {
    assertActive();
    const id = String(command?.id || '').trim();
    if (!id) throw new TypeError('ProjectDomain.dispatch() requires a command id.');
    if (typeof commandPipeline?.execute !== 'function') {
      throw new TypeError('ProjectDomain.dispatch() requires a commandPipeline with execute().');
    }
    const result = await commandPipeline.execute(id, command?.context || {}, command?.payload);
    if (result?.ok === true && result?.changed === true) emitChanged(id, result);
    return result;
  };

  const notify = (reason, detail, invalidate) => {
    for (const [stage, action] of [
      ['event', () => emitChanged(reason, detail)],
      ['render', () => invalidate(reason)],
      ['autosave', () => persistence?.queueProject(undefined, { markDirty: false })],
    ]) {
      try { action(); } catch (error) {
        try { reportDiagnostic({ stage, reason, error }); } catch (_) { /* A diagnostic cannot undo a commit. */ }
      }
    }
  };

  const replace = async (serializedProject, reason) => {
    assertActive();
    if (replacing) throw new Error('Project replacement is already running.');
    if (serializedProject && invariants?.assertProjectReferenceIntegrity) {
      const countries = serializedProject?.countriesData?.features || serializedProject?.countries || [];
      invariants.assertProjectReferenceIntegrity({
        ...serializedProject,
        countries,
      });
    }
    replacing = true;
    let checkpoint;
    let resetStarted = false;
    try {
      // Finish asynchronous preparation before touching the current project.
      const prepared = reason === 'new' ? await prepareEmpty() : null;
      checkpoint = captureReplacement?.();
      persistence?.cancelPending?.();
      resetStarted = true;
      const nextGeneration = bumpGeneration(`project-${reason}`);
      const result = await replaceSnapshot(serializedProject, {
        reason, generation: nextGeneration, skipRenderReset: true,
        ...(reason === 'new' ? { prepared } : {}),
      });
      if (result === false) throw new Error('Project replacement was rejected.');
      if (reason === 'new') await persistence?.clear?.();
      history?.reset();
      if (reason === 'new') saveState?.markNewProject('content:0');
      else saveState?.markOpenedFile(`content:${Date.now()}`);
      notify(`project-${reason}`, null, invalidateProject);
      return result;
    } catch (error) {
      if (resetStarted && checkpoint !== undefined && restoreReplacement) {
        // Generations stay monotonic so failed replacement workers remain stale.
        const rollbackGeneration = bumpGeneration('project-rollback');
        try { await restoreReplacement(checkpoint, rollbackGeneration); }
        catch (restoreError) { error.restoreError = restoreError; }
      }
      throw error;
    } finally {
      replacing = false;
    }
  };
  const load = project => replace(project, 'load');
  const createEmpty = () => replace(null, 'new');
  const travelHistory = (direction, metadata) => {
    assertActive();
    if (replacing) return false;
    if (!history) throw new TypeError('Project history is not configured.');
    const changed = history[direction](metadata);
    if (changed) {
      saveState?.markContentChanged();
      notify(`project-${direction}`, null, invalidateHistory);
    }
    return changed;
  };
  const save = async write => {
    assertActive();
    if (saving || replacing) return false;
    if (typeof createProjectFile !== 'function' || typeof write !== 'function') {
      throw new TypeError('Project save requires an encoder and a file writer.');
    }
    saving = true;
    const checkpoint = saveState?.checkpoint?.();
    const savedGeneration = generation;
    const tokens = saveState?.snapshot?.();
    const unchanged = () => generation === savedGeneration
      && saveState?.snapshot?.().currentContentToken === tokens?.currentContentToken
      && saveState?.snapshot?.().currentPresentationToken === tokens?.currentPresentationToken;
    saveState?.markFileSaving?.();
    try {
      const blob = await createProjectFile(buildProject());
      const result = await write(blob);
      if (unchanged()) saveState?.markFileSaved?.(result);
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (checkpoint && unchanged()) saveState.restore(checkpoint);
      } else if (unchanged()) saveState?.markFileError?.();
      throw error;
    } finally { saving = false; }
  };

  const resetRenderGeneration = reason => bumpGeneration(reason || 'render-reset');
  const dispose = () => { disposed = true; };

  return Object.freeze({
    snapshot,
    buildProject,
    buildAutosave,
    countriesFromAutosaveDelta,
    getGeneration: () => generation,
    dispatch,
    load,
    createEmpty,
    save,
    undo: metadata => travelHistory('undo', metadata),
    redo: metadata => travelHistory('redo', metadata),
    canUndo: () => history?.canUndo() || false,
    canRedo: () => history?.canRedo() || false,
    recordHistory: history?.record,
    commitHistorySnapshot: history?.commitSnapshot,
    discardHistory: history?.discardLast,
    queueAutosave: persistence?.queueProject,
    queueViewAutosave: persistence?.queueView,
    queuePresentationAutosave: persistence?.queuePresentation,
    persistAutosave: persistence?.persist,
    restoreAutosave: persistence?.restore,
    flushAutosave: () => persistence?.writeProject(buildAutosave()),
    resetRenderGeneration,
    dispose,
  });
}
