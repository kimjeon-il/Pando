export const PROJECT_STATE_FIELDS = Object.freeze([
  Object.freeze({ name: 'countryOverrides', history: true, fallback: () => ({}) }),
  Object.freeze({ name: 'sourceInfo', history: true, fallback: () => null }),
  Object.freeze({ name: 'labels', history: true, fallback: () => [] }),
  Object.freeze({ name: 'labelSettings', history: true, fallback: () => ({}) }),
  Object.freeze({ name: 'drawings', history: true, fallback: () => [] }),
  Object.freeze({ name: 'hydroEdits', history: true, fallback: () => [] }),
  Object.freeze({ name: 'territorialUnits', history: true, fallback: () => [] }),
  Object.freeze({ name: 'territorialRelations', history: true, fallback: () => [] }),
  Object.freeze({ name: 'distributionLayers', history: true, fallback: () => [] }),
  Object.freeze({ name: 'distributionEntries', history: true, fallback: () => [] }),
  Object.freeze({ name: 'distributionSettings', history: true, fallback: current => current || { renderMode: 'dominant', selectedLayerId: '' } }),
  Object.freeze({ name: 'layerPresentation', history: true, fallback: () => ({}) }),
  Object.freeze({ name: 'physicalSettings', history: true, fallback: current => current || {} }),
  Object.freeze({ name: 'projection', history: false, fallback: () => 'globe' }),
  Object.freeze({ name: 'layerVisibility', history: false, fallback: current => current || {} }),
  Object.freeze({ name: 'itemVisibility', history: false, fallback: () => ({}) }),
  Object.freeze({ name: 'layerFolders', history: false, fallback: () => ({}) }),
  Object.freeze({ name: 'view', history: false, fallback: current => current || {} }),
]);

const fieldsFor = scope => scope === 'history'
  ? PROJECT_STATE_FIELDS.filter(field => field.history)
  : PROJECT_STATE_FIELDS;

export function pickProjectFields(state, { scope = 'project', clone = structuredClone } = {}) {
  return Object.fromEntries(fieldsFor(scope).map(field => [field.name, clone(state[field.name])]));
}

export function applyProjectFields(target, source, {
  scope = 'project',
  clone = structuredClone,
  normalizers = {},
} = {}) {
  for (const field of fieldsFor(scope)) {
    const current = target[field.name];
    const raw = Object.prototype.hasOwnProperty.call(source || {}, field.name) && source[field.name] !== undefined
      ? source[field.name]
      : field.fallback(current);
    const normalize = normalizers[field.name];
    target[field.name] = normalize ? normalize(raw, current, source || {}) : clone(raw);
  }
  return target;
}
