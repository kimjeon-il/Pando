export function createAtomicMapStateController({ applySnapshot = () => {}, clone = structuredClone } = {}) {
  let requestedRevision = 0;
  let committedRevision = 0;
  let pending = null;

  function begin(input = {}) {
    requestedRevision += 1;
    const token = { revision: requestedRevision, input: clone(input) };
    pending = token;
    return token;
  }

  function isCurrent(token) {
    return !!token && token === pending && Number(token.revision) === requestedRevision;
  }

  function commit(token, snapshot) {
    if (!isCurrent(token)) return false;
    applySnapshot(clone({ ...snapshot, stateRevision: token.revision }));
    committedRevision = token.revision;
    pending = null;
    return true;
  }

  function cancel(token = pending) {
    if (!isCurrent(token)) return false;
    requestedRevision += 1;
    pending = null;
    return true;
  }

  return Object.freeze({
    begin,
    commit,
    cancel,
    isCurrent,
    requestedRevision: () => requestedRevision,
    committedRevision: () => committedRevision,
    pending: () => pending,
  });
}
