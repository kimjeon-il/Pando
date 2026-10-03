export const REFERENCE_IMAGE_MODEL_VERSION = 5;

const DEFAULT_OPACITY = 0.55;
const DEFAULT_BLEND_MODE = 'source-over';
const DEFAULT_WARP_MODE = 'auto';
const BLEND_MODES = new Set(['source-over', 'multiply', 'screen', 'difference']);
const WARP_MODES = new Set(['auto', 'similarity', 'affine', 'projective', 'tps']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finitePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export function normalizeReferenceImageMapCoordinate(value) {
  const pair = finitePair(value);
  if (!pair) return null;
  return [
    Math.max(-180, Math.min(180, pair[0])),
    Math.max(-90, Math.min(90, pair[1])),
  ];
}

export function normalizeReferenceImageMapQuad(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const quad = value.map(normalizeReferenceImageMapCoordinate);
  return quad.every(Boolean) ? quad.map(point => [...point]) : null;
}

export function normalizeReferenceImageAnchor(value) {
  if (!value || typeof value !== 'object') return null;
  const image = finitePair(value.image);
  const coordinate = normalizeReferenceImageMapCoordinate(value.coordinate);
  if (!image || !coordinate || image.some(component => component < 0 || component > 1)) return null;
  return {
    image: [...image],
    coordinate: [...coordinate],
  };
}

function normalizeControlPoints(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const ids = new Set();
  for (const value of values) {
    const image = finitePair(value?.image);
    const coordinate = normalizeReferenceImageMapCoordinate(value?.coordinate);
    const id = String(value?.id || '').trim();
    if (!id || ids.has(id) || !image || !coordinate) continue;
    if (image.some(component => component < 0 || component > 1)) continue;
    ids.add(id);
    result.push({ id, image, coordinate });
  }
  return result;
}

export function normalizeReferenceImageRecord(record = {}) {
  const opacity = Number(record?.opacity ?? DEFAULT_OPACITY);
  const order = Number(record?.order);
  const controlPoints = normalizeControlPoints(record?.controlPoints);
  const anchor = normalizeReferenceImageAnchor(record?.anchor);
  const mapQuad = normalizeReferenceImageMapQuad(record?.mapQuad);
  return {
    modelVersion: REFERENCE_IMAGE_MODEL_VERSION,
    id: String(record?.id || ''),
    name: String(record?.name || '참조 이미지'),
    opacity: clamp(Number.isFinite(opacity) ? opacity : DEFAULT_OPACITY, 0, 1),
    blendMode: BLEND_MODES.has(record?.blendMode) ? record.blendMode : DEFAULT_BLEND_MODE,
    warpMode: WARP_MODES.has(record?.warpMode) ? record.warpMode : DEFAULT_WARP_MODE,
    visible: record?.visible !== false,
    locked: record?.locked === true,
    flipX: record?.flipX === true,
    flipY: record?.flipY === true,
    controlPoints,
    anchor,
    cornerPinEnabled: record?.cornerPinEnabled === true && !!mapQuad,
    mapQuad,
    order: Number.isFinite(order) ? order : 0,
    blob: typeof Blob !== 'undefined' && record?.blob instanceof Blob ? record.blob : null,
  };
}

function inferredReferenceImageModelVersion(record) {
  const explicit = Number(record?.modelVersion);
  if (Number.isInteger(explicit) && explicit >= 1) return explicit;
  if (record?.screenRect) return 1;
  if (record?.cornerPinEnabled !== undefined) return 5;
  if (record?.anchor && Array.isArray(record?.controlPoints) && record.controlPoints.length) return 4;
  if (record?.anchor) return 3;
  if (record?.mapQuad) return 2;
  return 1;
}

export function migrateReferenceImageStoredRecord(record = {}, {
  legacyMapQuad = null,
} = {}) {
  const sourceVersion = inferredReferenceImageModelVersion(record);
  const normalizedLegacyQuad = normalizeReferenceImageMapQuad(legacyMapQuad);
  const normalizedExistingQuad = normalizeReferenceImageMapQuad(record?.mapQuad);
  const migratedMapQuad = normalizedExistingQuad || normalizedLegacyQuad;
  const normalized = normalizeReferenceImageRecord({
    ...record,
    mapQuad: migratedMapQuad,
  });

  const needsPlacementMigration = !normalized.mapQuad && !!record?.screenRect;
  const migrated = sourceVersion !== REFERENCE_IMAGE_MODEL_VERSION
    || !!record?.screenRect
    || 'rotation' in (record || {})
    || !('cornerPinEnabled' in (record || {}))
    || Number(record?.modelVersion) !== REFERENCE_IMAGE_MODEL_VERSION;

  return Object.freeze({
    record: normalized,
    sourceVersion,
    targetVersion: REFERENCE_IMAGE_MODEL_VERSION,
    migrated,
    needsPlacementMigration,
  });
}

export function serializeReferenceImageRecord(record, order = 0) {
  const normalized = normalizeReferenceImageRecord({ ...record, order });
  return {
    modelVersion: REFERENCE_IMAGE_MODEL_VERSION,
    id: normalized.id,
    name: normalized.name,
    opacity: normalized.opacity,
    blendMode: normalized.blendMode,
    warpMode: normalized.warpMode,
    visible: normalized.visible,
    locked: normalized.locked,
    flipX: normalized.flipX,
    flipY: normalized.flipY,
    controlPoints: normalized.controlPoints.map(point => ({
      id: point.id,
      image: [...point.image],
      coordinate: [...point.coordinate],
    })),
    anchor: normalized.anchor ? {
      image: [...normalized.anchor.image],
      coordinate: [...normalized.anchor.coordinate],
    } : null,
    cornerPinEnabled: normalized.cornerPinEnabled,
    mapQuad: normalized.mapQuad ? normalized.mapQuad.map(point => [...point]) : null,
    order: Number.isFinite(Number(order)) ? Number(order) : normalized.order,
    blob: normalized.blob,
  };
}

export function cloneReferenceImageRecord(record) {
  return {
    ...record,
    controlPoints: Array.isArray(record?.controlPoints)
      ? record.controlPoints.map(point => ({
        ...point,
        image: [...point.image],
        coordinate: [...point.coordinate],
      }))
      : [],
    anchor: normalizeReferenceImageAnchor(record?.anchor),
    mapQuad: normalizeReferenceImageMapQuad(record?.mapQuad),
    projectedMesh: null,
  };
}
