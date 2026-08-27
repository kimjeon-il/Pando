export const LAYER_PRESENTATION_SCHEMA_VERSION = 1;

export const OVERLAY_GROUPS = Object.freeze([
  'userDrawings',
  'religions',
  'ethnicities',
  'languages',
  'administrative',
  'regions',
  'historicalRegions',
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
    boundaryWidth: clamp(Number.isFinite(Number(value.boundaryWidth)) ? Number(value.boundaryWidth) : DEFAULT_STYLE.boundaryWidth, 0.5, 4),
    labelsVisible: value.labelsVisible !== false,
    blendMode: value.blendMode === 'multiply' ? 'multiply' : 'normal',
  };
}

export function normalizeLayerPresentation(value = {}) {
  const supplied = Array.isArray(value.overlayOrder) ? value.overlayOrder.map(String) : [];
  const overlayOrder = [];
  for (const group of supplied) if (OVERLAY_GROUPS.includes(group) && !overlayOrder.includes(group)) overlayOrder.push(group);
  for (const group of OVERLAY_GROUPS) if (!overlayOrder.includes(group)) overlayOrder.push(group);
  const styles = {};
  for (const group of PRESENTATION_GROUPS) styles[group] = normalizeLayerStyle(value.styles?.[group]);
  return { schemaVersion: LAYER_PRESENTATION_SCHEMA_VERSION, overlayOrder, styles };
}

export function moveOverlayGroup(presentation, group, direction) {
  const normalized = normalizeLayerPresentation(presentation);
  const index = normalized.overlayOrder.indexOf(String(group));
  const delta = direction === 'up' ? -1 : direction === 'down' ? 1 : Number(direction);
  const target = index + (Number.isFinite(delta) ? delta : 0);
  if (index < 0 || target < 0 || target >= normalized.overlayOrder.length || target === index) return normalized;
  const next = normalized.overlayOrder.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return { ...normalized, overlayOrder: next };
}

export const layerStyle = (presentation, group) => normalizeLayerStyle(normalizeLayerPresentation(presentation).styles[group]);
