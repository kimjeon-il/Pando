export function createSelectionUiController({
  window,
  document,
  selectionDomain,
  elements = {},
  resolveRef = value => value,
  refExists = () => true,
  displayInfo = () => ({ name: '', type: '' }),
  presenters = {},
  uiActions = {},
  metrics = {},
} = {}) {
  let disposed = false;
  let pendingSnapshot = null;
  let syncFrame = 0;
  let lastRevision = -1;

  const requestFrame = window?.requestAnimationFrame?.bind(window)
    || (callback => window?.setTimeout?.(callback, 0));
  const cancelFrame = window?.cancelAnimationFrame?.bind(window)
    || (handle => window?.clearTimeout?.(handle));

  const selection = () => selectionDomain?.snapshot?.().selection || {
    primaryKey: null,
    items: [],
    keys: [],
  };

  const primary = snapshot => {
    const current = snapshot?.selection || snapshot || selection();
    return current.items?.find(item => item.key === current.primaryKey)
      || current.items?.at?.(-1)
      || null;
  };

  const presentPrimary = ({ refreshOnly = false, openEditor = false } = {}) => {
    if (disposed) return false;
    const ref = primary(selection());
    if (!ref) {
      uiActions.clearPresenter?.({ refreshOnly });
      return false;
    }
    const presenter = presenters.resolve?.(ref) || presenters[ref.domain] || presenters.default;
    presenter?.(ref, { refreshOnly, openEditor });
    if (openEditor && !refreshOnly) uiActions.openEditor?.(ref);
    return true;
  };

  const renderMultiple = current => {
    if ((current.items?.length || 0) <= 1) return false;
    const types = [...new Set(current.items.map(item => displayInfo(item).type).filter(Boolean))];
    presenters.multiple?.(current, {
      title: `${current.items.length}개 선택됨`,
      typeLabel: types.length === 1 ? types[0] : '여러 유형',
    });
    return true;
  };

  const syncNow = (snapshot, { force = false } = {}) => {
    if (disposed) return false;
    const currentSnapshot = snapshot || selectionDomain?.snapshot?.();
    if (!currentSnapshot || (!force && currentSnapshot.revision === lastRevision)) return false;
    lastRevision = currentSnapshot.revision;
    const startedAt = globalThis.performance?.now?.() || Date.now();
    const current = currentSnapshot.selection;
    const count = current.items.length;
    const multiple = count > 1;
    if (elements.multiSelectionCount) elements.multiSelectionCount.textContent = `${count}개 선택됨`;
    if (elements.multiSelectionMode) {
      const addMode = uiActions.isAddSelectionMode?.() === true;
      elements.multiSelectionMode.textContent = addMode ? '선택 완료' : '추가 선택';
      elements.multiSelectionMode.setAttribute('aria-pressed', String(addMode));
      elements.multiSelectionMode.disabled = count === 0;
    }
    document?.body?.classList?.toggle('multi-selection-active', multiple);
    if (multiple) {
      const types = [...new Set(current.items.map(item => displayInfo(item).type).filter(Boolean))];
      if (elements.selectionStatus) elements.selectionStatus.textContent = `${count}개 선택됨 ${types.join(', ')}`;
      renderMultiple(current);
    }
    uiActions.syncBatchActions?.(current);
    uiActions.syncMapSurfaces?.(current);
    uiActions.syncLayerRows?.(current);
    metrics.selectionUiSyncCount = Number(metrics.selectionUiSyncCount || 0) + 1;
    metrics.summaryMs = (globalThis.performance?.now?.() || Date.now()) - startedAt;
    return true;
  };

  const sync = (snapshot = selectionDomain?.snapshot?.()) => {
    if (disposed) return false;
    pendingSnapshot = snapshot;
    if (syncFrame) {
      metrics.selectionUiCoalescedCount = Number(metrics.selectionUiCoalescedCount || 0) + 1;
      return false;
    }
    syncFrame = requestFrame?.(() => {
      syncFrame = 0;
      const next = pendingSnapshot || selectionDomain?.snapshot?.();
      pendingSnapshot = null;
      syncNow(next);
    }) || 0;
    return true;
  };

  const applyIntent = (value, {
    mode = 'replace',
    orderedRefs = [],
    scope = 'map',
    refreshOnly = false,
    openEditor = true,
  } = {}) => {
    if (disposed) return false;
    const ref = resolveRef(value);
    if (!ref || !refExists(ref)) return false;
    const startedAt = globalThis.performance?.now?.() || Date.now();
    if (mode === 'toggle') selectionDomain.toggle(ref, { scope, reason: 'object-selection-toggle' });
    else if (mode === 'range') selectionDomain.selectRange(ref, orderedRefs, { scope, reason: 'object-selection-range' });
    else selectionDomain.replace(ref, { scope, reason: 'object-selection-replace' });
    metrics.controllerMs = (globalThis.performance?.now?.() || Date.now()) - startedAt;
    const selected = selectionDomain.has(ref);
    if (selected) {
      presentPrimary({ refreshOnly, openEditor });
      const isCountry = ref.domain === 'territorial' && ref.type === 'country';
      if (!refreshOnly && !isCountry) uiActions.focusObject?.(ref);
    } else if (!selectionDomain.size()) uiActions.clearPresenter?.({ refreshOnly: false });
    uiActions.closeChooser?.();
    return selected;
  };

  const replaceMany = (refs, {
    primary: preferred = null,
    scope = 'map',
    reason = 'selection-replace-many',
    present = true,
  } = {}) => {
    const normalized = [...new Map((refs || []).map(resolveRef).filter(ref => ref && refExists(ref)).map(ref => [ref.key, ref])).values()];
    const preferredRef = resolveRef(preferred);
    const nextPrimary = normalized.find(ref => ref.key === preferredRef?.key) || normalized.at(-1) || null;
    selectionDomain.setMany(normalized, { primary: nextPrimary, scope, reason });
    if (present && nextPrimary) presentPrimary({ refreshOnly: true });
    else if (present) uiActions.clearPresenter?.({ refreshOnly: false });
    renderMultiple(selection());
    return normalized;
  };

  const restore = snapshot => replaceMany(snapshot?.items || [], {
    primary: snapshot?.items?.find?.(item => item.key === snapshot.primaryKey) || null,
    reason: 'restore-selection',
  });

  const clear = (options = {}) => {
    if (disposed) return false;
    const changed = selectionDomain.clear({ scope: options.scope || 'ui', reason: options.reason || 'selection-clear' });
    uiActions.clearPresenter?.(options);
    return changed;
  };

  const bind = () => {
    elements.multiSelectionMode?.addEventListener?.('click', () => uiActions.toggleAddSelectionMode?.());
    elements.clearMultiSelection?.addEventListener?.('click', () => clear());
    elements.multiEdit?.addEventListener?.('click', () => uiActions.openMultiEditor?.());
    return api;
  };

  const resetProject = () => {
    lastRevision = -1;
    pendingSnapshot = null;
    if (syncFrame) cancelFrame?.(syncFrame);
    syncFrame = 0;
    uiActions.clearPresenter?.({ projectReset: true });
  };

  const dispose = () => {
    disposed = true;
    if (syncFrame) cancelFrame?.(syncFrame);
    syncFrame = 0;
    pendingSnapshot = null;
  };

  const api = Object.freeze({ bind, applyIntent, replaceMany, restore, sync, syncNow, presentPrimary, clear, resetProject, dispose });
  return api;
}
