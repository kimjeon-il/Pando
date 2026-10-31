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
  const detachedOps = new Set([
    'core.document-temporal-source-prepare','core.document-temporal-source-stats',
    'core.document-temporal-source-release','core.document-temporal-candidate-prepare',
    'core.document-temporal-candidate-inspect','core.document-temporal-candidate-discard',
  ]);
  const speculativeOps = new Map([
    ['core.document-temporal-source-prepare',{id:'sourceId',release:'core.document-temporal-source-release'}],
    ['core.document-temporal-candidate-prepare',{id:'candidateId',release:'core.document-temporal-candidate-discard'}],
  ]);
  const cancelled = (code,message) => Object.assign(new Error(message),
    { code,name:'AbortError',cancelled:true });
  const rpc = createWorkerRpcClient({ createWorker, isCurrent: () => true, restartOnCrash: false,
    onCrash: () => { currentState = null; } });
  function ordered(operation, payload, options = {}, requiresDocument = true, atomic = false, injectEpoch = requiresDocument) {
    const result = queue.then(async () => {
      policy.assertOperation(operation);
      if (disposed) throw Object.assign(new Error('The C++ document owner was disposed.'),
        { code: 'PL-CORE-CANCELLED', name: 'AbortError', cancelled: true });
      if (options.isCurrent && !options.isCurrent()) fail('PL-CORE-STALE', 'The request belongs to another project generation.');
      if (requiresDocument && !currentState) fail('PL-CORE-NOT-LOADED', 'The complete C++ document has not been loaded.');
      const speculative=speculativeOps.get(operation);
      if ((atomic || speculative) && options.signal?.aborted)
        throw cancelled('PL-CORE-CANCELLED','Document operation was cancelled before dispatch.');
      const request = injectEpoch ? { ...payload,
        expectedEpoch: Object.hasOwn(payload, 'expectedEpoch') ? payload.expectedEpoch : currentState?.epoch ?? 0 } : payload;
      // A synchronous C++ confirm cannot be interrupted. Once dispatched, its
      // acknowledgement must update the read model even if the caller aborts.
      // A native commit cannot be interrupted. Likewise, speculative work
      // must receive its acknowledgement so that cancelled handles can be
      // explicitly released rather than leaking after a lost Worker result.
      const { result } = await rpc.request(operation, request, atomic || speculative
        ? { timeoutMs: 0 } : { signal: options.signal });
      if (disposed) throw Object.assign(new Error('The C++ document owner was disposed.'),
        { code: 'PL-CORE-CANCELLED', name: 'AbortError', cancelled: true });
      if (speculative && (options.signal?.aborted || options.isCurrent?.() === false)) {
        // Must not queue this release through ordered(): we already hold that
        // transport queue. Release in the same Worker session, after the
        // original native operation has returned, before reporting stale work.
        const sourceId=result?.[speculative.id];
        if (Number.isSafeInteger(sourceId) && sourceId>0) {
          await rpc.request(speculative.release,
            { [speculative.id]:sourceId,expectedEpoch:request.expectedEpoch },
            { timeoutMs:0 });
        }
        throw cancelled(options.signal?.aborted?'PL-CORE-CANCELLED':'PL-CORE-STALE',
          'Detached temporal source/candidate was superseded and released.');
      }
      // Detached C++ handles and inspection never publish a document
      // transition. The accepted adopt response alone publishes Core state.
      if (detachedOps.has(operation)
        || operation==='core.document-validate-import' || operation==='core.document-inspect-import')
        return result;
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
    temporalSourcePrepare:(source,{dataRevision,manifestSha256,...options}={})=>
      ordered('core.document-temporal-source-prepare',{source,dataRevision,manifestSha256},options),
    temporalSourceStats:options=>ordered('core.document-temporal-source-stats',{},options),
    temporalSourceRelease:(sourceId,options)=>ordered('core.document-temporal-source-release',{sourceId},options,true,true),
    temporalCandidatePrepare:({sourceId,targetMonth,sourceFingerprint,setup=null,documentId=''},options)=>
      ordered('core.document-temporal-candidate-prepare',
        {sourceId,targetMonth,sourceFingerprint,setup,documentId},options),
    temporalCandidateInspect:(candidateId,options)=>ordered('core.document-temporal-candidate-inspect',{candidateId},options),
    temporalCandidateDiscard:(candidateId,options)=>ordered('core.document-temporal-candidate-discard',{candidateId},options,true,true),
    temporalCandidateAdopt:({candidateId,sourceId,targetMonth,sourceFingerprint,worldSha256,replacementId},options)=>
      ordered('core.document-temporal-candidate-adopt',
        {candidateId,sourceId,targetMonth,sourceFingerprint,worldSha256,replacementId},options,true,true),
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
