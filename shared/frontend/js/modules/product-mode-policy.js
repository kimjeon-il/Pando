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
]);

export function createProductModePolicy(productMode) {
  if (productMode !== 'viewer' && productMode !== 'editor')
    throw new TypeError('Product mode must be viewer or editor.');
  const projection = productMode === 'viewer' ? 'globe' : 'flat';
  return Object.freeze({
    productMode,
    projection,
    assertProjection(requested) {
      if (requested !== undefined && requested !== projection)
        throw Object.assign(new Error(`The ${productMode} supports only the ${projection} projection.`), { code: 'PL-PRODUCT-PROJECTION', productMode, projection: requested });
    },
    assertOperation(operation) {
      if (productMode === 'viewer' && !viewerOperations.has(operation))
        throw Object.assign(new Error('This operation is unavailable in the read-only viewer.'),
          { code: 'PL-PRODUCT-READONLY', productMode, operation });
    },
  });
}
