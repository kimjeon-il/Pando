// Runtime renderer ordering contract. Internal functions are tested through observable
// resource and presentation results, not by parsing their source code.
export const PROJECT_RENDERER_SEQUENCE = Object.freeze([
  'base',
  'hydro',
  'hydroEdits',
  'territorialUnits',
  'distributions',
  'genericFeatures',
  'stackOverlays',
  'projectedOverlays',
  'countries',
  'selectionData',
  'selectionStyle',
  'selectionView',
  'gpuInteraction',
  'labelLayout',
  'territorialLabels',
  'userLabels',
  'viewPresentation',
  'objectSearch',
  'debug',
]);

export const REQUIRED_STROKE_SOURCE_MARKERS = Object.freeze([
  'GPU_STROKE_FLAGS',
  'aPrevious',
  'aNext',
  'ownerNodeRanges',
  'uMiterLimit',
  'uAaRadius',
  'smoothstep(-uAaRadius,uAaRadius,edge)',
  'connectedTopology: true',
  'analyticAa: true',
]);
