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
 * Owns the canonical project boundary while keeping persistence and the
 * existing command/history services injectable.  The domain never exposes
 * the mutable object returned by the host application.
 */
export function createProjectDomain({
  context = null,
  getSnapshot = null,
  replaceSnapshot = () => false,
  commandPipeline = null,
  serializer = null,
  persistence = null,
  history = null,
  invariants = null,
  restoreCountriesFromDelta = null,
  onProjectChanged = () => {},
  onProjectReset = () => {},
} = {}) {
  let generation = 0;
  let disposed = false;

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

  const load = async serializedProject => {
    assertActive();
    if (invariants?.assertProjectReferenceIntegrity) {
      const countries = serializedProject?.countriesData?.features || serializedProject?.countries || [];
      invariants.assertProjectReferenceIntegrity({
        ...serializedProject,
        countries,
      });
    }
    const nextGeneration = bumpGeneration('project-load');
    let result;
    try {
      result = await replaceSnapshot(serializedProject, {
        reason: 'load', generation: nextGeneration, skipRenderReset: true,
      });
    } catch (error) {
      generation -= 1;
      throw error;
    }
    emitChanged('project-load', result);
    return result;
  };

  const createEmpty = async () => {
    assertActive();
    const nextGeneration = bumpGeneration('project-create-empty');
    let result;
    try {
      result = await replaceSnapshot(null, {
        reason: 'create-empty', generation: nextGeneration, skipRenderReset: true,
      });
    } catch (error) {
      generation -= 1;
      throw error;
    }
    emitChanged('project-create-empty', result);
    return result;
  };

  const save = async () => {
    assertActive();
    const project = buildProject();
    if (invariants?.assertProjectReferenceIntegrity) {
      invariants.assertProjectReferenceIntegrity({
        ...project,
        countries: project?.countriesData?.features || project?.countries || [],
      });
    }
    if (persistence?.persist) return persistence.persist(project);
    return project;
  };

  const undo = async () => {
    assertActive();
    const result = await history?.undo?.();
    if (result) emitChanged('undo', result);
    return result;
  };

  const redo = async () => {
    assertActive();
    const result = await history?.redo?.();
    if (result) emitChanged('redo', result);
    return result;
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
    undo,
    redo,
    save,
    resetRenderGeneration,
    dispose,
  });
}
