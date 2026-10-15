import { sharedCalculationCore as core } from './temporal.js';
const DEFAULT_MAX_DIMENSION = 1024;
const DEFAULT_SNAP_RADIUS = 8;
const DEFAULT_SEARCH_RADIUS = 256;
const DEFAULT_SIMPLIFY_TOLERANCE = 1.5;

const liveWireFieldCache = new WeakMap();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finitePoint = point => Array.isArray(point) && point.length >= 2
  && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
const clonePoint = point => [Number(point[0]), Number(point[1])];
const squaredDistance = (left, right) => {
  const dx = Number(left[0]) - Number(right[0]);
  const dy = Number(left[1]) - Number(right[1]);
  return dx * dx + dy * dy;
};

export function buildReferenceImageLiveWireField(imageData, options = {}) {
  return Object.freeze(core.referenceGradientField(imageData, options));
}

function createAnalysisCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (globalThis.document?.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Canvas is unavailable for reference image analysis.');
}

export function getReferenceImageLiveWireField(image, { maxDimension = DEFAULT_MAX_DIMENSION } = {}) {
  if (!image || typeof image !== 'object') throw new TypeError('A loaded reference image is required.');
  const sourceWidth = Math.max(1, Number(image.naturalWidth || image.width) || 0);
  const sourceHeight = Math.max(1, Number(image.naturalHeight || image.height) || 0);
  const limit = Math.max(64, Math.floor(Number(maxDimension) || DEFAULT_MAX_DIMENSION));
  const cacheKey = `${sourceWidth}x${sourceHeight}:${limit}`;
  let cache = liveWireFieldCache.get(image);
  if (!cache) {
    cache = new Map();
    liveWireFieldCache.set(image, cache);
  }
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const ratio = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(2, Math.round(sourceWidth * ratio));
  const height = Math.max(2, Math.round(sourceHeight * ratio));
  const canvas = createAnalysisCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas is unavailable for reference image analysis.');
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const field = buildReferenceImageLiveWireField(context.getImageData(0, 0, width, height), {
    sourceWidth,
    sourceHeight,
  });
  cache.set(cacheKey, field);
  return field;
}

export function clearReferenceImageLiveWireCache(image = null) {
  if (image && typeof image === 'object') return liveWireFieldCache.delete(image);
  return false;
}

export function snapLiveWireAnchor(field, point, options = {}) {
  if (!field?.gradient || !finitePoint(point)) return null;
  return core.referenceSnapAnchor(field, point, options);
}

export function buildLiveWireTree(field, anchor, options = {}) {
  if (!field?.gradient || !finitePoint(anchor)) return Object.freeze({ ok: false, reason: 'invalid-gradient-field', parents: null });
  return Object.freeze(core.referenceTraceTree(field, anchor, options));
}

export function traceLiveWirePath(tree, target, options = {}) {
  if (!tree?.ok || !finitePoint(target)) return Object.freeze({ ok: false, reason: tree?.reason || 'invalid-tree', points: [] });
  return Object.freeze(core.referenceTracePath(tree, target, options));
}

export function simplifyLiveWireSegments(segments, { tolerance = DEFAULT_SIMPLIFY_TOLERANCE } = {}) {
  const result = [];
  for (const segment of segments || []) {
    const source = (segment || []).filter(finitePoint).map(clonePoint);
    if (source.length < 2) continue;
    const simplified = core.referenceSimplifyTrace(source, Math.max(0, Number(tolerance) || 0));
    if (result.length && squaredDistance(result.at(-1), simplified[0]) <= 1e-12) result.push(...simplified.slice(1));
    else result.push(...simplified);
  }
  return result;
}

export function analysisPointFromUv(field, uv) {
  if (!field || !finitePoint(uv)) return null;
  return [
    clamp(Number(uv[0]), 0, 1) * Math.max(1, field.width - 1),
    clamp(Number(uv[1]), 0, 1) * Math.max(1, field.height - 1),
  ];
}

export function sourcePixelsFromAnalysis(field, points) {
  if (!field) return [];
  const scaleX = Number(field.scaleX) || ((field.width - 1) / Math.max(1, field.sourceWidth - 1));
  const scaleY = Number(field.scaleY) || ((field.height - 1) / Math.max(1, field.sourceHeight - 1));
  return (points || []).filter(finitePoint).map(point => [
    scaleX > 0 ? Number(point[0]) / scaleX : 0,
    scaleY > 0 ? Number(point[1]) / scaleY : 0,
  ]);
}

export function traceReferenceImageLinearAnchors(field, anchors) {
  if (!field || !Array.isArray(anchors) || anchors.length < 2) {
    return { ok: false, reason: 'insufficient-anchors', image: [] };
  }
  const segments = [];
  for (let index = 1; index < anchors.length; index += 1) {
    const start = analysisPointFromUv(field, anchors[index - 1]);
    const end = analysisPointFromUv(field, anchors[index]);
    const tree = buildLiveWireTree(field, start, { target: end });
    const path = traceLiveWirePath(tree, end);
    if (!path.ok) return { ok: false, reason: path.reason, image: [] };
    segments.push(path.points);
  }
  const pixels = sourcePixelsFromAnalysis(field, simplifyLiveWireSegments(segments));
  return {
    ok: pixels.length >= 2,
    reason: pixels.length >= 2 ? '' : 'path-not-found',
    image: pixels.map(([x, y]) => [
      clamp(x / Math.max(1, field.sourceWidth - 1), 0, 1),
      clamp(y / Math.max(1, field.sourceHeight - 1), 0, 1),
    ]),
  };
}

export const REFERENCE_IMAGE_LIVE_WIRE_DEFAULTS = Object.freeze({
  maxDimension: DEFAULT_MAX_DIMENSION,
  snapRadius: DEFAULT_SNAP_RADIUS,
  searchRadius: DEFAULT_SEARCH_RADIUS,
  simplifyTolerance: DEFAULT_SIMPLIFY_TOLERANCE,
});
