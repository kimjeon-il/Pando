export function createHistoryService({
  store,
  maxEntries,
  snapshot,
  restore,
  normalizeMetadata,
  onRecord = () => {},
  onChange = () => {},
}) {
  function trim() {
    while (store.history.length > maxEntries) {
      store.history.shift();
      store.historyMeta.shift();
    }
  }

  function commitSnapshot(value, metadata = {}) {
    store.history.push(value);
    store.historyMeta.push(normalizeMetadata(metadata));
    trim();
    store.future = [];
    store.futureMeta = [];
    onRecord();
    onChange();
  }

  function record(metadata = {}) {
    commitSnapshot(snapshot(), metadata);
  }

  function discardLast() {
    if (!store.history.length) return false;
    store.history.pop();
    store.historyMeta.pop();
    onChange();
    return true;
  }

  function undo(fallbackMetadata = {}) {
    if (!store.history.length) return false;
    store.future.push(snapshot());
    store.futureMeta.push(store.historyMeta.at(-1) || normalizeMetadata(fallbackMetadata));
    const previous = store.history.pop();
    store.historyMeta.pop();
    restore(previous);
    onChange();
    return true;
  }

  function redo(fallbackMetadata = {}) {
    if (!store.future.length) return false;
    store.history.push(snapshot());
    store.historyMeta.push(store.futureMeta.at(-1) || normalizeMetadata(fallbackMetadata));
    trim();
    const next = store.future.pop();
    store.futureMeta.pop();
    restore(next);
    onChange();
    return true;
  }

  function reset() {
    store.history = [];
    store.historyMeta = [];
    store.future = [];
    store.futureMeta = [];
    onChange();
  }

  return Object.freeze({
    canRedo: () => store.future.length > 0,
    canUndo: () => store.history.length > 0,
    commitSnapshot,
    discardLast,
    record,
    redo,
    reset,
    undo,
  });
}
