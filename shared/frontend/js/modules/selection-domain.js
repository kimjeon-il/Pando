import { normalizeObjectRef, objectRefKey } from './object-selection-controller.js';
import { createSelectionPacket } from './selection-packet.js';

const empty = Object.freeze({ primaryKey: null, keys: Object.freeze([]), items: Object.freeze([]) });
const invalid = message => { throw Object.assign(new Error(message), { code: 'PL-CORE-RESPONSE' }); };

/** Immutable selection projection. Admission, anchors and hover sources are C++ owned. */
export function createSelectionDomain({
  commandOwner, refAdapter, projectDomain = null,
  selectionPacketFactory = createSelectionPacket, normalizeRef = normalizeObjectRef,
  onSelectionChanged = () => {}, onHoverChanged = () => {}, requestRender = () => {},
} = {}) {
  for (const method of ['state', 'selectionApply', 'selectionSnapshot', 'subscribeTransitions']) {
    if (typeof commandOwner?.[method] !== 'function') throw new TypeError('The Core selection owner is required: ' + method);
  }
  if (typeof refAdapter?.toCore !== 'function' || typeof refAdapter?.fromCore !== 'function') {
    throw new TypeError('An explicit Core selection reference adapter is required.');
  }
  let current = Object.freeze({ revision: 0, hoverRevision: 0,
    projectGeneration: Number(projectDomain?.getGeneration?.() || 0), selection: empty, hover: null });
  let disposed = false, lastNative = null, lastChanged = false;
  const contexts = new WeakMap();
  const metrics = { mutationCount: 0, noOpCount: 0, renderInvalidationCount: 0 };
  const generation = () => Number(projectDomain?.getGeneration?.() ?? current.projectGeneration);
  const active = () => { if (disposed) throw new Error('Selection domain is disposed.'); };
  const invalidate = reason => { metrics.renderInvalidationCount += 1; requestRender(reason); };
  const webRef = value => {
    const converted = normalizeRef(refAdapter.fromCore(value));
    if (!converted) invalid('A valid public selection reference is required.');
    return converted;
  };
  function acceptCoreSnapshot(native, { reason = 'selection-change', projectGeneration = generation(), reset = false } = {}) {
    if (disposed) return current;
    if (native === lastNative && projectGeneration === current.projectGeneration) return current;
    if (!Number.isSafeInteger(native?.selectionRevision) || native.selectionRevision < 0
      || !Number.isSafeInteger(native.hoverRevision) || native.hoverRevision < 0
      || !Array.isArray(native.items) || !Object.hasOwn(native, 'primary') || !Object.hasOwn(native, 'hover')) {
      invalid('A complete C++ selection snapshot is required.');
    }
    const items = Object.freeze(native.items.map(webRef));
    const keys = Object.freeze(items.map(ref => ref.key));
    const preferred = native.primary === null ? null : webRef(native.primary);
    const hover = native.hover === null ? null : webRef(native.hover);
    if (new Set(keys).size !== keys.length || (preferred && !keys.includes(preferred.key))
      || (items.length && !preferred) || (!items.length && preferred)) invalid('Invalid authoritative C++ selection order/primary.');
    const selectionChanged = native.selectionRevision !== current.revision;
    const hoverChanged = native.hoverRevision !== current.hoverRevision;
    const generationChanged = projectGeneration !== current.projectGeneration;
    if (!selectionChanged && (preferred?.key !== (current.selection.primaryKey || undefined)
      || keys.length !== current.selection.keys.length || keys.some((key, index) => key !== current.selection.keys[index]))) {
      invalid('C++ selection changed without its canonical revision.');
    }
    if (!hoverChanged && (hover?.key || null) !== (current.hover?.key || null)) invalid('C++ hover changed without its canonical revision.');
    lastNative = native; lastChanged = selectionChanged || hoverChanged || generationChanged;
    if (!lastChanged) return current;
    const previous = current.selection;
    current = Object.freeze({ revision: native.selectionRevision, hoverRevision: native.hoverRevision, projectGeneration,
      selection: selectionChanged ? Object.freeze({ primaryKey: preferred?.key || null, keys, items }) : current.selection, hover });
    if (reset || reason === 'project-reset' || generationChanged) {
      metrics.mutationCount += 1;
      onSelectionChanged(current, reason, previous);
      if (hoverChanged) onHoverChanged(current, reason);
      invalidate('project-reset-selection');
    } else {
      if (selectionChanged) { metrics.mutationCount += 1; onSelectionChanged(current, reason, previous); invalidate(reason); }
      if (hoverChanged) { metrics.mutationCount += 1; onHoverChanged(current, 'selection-hover'); invalidate('selection-hover'); }
    }
    return current;
  }
  const unsubscribe = commandOwner.subscribeTransitions((result, operation, payload) => {
    if (disposed || operation === 'core.document-selection-snapshot') return;
    if (operation === 'core.document-selection-apply' && typeof result?.countNoOp !== 'boolean') {
      invalid('A complete C++ selection acknowledgement is required.');
    }
    const native = result?.selection || (Object.hasOwn(result || {}, 'selectionRevision') ? result : null);
    if (!native) return;
    const context = payload && contexts.get(payload);
    acceptCoreSnapshot(native, context || { reason: operation === 'core.document-undo' || operation === 'core.document-redo'
      ? 'history-selection' : 'selection-change' });
    if (context) { context.observed = true; context.changed = lastChanged; }
  });
  if (typeof unsubscribe !== 'function') throw new TypeError('The Core selection subscription disposer is required.');
  const toCore = value => {
    const ref = normalizeRef(value);
    return ref ? refAdapter.toCore(ref) : null;
  };
  function publicKeyRef(key) {
    const known = current.selection.items.find(ref => ref.key === key) || (current.hover?.key === key ? current.hover : null);
    if (known) return known;
    const first = key.indexOf(':'), last = key.lastIndexOf(':');
    if (first < 0 || last <= first) return null;
    let id;
    try { id = decodeURIComponent(key.slice(last + 1)); } catch { return null; }
    const ref = normalizeRef({ domain: key.slice(0, first), type: key.slice(first + 1, last), id });
    return ref?.key === key ? ref : null;
  }
  const nativeKey = value => {
    const ref = refAdapter.toCore(value);
    return ref.domain + ':' + ref.type + ':' + encodeURIComponent(ref.id);
  };
  const convertKey = key => {
    const ref = publicKeyRef(String(key));
    return ref ? nativeKey(ref) : 'web-unmatched-key:' + String(key);
  };
  function perform(payload, reason, projectGeneration = generation(), isCurrent = () => true) {
    active();
    const epoch = commandOwner.state()?.epoch;
    if (!Number.isSafeInteger(epoch)) throw Object.assign(new Error('The Core document must be loaded before selecting objects.'), { code: 'PL-CORE-NOT-LOADED' });
    const request = { ...payload };
    const context = { reason, projectGeneration, reset: payload.action === 'resetProject', observed: false, changed: false };
    contexts.set(request, context);
    // Preserve intent order in the Core queue. Its epoch is resolved when the
    // request reaches Core, after any earlier document commands complete.
    return commandOwner.selectionApply(request, { isCurrent: () => !disposed && generation() === projectGeneration && isCurrent() }).then(ack => {
      if (disposed) return current;
      if (typeof ack?.countNoOp !== 'boolean' || !ack.selection) invalid('A complete C++ selection acknowledgement is required.');
      const native = ack.selection;
      if (!context.observed) { acceptCoreSnapshot(native, context); context.changed = lastChanged; }
      if (!context.changed && ack.countNoOp) metrics.noOpCount += 1;
      return current;
    });
  }
  const replace = async (value, options = {}) => perform({ action: 'replace', ref: toCore(value), scope: options.scope || '' }, options.reason || 'replace');
  const toggle = async (value, options = {}) => perform({ action: 'toggle', ref: toCore(value), scope: options.scope || '' }, options.reason || 'toggle');
  const selectRange = async (value, orderedRefs, options = {}) => perform({ action: 'selectRange', ref: toCore(value),
    orderedRefs: (orderedRefs || []).map(toCore).filter(Boolean), scope: options.scope || 'default', additive: options.additive === true }, options.reason || 'range');
  const setMany = async (values, options = {}) => perform({ action: 'setMany', refs: (values || []).map(toCore).filter(Boolean),
    primary: toCore(options.primary), scope: options.scope || '' }, options.reason || 'set-many');
  const remove = async (value, options = {}) => perform(typeof value === 'string'
    ? { action: 'remove', key: convertKey(value) } : { action: 'remove', ref: toCore(value) }, options.reason || 'remove');
  const prune = async (validKeys, options = {}) => perform({ action: 'prune',
    validKeys: validKeys == null ? null : [...validKeys].map(convertKey) }, options.reason || 'prune');
  const clear = async (options = {}) => perform({ action: 'clear' }, options.reason || 'clear');
  const setHover = async (value, { source = '', expectedKey = '', isCurrent = () => true } = {}) => perform({ action: 'setHover',
    ref: value == null ? null : (toCore(value) || {}), source, expectedKey: expectedKey ? convertKey(expectedKey) : '' }, 'selection-hover', generation(), isCurrent);
  const resetProject = async projectGeneration => perform({ action: 'resetProject' }, 'project-reset', Number(projectGeneration || 0));
  const refresh = async (options = {}) => {
    active();
    const native = await commandOwner.selectionSnapshot();
    return acceptCoreSnapshot(native, options);
  };
  function dispose() { if (disposed) return; disposed = true; unsubscribe(); }
  return Object.freeze({ replace, toggle, selectRange, setMany, remove, prune, clear, setHover, resetProject, refresh, acceptCoreSnapshot,
    snapshot: () => current, primary: () => current.selection.items.find(ref => ref.key === current.selection.primaryKey) || null,
    has: value => current.selection.keys.includes(typeof value === 'string' ? value : objectRefKey(value)),
    size: () => current.selection.items.length,
    createPacket: channels => selectionPacketFactory({ ...(channels || {}), revision: current.revision, hoverRevision: current.hoverRevision }),
    stats: () => Object.freeze({ selectionRevision: current.revision, selectionHoverRevision: current.hoverRevision,
      selectionMutationCount: metrics.mutationCount, selectionNoOpCount: metrics.noOpCount,
      selectionRenderInvalidationCount: metrics.renderInvalidationCount }), dispose });
}
