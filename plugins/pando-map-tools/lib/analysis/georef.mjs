import { calculateReferenceImage, calculateReferenceMesh, createReferenceWarp, createCalculatedReferenceWarp, referenceWarpDescriptor, freezeReferenceResult } from './core.mjs';

export const REFERENCE_IMAGE_GEOREF_SCHEMA_VERSION = 2;

export const REFERENCE_IMAGE_WARP_MODES = Object.freeze({
  AUTO: 'auto',
  SIMILARITY: 'similarity',
  AFFINE: 'affine',
  PROJECTIVE: 'projective',
  TPS: 'tps',
});

export function normalizeReferenceControlPoints(values = []) {
  return freezeReferenceResult(calculateReferenceImage('normalize', values));
}

export function buildReferenceImageWarp(values = [], { mode = REFERENCE_IMAGE_WARP_MODES.AUTO } = {}) {
  return createCalculatedReferenceWarp('warp', { points: values, mode });
}

export function buildReferenceImageAutoGeoref(values = [], options = {}) {
  const result = calculateReferenceImage('autoGeoref', { ...options, points: values });
  if (!result.ok) return Object.freeze(result);
  const warp = createReferenceWarp(result.warp);
  return Object.freeze({ ...result, warp, project: warp.project });
}

export function buildReferenceImageLinearConstraintPoints(linearConstraints = [], {
  baseWarp = null, samplesPerConstraint = 4, maximumSamples = 24,
} = {}) {
  return freezeReferenceResult(calculateReferenceImage('linearPoints', {
    constraints: linearConstraints, baseWarp: referenceWarpDescriptor(baseWarp),
    samplesPerConstraint, maximumSamples,
  }));
}

export function buildReferenceImageLinearRefinement({
  controlPoints = [],
  anchor = null,
  linearConstraints = [],
  baseMode = REFERENCE_IMAGE_WARP_MODES.AUTO,
  samplesPerConstraint = 4,
  maximumSamples = 24,
} = {}) {
  const basePoints = Array.isArray(controlPoints) ? controlPoints : [];
  const baseWarp = buildReferenceImageWarp([
    ...(anchor ? [{
      id: 'anchor',
      image: anchor.image,
      coordinate: anchor.coordinate,
      pinned: true,
    }] : []),
    ...basePoints.map(point => ({ ...point, pinned: false })),
  ], { mode: baseMode });
  if (!baseWarp.ok) {
    return Object.freeze({
      ok: false,
      reason: 'linear-refinement-base-warp-unavailable',
      baseWarp,
      linePointCount: 0,
    });
  }
  const linePoints = buildReferenceImageLinearConstraintPoints(linearConstraints, {
    baseWarp,
    samplesPerConstraint,
    maximumSamples,
  });
  if (!linePoints.length) {
    return Object.freeze({
      ok: false,
      reason: 'no-linear-constraints',
      baseWarp,
      linePointCount: 0,
    });
  }
  const points = [
    ...(anchor ? [{
      id: 'anchor',
      image: anchor.image,
      coordinate: anchor.coordinate,
      pinned: true,
    }] : []),
    ...basePoints.map(point => ({ ...point, pinned: false })),
    ...linePoints,
  ];
  const refinedWarp = buildReferenceImageWarp(points, { mode: REFERENCE_IMAGE_WARP_MODES.TPS });
  if (!refinedWarp.ok) {
    return Object.freeze({
      ok: false,
      reason: refinedWarp.reason || 'linear-refinement-failed',
      baseWarp,
      linePointCount: linePoints.length,
    });
  }
  return Object.freeze({
    ok: true,
    mode: REFERENCE_IMAGE_WARP_MODES.TPS,
    baseWarp,
    warp: refinedWarp,
    project: refinedWarp.project,
    controlPoints: refinedWarp.controlPoints,
    linePoints,
    linePointCount: linePoints.length,
    diagnostics: Object.freeze({
      ...refinedWarp.diagnostics,
      linearConstraintCount: new Set(linePoints.map(point => point.linearConstraintId)).size,
      linearConstraintPointCount: linePoints.length,
      baseRmsMeters: baseWarp.diagnostics?.rmsMeters ?? null,
    }),
  });
}

export function referenceImageWarpQuad(warp) {
  if (!warp?.ok || typeof warp.project !== 'function') return null;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]]
    .map(image => warp.project(image));
  return corners.every(coordinate => coordinate?.every(Number.isFinite))
    ? corners.map(coordinate => [...coordinate])
    : null;
}

export function buildReferenceImageCalibrationWarp(record = {}) {
  return createCalculatedReferenceWarp('calibrationWarp', record);
}

export function buildReferenceImageProjectiveWarpFromQuad(mapQuad) {
  return createCalculatedReferenceWarp('projective', mapQuad);
}

export function buildReferenceImageMesh(warp, { columns = 24, rows = 16 } = {}) {
  if (!warp?.ok || typeof warp.project !== 'function') return null;
  return calculateReferenceMesh(warp, columns, rows);
}
