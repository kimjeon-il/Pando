import { normalizeReferenceImageSourceRect } from './reference-image-source.js';
export const REFERENCE_IMAGE_MODEL_VERSION = 7;

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

const LINEAR_CONSTRAINT_KINDS = new Set(['coastline', 'river', 'border', 'other']);

function normalizeImagePolyline(values) {
  if (!Array.isArray(values)) return null;
  const points = values.map(finitePair).filter(Boolean);
  if (points.length < 2 || points.some(point => point.some(component => component < 0 || component > 1))) return null;
  return points.map(point => [...point]);
}

function normalizeMapPolyline(values) {
  if (!Array.isArray(values)) return null;
  const points = values.map(normalizeReferenceImageMapCoordinate).filter(Boolean);
  return points.length >= 2 ? points.map(point => [...point]) : null;
}

export function normalizeReferenceImageLinearConstraints(values = []) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const ids = new Set();
  for (const value of values) {
    const id = String(value?.id || '').trim();
    const image = normalizeImagePolyline(value?.image);
    const coordinates = normalizeMapPolyline(value?.coordinates || value?.coordinate);
    if (!id || ids.has(id) || !image || !coordinates) continue;
    ids.add(id);
    const weight = Number(value?.weight);
    result.push({
      id,
      kind: LINEAR_CONSTRAINT_KINDS.has(value?.kind) ? value.kind : 'other',
      image,
      coordinates,
      weight: clamp(Number.isFinite(weight) ? weight : 1, 0.25, 3),
      enabled: value?.enabled !== false,
    });
  }
  return result;
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
  const linearConstraints = normalizeReferenceImageLinearConstraints(record?.linearConstraints);
  const anchor = normalizeReferenceImageAnchor(record?.anchor);
  const mapQuad = normalizeReferenceImageMapQuad(record?.mapQuad);
  const gridReference = record.gridReference;
  if (gridReference && (gridReference.primeMeridian !== 'greenwich' || gridReference.datum !== 'WGS84'
    || gridReference.reviewed !== true || !Array.isArray(gridReference.labels))) throw new TypeError('Invalid reviewed graticule reference.');
  return {
    modelVersion: REFERENCE_IMAGE_MODEL_VERSION,
    id: String(record?.id || ''),
    name: String(record?.name || '참조 이미지'),
    sourceRect: normalizeReferenceImageSourceRect(record.sourceRect),
    gridReference: gridReference ? structuredClone(gridReference) : null,
    opacity: clamp(Number.isFinite(opacity) ? opacity : DEFAULT_OPACITY, 0, 1),
    blendMode: BLEND_MODES.has(record?.blendMode) ? record.blendMode : DEFAULT_BLEND_MODE,
    warpMode: WARP_MODES.has(record?.warpMode) ? record.warpMode : DEFAULT_WARP_MODE,
    visible: record?.visible !== false,
    locked: record?.locked === true,
    flipX: record?.flipX === true,
    flipY: record?.flipY === true,
    controlPoints,
    linearConstraints,
    anchor,
    cornerPinEnabled: record?.cornerPinEnabled === true && !!mapQuad,
    mapQuad,
    order: Number.isFinite(order) ? order : 0,
    blob: typeof Blob !== 'undefined' && record?.blob instanceof Blob ? record.blob : null,
  };
}


export function referenceImageMappingSignature(record = {}) {
  const normalized = normalizeReferenceImageRecord(record);
  return JSON.stringify({
    sourceRect: normalized.sourceRect,
    gridReference: normalized.gridReference,
    warpMode: normalized.warpMode,
    flipX: normalized.flipX,
    flipY: normalized.flipY,
    controlPoints: normalized.controlPoints.map(point => ({
      id: point.id,
      image: [...point.image],
      coordinate: [...point.coordinate],
    })),
    linearConstraints: normalized.linearConstraints.map(constraint => ({
      ...constraint,
      image: constraint.image.map(point => [...point]),
      coordinates: constraint.coordinates.map(point => [...point]),
    })),
    anchor: normalized.anchor ? {
      image: [...normalized.anchor.image],
      coordinate: [...normalized.anchor.coordinate],
    } : null,
    cornerPinEnabled: normalized.cornerPinEnabled,
    mapQuad: normalized.mapQuad ? normalized.mapQuad.map(point => [...point]) : null,
  });
}

export function serializeReferenceImageRecord(record, order = 0) {
  const normalized = normalizeReferenceImageRecord({ ...record, order });
  return {
    modelVersion: REFERENCE_IMAGE_MODEL_VERSION,
    id: normalized.id,
    name: normalized.name,
    sourceRect: normalized.sourceRect,
    gridReference: normalized.gridReference,
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
    linearConstraints: normalized.linearConstraints.map(constraint => ({
      ...constraint,
      image: constraint.image.map(point => [...point]),
      coordinates: constraint.coordinates.map(point => [...point]),
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
    sourceRect: normalizeReferenceImageSourceRect(record.sourceRect),
    gridReference: record.gridReference ? structuredClone(record.gridReference) : null,
    analysis: null,
    controlPoints: Array.isArray(record?.controlPoints)
      ? record.controlPoints.map(point => ({
        ...point,
        image: [...point.image],
        coordinate: [...point.coordinate],
      }))
      : [],
    linearConstraints: normalizeReferenceImageLinearConstraints(record?.linearConstraints),
    anchor: normalizeReferenceImageAnchor(record?.anchor),
    mapQuad: normalizeReferenceImageMapQuad(record?.mapQuad),
    projectedMesh: null,
  };
}
