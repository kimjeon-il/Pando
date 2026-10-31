/** Page-scoped first-map presentation; independent of search and later opens. */
export function createViewerInitialPresentation({onPresented = () => {}} = {}) {
  let presented = false, disposed = false, pending = null;
  function publish(request) {
    if (disposed || presented || pending !== request || !request.isCurrent()
      || request.generation === null || request.readyGeneration !== request.generation) return false;
    presented = true;
    pending = null;
    onPresented();
    return true;
  }
  return Object.freeze({
    hasPresented: () => presented,
    track(isCurrent) {
      if (typeof isCurrent !== 'function') throw new TypeError('A current viewer request predicate is required.');
      const request = {isCurrent, generation: null, readyGeneration: null};
      if (!disposed && !presented) pending = request;
      return Object.freeze({
        accept(generation) {
          if (!Number.isSafeInteger(generation) || generation <= 0) throw new TypeError('An accepted project generation is required.');
          request.generation = generation;
          return publish(request);
        },
        cancel() { if (pending === request) pending = null; },
      });
    },
    observe(presentation, generation) {
      if (!pending || disposed || presented) return false;
      pending.readyGeneration = presentation.status === 'ready'
        && Number.isSafeInteger(generation) && generation > 0 ? generation : null;
      return publish(pending);
    },
    dispose() { disposed = true; pending = null; },
  });
}
