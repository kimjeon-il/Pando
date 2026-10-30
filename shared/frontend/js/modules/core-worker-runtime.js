import { createDocumentSessionRuntime } from './core-document-runtime.js';
import { createProductModePolicy } from './product-mode-policy.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const documentMethods = Object.freeze({
  'core.document-load': 'load','core.document-initialize': 'initialize', 'core.document-execute': 'execute', 'core.document-prepare': 'prepare',
  'core.document-baseline-coverage':'baselineCoverage',
  'core.document-load-baseline': 'loadBaseline',
  'core.document-confirm': 'confirm', 'core.document-cancel': 'cancel', 'core.document-undo': 'undo',
  'core.document-redo': 'redo', 'core.storage-snapshot': 'storageSnapshot', 'core.document-state': 'state',
  'core.document-resolve-world': 'resolveWorld', 'core.document-timeline-cursor': 'setTimelineCursor',
  'core.document-mark-saved': 'markSaved',
  'core.document-selection-catalog': 'selectionCatalogLoad', 'core.document-selection-apply': 'selectionApply',
  'core.document-selection-snapshot': 'selectionSnapshot',
  'core.document-export': 'exportSnapshot',
  'core.storage-baseline-load': 'storageBaselineLoad','core.document-validate-import': 'validateImport',
  'core.document-inspect-import': 'inspectImport',
  'core.document-draft-apply': 'draftApply', 'core.document-draft-snapshot': 'draftSnapshot',
  'core.document-label-gesture': 'labelGestureApply',
  'core.document-presentation-catalog': 'presentationCatalogLoad','core.document-candidate-projection': 'candidateProjection',
  'core.document-replacement-capture': 'captureReplacement','core.document-replacement-rollback': 'rollbackReplacement',
  'core.document-replacement-release': 'releaseReplacement',
});

/** The single persistent C++ Project owns document, queries, selection and draft. */
export function createCoreWorkerRuntime({ loadModule, validateFlagDataUrl, productMode = 'editor' }) {
  const policy = createProductModePolicy(productMode);
  let modulePromise = null;
  const loadOnce = () => {
    if (!modulePromise) modulePromise = Promise.resolve().then(loadModule).catch(error => {
      // A failed download is not a reusable module. Keep successful engines.
      modulePromise = null;
      throw error;
    });
    return modulePromise;
  };
  const document = createDocumentSessionRuntime({ loadModule: loadOnce, validateFlagDataUrl });
  let loaded=false;
  let queue = Promise.resolve();
  function dispatch(operation, payload, context) {
    const result = queue.then(async () => {
      policy.assertOperation(operation);
      context.throwIfCancelled();
      const method = documentMethods[operation];
      if (!method) fail('PL-CORE-OPERATION', `Unknown core operation: ${operation}`);
      const admission=['core.document-load','core.document-initialize'].includes(operation);
      if (!loaded && !admission) fail('PL-CORE-NOT-LOADED','The complete C++ document is not active.');
      const outcome=await document[method](payload,context);
      if (admission) loaded=true;
      return outcome;
    });
    queue = result.catch(() => {});
    return result;
  }
  async function dispose() { await queue;loaded=false;await document.dispose(); }
  return Object.freeze({ productMode: policy.productMode, dispatch, dispose, operations: Object.freeze(Object.keys(documentMethods)) });
}
