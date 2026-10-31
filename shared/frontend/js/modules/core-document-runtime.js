const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** ABI dispatch only; every mutation, validation and history entry is C++ owned. */
export function createDocumentSessionRuntime({ loadModule, validateFlagDataUrl, currentMonth = () => new Date().toISOString().slice(0,7) }) {
  if (typeof loadModule !== 'function' || typeof validateFlagDataUrl !== 'function' || typeof currentMonth !== 'function')
    throw new TypeError('The complete document module and current platform flag policy are required.');
  let sessionPromise = null;
  let queue = Promise.resolve();
  let disposed = false;
  function session() {
    if (!sessionPromise) sessionPromise = Promise.resolve().then(loadModule).then(module => {
      if (typeof module.DocumentSession !== 'function') fail('PL-CORE-DOCUMENT-ABI', 'The required whole-document C++ session export is missing.');
      return new module.DocumentSession({ validateFlagDataUrl });
    });
    return sessionPromise;
  }
  function call(method, args, context, projectResult = result => result) {
    const result = queue.then(async () => {
      if (disposed) fail('PL-CORE-DISPOSED', 'Document session is disposed.');
      context.throwIfCancelled();
      const core = await session();
      context.throwIfCancelled();
      if (typeof core[method] !== 'function') fail('PL-CORE-DOCUMENT-ABI', `DocumentSession.${method} is required.`);
      return projectResult(core[method](...(typeof args === 'function' ? args() : args)),core);
    });
    queue = result.catch(() => {});
    return result;
  }
  function resolvedWorld(core,state) {
    if (!Number.isSafeInteger(state?.epoch) || typeof state.timelineCursor !== 'string'
      || typeof core.resolveWorld !== 'function') fail('PL-CORE-DOCUMENT-ABI','An epoch-pinned current C++ world is required.');
    return core.resolveWorld(state.timelineCursor,state.epoch);
  }
  const committedResult = (result,core) => result?.ok && result.changed && result.delta?.timelineRecords !== null
    ? { ...result,world: resolvedWorld(core,result.state) } : result;
  function loadedResult(state,core) {
    for (const method of ['documentSnapshot','selectionSnapshot','draftSnapshot'])
      if (typeof core[method] !== 'function') fail('PL-CORE-DOCUMENT-ABI',`DocumentSession.${method} is required.`);
    return { state,project: core.documentSnapshot(),selection: core.selectionSnapshot(),draft: core.draftSnapshot(),
      world: resolvedWorld(core,state) };
  }
  return Object.freeze({
    // Publish the accepted load projection in this same Worker operation. A
    // second RPC could observe an intervening command or another document load.
    load: (payload, context) => call('documentLoad', () => [payload.storageJson, currentMonth()], context,loadedResult),
    baselineCoverage:(payload,context)=>call('baselineCoverage',[payload.baselineId,payload.month],context),
    loadBaseline: (payload,context) => call('documentLoadBaseline',() => [payload.baselineId,payload.setup],context,loadedResult),
    transitionBaseline: (payload,context) => call('documentTransitionBaseline',[payload.baselineId,payload.setup,payload.expectedEpoch],context,
      (result,core) => {
        if(!result?.ok || !result.delta)fail('PL-CORE-DOCUMENT-ABI','A builtin transition must return its accepted canonical delta.');
        return {...result,world:resolvedWorld(core,result.state),draft:core.draftSnapshot()};
      }),
    initialize: (payload,context) => call('documentInitialize',() => [{ ...payload,currentMonth: currentMonth() }],context,loadedResult),
    captureReplacement: (payload,context) => call('captureReplacement',[payload.expectedEpoch],context),
    rollbackReplacement: (payload,context) => call('rollbackReplacement',[payload.replacementId,payload.expectedEpoch],context,loadedResult),
    releaseReplacement: (payload,context) => call('releaseReplacement',[payload.replacementId],context),
    execute: (payload, context) => call('executeCommand', [payload], context,committedResult),
    prepare: (payload, context) => call('prepareCommand', [payload], context),
    candidateProjection: (payload,context) => call('candidateProjection',[payload.candidateId,payload.expectedEpoch],context),
    confirm: (payload, context) => call('confirmCandidate', [payload.candidateId, payload.expectedEpoch], context,committedResult),
    cancel: (payload, context) => call('cancelCandidate', [payload.candidateId], context),
    undo: (payload, context) => call('undo', [payload.expectedEpoch], context,committedResult),
    redo: (payload, context) => call('redo', [payload.expectedEpoch], context,committedResult),
    markSaved: (payload, context) => call('markSaved', [payload.expectedEpoch], context),
    storageSnapshot: (payload, context) => call('storageSnapshot', [], context),
    exportSnapshot: (payload, context) => call('exportSnapshot', [payload], context),
    storageBaselineLoad: (payload,context) => call('storageBaselineLoad',[payload.baseline,payload.expectedEpoch],context,state => ({ state })),
    validateImport: (payload,context) => call('validateImport',[payload.storageJson,payload.baselineId],context),
    inspectImport: (payload,context) => call('inspectImport',() => [payload.storageJson,payload.baselineId,currentMonth()],context),
    resolveWorld: (payload, context) => call('resolveWorld', [payload.month, payload.expectedEpoch], context),
    setTimelineCursor: (payload, context) => call('setTimelineCursor', [payload.month, payload.expectedEpoch], context,
      result => {
        if (!result?.state || !result?.world || result.world.sourceEpoch !== result.state.epoch
          || result.world.month !== result.state.timelineCursor || !Array.isArray(result.world.entities))
          fail('PL-CORE-DOCUMENT-ABI', 'The C++ cursor transition must return its own epoch-pinned resolved world.');
        return result;
      }),
    selectionCatalogLoad: (payload, context) => call('selectionCatalogLoad', [payload.domain,payload.refs,payload.expectedEpoch], context),
    presentationCatalogLoad: (payload,context) => call('presentationCatalogLoad',[payload.catalog,payload.expectedEpoch],context),
    selectionApply: (payload, context) => call('selectionApply', [payload], context),
    selectionSnapshot: (payload, context) => call('selectionSnapshot', [], context),
    draftApply: (payload, context) => call('draftApply', [payload], context),
    draftSnapshot: (payload, context) => call('draftSnapshot', [], context),
    labelGestureApply: (payload,context) => call('labelGestureApply',[payload],context,committedResult),
    state: (payload, context) => call('projectState', [], context),
    async dispose() { disposed = true; await queue; if (sessionPromise) (await sessionPromise).delete(); },
  });
}
