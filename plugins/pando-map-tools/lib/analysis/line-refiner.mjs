import { core } from '../workspace.mjs';
const DEFAULT_MAX_DIMENSION = 1024;
const DEFAULT_CORRIDOR_RADIUS = 12;
const DEFAULT_SIMPLIFY_TOLERANCE = 1.5;



const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finitePoint = value => Array.isArray(value) && value.length >= 2
  && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
const clonePoint = value => [Number(value[0]), Number(value[1])];
export function buildReferenceImageGradientField(imageData, options = {}) {
  const { gradientX, gradientY, ...field } = core.referenceGradientField(imageData, options);
  return Object.freeze(field);
}







export function refineReferenceImageLine(options = {}) {
  if (!options.field?.gradient) return Object.freeze({ ok: false, reason: 'invalid-gradient-field', points: [] });
  return Object.freeze(core.referenceRefineTrace(options));
}

export function referenceImagePixelsToCoordinates(points, { sourceWidth, sourceHeight, warp } = {}) {
  if (!warp?.ok || typeof warp.project !== 'function') throw new Error('A ready reference image warp is required.');
  const width = Math.max(2, Number(sourceWidth) || 0);
  const height = Math.max(2, Number(sourceHeight) || 0);
  const xDenominator = width - 1;
  const yDenominator = height - 1;
  return (points || []).filter(finitePoint).map(point => {
    const uv = [clamp(Number(point[0]) / xDenominator, 0, 1), clamp(Number(point[1]) / yDenominator, 0, 1)];
    const projected = warp.project(uv);
    if (!finitePoint(projected)) throw new Error('Reference image warp returned an invalid coordinate.');
    return clonePoint(projected);
  });
}

export const REFERENCE_IMAGE_LINE_REFINER_DEFAULTS = Object.freeze({
  maxDimension: DEFAULT_MAX_DIMENSION,
  corridorRadius: DEFAULT_CORRIDOR_RADIUS,
  simplifyTolerance: DEFAULT_SIMPLIFY_TOLERANCE,
});
