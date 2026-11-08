export function createCountryGeometryRevisionTracker() {
  let committedRevision = 0;
  let displayedRevision = 0;
  let taskToken = 0;
  const pendingRevisions = new Map();

  const normalizedIds = ids => [...new Set([...(ids || [])].map(String).filter(Boolean))];

  function beginCommit(ids) {
    committedRevision += 1;
    taskToken += 1;
    const normalized = normalizedIds(ids);
    for (const id of normalized) pendingRevisions.set(id, committedRevision);
    return { ids: normalized, revision: committedRevision, token: taskToken };
  }

  function beginTask(revision = committedRevision) {
    taskToken += 1;
    return { revision: Number(revision || 0), token: taskToken };
  }

  function isCurrent(token, revision) {
    return Number(token) === taskToken && Number(revision) === committedRevision;
  }

  function markDisplayed(ids, revision) {
    const numericRevision = Number(revision || 0);
    if (numericRevision < committedRevision) return [];
    const cleared = [];
    for (const id of normalizedIds(ids)) {
      const pendingRevision = pendingRevisions.get(id);
      if (pendingRevision === undefined || pendingRevision > numericRevision) continue;
      pendingRevisions.delete(id);
      cleared.push(id);
    }
    displayedRevision = Math.max(displayedRevision, numericRevision);
    return cleared;
  }

  function reset() {
    taskToken += 1;
    pendingRevisions.clear();
    committedRevision += 1;
    return committedRevision;
  }

  return Object.freeze({
    beginCommit,
    beginTask,
    isCurrent,
    markDisplayed,
    reset,
    committedRevision: () => committedRevision,
    displayedRevision: () => displayedRevision,
    taskToken: () => taskToken,
    pendingIds: () => [...pendingRevisions.keys()],
    pendingRevision: id => pendingRevisions.get(String(id)),
    isPending: id => pendingRevisions.has(String(id)),
  });
}
