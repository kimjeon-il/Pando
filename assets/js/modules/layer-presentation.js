export const LAYER_PRESENTATION_SCHEMA_VERSION = 1;

export const OVERLAY_GROUPS = Object.freeze([
  'religions',
  'ethnicities',
  'languages',
  'administrative',
  'regions',
  'historicalRegions',
  'userDrawings',
]);

export const PRESENTATION_GROUPS = Object.freeze([
  'labels',
  'countryLabels',
  ...OVERLAY_GROUPS,
  'hydro',
  'countries',
  'terrain',
]);

const DEFAULT_STYLE = Object.freeze({
  opacity: 1,
  boundaryVisible: true,
  boundaryWidth: 1,
  labelsVisible: true,
  blendMode: 'normal',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeLayerStyle(value = {}) {
  return {
    opacity: clamp(Number.isFinite(Number(value.opacity)) ? Number(value.opacity) : DEFAULT_STYLE.opacity, 0, 1),
    boundaryVisible: value.boundaryVisible !== false,
    // Legacy projects may contain a manual width. The value remains readable,
    // but PandoLab now renders every boundary with the canonical policy.
    boundaryWidth: DEFAULT_STYLE.boundaryWidth,
    labelsVisible: value.labelsVisible !== false,
    blendMode: value.blendMode === 'multiply' ? 'multiply' : 'normal',
  };
}

export function normalizeLayerPresentation(value = {}) {
  // Render order is an application policy rather than a project preference.
  // Keep accepting the old field so v0.30 projects load without migration.
  const overlayOrder = [...OVERLAY_GROUPS];
  const styles = {};
  for (const group of PRESENTATION_GROUPS) styles[group] = normalizeLayerStyle(value.styles?.[group]);
  return { schemaVersion: LAYER_PRESENTATION_SCHEMA_VERSION, overlayOrder, styles };
}

export function moveOverlayGroup(presentation, group, direction) {
  void group;
  void direction;
  return normalizeLayerPresentation(presentation);
}

export const layerStyle = (presentation, group) => normalizeLayerStyle(normalizeLayerPresentation(presentation).styles[group]);
