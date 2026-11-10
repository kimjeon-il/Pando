// One renderer-independent owner for temporal map admission and accepted-frame waiters.
// GPU resources, pixel buffers and canonical document state remain with their existing owners.
export function createMapPresentationSession({
  getGeneration, getContextRevision, isDisposed, getReadiness,
  invalidateFrame, prepareContentKey, isProjectBlocked,
  isRecoveryFrameAdmissible, onTemporalFailure = () => {},
  onTemporalRetired = () => {}, waitForCanonicalFrame,
}) {
  const mapWaiters = new Set();
  let committedGeneration = -1;
  let temporalTicket = null;
  let viewSequence = 0;
  const abortError = reason => Object.assign(new Error(reason), { name: 'AbortError', cancelled: true });
  const temporalPending = () => !!temporalTicket && !temporalTicket.presented;

  // Preparing a dated LOD precedes presentation. Waiting for the displayed
  // frame here would deadlock a capped source that needs that LOD to paint.
  function countrySourceAdmitted(content) {
    if (!temporalPending()) return true;
    return !temporalTicket.error && temporalTicket.sourceAdmitted !== false
      && temporalTicket.isCurrent() && temporalTicket.generation === getGeneration()
      && temporalTicket.context === getContextRevision()
      && (temporalTicket.kind !== 'view' || !!temporalTicket.countryContent
        && temporalTicket.countryContent === content);
  }

  function rejectMapPresentationWaiters(error) {
    for (const waiter of mapWaiters) waiter.reject(error);
    mapWaiters.clear();
  }
  function settleMapPresentationWaiters() {
    if (temporalPending() || !getReadiness().mapReady) return false;
    const generation = getGeneration();
    committedGeneration = generation;
    for (const waiter of mapWaiters) {
      if (waiter.generation !== generation) continue;
      mapWaiters.delete(waiter);
      waiter.resolve(true);
    }
    return true;
  }
  function waitForMapPresentation(generation) {
    if (isDisposed() || Number(generation) !== getGeneration())
      return Promise.reject(abortError('Project map presentation was superseded.'));
    if (!temporalPending() && committedGeneration === getGeneration() && getReadiness().mapReady)
      return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      mapWaiters.add({ generation, resolve, reject });
      invalidateFrame('await-current-map-frame');
    });
  }
  function beginTemporalViewTransition(isCurrent = () => true) {
    const token = ++viewSequence;
    temporalTicket = {
      kind: 'view', countryContent: null, token, generation: getGeneration(),
      context: getContextRevision(), isCurrent: () => !isDisposed()
        && token === viewSequence && isCurrent(),
      onPresented: () => {}, presented: false, sourceAdmitted: false,
      error: null, frameId: null,
    };
    return token;
  }
  function admitTemporalViewTransition(token) {
    if (!temporalPending() || temporalTicket.token !== token || !temporalTicket.isCurrent())
      return false;
    temporalTicket.sourceAdmitted = true;
    invalidateFrame('temporal-source-admitted');
    return true;
  }
  async function prepareTemporalCountrySource(features) {
    const ticket = temporalTicket;
    if (!temporalPending() || ticket.kind !== 'view' || ticket.countryContent !== null) return true;
    const isCurrent = () => ticket === temporalTicket && ticket.isCurrent();
    // Content identity (not the project generation alone) admits a dated mesh.
    const content = await prepareContentKey(features, isCurrent);
    if (content === null || !isCurrent()) return false;
    ticket.countryContent = content;
    return true;
  }
  function finishTemporalViewTransition(token) {
    if (temporalTicket?.token !== token) return false;
    if (!temporalTicket.presented) {
      temporalTicket = null;
      onTemporalRetired();
      invalidateFrame('temporal-source-rejected');
    }
    return true;
  }
  function canPresentVisualFrame(frame, result = null, { canvasPresented = false } = {}) {
    if (isProjectBlocked() || temporalTicket?.sourceAdmitted === false
      || result?.preserved || result?.succeeded === false) return false;
    if (!isRecoveryFrameAdmissible(frame)) return false;
    if (!temporalPending()) return true;
    if (result?.deferred && !canvasPresented) return false;
    return !temporalTicket.error && temporalTicket.isCurrent()
      && temporalTicket.generation === getGeneration()
      && frame?.projectGeneration === getGeneration()
      && temporalTicket.context === getContextRevision()
      && temporalTicket.frameId != null && temporalTicket.frameId === frame?.frameId;
  }
  function failTemporalPresentation(error) {
    if (!temporalPending()) return;
    temporalTicket.error = error;
    onTemporalFailure(error);
  }
  function waitForTemporalPresentation() {
    if (!temporalPending()) return Promise.resolve(true);
    if (temporalTicket.error) return Promise.reject(temporalTicket.error);
    if (!temporalTicket.isCurrent())
      return Promise.reject(abortError('Temporal presentation superseded'));
    return waitForCanonicalFrame();
  }
  function markTemporalFrame(frame) {
    if (temporalPending()) temporalTicket.frameId = frame.frameId;
  }
  function commitVisualFrame(frame) {
    if (!canPresentVisualFrame(frame)) return false;
    if (temporalPending()) {
      const ticket = temporalTicket;
      ticket.presented = true;
      onTemporalRetired();
      ticket.onPresented();
    }
    if (frame?.projectGeneration === getGeneration()) settleMapPresentationWaiters();
    return true;
  }
  function resetForProject({ presentation = 'default', isCurrent = () => true, onPresented = () => {} } = {}) {
    rejectMapPresentationWaiters(abortError('Project replaced before its map was presented.'));
    committedGeneration = -1;
    temporalTicket = presentation === 'temporal'
      ? { kind: 'replacement', generation: getGeneration(), context: getContextRevision(),
        isCurrent, onPresented, presented: false, error: null, frameId: null }
      : null;
  }
  function dispose() {
    temporalTicket = null;
    rejectMapPresentationWaiters(abortError('Renderer disposed before map publication.'));
    committedGeneration = -1;
  }
  return Object.freeze({
    get ticket() { return temporalTicket; },
    get pendingMapWaiterCount() { return mapWaiters.size; },
    temporalPending, countrySourceAdmitted, beginTemporalViewTransition, admitTemporalViewTransition,
    prepareTemporalCountrySource, finishTemporalViewTransition,
    canPresentVisualFrame, failTemporalPresentation, waitForTemporalPresentation,
    waitForMapPresentation, rejectMapPresentationWaiters, settleMapPresentationWaiters,
    markTemporalFrame, commitVisualFrame, resetForProject, dispose,
  });
}
