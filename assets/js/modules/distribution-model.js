export const DISTRIBUTION_SCHEMA_VERSION = 1;

export const DISTRIBUTION_TYPES = Object.freeze({
  LANGUAGE: 'language',
  ETHNICITY: 'ethnicity',
  RELIGION: 'religion',
});

export const DISTRIBUTION_MODES = Object.freeze({
  REGION: 'region',
  GEOMETRY: 'geometry',
});

export const DISTRIBUTION_RENDER_MODES = Object.freeze({
  DOMINANT: 'dominant',
  INTENSITY: 'intensity',
});

const TYPES = new Set(Object.values(DISTRIBUTION_TYPES));
const MODES = new Set(Object.values(DISTRIBUTION_MODES));
const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);
const text = value => String(value ?? '').trim();
const clone = value => structuredClone(value);
const shareValue = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 100));

function normalizedDate(value) {
  const source = text(value);
  return /^[-+]?\d{4,6}(?:-\d{2}-\d{2})?$/.test(source) ? source : null;
}

export function normalizeDistributionLayer(raw, { makeId } = {}) {
  const type = text(raw?.type || raw?.distributionType).toLowerCase();
  if (!TYPES.has(type)) return null;
  const id = text(raw?.id) || text(typeof makeId === 'function' ? makeId(type) : '');
  if (!id) return null;
  return {
    id,
    schemaVersion: DISTRIBUTION_SCHEMA_VERSION,
    type,
    name: text(raw.name) || id,
    color: text(raw.color) || '#8c68d8',
    visible: raw.visible !== false,
    locked: raw.locked === true,
    parentId: text(raw.parentId || raw.parent_id),
    groups: Array.isArray(raw.groups) ? [...new Set(raw.groups.map(text).filter(Boolean))] : [],
    validFrom: normalizedDate(raw.validFrom ?? raw.valid_from),
    validTo: normalizedDate(raw.validTo ?? raw.valid_to),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? clone(raw.metadata) : {},
  };
}

export function normalizeDistributionLayers(value, options = {}) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const layer = normalizeDistributionLayer(raw, options);
    if (!layer || seen.has(layer.id)) continue;
    seen.add(layer.id);
    output.push(layer);
  }
  const byId = new Map(output.map(layer => [layer.id, layer]));
  for (const layer of output) {
    const parent = byId.get(layer.parentId);
    if (!parent || parent.type !== layer.type || parent.id === layer.id) layer.parentId = '';
    let cursor = parent;
    const visited = new Set([layer.id]);
    while (cursor) {
      if (visited.has(cursor.id)) {
        layer.parentId = '';
        break;
      }
      visited.add(cursor.id);
      cursor = byId.get(cursor.parentId);
    }
  }
  return output;
}

export function normalizeDistributionEntry(raw, { makeId } = {}) {
  const layerId = text(raw?.layerId || raw?.layer_id);
  if (!layerId) return null;
  const mode = MODES.has(text(raw?.mode || raw?.sourceMode || raw?.source_mode))
    ? text(raw.mode || raw.sourceMode || raw.source_mode)
    : raw?.regionId || raw?.region_id
      ? DISTRIBUTION_MODES.REGION
      : DISTRIBUTION_MODES.GEOMETRY;
  const regionId = mode === DISTRIBUTION_MODES.REGION ? text(raw.regionId || raw.region_id) : '';
  const geometry = mode === DISTRIBUTION_MODES.GEOMETRY && POLYGON_TYPES.has(raw?.geometry?.type)
    ? clone(raw.geometry)
    : null;
  if ((mode === DISTRIBUTION_MODES.REGION && !regionId) || (mode === DISTRIBUTION_MODES.GEOMETRY && !geometry)) return null;
  const id = text(raw.id || raw.entryId || raw.entry_id) || text(typeof makeId === 'function' ? makeId('entry') : '');
  if (!id) return null;
  return {
    id,
    schemaVersion: DISTRIBUTION_SCHEMA_VERSION,
    layerId,
    mode,
    regionId,
    geometry,
    share: shareValue(raw.share),
    certainty: text(raw.certainty) || 'unknown',
    validFrom: normalizedDate(raw.validFrom ?? raw.valid_from),
    validTo: normalizedDate(raw.validTo ?? raw.valid_to),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? clone(raw.metadata) : {},
  };
}

export function normalizeDistributionEntries(value, { layerExists = () => true, makeId } = {}) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const entry = normalizeDistributionEntry(raw, { makeId });
    if (!entry || seen.has(entry.id) || !layerExists(entry.layerId)) continue;
    seen.add(entry.id);
    output.push(entry);
  }
  return output;
}

export function createDistributionLayer(options) {
  const layer = normalizeDistributionLayer(options);
  if (!layer) throw new Error('분포 레이어 형식이 올바르지 않습니다.');
  return layer;
}

export function createDistributionEntry(options) {
  const entry = normalizeDistributionEntry(options);
  if (!entry) throw new Error('분포 엔트리 형식이 올바르지 않습니다.');
  return entry;
}

export function distributionEntriesForLayer(entries, layerId) {
  const key = text(layerId);
  return (entries || []).filter(entry => text(entry.layerId) === key);
}

export function validateDistributionModel(layers, entries, { territorialExists = () => true } = {}) {
  const issues = [];
  const layerIds = new Set((layers || []).map(layer => text(layer.id)));
  for (const entry of entries || []) {
    if (!layerIds.has(text(entry.layerId))) issues.push(`${entry.id}의 분포 항목이 존재하지 않습니다.`);
    if (entry.mode === DISTRIBUTION_MODES.REGION && !territorialExists(entry.regionId)) issues.push(`${entry.id}의 참조 영역이 존재하지 않습니다.`);
    if (entry.share < 0 || entry.share > 100) issues.push(`${entry.id}의 비율이 0~100 범위를 벗어났습니다.`);
  }
  return { ok: issues.length === 0, issues };
}

export function dominantDistributionEntries(layers, entries) {
  const visible = new Set((layers || []).filter(layer => layer.visible !== false).map(layer => layer.id));
  const byRegion = new Map();
  const geometryEntries = [];
  for (const entry of entries || []) {
    if (!visible.has(entry.layerId)) continue;
    if (entry.mode === DISTRIBUTION_MODES.GEOMETRY) {
      geometryEntries.push(entry);
      continue;
    }
    const current = byRegion.get(entry.regionId);
    if (!current || entry.share > current.share) byRegion.set(entry.regionId, entry);
  }
  return [...byRegion.values(), ...geometryEntries];
}

export function migrateThematicDrawings(drawings, { existingLayers = [], existingEntries = [] } = {}) {
  const layers = clone(existingLayers || []);
  const entries = clone(existingEntries || []);
  const remainingDrawings = [];
  const layerKeys = new Map(layers.map(layer => [`${layer.type}\u0000${layer.name}\u0000${layer.color}`, layer.id]));
  const layerIds = new Set(layers.map(layer => layer.id));
  const entryIds = new Set(entries.map(entry => entry.id));
  for (const drawing of Array.isArray(drawings) ? drawings : []) {
    const type = text(drawing?.properties?.category).toLowerCase();
    if (!TYPES.has(type) || !POLYGON_TYPES.has(drawing?.geometry?.type)) {
      remainingDrawings.push(drawing);
      continue;
    }
    const name = text(drawing.properties?.name) || `${type} 분포`;
    const color = text(drawing.properties?.editorColor || drawing.properties?.color) || '#8c68d8';
    const key = `${type}\u0000${name}\u0000${color}`;
    let layerId = layerKeys.get(key);
    if (!layerId) {
      const baseId = `distribution-layer:${text(drawing.id) || layers.length + 1}`;
      layerId = baseId;
      let suffix = 2;
      while (layerIds.has(layerId)) layerId = `${baseId}:${suffix++}`;
      layers.push(createDistributionLayer({ id: layerId, type, name, color, metadata: { migratedFromDrawing: true } }));
      layerIds.add(layerId);
      layerKeys.set(key, layerId);
    }
    const baseEntryId = `distribution-entry:${text(drawing.id) || entries.length + 1}`;
    let entryId = baseEntryId;
    let suffix = 2;
    while (entryIds.has(entryId)) entryId = `${baseEntryId}:${suffix++}`;
    entries.push(createDistributionEntry({
      id: entryId,
      layerId,
      mode: DISTRIBUTION_MODES.GEOMETRY,
      geometry: drawing.geometry,
      share: 100,
      certainty: 'unknown',
      metadata: { sourceDrawingId: text(drawing.id), notes: text(drawing.properties?.notes) },
    }));
    entryIds.add(entryId);
  }
  return { layers, entries, remainingDrawings };
}
