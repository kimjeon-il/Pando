import { createWorkerRpcClient } from './worker-rpc.js';
import {workerAssetUrl} from './worker-asset-url.js';
import { createProductModePolicy } from './product-mode-policy.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const stateResponses = new Set(['core.document-state', 'core.document-mark-saved']);

/** Ordered transport only. Document validation and history stay in C++ Project. */
export function createCoreDocumentClient({
  productMode = 'editor',
  createWorker = () => new Worker(workerAssetUrl(new URL(productMode === 'viewer'
    ? '../workers/core-viewer-session-worker.js' : '../workers/core-session-worker.js', import.meta.url)), { type: 'module' }),
  onTransition = () => {},
} = {}) {
  const policy = createProductModePolicy(productMode);
  let currentState = null;
  let disposed = false;
  let queue = Promise.resolve();
  const subscribers = new Set();
  const rpc = createWorkerRpcClient({ createWorker, isCurrent: () => true, restartOnCrash: false,
    onCrash: () => { currentState = null; } });
  function ordered(operation, payload, options = {}, requiresDocument = true, atomic = false, injectEpoch = requiresDocument) {
    const result = queue.then(async () => {
      policy.assertOperation(operation);
      if (disposed) throw Object.assign(new Error('The C++ document owner was disposed.'),
        { code: 'PL-CORE-CANCELLED', name: 'AbortError', cancelled: true });
      if (options.isCurrent && !options.isCurrent()) fail('PL-CORE-STALE', 'The request belongs to another project generation.');
      if (requiresDocument && !currentState) fail('PL-CORE-NOT-LOADED', 'The complete C++ document has not been loaded.');
      if (atomic && options.signal?.aborted) throw Object.assign(new Error('Document operation was cancelled before dispatch.'),
        { code: 'PL-CORE-CANCELLED', name: 'AbortError', cancelled: true });
      const request = injectEpoch ? { ...payload,
        expectedEpoch: Object.hasOwn(payload, 'expectedEpoch') ? payload.expectedEpoch : currentState?.epoch ?? 0 } : payload;
      // A synchronous C++ confirm cannot be interrupted. Once dispatched, its
      // acknowledgement must update the read model even if the caller aborts.
      const { result } = await rpc.request(operation, request, atomic
        ? { timeoutMs: 0 } : { signal: options.signal });
      if (disposed) throw Object.assign(new Error('The C++ document owner was disposed.'),
        { code: 'PL-CORE-CANCELLED', name: 'AbortError', cancelled: true });
      // A validated import is a detached candidate, never a live transition.
      // Header fields in the imported document cannot publish state or deltas.
      if(operation==='core.document-validate-import' || operation==='core.document-inspect-import')return result;
      const next = stateResponses.has(operation) ? result : result?.state;
      if (next) {
        if (!Number.isSafeInteger(next.epoch) || next.epoch < 0) fail('PL-CORE-RESPONSE', 'A current document operation epoch is required.');
        currentState = Object.freeze({ ...next,...(Array.isArray(next.dirtyTerritorialIds)
          ? { dirtyTerritorialIds: Object.freeze([...next.dirtyTerritorialIds]) }: {}) });
      }
      try {
        onTransition(result, operation, payload);
        // Accepted read projections publish synchronously in this queue. A
        // subscriber must not dispatch and await another queued Core request.
        for (const listener of subscribers) listener(result, operation, payload);
      }
      catch (error) {
        // C++ may already have committed. A failed read-model publication
        // requires an explicit document reload before another mutation.
        currentState = null;
        throw error;
      }
      return result;
    });
    queue = result.catch(() => {});
    return result;
  }
  return Object.freeze({
    productMode: policy.productMode,
    subscribeTransitions(listener) {
      if (typeof listener !== 'function') throw new TypeError('A Core acknowledgement subscriber is required.');
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    load: (storageJson, options) => ordered('core.document-load', { storageJson }, options, false, true),
    baselineCoverage:(baselineId,month,options)=>ordered('core.document-baseline-coverage',{baselineId,month},options),
    loadBaseline: (baselineId,setup,options) => ordered('core.document-load-baseline',{ baselineId,setup },options,true,true),
    initialize: (payload,options) => ordered('core.document-initialize',payload,options,false,true,true),
    captureReplacement: options => ordered('core.document-replacement-capture',{},options,true,true),
    rollbackReplacement: (replacementId,options) => ordered('core.document-replacement-rollback',{ replacementId },options,true,true),
    releaseReplacement: (replacementId,options) => ordered('core.document-replacement-release',{ replacementId },options,true,true),
    execute: (command, options) => ordered('core.document-execute', command, options, true, true),
    prepare: (command, options) => ordered('core.document-prepare', command, options),
    confirm: (candidateId,expectedEpoch,options) => ordered('core.document-confirm', { candidateId,expectedEpoch }, options, true, true),
    cancel: (candidateId, options) => ordered('core.document-cancel', { candidateId }, options),
    undo: options => ordered('core.document-undo', {}, options, true, true),
    redo: options => ordered('core.document-redo', {}, options, true, true),
    markSaved: (expectedEpoch, options) => ordered('core.document-mark-saved', { expectedEpoch }, options, true, true),
    exportSnapshot: (context, options) => ordered('core.document-export', context, options),
    storageBaselineLoad: (baseline,options) => ordered('core.storage-baseline-load',{ baseline },options,true,true),
    validateImport: (storageJson,options = {}) => ordered('core.document-validate-import',
      { storageJson,baselineId: options.baselineId ?? null },options),
    inspectImport: (storageJson,options = {}) => ordered('core.document-inspect-import',
      { storageJson,baselineId: options.baselineId ?? null },options),
    setTimelineCursor: (month, options) => ordered('core.document-timeline-cursor', { month }, options, true, true),
    resolveWorld: (month, options) => ordered('core.document-resolve-world', { month }, options),
    projectState: options => ordered('core.document-state', {}, options),
    selectionCatalogLoad: (domain,refs,expectedEpoch,options) => ordered('core.document-selection-catalog',
      { domain,refs,...(expectedEpoch===undefined ? {}:{ expectedEpoch }) },options,true,true),
    presentationCatalogLoad: (catalog,options) => ordered('core.document-presentation-catalog',{ catalog },options,true,true),
    candidateProjection: (candidateId,expectedEpoch,options) => ordered('core.document-candidate-projection',{ candidateId,expectedEpoch },options),
    selectionApply: (payload, options) => ordered('core.document-selection-apply', payload, options, true, true),
    selectionSnapshot: options => ordered('core.document-selection-snapshot', {}, options),
    draftApply: (payload, options) => ordered('core.document-draft-apply', payload, options, true, true),
    draftSnapshot: options => ordered('core.document-draft-snapshot', {}, options),
    labelGestureApply: (payload,options) => ordered('core.document-label-gesture',payload,options,true,true),
    storageSnapshot: options => ordered('core.storage-snapshot', {}, options),
    state: () => currentState,
    dispose: () => { if(disposed)return;disposed=true;currentState = null; subscribers.clear(); rpc.stop(); },
  });
}
