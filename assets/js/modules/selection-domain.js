import { createObjectSelectionController, normalizeObjectRef, objectRefKey } from './object-selection-controller.js';

const EMPTY_SELECTION = Object.freeze({
  primaryKey: null,
  keys: Object.freeze([]),
  items: Object.freeze([]),
});

const freezeSelection = value => Object.freeze({
  primaryKey: value?.primaryKey || null,
  keys: Object.freeze([...(value?.keys || [])]),
  items: Object.freeze([...(value?.items || [])]),
});

export function createSelectionDomain({
  context = null,
  projectDomain = null,
  selectionPacketFactory = null,
  normalizeRef = normalizeObjectRef,
  refExists = () => true,
  onSelectionChanged = () => {},
  onHoverChanged = () => {},
  requestRender = () => {},
} = {}) {
  let revision = 0;
  let hoverRevision = 0;
  let projectGeneration = Number(projectDomain?.getGeneration?.() || 0);
  let hover = null;
  let disposed = false;
  let controllerSnapshot = EMPTY_SELECTION;
  let cachedSnapshot = null;
  let changeSerial = 0;
  let activeReason = '';
  let suppressControllerChange = false;
  const metrics = { mutationCount: 0, noOpCount: 0, renderInvalidationCount: 0 };

  const active = () => {
    if (disposed) throw new Error('Selection domain is disposed.');
  };
  const readProjectGeneration = () => projectGeneration;
  const rebuildSnapshot = () => {
    cachedSnapshot = Object.freeze({
      revision,
      hoverRevision,
      projectGeneration: readProjectGeneration(),
      selection: controllerSnapshot,
      hover,
    });
    return cachedSnapshot;
  };
  const snapshot = () => cachedSnapshot || rebuildSnapshot();
  const invalidate = reason => {
    metrics.renderInvalidationCount += 1;
    (typeof requestRender === 'function' ? requestRender : context?.requestRender)?.(reason || 'selection-change');
  };
  const publishSelection = reason => {
    projectGeneration = Number(projectDomain?.getGeneration?.() ?? projectGeneration ?? 0);
    const value = rebuildSnapshot();
    onSelectionChanged(value, reason || 'selection-change');
    invalidate(reason || 'selection-change');
    return value;
  };
  const publishHover = reason => {
    projectGeneration = Number(projectDomain?.getGeneration?.() ?? projectGeneration ?? 0);
    const value = rebuildSnapshot();
    onHoverChanged(value, reason || 'selection-hover');
    invalidate(reason || 'selection-hover');
    return value;
  };

  const controller = createObjectSelectionController({
    onChange: (nextSelection, reason) => {
      controllerSnapshot = freezeSelection(nextSelection);
      changeSerial += 1;
      if (suppressControllerChange) return;
      metrics.mutationCount += 1;
      revision += 1;
      publishSelection(activeReason || reason);
    },
  });
  controllerSnapshot = freezeSelection(controller.snapshot());
  rebuildSnapshot();

  const normalizeExistingRef = value => {
    const ref = normalizeRef(value);
    return ref && refExists(ref) ? ref : null;
  };
  const mutate = (reason, callback) => {
    active();
    const before = changeSerial;
    const previousReason = activeReason;
    activeReason = String(reason || 'selection-change');
    try {
      callback();
    } finally {
      activeReason = previousReason;
    }
    if (changeSerial === before) metrics.noOpCount += 1;
    return snapshot();
  };

  const replace = (value, options = {}) => {
    const ref = normalizeExistingRef(value);
    return mutate(options.reason || 'replace', () => {
      if (ref) controller.replace(ref, { scope: options.scope || '' });
    });
  };
  const toggle = (value, options = {}) => {
    const ref = normalizeExistingRef(value);
    return mutate(options.reason || 'toggle', () => {
      if (ref) controller.toggle(ref, { scope: options.scope || '' });
    });
  };
  const selectRange = (value, orderedRefs, options = {}) => {
    const ref = normalizeExistingRef(value);
    const ordered = (orderedRefs || []).map(normalizeExistingRef).filter(Boolean);
    return mutate(options.reason || 'range', () => {
      if (ref && ordered.length) controller.selectRange(ref, ordered, {
        scope: options.scope || 'default',
        additive: options.additive === true,
      });
    });
  };
  const setMany = (values, options = {}) => {
    const refs = (values || []).map(normalizeExistingRef).filter(Boolean);
    const primary = normalizeExistingRef(options.primary);
    return mutate(options.reason || 'set-many', () => controller.setMany(refs, {
      primary,
      scope: options.scope || '',
    }));
  };
  const remove = (value, options = {}) => mutate(
    options.reason || 'remove',
    () => controller.remove(typeof value === 'string' ? value : normalizeRef(value)),
  );
  const prune = (validKeys, options = {}) => {
    const keys = validKeys == null ? null : new Set([...validKeys].map(String));
    return mutate(options.reason || 'prune', () => controller.prune(ref => (
      keys ? keys.has(ref.key) : refExists(ref)
    )));
  };
  const clear = (options = {}) => mutate(options.reason || 'clear', () => controller.clear());
  const setHover = value => {
    active();
    const ref = value == null ? null : normalizeExistingRef(value);
    if (value != null && !ref) {
      metrics.noOpCount += 1;
      return snapshot();
    }
    if ((hover?.key || '') === (ref?.key || '')) {
      metrics.noOpCount += 1;
      return snapshot();
    }
    metrics.mutationCount += 1;
    hover = ref;
    hoverRevision += 1;
    return publishHover('selection-hover');
  };
  const resetProject = generation => {
    active();
    const hadSelection = controller.size() > 0;
    const hadHover = !!hover;
    const previousGeneration = readProjectGeneration();
    projectGeneration = Number(generation || 0);
    suppressControllerChange = true;
    try {
      controller.clear();
      controllerSnapshot = freezeSelection(controller.snapshot());
    } finally {
      suppressControllerChange = false;
    }
    hover = null;
    if (!hadSelection && !hadHover && previousGeneration === projectGeneration) {
      metrics.noOpCount += 1;
      return snapshot();
    }
    metrics.mutationCount += 1;
    if (hadSelection) revision += 1;
    if (hadHover) hoverRevision += 1;
    const value = rebuildSnapshot();
    onSelectionChanged(value, 'project-reset');
    if (hadHover) onHoverChanged(value, 'project-reset');
    invalidate('project-reset-selection');
    return value;
  };
  const createPacket = channels => selectionPacketFactory?.({
    ...(channels || {}),
    revision,
    hoverRevision,
  }) || Object.freeze({ revision, hoverRevision, country: {}, generic: {} });
  const dispose = () => {
    disposed = true;
    hover = null;
    cachedSnapshot = null;
  };

  return Object.freeze({
    replace,
    toggle,
    selectRange,
    setMany,
    remove,
    prune,
    clear,
    resetProject,
    setHover,
    snapshot,
    has: value => controller.has(typeof value === 'string' ? value : objectRefKey(value)),
    primary: () => controller.primary(),
    size: () => controller.size(),
    createPacket,
    stats: () => Object.freeze({
      selectionRevision: revision,
      selectionHoverRevision: hoverRevision,
      selectionMutationCount: metrics.mutationCount,
      selectionNoOpCount: metrics.noOpCount,
      selectionRenderInvalidationCount: metrics.renderInvalidationCount,
    }),
    dispose,
  });
}
