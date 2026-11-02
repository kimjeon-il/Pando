// Viewer admission and view-state operations are explicit. New Core operations
// remain unavailable to the viewer until their effects have been reviewed.
const viewerOperations = new Set([
  'core.document-load', 'core.document-initialize',
  'core.document-baseline-coverage', 'core.document-load-baseline',
  'core.storage-baseline-load', 'core.document-validate-import', 'core.document-inspect-import',
  'core.document-replacement-capture', 'core.document-replacement-rollback', 'core.document-replacement-release',
  'core.document-state', 'core.document-resolve-world', 'core.document-timeline-cursor',
  'core.document-selection-catalog', 'core.document-presentation-catalog',
  'core.document-selection-apply', 'core.document-selection-snapshot',
  // Scoped, epoch-checked C++ source/candidate handles; adoption additionally
  // requires the existing Core replacement capsule and stays atomic.
  'core.document-temporal-source-prepare','core.document-temporal-source-stats',
  'core.document-temporal-source-release','core.document-temporal-candidate-prepare',
  'core.document-temporal-candidate-inspect','core.document-temporal-candidate-discard',
  'core.document-temporal-candidate-adopt',
]);

export function createProductModePolicy(productMode, {readOnly = productMode === 'viewer'} = {}) {
  if (productMode !== 'viewer' && productMode !== 'editor')
    throw new TypeError('Product mode must be viewer or editor.');
  if (typeof readOnly !== 'boolean' || (productMode === 'viewer' && !readOnly))
    throw new TypeError('Viewer must remain read-only; map access must be explicit.');
  const projection = productMode === 'viewer' ? 'globe' : 'flat';
  return Object.freeze({
    productMode,
    readOnly,
    projection,
    assertProjection(requested) {
      if (requested !== undefined && requested !== projection)
        throw Object.assign(new Error(`The ${productMode} supports only the ${projection} projection.`), { code: 'PL-PRODUCT-PROJECTION', productMode, projection: requested });
    },
    assertOperation(operation) {
      if (readOnly && !viewerOperations.has(operation))
        throw Object.assign(new Error(`This operation is unavailable in the read-only ${productMode === 'viewer' ? 'viewer' : 'map'}.`),
          { code: 'PL-PRODUCT-READONLY', productMode, operation });
    },
  });
}
