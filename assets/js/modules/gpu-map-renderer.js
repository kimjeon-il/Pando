import { createRenderDevice } from './render-device.js';
import { createSceneColorCache } from './scene-color-cache.js';
import { createGpuPolygonOverlayPass } from './gpu-polygon-overlay-pass.js';
import { createGpuStrokeRenderer } from './gpu-stroke-renderer.js';
import { resetGpuNormalBlend } from './gpu-blend-utils.js';
import { linkGpuProgram } from './gpu-shader-utils.js';
import { GPU_VIEW_UNIFORM_NAMES, setGpuViewUniforms } from './gpu-view-uniforms.js';
import { createHydroTileWindow, hydroTileSpecsForWindow } from './hydro-tile-window.js';
import { isRenderScene } from './render-scene.js';
import { isMapVisualFrame } from './map-visual-frame.js';
import {
  createLatestWorkerJobScheduler,
  createWorkerCancellationError,
} from './worker-job-scheduler.js';

const DEFAULT_RENDER_QUALITY = Object.freeze({
  tier: 'high',
  phase: 'settle',
  revision: 0,
  countryMeshQuality: 'canonical',
  dprCap: 3,
  terrainResolutionScale: 1,
  terrainCacheBudgetBytes: 128 * 1024 * 1024,
  hydroCacheBudgetBytes: 96 * 1024 * 1024,
  overlayGpuBudgetBytes: 192 * 1024 * 1024,
  uploadBudgetBytes: 8 * 1024 * 1024,
});

const COUNTRY_BOUNDS_FLAG_DATELINE = 1;
const COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE = 2;
const COUNTRY_BOUNDS_SCALE = 1e-6;
const COUNTRY_CULLING_PADDING_PIXELS = 64;
const COUNTRY_CULLING_FULL_RANGE_THRESHOLD = 0.7;
const COUNTRY_CULLING_MAX_RANGES = 96;

function fullCountryDrawRange(indexCount) {
  const count = Math.max(0, Number(indexCount || 0));
  return count ? [{ first: 0, count }] : [];
}

export function mergeCountryDrawRanges(ranges = []) {
  const normalized = ranges
    .map(range => ({
      first: Math.max(0, Number(range?.first || 0)),
      count: Math.max(0, Number(range?.count || 0)),
    }))
    .filter(range => range.count > 0)
    .sort((left, right) => left.first - right.first);
  const merged = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && range.first <= previous.first + previous.count) {
      previous.count = Math.max(previous.first + previous.count, range.first + range.count) - previous.first;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function createCountryTriangleRangeMap(sourceMesh, countryIds = []) {
  const ranges = new Map();
  const metadataRanges = sourceMesh?.countryTriangleRanges;
  const metadataIds = sourceMesh?.metadataCountryIds;
  if (metadataRanges?.length === metadataIds?.length * 2) {
    for (let countryIndex = 0; countryIndex < metadataIds.length; countryIndex += 1) {
      const count = Number(metadataRanges[countryIndex * 2 + 1] || 0);
      if (!count) continue;
      ranges.set(String(metadataIds[countryIndex]), Object.freeze([Object.freeze({
        first: Number(metadataRanges[countryIndex * 2] || 0),
        count,
      })]));
    }
    return ranges;
  }
  const indices = sourceMesh?.triangleIndices || [];
  let activeId = '';
  let activeRange = null;
  for (let first = 0; first + 2 < indices.length; first += 3) {
    const vertexIndex = Number(indices[first]);
    const countryIndex = Number(sourceMesh.countryIndices?.[vertexIndex]);
    const countryId = String(countryIds?.[countryIndex] || '');
    if (!countryId) {
      activeId = '';
      activeRange = null;
      continue;
    }
    if (countryId === activeId && activeRange && activeRange.first + activeRange.count === first) {
      activeRange.count += 3;
      continue;
    }
    activeId = countryId;
    activeRange = { first, count: 3 };
    if (!ranges.has(countryId)) ranges.set(countryId, []);
    ranges.get(countryId).push(activeRange);
  }
  for (const [countryId, countryRanges] of ranges) {
    ranges.set(countryId, Object.freeze(countryRanges.map(range => Object.freeze({ ...range }))));
  }
  return ranges;
}

function longitudeIntervals(west, east, flags) {
  if ((flags & COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE) !== 0) return [[-180, 180]];
  if ((flags & COUNTRY_BOUNDS_FLAG_DATELINE) !== 0 || west > east) return [[west, 180], [-180, east]];
  return [[west, east]];
}

function longitudeSpanDegrees(west, east, flags) {
  if ((flags & COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE) !== 0) return 360;
  return west <= east ? east - west : 360 - west + east;
}

function longitudeMidpointDegrees(west, east, flags) {
  if ((flags & COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE) !== 0) return 0;
  const span = longitudeSpanDegrees(west, east, flags);
  const midpoint = west + span / 2;
  return midpoint > 180 ? midpoint - 360 : midpoint;
}

function flatBoundsIntersectViewport(bounds, flags, frameContext, paddingPixels) {
  const [west, south, east, north] = bounds;
  const width = Math.max(1, Number(frameContext.cssViewport?.[0] || 0));
  const height = Math.max(1, Number(frameContext.cssViewport?.[1] || 0));
  const translate = frameContext.cssTranslate || [width / 2, height / 2];
  const scale = Math.abs(Number(frameContext.cssScale || 0));
  const center = frameContext.flatCenter || [0, 0];
  if (!scale) return true;
  const minY = translate[1] - scale * (north * Math.PI / 180 - center[1]);
  const maxY = translate[1] - scale * (south * Math.PI / 180 - center[1]);
  if (maxY < -paddingPixels || minY > height + paddingPixels) return false;
  for (const [intervalWest, intervalEast] of longitudeIntervals(west, east, flags)) {
    for (const worldOffset of frameContext.worldOffsets || [0]) {
      const minX = translate[0] + scale * (intervalWest * Math.PI / 180 + worldOffset - center[0]);
      const maxX = translate[0] + scale * (intervalEast * Math.PI / 180 + worldOffset - center[0]);
      if (maxX >= -paddingPixels && minX <= width + paddingPixels) return true;
    }
  }
  return false;
}

function globeBoundsIntersectViewport(bounds, flags, frameContext, paddingPixels) {
  const [west, south, east, north] = bounds;
  if ((flags & COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE) !== 0) return true;
  const width = Math.max(1, Number(frameContext.cssViewport?.[0] || 0));
  const height = Math.max(1, Number(frameContext.cssViewport?.[1] || 0));
  const translate = frameContext.cssTranslate || [width / 2, height / 2];
  const scale = Math.abs(Number(frameContext.cssScale || 0));
  const lon = longitudeMidpointDegrees(west, east, flags) * Math.PI / 180;
  const lat = ((south + north) / 2) * Math.PI / 180;
  const vector = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const rowX = frameContext.rowX || [1, 0, 0];
  const rowY = frameContext.rowY || [0, 1, 0];
  const rowZ = frameContext.rowZ || [0, 0, 1];
  const dot = (row, point) => row[0] * point[0] + row[1] * point[1] + row[2] * point[2];
  const longitudeRadius = longitudeSpanDegrees(west, east, flags) * Math.PI / 360;
  const latitudeRadius = Math.max(0, north - south) * Math.PI / 360;
  const angularRadius = Math.min(Math.PI, Math.hypot(longitudeRadius, latitudeRadius) + 2 * Math.PI / 180);
  if (angularRadius >= Math.PI / 2) return true;
  const paddingAngle = scale > 0 ? paddingPixels / scale : 0;
  const centerDepth = Math.max(-1, Math.min(1, dot(rowZ, vector)));
  if (Math.acos(centerDepth) > Math.PI / 2 + angularRadius + paddingAngle) return false;
  const screenX = translate[0] + scale * dot(rowX, vector);
  const screenY = translate[1] + scale * dot(rowY, vector);
  const radiusPixels = scale * 2 * Math.sin(angularRadius / 2) + paddingPixels;
  return screenX + radiusPixels >= 0
    && screenX - radiusPixels <= width
    && screenY + radiusPixels >= 0
    && screenY - radiusPixels <= height;
}

export function countryDrawRangesForFrame(sourceMesh, frameContext, {
  kind = 'triangle',
  paddingPixels = COUNTRY_CULLING_PADDING_PIXELS,
  fullRangeThreshold = COUNTRY_CULLING_FULL_RANGE_THRESHOLD,
  maxRanges = COUNTRY_CULLING_MAX_RANGES,
  includeCountry = null,
} = {}) {
  const indexCount = Number(kind === 'boundary'
    ? sourceMesh?.lineIndices?.length
    : sourceMesh?.triangleIndices?.length) || 0;
  const fullRanges = fullCountryDrawRange(indexCount);
  const rangeData = kind === 'boundary' ? sourceMesh?.countryBoundaryRanges : sourceMesh?.countryTriangleRanges;
  const boundsData = sourceMesh?.countryBounds;
  const flagsData = sourceMesh?.countryBoundsFlags;
  const countryIds = sourceMesh?.metadataCountryIds;
  const countryCount = Array.isArray(countryIds) ? countryIds.length : Number(rangeData?.length || 0) / 2;
  const invalidMetadata = !frameContext
    || !rangeData || rangeData.length !== countryCount * 2
    || !boundsData || boundsData.length !== countryCount * 4
    || !flagsData || flagsData.length !== countryCount;
  if (!indexCount || invalidMetadata) {
    return { ranges: fullRanges, culled: false, visibleCountryCount: countryCount, indexCount, fullIndexCount: indexCount, fallback: true };
  }
  const width = Math.max(1, Number(frameContext.cssViewport?.[0] || 0));
  const height = Math.max(1, Number(frameContext.cssViewport?.[1] || 0));
  const scale = Math.abs(Number(frameContext.cssScale || 0));
  const worldVisible = frameContext.mode === 0
    ? scale * 2 <= Math.min(width, height) + paddingPixels * 2
    : scale * 2 * Math.PI <= width + paddingPixels * 2 && scale * Math.PI <= height + paddingPixels * 2;
  if (worldVisible && typeof includeCountry !== 'function') {
    return { ranges: fullRanges, culled: false, visibleCountryCount: countryCount, indexCount, fullIndexCount: indexCount, fallback: false };
  }
  const candidates = [];
  let visibleCountryCount = 0;
  for (let countryIndex = 0; countryIndex < countryCount; countryIndex += 1) {
    const countryId = String(countryIds?.[countryIndex] ?? countryIndex);
    if (typeof includeCountry === 'function' && !includeCountry(countryId, countryIndex)) continue;
    const range = {
      first: Number(rangeData[countryIndex * 2] || 0),
      count: Number(rangeData[countryIndex * 2 + 1] || 0),
    };
    if (!range.count) continue;
    const bounds = Array.from(boundsData.subarray(countryIndex * 4, countryIndex * 4 + 4), value => value * COUNTRY_BOUNDS_SCALE);
    const flags = Number(flagsData[countryIndex] || 0);
    const visible = frameContext.mode === 0
      ? globeBoundsIntersectViewport(bounds, flags, frameContext, paddingPixels)
      : flatBoundsIntersectViewport(bounds, flags, frameContext, paddingPixels);
    if (!visible) continue;
    visibleCountryCount += 1;
    candidates.push(range);
  }
  const merged = mergeCountryDrawRanges(candidates);
  const visibleIndexCount = merged.reduce((sum, range) => sum + range.count, 0);
  if (visibleIndexCount >= indexCount * Math.max(0, Number(fullRangeThreshold) || 0) || merged.length > Math.max(1, Number(maxRanges) || 1)) {
    return { ranges: fullRanges, culled: false, visibleCountryCount, indexCount, fullIndexCount: indexCount, fallback: true };
  }
  return { ranges: merged, culled: true, visibleCountryCount, indexCount: visibleIndexCount, fullIndexCount: indexCount, fallback: false };
}

export function resolveRenderPixelRatioValue(devicePixelRatio, mobileLayout = false, qualityCap = Infinity) {
  const deviceRatio = Math.max(1, Number(devicePixelRatio || 1));
  const cap = Math.max(1, Number(qualityCap) || Infinity);
  return Math.min(mobileLayout ? 2 : 3, cap, deviceRatio);
}

export function visibleFlatWorldOffsets({
  translateX,
  scale,
  flatCenterRadians = 0,
  viewportWidth,
  minimumOverlap = 0.5,
} = {}) {
  const resolvedTranslate = Number(translateX);
  const resolvedScale = Math.abs(Number(scale));
  const resolvedCenter = Number(flatCenterRadians);
  const resolvedWidth = Math.max(1, Number(viewportWidth));
  if (![resolvedTranslate, resolvedScale, resolvedCenter, resolvedWidth].every(Number.isFinite) || resolvedScale <= 0) {
    return [0];
  }
  const overlapThreshold = Math.max(0, Number(minimumOverlap) || 0);
  const candidates = [-2 * Math.PI, 0, 2 * Math.PI];
  const visible = candidates.filter(worldOffset => {
    const left = resolvedTranslate + resolvedScale * (-Math.PI + worldOffset - resolvedCenter);
    const right = resolvedTranslate + resolvedScale * (Math.PI + worldOffset - resolvedCenter);
    return Math.min(right, resolvedWidth) - Math.max(left, 0) > overlapThreshold;
  });
  if (visible.length) return visible;
  const viewportCenter = resolvedWidth / 2;
  return [candidates.reduce((nearest, worldOffset) => {
    const center = resolvedTranslate + resolvedScale * (worldOffset - resolvedCenter);
    const distance = Math.abs(center - viewportCenter);
    return distance < nearest.distance ? { worldOffset, distance } : nearest;
  }, { worldOffset: 0, distance: Infinity }).worldOffset];
}

export function createCountryGeometryRevisionTracker() {
  let committedRevision = 0;
  let displayedRevision = 0;
  let taskToken = 0;
  const pendingRevisions = new Map();

  const normalizedIds = ids => [...new Set([...(ids || [])].map(String).filter(Boolean))];

  function beginCommit(ids) {
    committedRevision += 1;
    taskToken += 1;
    const normalized = normalizedIds(ids);
    for (const id of normalized) pendingRevisions.set(id, committedRevision);
    return { ids: normalized, revision: committedRevision, token: taskToken };
  }

  function beginTask(revision = committedRevision) {
    taskToken += 1;
    return { revision: Number(revision || 0), token: taskToken };
  }

  function isCurrent(token, revision) {
    return Number(token) === taskToken && Number(revision) === committedRevision;
  }

  function markDisplayed(ids, revision) {
    const numericRevision = Number(revision || 0);
    if (numericRevision < committedRevision) return [];
    const cleared = [];
    for (const id of normalizedIds(ids)) {
      const pendingRevision = pendingRevisions.get(id);
      if (pendingRevision === undefined || pendingRevision > numericRevision) continue;
      pendingRevisions.delete(id);
      cleared.push(id);
    }
    displayedRevision = Math.max(displayedRevision, numericRevision);
    return cleared;
  }

  function reset() {
    taskToken += 1;
    pendingRevisions.clear();
    committedRevision += 1;
    return committedRevision;
  }

  return Object.freeze({
    beginCommit,
    beginTask,
    isCurrent,
    markDisplayed,
    reset,
    committedRevision: () => committedRevision,
    displayedRevision: () => displayedRevision,
    taskToken: () => taskToken,
    pendingIds: () => [...pendingRevisions.keys()],
    pendingRevision: id => pendingRevisions.get(String(id)),
    isPending: id => pendingRevisions.has(String(id)),
  });
}

export function createGpuMapRenderer(deps) {
  const {
    APP_VERSION,
    ASSET_REVISION,
    DATA_REVISION,
    PHYSICAL_DATA_BASE_URL,
    activeProjection,
    countryColor,
    countryFeatureById,
    countryOutlineFeature,
    d3,
    deepClone,
    defaultCountryColor,
    flatProjection,
    getSystemTheme,
    globeProjection,
    hydroDisplayColor,
    hydroFeatureById,
    hydroVisibilityThreshold,
    isCountryVisibleById,
    isHydroFeatureVisible,
    isLayerItemVisible,
    isMobile,
    isSafeKoreanErrorMessage,
    mapTheme,
    mapWorkScheduler,
    prepareHydroFeature,
    queueMapResize,
    renderPendingCountryOverlays,
    renderViewFrame,
    reportOperationError,
    rendererUi,
    runtimeAssetUrl,
    scheduleGpuFrame,
    scheduleGpuInteractionFrame,
    scheduleGpuMeshRebuild,
    setActionStatus,
    state,
  } = deps;
  return (() => {
    const PI = Math.PI;
    let canvas = null;
    let gl = null;
    let glVersion = 0;
    let renderDevice = null;
    let renderDeviceContextRevision = 0;
    let projectGeneration = 0;
    let projectRenderBlocked = false;
    let renderScene = null;
    let renderInteractionState = Object.freeze({
      selectionPacket: null,
      genericFillItems: Object.freeze([]),
      previewPackets: Object.freeze([]),
      draftPackets: Object.freeze([]),
    });
    let selectionPass = null;
    let lastSelectionRenderResult = null;
    let lastBaseSceneResult = null;
    const sceneColorCache = createSceneColorCache();
    const polygonOverlayPass = createGpuPolygonOverlayPass({
      onError: payload => console.warn(`[${payload?.stage || 'gpu-polygon-overlay'}]`, payload?.error || payload),
    });
    const strokeRenderer = createGpuStrokeRenderer({
      onError: payload => console.warn(`[${payload?.stage || 'gpu-stroke'}]`, payload?.error || payload),
    });
    let sceneCacheFallbackFrame = false;
    let sceneCacheFullDrawCount = 0;
    let sceneCacheInteractionDrawCount = 0;
    let sceneCacheSelectionOnlyBaseDrawCount = 0;
    let sceneCacheReprojectCount = 0;
    let lastRenderSceneRevision = 0;
    const rendererStartedAt = performance.now();
    let firstCanonicalFrameMs = null;
    let canonicalFrameFallbackCount = 0;
    let renderQuality = DEFAULT_RENDER_QUALITY;
    let meshSwitchCount = 0;
    let renderQualityChangeCount = 0;
    // Preview data is a one-way startup fallback. Once canonical geometry is
    // promoted it is never selected again for interaction or adaptive quality.
    let qualityPhase = 'startup-preview';
    let previewAllowed = true;
    let previewActivationCount = 0;
    let previewActivationAfterCanonical = 0;
    let canonicalPromotionCount = 0;
    let canonicalPromotionError = '';
    let canonicalReadyFrameId = 0;
    function recordCanonicalFrameReady() {
      if (firstCanonicalFrameMs === null) {
        firstCanonicalFrameMs = Math.max(0, performance.now() - rendererStartedAt);
      }
    }
    function recordSceneCacheFallback() {
      if (!sceneCacheFallbackFrame) canonicalFrameFallbackCount += 1;
      sceneCacheFallbackFrame = true;
    }
    let webGlContextKind = '';
    let uintIndexExtension = null;
    let ctx2d = null;
    let rendererMode = 'pending';
    let fillProgram = null;
    let landMaskProgram = null;
    let lineProgram = null;
    let pickProgram = null;
    let terrainProgram = null;
    let hydroFillProgram = null;
    let hydroLineProgram = null;
    let hydroPickProgram = null;
    let hydroLinePickProgram = null;
    let countryStateFillProgram = null;
    let countryStateQuadBuffer = null;
    let hydroCornerBuffer = null;
    let instancedExtension = null;
    let hydroVisibilityTexture = null;
    let hydroVisibilityWidth = 1;
    let hydroVisibilityHeight = 1;
    let hydroManifest = null;
    let hydroManifestUrl = null;
    let hydroWorker = null;
    let hydroWorkerReady = false;
    let hydroWorkerGeneration = 0;
    let hydroWorkerIncludesGeometry = false;
    let hydroWorkerReadyPromise = Promise.resolve(false);
    let hydroWorkerReadyResolve = null;
    let hydroWorkerReadyTimer = 0;
    let hydroViewRequestedKey = '';
    let hydroViewLoadedKey = '';
    let hydroViewRequestedRevision = 0;
    let hydroViewRetryAttempts = 0;
    let hydroViewRetryKey = '';
    let hydroViewRetryTimer = 0;
    let hydroRequestRevision = 0;
    let hydroVisibleTileCache = { signature: '', tiles: [], key: '', window: null };
    let hydroAcceptedRevision = 0;
    let hydroActivePackIds = new Set();
    const hydroPacks = new Map();
    let hydroEditEntries = [];
    let hydroEditRevision = -1;
    const hydroEditFeatureByFid = new Map();
    const hydroUploadQueue = [];
    let hydroUploadFrame = 0;
    let interactionActive = false;
    let hydroVisibilityDirty = true;
    const hydroFeatureRequests = new Map();
    const hydroLogicalQueryRequests = new Map();
    let hydroFeatureRequestId = 0;
    let hydroCacheCompletionNotified = false;
    let fillVao = null;
    let lineVao = null;
    let positionBuffer = null;
    let countryBuffer = null;
    let fillIndexBuffer = null;
    let lineIndexBuffer = null;
    let paletteTexture = null;
    let overridePaletteTexture = null;
    let emphasisPaletteTexture = null;
    let overrideEmphasisPaletteTexture = null;
    let paletteCapacity = 0;
    let palettePixels = null;
    const paletteDirty = { base: true, emphasis: true };
    const pendingEmphasisCountryIds = new Set();
    let emphasisPaletteFullDirty = true;
    let uniformLocationCache = new WeakMap();
    let attributeLocationCache = new WeakMap();
    let activeFrameContext = null;
    let lastVisualFrame = null;
    let framePresentationListener = null;
    let interactionStyle = {
      hover: { color: '#d7ba7d', fillAlpha: 0.05775 },
      selection: {
        color: '#cda95d', casingColor: '#f2f4f6',
        primary: { innerWidth: 2.5, innerAlpha: 1, outerWidth: 4, casingAlpha: 0.72, fillAlpha: 0.13 },
        secondary: { innerWidth: 1.5, innerAlpha: 0.72, outerWidth: 2.8, casingAlpha: 0.48, fillAlpha: 0.08 },
      },
      drawOrder: ['hover', 'secondary-casing', 'secondary-inner', 'primary-casing', 'primary-inner'],
    };
    let countryEmphasis = { primaryId: '', hoverId: '', selectedIds: new Set() };
    let countryEmphasisRevision = 0;
    let countryPaletteRevision = 0;
    let physicalStyleStateRevision = 0;
    let overridePositionBuffer = null;
    let overrideCountryBuffer = null;
    let overrideFillIndexBuffer = null;
    let overrideLineIndexBuffer = null;
    let overrideFillVao = null;
    let overrideLineVao = null;
    let overrideMesh = null;
    let overrideWebGl1PositionData = null;
    let overrideWebGl1CountryData = null;
    const countryOverrideIds = new Set();
    const overrideFeatureSnapshots = new Map();
    const geometryRevisionTracker = createCountryGeometryRevisionTracker();
    let pendingOldMeshVisibleCount = 0;
    let patchWorker = null;
    const patchRequests = new Map();
    let patchWorkerOutputBytes = 0;
    const patchJobScheduler = createLatestWorkerJobScheduler({
      maxConcurrent: 1,
      execute: entry => new Promise((resolve, reject) => {
        const payload = entry.payload || {};
        const currentWorker = ensurePatchWorker();
        patchRequests.set(Number(payload.token), { resolve, reject, geometryRevision: entry.geometryRevision });
        currentWorker.postMessage({
          token: Number(payload.token),
          geometryRevision: Number(entry.geometryRevision),
          targetRevision: Number(entry.targetRevision),
          jobKey: entry.jobKey,
          features: payload.features || [],
        });
      }),
      isCurrent: entry => geometryRevisionTracker.isCurrent(entry.payload?.token, entry.geometryRevision),
    });
    let terrainManifest = null;
    const terrainTiles = new Map();
    const terrainTileRequests = new Map();
    const terrainFetchQueue = [];
    const terrainFetchQueuedKeys = new Set();
    let terrainActiveFetches = 0;
    const terrainTileFailures = new Map();
    const terrainTileQueuedKeys = new Set();
    const terrainUploadQueue = [];
    let terrainUploadFrame = 0;
    const terrainGridMeshes = new Map();
    let terrainLastLevel = -1;
    let terrainRenderedLevel = -1;
    let terrainTargetTileCount = 0;
    let terrainTargetTilesLoaded = 0;
    let mesh = null;
    let meshCountryIds = [];
    const countryStrokePacketCache = {
      preview: { mesh: null, countryIds: null, revision: '', resource: null },
      canonical: { mesh: null, countryIds: null, revision: '', resource: null },
      override: { mesh: null, countryIds: null, revision: '', resource: null },
    };
    const countryStrokeMeshRevisions = new WeakMap();
    let countryStrokeMeshRevisionSequence = 0;
    let meshQuality = 'preview';
    let activeMeshQuality = 'preview';
    let canonicalMeshReady = false;
    const meshVariants = new Map();
    let pickCount = 0;
    let pickReadPixelsMs = 0;
    let pickLastReadPixelsMs = 0;
    let pickSceneKey = '';
    let pickSceneRenderCount = 0;
    let effectivePixelRatio = 1;
    let pixelWidth = 0;
    let pixelHeight = 0;
    let cssWidth = 0;
    let cssHeight = 0;
    let resizePending = true;
    let pickFramebuffer = null;
    let pickTexture = null;
    let activeRenderViewState = null;
    let lastSceneFrameContext = null;
    let worker = null;
    let workerCompletionResolver = null;
    let canvasWorker = null;
    let canvasWorkerUrl = null;
    let canvasWorkerBitmapContext = null;
    let canvasWorker2dContext = null;
    let canvasWorkerReady = false;
    let canvasWorkerBusy = false;
    let canvasWorkerPendingMessage = null;
    let canvasStyleRevision = 0;
    let canvasPhysicalStyleRevision = 0;
    let canvasLastStyleSignature = '';
    let canvasLastPhysicalStyleSignature = '';
    let canvasWorkerLatestRequestedRevision = 0;
    let canvasWorkerDisplayedRevision = 0;
    let canvasHydroPickRequestId = 0;
    const canvasHydroPickRequests = new Map();
    let fallbackReason = '';
    let layoutMismatchCount = 0;
    let lastLayoutMismatchCssPx = 0;
    let layoutVerificationFrame = 0;
    let webglRecoveryTimer = 0;
    let webglContextLost = false;
    let currentRenderRevision = 0;
    let displayedRenderRevision = 0;
    const frameTimes = [];
    const performanceMetrics = {
      paletteRebuildCount: 0,
      paletteUploadCount: 0,
      paletteUploadBytes: 0,
      uniformCacheHits: 0,
      uniformCacheMisses: 0,
      attributeCacheHits: 0,
      attributeCacheMisses: 0,
      frameContextBuildCount: 0,
      visualFrameConsumeCount: 0,
      hydroViewRequestCount: 0,
      hydroTileWindowCacheHitCount: 0,
      hydroTileWindowRecomputeCount: 0,
      hydroUploadBytes: 0,
      terrainUploadCount: 0,
      terrainIncompleteFrameCount: 0,
      canvasWorkerMessageCount: 0,
      canvasWorkerMessageBytes: 0,
      canvasWorkerViewMessageCount: 0,
      canvasWorkerStaleFrameCount: 0,
      canvasWorkerStateMessageCount: 0,
      canvasWorkerMessagesByType: {},
      baseSceneDrawCount: 0,
      interactionFrameCount: 0,
      selectionOnlyFrameCount: 0,
      selectionOnlyGeometryUploadBytes: 0,
      countryInteractionIndexCount: 0,
      countryInteractionRangeCount: 0,
      countryInteractionFullIndexCount: 0,
      countryBaseIndexCount: 0,
      countryBaseFullIndexCount: 0,
      countryBaseRangeCount: 0,
      countryBoundaryIndexCount: 0,
      countryBoundaryFullIndexCount: 0,
      countryVisibleCount: 0,
      countryCullingFallbackCount: 0,
      countryStateCompositeCount: 0,
      countryStateCompositeMs: 0,
      countryPatchUploadBytes: 0,
      lastCountryPatchUploadBytes: 0,
      paletteChangedCountryCount: 0,
      paletteUploadRangeCount: 0,
      paletteFullRebuildCount: 0,
      paletteSkippedUnchangedCount: 0,
      overlayUploadBytes: 0,
      lastOverlayUploadBytes: 0,
      overlayDeferredItemCount: 0,
      uploadBudgetOverrunCount: 0,
    };
    let cachedDetailedStats = { at: 0, p95CpuSubmitMs: 0, p99CpuSubmitMs: 0 };
    let canvasDataReplacementResolver = null;
    let lastGeometryCommitTimings = null;
    const forcedRenderer = (() => {
      try {
        const value = new URLSearchParams(location.search).get('renderer');
        return ['webgl2', 'webgl1', 'canvas'].includes(value) ? value : '';
      } catch (_) { return ''; }
    })();

    function invalidateGpuFrame(reason = 'gpu-frame') {
      if (typeof scheduleGpuFrame === 'function') return scheduleGpuFrame(reason);
      return renderViewFrame?.(reason);
    }

    function invalidateGpuInteraction(reason = 'gpu-interaction') {
      if (typeof scheduleGpuInteractionFrame === 'function') return scheduleGpuInteractionFrame(reason);
      return invalidateGpuFrame(reason);
    }

    function invalidatePhysicalScene(reason = 'physical-scene') {
      lastBaseSceneResult = null;
      sceneColorCache.invalidate(reason);
      if (rendererMode !== 'pending') return invalidateGpuFrame(reason);
      return false;
    }

    function resolveRenderPixelRatio() {
      effectivePixelRatio = resolveRenderPixelRatioValue(window.devicePixelRatio, isMobile(), renderQuality.dprCap);
      return effectivePixelRatio;
    }

    const vertexShaderSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      layout(location=0) in ivec2 aCoord;
      layout(location=1) in uint aCountry;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      out float vDepth;
      flat out uint vCountry;
      void main() {
        float lon = float(aCoord.x) * 0.000001 * ${Math.PI / 180};
        float lat = float(aCoord.y) * 0.000001 * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const fillFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 color = texelFetch(uPalette, ivec2(int(vCountry), 0), 0);
        if (color.a <= 0.0) discard;
        outColor = color;
      }`;
    const lineFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      uniform vec4 uBorderColor;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        if (texelFetch(uPalette, ivec2(int(vCountry), 0), 0).a <= 0.0) discard;
        outColor = uBorderColor;
      }`;
    const pickFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uPalette;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        if (texelFetch(uPalette, ivec2(int(vCountry), 0), 0).a <= 0.0) discard;
        uint id = vCountry + 1u;
        outColor = vec4(float(id & 255u), float((id >> 8u) & 255u), float((id >> 16u) & 255u), 255.0) / 255.0;
      }`;
    const countryStateVertexSourceWebGl2 = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 aPosition;
      out vec2 vUv;
      void main(){vUv=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0.0,1.0);}`;
    const countryStateFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      uniform sampler2D uCountryIds;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      in vec2 vUv;
      out vec4 outColor;
      void main(){
        vec3 encoded=floor(texture(uCountryIds,vUv).rgb*255.0+0.5);
        float countryIndex=encoded.r+encoded.g*256.0+encoded.b*65536.0-1.0;
        if(countryIndex<0.0)discard;
        vec4 color=texture(uPalette,vec2((countryIndex+0.5)/max(1.0,uPaletteWidth),0.5));
        if(color.a<=0.0)discard;
        outColor=color;
      }`;
    const landMaskFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        outColor = vec4(1.0);
      }`;
    const vertexShaderSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aCoord;
      attribute float aCountry;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      varying float vDepth;
      varying float vCountry;
      void main() {
        float lon = aCoord.x * 0.000001 * ${Math.PI / 180};
        float lat = aCoord.y * 0.000001 * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const hydroRibbonVertexSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      layout(location=0) in vec2 aCorner;
      layout(location=1) in ivec2 aStart;
      layout(location=2) in ivec2 aEnd;
      layout(location=3) in uint aCountry;
      layout(location=4) in float aStartWidth;
      layout(location=5) in float aEndWidth;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform float uWidthBoost;
      uniform float uWidthScale;
      uniform int uMode;
      out float vDepth;
      flat out uint vCountry;
      void projectCoord(ivec2 coord, out vec2 screenPoint, out float depth) {
        float lon = float(coord.x) * 0.000001 * ${Math.PI / 180};
        float lat = float(coord.y) * 0.000001 * ${Math.PI / 180};
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          depth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          depth = 1.0;
        }
      }
      void main() {
        vec2 startPoint;
        vec2 endPoint;
        float startDepth;
        float endDepth;
        projectCoord(aStart, startPoint, startDepth);
        projectCoord(aEnd, endPoint, endDepth);
        vec2 direction = endPoint - startPoint;
        float segmentLength = length(direction);
        direction = segmentLength > 0.0001 ? direction / segmentLength : vec2(1.0, 0.0);
        vec2 normal = vec2(-direction.y, direction.x);
        float width = mix(aStartWidth, aEndWidth, aCorner.x) * uWidthScale;
        vec2 screenPoint = mix(startPoint, endPoint, aCorner.x) + normal * aCorner.y * (width + uWidthBoost) * 0.5;
        vDepth = mix(startDepth, endDepth, aCorner.x);
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const hydroRibbonVertexSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aCorner;
      attribute vec2 aStart;
      attribute vec2 aEnd;
      attribute float aCountry;
      attribute float aStartWidth;
      attribute float aEndWidth;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform float uWidthBoost;
      uniform float uWidthScale;
      uniform int uMode;
      varying float vDepth;
      varying float vCountry;
      void projectCoord(vec2 coord, out vec2 screenPoint, out float depth) {
        float lon = coord.x * 0.000001 * ${Math.PI / 180};
        float lat = coord.y * 0.000001 * ${Math.PI / 180};
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          depth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          depth = 1.0;
        }
      }
      void main() {
        vec2 startPoint;
        vec2 endPoint;
        float startDepth;
        float endDepth;
        projectCoord(aStart, startPoint, startDepth);
        projectCoord(aEnd, endPoint, endDepth);
        vec2 direction = endPoint - startPoint;
        float segmentLength = length(direction);
        direction = segmentLength > 0.0001 ? direction / segmentLength : vec2(1.0, 0.0);
        vec2 normal = vec2(-direction.y, direction.x);
        float width = mix(aStartWidth, aEndWidth, aCorner.x) * uWidthScale;
        vec2 screenPoint = mix(startPoint, endPoint, aCorner.x) + normal * aCorner.y * (width + uWidthBoost) * 0.5;
        vDepth = mix(startDepth, endDepth, aCorner.x);
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vCountry = aCountry;
      }`;
    const fillFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        vec4 color = texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5));
        if (color.a <= 0.0) discard;
        gl_FragColor = color;
      }`;
    const lineFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      uniform vec4 uBorderColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        if (texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5)).a <= 0.0) discard;
        gl_FragColor = uBorderColor;
      }`;
    const pickFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float index = floor(vCountry + 0.5);
        if (texture2D(uPalette, vec2((index + 0.5) / uPaletteWidth, 0.5)).a <= 0.0) discard;
        float id = floor(vCountry + 1.5);
        float r = mod(id, 256.0);
        float g = mod(floor(id / 256.0), 256.0);
        float b = mod(floor(id / 65536.0), 256.0);
        gl_FragColor = vec4(r, g, b, 255.0) / 255.0;
      }`;
    const countryStateVertexSourceWebGl1 = `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main(){vUv=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0.0,1.0);}`;
    const countryStateFragmentSourceWebGl1 = `
      precision highp float;
      uniform sampler2D uCountryIds;
      uniform sampler2D uPalette;
      uniform float uPaletteWidth;
      varying vec2 vUv;
      void main(){
        vec3 encoded=floor(texture2D(uCountryIds,vUv).rgb*255.0+0.5);
        float countryIndex=encoded.r+encoded.g*256.0+encoded.b*65536.0-1.0;
        if(countryIndex<0.0)discard;
        vec4 color=texture2D(uPalette,vec2((countryIndex+0.5)/max(1.0,uPaletteWidth),0.5));
        if(color.a<=0.0)discard;
        gl_FragColor=color;
      }`;
    const landMaskFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        gl_FragColor = vec4(1.0);
      }`;
    const terrainVertexSourceWebGl2 = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 aGrid;
      uniform vec4 uGeoBounds;
      uniform vec4 uUvBounds;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      out vec2 vUv;
      out float vDepth;
      void main() {
        float lon = mix(uGeoBounds.x, uGeoBounds.z, aGrid.x) * ${Math.PI / 180};
        float lat = mix(uGeoBounds.y, uGeoBounds.w, aGrid.y) * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vUv = mix(uUvBounds.xy, uUvBounds.zw, aGrid);
      }`;
    const terrainFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in vec2 vUv;
      in float vDepth;
      uniform sampler2D uTerrain;
      uniform int uMode;
      uniform float uPhysicalStyle;
      uniform float uDarkTheme;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 terrainSample = texture(uTerrain, vUv);
        vec3 neutral = vec3(terrainSample.a);
        vec3 color = mix(neutral, terrainSample.rgb, uPhysicalStyle);
        color = mix(color, color * vec3(0.60, 0.68, 0.76), uDarkTheme * 0.48);
        outColor = vec4(color, 1.0);
      }`;
    const terrainVertexSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      attribute vec2 aGrid;
      uniform vec4 uGeoBounds;
      uniform vec4 uUvBounds;
      uniform vec2 uViewport;
      uniform vec2 uTranslate;
      uniform float uScale;
      uniform vec3 uRowX;
      uniform vec3 uRowY;
      uniform vec3 uRowZ;
      uniform vec2 uFlatCenter;
      uniform float uWorldOffset;
      uniform int uMode;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        float lon = mix(uGeoBounds.x, uGeoBounds.z, aGrid.x) * ${Math.PI / 180};
        float lat = mix(uGeoBounds.y, uGeoBounds.w, aGrid.y) * ${Math.PI / 180};
        vec2 screenPoint;
        if (uMode == 0) {
          vec3 point = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
          screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
          vDepth = dot(uRowZ, point);
        } else {
          screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
          vDepth = 1.0;
        }
        vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
        gl_Position = vec4(clip, 0.0, 1.0);
        vUv = mix(uUvBounds.xy, uUvBounds.zw, aGrid);
      }`;
    const terrainFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying vec2 vUv;
      varying float vDepth;
      uniform sampler2D uTerrain;
      uniform int uMode;
      uniform float uPhysicalStyle;
      uniform float uDarkTheme;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        vec4 terrainSample = texture2D(uTerrain, vUv);
        vec3 neutral = vec3(terrainSample.a);
        vec3 color = mix(neutral, terrainSample.rgb, uPhysicalStyle);
        color = mix(color, color * vec3(0.60, 0.68, 0.76), uDarkTheme * 0.48);
        gl_FragColor = vec4(color, 1.0);
      }`;
    const hydroFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uHydroVisibility;
      uniform ivec2 uHydroVisibilitySize;
      uniform vec4 uHydroColor;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        int featureId = int(vCountry);
        ivec2 cell = ivec2(featureId % uHydroVisibilitySize.x, featureId / uHydroVisibilitySize.x);
        if (texelFetch(uHydroVisibility, cell, 0).a <= 0.0) discard;
        outColor = uHydroColor;
      }`;
    const hydroPickFragmentSourceWebGl2 = `#version 300 es
      precision highp float;
      precision highp int;
      in float vDepth;
      flat in uint vCountry;
      uniform sampler2D uHydroVisibility;
      uniform ivec2 uHydroVisibilitySize;
      uniform int uMode;
      out vec4 outColor;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        int featureId = int(vCountry);
        ivec2 cell = ivec2(featureId % uHydroVisibilitySize.x, featureId / uHydroVisibilitySize.x);
        if (texelFetch(uHydroVisibility, cell, 0).a <= 0.0) discard;
        uint id = vCountry + 1u;
        outColor = vec4(float(id & 255u), float((id >> 8u) & 255u), float((id >> 16u) & 255u), 255.0) / 255.0;
      }`;
    const hydroFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uHydroVisibility;
      uniform vec2 uHydroVisibilitySize;
      uniform vec4 uHydroColor;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float featureId = floor(vCountry + 0.5);
        float x = mod(featureId, uHydroVisibilitySize.x);
        float y = floor(featureId / uHydroVisibilitySize.x);
        if (texture2D(uHydroVisibility, vec2((x + 0.5) / uHydroVisibilitySize.x, (y + 0.5) / uHydroVisibilitySize.y)).a <= 0.0) discard;
        gl_FragColor = uHydroColor;
      }`;
    const hydroPickFragmentSourceWebGl1 = `
      precision highp float;
      precision mediump int;
      varying float vDepth;
      varying float vCountry;
      uniform sampler2D uHydroVisibility;
      uniform vec2 uHydroVisibilitySize;
      uniform int uMode;
      void main() {
        if (uMode == 0 && vDepth < 0.0) discard;
        float featureId = floor(vCountry + 0.5);
        float x = mod(featureId, uHydroVisibilitySize.x);
        float y = floor(featureId / uHydroVisibilitySize.x);
        if (texture2D(uHydroVisibility, vec2((x + 0.5) / uHydroVisibilitySize.x, (y + 0.5) / uHydroVisibilitySize.y)).a <= 0.0) discard;
        float id = featureId + 1.0;
        gl_FragColor = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0), mod(floor(id / 65536.0), 256.0), 255.0) / 255.0;
      }`;

    function createProgram(vertexSource, fragmentSource) {
      return linkGpuProgram(gl, vertexSource, fragmentSource, { label: 'map' });
    }

    function cachedUniformLocation(program, name) {
      let locations = uniformLocationCache.get(program);
      if (!locations) {
        locations = new Map();
        uniformLocationCache.set(program, locations);
      }
      if (locations.has(name)) {
        performanceMetrics.uniformCacheHits += 1;
        return locations.get(name);
      }
      const location = gl.getUniformLocation(program, name);
      locations.set(name, location);
      performanceMetrics.uniformCacheMisses += 1;
      return location;
    }

    function cachedAttributeLocation(program, name) {
      let locations = attributeLocationCache.get(program);
      if (!locations) {
        locations = new Map();
        attributeLocationCache.set(program, locations);
      }
      if (locations.has(name)) {
        performanceMetrics.attributeCacheHits += 1;
        return locations.get(name);
      }
      const location = gl.getAttribLocation(program, name);
      locations.set(name, location);
      performanceMetrics.attributeCacheMisses += 1;
      return location;
    }

    function primeProgramLocations(program, uniforms = [], attributes = []) {
      for (const name of uniforms) cachedUniformLocation(program, name);
      for (const name of attributes) cachedAttributeLocation(program, name);
    }

    function attach(nextCanvas) {
      canvas = nextCanvas;
      resizePending = true;
      canvas.className = 'gpu-map-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      layoutMismatchCount = 0;
    }

    function replaceCanvas() {
      if (renderDevice || gl) handleSharedGpuContextLost();
      const replacement = rendererUi.createCanvas();
      canvas?.replaceWith(replacement);
      attach(replacement);
      gl = null;
      glVersion = 0;
      renderDevice = null;
      webGlContextKind = '';
      uintIndexExtension = null;
      instancedExtension = null;
      ctx2d = null;
      canvasWorkerBitmapContext = null;
      canvasWorker2dContext = null;
      return replacement;
    }

    function isWebGlRenderer() {
      return rendererMode === 'webgl2' || rendererMode === 'webgl1';
    }

    function connectHydroCanvasWorkers() {
      if (!hydroWorker || !canvasWorker || rendererMode !== 'canvas-worker' || typeof MessageChannel !== 'function') return;
      const channel = new MessageChannel();
      canvasWorker.postMessage({ type: 'hydro-port', port: channel.port1 }, [channel.port1]);
      hydroWorker.postMessage({ type: 'hydro-port', port: channel.port2 }, [channel.port2]);
    }

    function rendererName() {
      return glVersion === 2 ? 'WebGL2' : glVersion === 1 ? 'WebGL1' : 'Canvas';
    }

    function meshQualityLabel() {
      return canonicalMeshReady ? '무손실' : previewAllowed ? '빠른 미리보기' : '고화질 지도 준비 중';
    }

    function updateRendererStatus(label, reason = '') {
      rendererUi.setEngineStatus(reason ? `${label} · ${reason}` : label);
    }

    function createWebGlResources() {
      uniformLocationCache = new WeakMap();
      attributeLocationCache = new WeakMap();
      const vertexSource = glVersion === 2 ? vertexShaderSourceWebGl2 : vertexShaderSourceWebGl1;
      fillProgram = createProgram(vertexSource, glVersion === 2 ? fillFragmentSourceWebGl2 : fillFragmentSourceWebGl1);
      landMaskProgram = createProgram(vertexSource, glVersion === 2 ? landMaskFragmentSourceWebGl2 : landMaskFragmentSourceWebGl1);
      lineProgram = createProgram(vertexSource, glVersion === 2 ? lineFragmentSourceWebGl2 : lineFragmentSourceWebGl1);
      pickProgram = createProgram(vertexSource, glVersion === 2 ? pickFragmentSourceWebGl2 : pickFragmentSourceWebGl1);
      countryStateFillProgram = createProgram(
        glVersion === 2 ? countryStateVertexSourceWebGl2 : countryStateVertexSourceWebGl1,
        glVersion === 2 ? countryStateFragmentSourceWebGl2 : countryStateFragmentSourceWebGl1,
      );
      terrainProgram = createProgram(
        glVersion === 2 ? terrainVertexSourceWebGl2 : terrainVertexSourceWebGl1,
        glVersion === 2 ? terrainFragmentSourceWebGl2 : terrainFragmentSourceWebGl1,
      );
      hydroFillProgram = createProgram(vertexSource, glVersion === 2 ? hydroFragmentSourceWebGl2 : hydroFragmentSourceWebGl1);
      hydroLineProgram = createProgram(
        glVersion === 2 ? hydroRibbonVertexSourceWebGl2 : hydroRibbonVertexSourceWebGl1,
        glVersion === 2 ? hydroFragmentSourceWebGl2 : hydroFragmentSourceWebGl1,
      );
      hydroPickProgram = createProgram(vertexSource, glVersion === 2 ? hydroPickFragmentSourceWebGl2 : hydroPickFragmentSourceWebGl1);
      hydroLinePickProgram = createProgram(
        glVersion === 2 ? hydroRibbonVertexSourceWebGl2 : hydroRibbonVertexSourceWebGl1,
        glVersion === 2 ? hydroPickFragmentSourceWebGl2 : hydroPickFragmentSourceWebGl1,
      );
      const viewUniforms = GPU_VIEW_UNIFORM_NAMES;
      for (const program of [fillProgram, landMaskProgram, lineProgram, pickProgram, terrainProgram, hydroFillProgram, hydroLineProgram, hydroPickProgram, hydroLinePickProgram]) {
        primeProgramLocations(program, viewUniforms);
      }
      for (const program of [fillProgram, lineProgram, pickProgram]) primeProgramLocations(program, ['uPalette', 'uPaletteWidth'], ['aCoord', 'aCountry']);
      primeProgramLocations(countryStateFillProgram, ['uCountryIds', 'uPalette', 'uPaletteWidth'], ['aPosition']);
      primeProgramLocations(lineProgram, ['uBorderColor']);
      for (const program of [hydroFillProgram, hydroLineProgram, hydroPickProgram, hydroLinePickProgram]) {
        primeProgramLocations(program, ['uHydroVisibility', 'uHydroVisibilitySize', 'uHydroColor', 'uWidthBoost', 'uWidthScale'], ['aCoord', 'aCountry', 'aCorner', 'aStart', 'aEnd', 'aStartWidth', 'aEndWidth']);
      }
      primeProgramLocations(terrainProgram, ['uTerrain', 'uGeoBounds', 'uUvBounds', 'uPhysicalStyle', 'uDarkTheme'], ['aGrid']);
      paletteTexture = gl.createTexture();
      overridePaletteTexture = gl.createTexture();
      emphasisPaletteTexture = gl.createTexture();
      overrideEmphasisPaletteTexture = gl.createTexture();
      paletteCapacity = 0;
      palettePixels = null;
      paletteDirty.base = true;
      paletteDirty.emphasis = true;
      emphasisPaletteFullDirty = true;
      pendingEmphasisCountryIds.clear();
      hydroVisibilityTexture = gl.createTexture();
      countryStateQuadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, countryStateQuadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      hydroCornerBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, hydroCornerBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      positionBuffer = null;
      countryBuffer = null;
      fillIndexBuffer = null;
      lineIndexBuffer = null;
      overridePositionBuffer = gl.createBuffer();
      overrideCountryBuffer = gl.createBuffer();
      overrideFillIndexBuffer = gl.createBuffer();
      overrideLineIndexBuffer = gl.createBuffer();
      resetGpuNormalBlend(gl);
      gl.disable(gl.DEPTH_TEST);
      pickFramebuffer = null;
      pickTexture = null;
      pickSceneKey = '';
      for (const pending of terrainUploadQueue.splice(0)) pending.bitmap?.close?.();
      terrainTileQueuedKeys.clear();
      terrainTiles.clear();
      terrainTileRequests.clear();
      terrainFetchQueue.length = 0;
      terrainFetchQueuedKeys.clear();
      terrainActiveFetches = 0;
      terrainTileFailures.clear();
      terrainGridMeshes.clear();
      for (const entry of [...hydroPacks.values(), ...hydroEditEntries]) {
        entry.resources = null;
        entry.uploadState = null;
        entry.uploadQueued = false;
        scheduleHydroUpload(entry);
      }
      hydroVisibilityDirty = true;
      for (const entry of meshVariants.values()) entry.resources = uploadMeshResources(entry.mesh);
      activateMeshVariant(activeMeshQuality, { renderFrame: false });
    }

    function initializeSharedGpuPasses() {
      if (!renderDevice) return false;
      const sceneCacheReady = sceneColorCache.initialize(renderDevice);
      const polygonReady = polygonOverlayPass.initialize(renderDevice);
      const strokeReady = strokeRenderer.initialize(renderDevice);
      const selectionReady = selectionPass
        ? (selectionPass.stats?.().contextLost
          ? selectionPass.handleContextRestored?.(renderDevice, { strokeRenderer, polygonPass: polygonOverlayPass })
          : selectionPass.initialize(renderDevice, { strokeRenderer, polygonPass: polygonOverlayPass }))
        : true;
      lastSelectionRenderResult = null;
      if (!sceneCacheReady) console.warn('SceneColorCache를 초기화하지 못해 전체 프레임 경로를 사용합니다.');
      if (!polygonReady || !strokeReady || !selectionReady) {
        console.warn('일부 GPU overlay pass가 준비되지 않아 객체별 SVG fallback을 유지합니다.');
      }
      if (strokeReady) prewarmCountryStrokeResources();
      return sceneCacheReady && polygonReady && strokeReady && selectionReady;
    }

    function handleSharedGpuContextLost() {
      sceneColorCache.handleContextLost();
      polygonOverlayPass.handleContextLost();
      strokeRenderer.handleContextLost();
      if (!selectionPass?.stats?.().contextLost) selectionPass?.handleContextLost?.();
      lastSelectionRenderResult = null;
      lastBaseSceneResult = null;
      lastSceneFrameContext = null;
      sceneCacheFallbackFrame = false;
    }

    function handleWebGlContextLost(event) {
      if (event.currentTarget !== canvas) return;
      event.preventDefault();
      handleSharedGpuContextLost();
      webglContextLost = true;
      renderDevice = null;
      rendererMode = 'webgl-recovering';
      clearTimeout(webglRecoveryTimer);
      updateRendererStatus(`${rendererName()} · GPU를 복구하는 중입니다.`);
      setActionStatus('지도 GPU를 복구하는 중입니다.', 'working', 0);
      rendererUi.onContextStateChange?.('lost');
      webglRecoveryTimer = setTimeout(() => {
        if (webglContextLost && rendererMode === 'webgl-recovering') {
          activateCanvasFallback('WebGL 컨텍스트 복구 시간 초과');
        }
      }, 5000);
    }

    function handleWebGlContextRestored(event) {
      if (event.currentTarget !== canvas || !webglContextLost) return;
      clearTimeout(webglRecoveryTimer);
      try {
        gl = canvas.getContext(webGlContextKind);
        if (!gl) throw new Error(`복구된 ${rendererName()} 컨텍스트를 가져올 수 없습니다.`);
        if (glVersion === 1) {
          uintIndexExtension = gl.getExtension('OES_element_index_uint');
          if (!uintIndexExtension) throw new Error('WebGL1 32비트 인덱스를 지원하지 않습니다.');
          instancedExtension = gl.getExtension('ANGLE_instanced_arrays');
          if (!instancedExtension) throw new Error('WebGL1 인스턴스 강·호수 렌더링을 지원하지 않습니다.');
        }
        createWebGlResources();
        renderDeviceContextRevision += 1;
        renderDevice = createRenderDevice({
          gl,
          canvas,
          version: glVersion,
          contextRevision: renderDeviceContextRevision,
        });
        initializeSharedGpuPasses();
        webglContextLost = false;
        rendererMode = glVersion === 2 ? 'webgl2' : 'webgl1';
        if (overrideMesh) setOverrideMesh(overrideMesh);
        else renderLatestVisualFrame();
        updateRendererStatus(`${rendererName()} · GPU 실시간`);
        setActionStatus('지도 GPU를 복구했습니다.', 'success', 2200);
        rendererUi.onContextStateChange?.('restored');
      } catch (error) {
        webglContextLost = false;
        console.error('[PL-GPU-002]', error);
        activateCanvasFallback('WebGL 컨텍스트를 복구하지 못했습니다.');
      }
    }

    function initWebGl(version) {
      const contextKind = version === 2 ? 'webgl2' : 'webgl';
      webGlContextKind = contextKind;
      gl = canvas.getContext(contextKind, {
        alpha: true,
        antialias: true,
        depth: false,
        stencil: true,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true,
        powerPreference: 'high-performance',
      });
      if (!gl && version === 1) {
        webGlContextKind = 'experimental-webgl';
        gl = canvas.getContext(webGlContextKind, { alpha: true, antialias: true, depth: false, stencil: true, preserveDrawingBuffer: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
      }
      if (!gl) throw new Error(`${version === 2 ? 'WebGL2' : 'WebGL1'}를 지원하지 않습니다.`);
      if (!gl.getContextAttributes()?.stencil) throw new Error(`${version === 2 ? 'WebGL2' : 'WebGL1'} 스텐실 마스크를 지원하지 않습니다.`);
      glVersion = version;
      uintIndexExtension = version === 1 ? gl.getExtension('OES_element_index_uint') : true;
      if (version === 1 && !uintIndexExtension) throw new Error('WebGL1 OES_element_index_uint를 지원하지 않습니다.');
      instancedExtension = version === 1 ? gl.getExtension('ANGLE_instanced_arrays') : true;
      if (version === 1 && !instancedExtension) throw new Error('WebGL1 ANGLE_instanced_arrays를 지원하지 않습니다.');
      createWebGlResources();
      renderDeviceContextRevision += 1;
      renderDevice = createRenderDevice({
        gl,
        canvas,
        version,
        contextRevision: renderDeviceContextRevision,
      });
      initializeSharedGpuPasses();
      canvas.addEventListener('webglcontextlost', handleWebGlContextLost);
      canvas.addEventListener('webglcontextrestored', handleWebGlContextRestored);
      webglContextLost = false;
      rendererMode = version === 2 ? 'webgl2' : 'webgl1';
    }

    function disposeMeshResources(resources) {
      if (!gl || !resources) return;
      if (glVersion === 2) {
        if (resources.fillVao) gl.deleteVertexArray(resources.fillVao);
        if (resources.lineVao) gl.deleteVertexArray(resources.lineVao);
      }
      for (const buffer of [resources.positionBuffer, resources.countryBuffer, resources.fillIndexBuffer, resources.lineIndexBuffer]) {
        if (buffer) gl.deleteBuffer(buffer);
      }
    }

    function uploadMeshResources(nextMesh) {
      if (!gl || !nextMesh) return null;
      const resources = {
        positionBuffer: gl.createBuffer(),
        countryBuffer: gl.createBuffer(),
        fillIndexBuffer: gl.createBuffer(),
        lineIndexBuffer: gl.createBuffer(),
        fillVao: null,
        lineVao: null,
        byteLength: Number(nextMesh.positions?.byteLength || 0)
          + Number(nextMesh.countryIndices?.byteLength || 0)
          + Number(nextMesh.triangleIndices?.byteLength || 0)
          + Number(nextMesh.lineIndices?.byteLength || 0),
      };
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.positionBuffer);
      if (glVersion === 2) gl.bufferData(gl.ARRAY_BUFFER, nextMesh.positions, gl.STATIC_DRAW);
      else {
        const positionData = Float32Array.from(nextMesh.positions);
        gl.bufferData(gl.ARRAY_BUFFER, positionData, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.countryBuffer);
      if (glVersion === 2) gl.bufferData(gl.ARRAY_BUFFER, nextMesh.countryIndices, gl.STATIC_DRAW);
      else {
        const countryData = Float32Array.from(nextMesh.countryIndices);
        gl.bufferData(gl.ARRAY_BUFFER, countryData, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.fillIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, nextMesh.triangleIndices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.lineIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, nextMesh.lineIndices, gl.STATIC_DRAW);
      if (glVersion === 2) {
        const createVao = indexBuffer => {
          const vao = gl.createVertexArray();
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, resources.positionBuffer);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribIPointer(0, 2, gl.INT, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, resources.countryBuffer);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
          gl.bindVertexArray(null);
          return vao;
        };
        resources.fillVao = createVao(resources.fillIndexBuffer);
        resources.lineVao = createVao(resources.lineIndexBuffer);
      }
      return resources;
    }

    function activateMeshVariant(quality, { renderFrame = true } = {}) {
      const requestedQuality = quality === 'preview' ? 'preview' : 'canonical';
      if (requestedQuality === 'preview') {
        previewActivationCount += 1;
        if (!previewAllowed || canonicalMeshReady || qualityPhase === 'canonical-ready') {
          previewActivationAfterCanonical += canonicalMeshReady || qualityPhase === 'canonical-ready' ? 1 : 0;
          return false;
        }
      }
      const entry = meshVariants.get(requestedQuality) || meshVariants.get('canonical');
      if (!entry) return false;
      const changed = activeMeshQuality !== entry.quality || mesh !== entry.mesh;
      activeMeshQuality = entry.quality;
      meshQuality = entry.quality;
      mesh = entry.mesh;
      meshCountryIds = entry.countryIds;
      if (changed) meshSwitchCount += 1;
      const resources = entry.resources;
      positionBuffer = resources?.positionBuffer || null;
      countryBuffer = resources?.countryBuffer || null;
      fillIndexBuffer = resources?.fillIndexBuffer || null;
      lineIndexBuffer = resources?.lineIndexBuffer || null;
      fillVao = resources?.fillVao || null;
      lineVao = resources?.lineVao || null;
      pickSceneKey = '';
      window.__PANDOLAB_GPU_METRICS__ = getStats();
      if (renderFrame && changed) renderLatestVisualFrame();
      return true;
    }

    function setMesh(nextMesh, countryIds, {
      renderFrame = true,
      quality = meshQuality,
      preserveOtherVariants = false,
    } = {}) {
      const variantQuality = quality === 'preview' ? 'preview' : 'canonical';
      if (variantQuality === 'preview' && (!previewAllowed || canonicalMeshReady || qualityPhase === 'canonical-ready')) {
        previewActivationAfterCanonical += 1;
        return false;
      }
      if (!preserveOtherVariants) {
        for (const entry of meshVariants.values()) disposeMeshResources(entry.resources);
        meshVariants.clear();
      } else if (meshVariants.has(variantQuality)) {
        disposeMeshResources(meshVariants.get(variantQuality).resources);
      }
      nextMesh.metadataCountryIds = [...countryIds];
      nextMesh.triangleRangesByCountryId = createCountryTriangleRangeMap(nextMesh, countryIds);
      const entry = {
        quality: variantQuality,
        mesh: nextMesh,
        countryIds: [...countryIds],
        resources: uploadMeshResources(nextMesh),
      };
      meshVariants.set(variantQuality, entry);
      activateMeshVariant(variantQuality, { renderFrame });
      prewarmCountryStrokeResources();
      projectRenderBlocked = false;
      sceneColorCache.invalidate('mesh-ready');
    }

    function promoteCanonicalMesh({ frameId = 0 } = {}) {
      canonicalMeshReady = true;
      recordCanonicalFrameReady();
      qualityPhase = 'canonical-ready';
      previewAllowed = false;
      meshQuality = 'canonical';
      canonicalPromotionCount += 1;
      canonicalReadyFrameId = Number(frameId || currentRenderRevision || 0);
      canonicalPromotionError = '';
      const previewEntry = meshVariants.get('preview');
      if (previewEntry) {
        if (previewEntry !== meshVariants.get('canonical')) disposeMeshResources(previewEntry.resources);
        meshVariants.delete('preview');
      }
      countryStrokePacketCache.preview.mesh = null;
      countryStrokePacketCache.preview.countryIds = null;
      countryStrokePacketCache.preview.revision = '';
      countryStrokePacketCache.preview.resource = null;
      return true;
    }

    function setOverrideMesh(nextMesh, { renderFrame = true } = {}) {
      if (nextMesh && !(nextMesh.triangleRangesByCountryId instanceof Map)) {
        nextMesh.triangleRangesByCountryId = createCountryTriangleRangeMap(
          nextMesh,
          nextMesh.metadataCountryIds || meshCountryIds,
        );
      }
      overrideMesh = nextMesh;
      // An override changes the pixels owned by the base scene.  Invalidate
      // the scene cache before uploading (and also when the override is
      // cleared) so a previous scene texture cannot leave the old country
      // border behind after the patch is displayed.
      lastBaseSceneResult = null;
      sceneColorCache.invalidate('country-override-mesh');
      countryStrokePacketCache.override.mesh = null;
      countryStrokePacketCache.override.resource = null;
      overrideWebGl1PositionData = null;
      overrideWebGl1CountryData = null;
      if (!gl || !isWebGlRenderer() || !nextMesh) {
        if (renderFrame) renderLatestVisualFrame();
        return;
      }
      const uploadBytes = Number(nextMesh.positions?.byteLength || 0)
        + Number(nextMesh.countryIndices?.byteLength || 0)
        + Number(nextMesh.triangleIndices?.byteLength || 0)
        + Number(nextMesh.lineIndices?.byteLength || 0);
      performanceMetrics.countryPatchUploadBytes += uploadBytes;
      performanceMetrics.lastCountryPatchUploadBytes = uploadBytes;
      gl.bindBuffer(gl.ARRAY_BUFFER, overridePositionBuffer);
      if (glVersion === 2) gl.bufferData(gl.ARRAY_BUFFER, nextMesh.positions, gl.DYNAMIC_DRAW);
      else {
        overrideWebGl1PositionData = Float32Array.from(nextMesh.positions);
        gl.bufferData(gl.ARRAY_BUFFER, overrideWebGl1PositionData, gl.DYNAMIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, overrideCountryBuffer);
      if (glVersion === 2) gl.bufferData(gl.ARRAY_BUFFER, nextMesh.countryIndices, gl.DYNAMIC_DRAW);
      else {
        overrideWebGl1CountryData = Float32Array.from(nextMesh.countryIndices);
        gl.bufferData(gl.ARRAY_BUFFER, overrideWebGl1CountryData, gl.DYNAMIC_DRAW);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, overrideFillIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, nextMesh.triangleIndices, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, overrideLineIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, nextMesh.lineIndices, gl.DYNAMIC_DRAW);
      overrideFillVao = null;
      overrideLineVao = null;
      if (glVersion === 2) {
        const createVao = indexBuffer => {
          const vao = gl.createVertexArray();
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, overridePositionBuffer);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribIPointer(0, 2, gl.INT, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, overrideCountryBuffer);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
          gl.bindVertexArray(null);
          return vao;
        };
        overrideFillVao = createVao(overrideFillIndexBuffer);
        overrideLineVao = createVao(overrideLineIndexBuffer);
      }
      updatePalette();
      prewarmCountryStrokeResources();
      if (renderFrame) renderLatestVisualFrame();
    }

    function remapOverrideMesh(rawMesh, localIds) {
      const globalIndices = localIds.map(id => {
        const key = String(id);
        let index = meshCountryIds.indexOf(key);
        if (index < 0) {
          meshCountryIds.push(key);
          index = meshCountryIds.length - 1;
        }
        return index;
      });
      const local = new Uint16Array(rawMesh.countryIndices);
      const countryIndices = new Uint16Array(local.length);
      for (let index = 0; index < local.length; index += 1) countryIndices[index] = globalIndices[local[index]];
      const remapped = {
        positions: new Int32Array(rawMesh.positions),
        countryIndices,
        triangleIndices: new Uint32Array(rawMesh.triangleIndices),
        lineIndices: new Uint32Array(rawMesh.lineIndices),
        strokeStartsEnds: new Float32Array(rawMesh.strokeStartsEnds || []),
        strokeOwnerRanges: rawMesh.strokeOwnerRanges || null,
        countryTriangleRanges: new Uint32Array(rawMesh.countryTriangleRanges || []),
        countryBoundaryRanges: new Uint32Array(rawMesh.countryBoundaryRanges || []),
        countryBounds: new Int32Array(rawMesh.countryBounds || []),
        countryBoundsFlags: new Uint32Array(rawMesh.countryBoundsFlags || []),
        metadataCountryIds: [...localIds],
      };
      remapped.triangleRangesByCountryId = createCountryTriangleRangeMap(remapped, localIds);
      return remapped;
    }

    function stopPatchWorkerJobs(reason = 'cancelled') {
      patchJobScheduler.cancelAll(reason);
      const error = createWorkerCancellationError('국가 메시 계산을 취소했습니다.', reason);
      for (const request of patchRequests.values()) request.reject(error);
      patchRequests.clear();
      patchWorker?.terminate();
      patchWorker = null;
    }

    function completeGeometryDisplay(ids, geometryRevision, { renderFrame = true } = {}) {
      const cleared = geometryRevisionTracker.markDisplayed(ids, geometryRevision);
      if (renderFrame) {
        updatePalette();
        renderLatestVisualFrame();
      }
      for (const id of cleared) state.pendingCountryRenderIds.delete(String(id));
      renderPendingCountryOverlays?.();
      if (lastGeometryCommitTimings && Number(geometryRevision) === geometryRevisionTracker.committedRevision()) {
        lastGeometryCommitTimings.gpuPatchDisplayedAt ||= performance.now();
        if (!geometryRevisionTracker.pendingIds().length) lastGeometryCommitTimings.overlayRemovedAt ||= performance.now();
      }
      window.__PANDOLAB_GPU_METRICS__ = getStats();
      return cleared;
    }

    function normalizeCountryPatchRequest(rawRequest) {
      if (rawRequest && !Array.isArray(rawRequest) && typeof rawRequest === 'object' && rawRequest.ids) {
        const ids = [...new Set([...(rawRequest.ids || [])].map(String).filter(Boolean))];
        const byId = new Map((rawRequest.features || []).map(feature => [
          String(feature?.id || ''),
          feature,
        ]).filter(([id]) => id));
        const removed = new Set((rawRequest.removedIds || []).map(String));
        return {
          ids,
          features: ids.filter(id => !removed.has(id) && byId.has(id)).map(id => byId.get(id)),
          removedIds: ids.filter(id => removed.has(id) || !byId.has(id)),
        };
      }
      const ids = [...new Set([...(rawRequest || [])].map(String).filter(Boolean))];
      const features = [];
      const removedIds = [];
      for (const id of ids) {
        const feature = countryFeatureById(id);
        if (feature && String(feature?.id || '') === id) features.push(feature);
        else removedIds.push(id);
      }
      return { ids, features, removedIds };
    }

    function ensurePatchWorker() {
      if (patchWorker) return patchWorker;
      patchWorker = new Worker(runtimeAssetUrl('workers/gpu-mesh-worker.js'), { name: 'pandolab-country-patch-mesh' });
      patchWorker.onmessage = event => {
        const token = Number(event.data?.token || 0);
        const request = patchRequests.get(token);
        if (!request) return;
        patchRequests.delete(token);
        if (!event.data?.ok) {
          request.reject(new Error(event.data?.message || '변경 국가 메시를 만들지 못했습니다.'));
          return;
        }
        lastGeometryCommitTimings && (lastGeometryCommitTimings.patchWorkerCompletedAt = performance.now());
        const next = event.data.mesh;
        patchWorkerOutputBytes += Number(next?.positions?.byteLength || 0)
          + Number(next?.countryIndices?.byteLength || 0)
          + Number(next?.triangleIndices?.byteLength || 0)
          + Number(next?.lineIndices?.byteLength || 0)
          + Number(next?.strokeStartsEnds?.byteLength || 0);
        request.resolve(next);
      };
      patchWorker.onerror = event => {
        console.error('[PL-GPU-PATCH-001]', event.message || event);
        for (const request of patchRequests.values()) request.reject(new Error(event.message || '변경 국가 메시 Worker 오류'));
        patchRequests.clear();
        patchWorker?.terminate();
        patchWorker = null;
        scheduleGpuMeshRebuild(0);
      };
      return patchWorker;
    }

    function applyCountryPatch(rawRequest) {
      const { ids, features, removedIds } = normalizeCountryPatchRequest(rawRequest);
      if (!ids.length) return Promise.resolve(true);
      mapWorkScheduler.cancel('country-mesh-compaction');
      const commit = geometryRevisionTracker.beginCommit(ids);
      lastGeometryCommitTimings = {
        geometryRevision: commit.revision,
        editCommitAt: performance.now(),
        baseHiddenAt: 0,
        optimisticOverlayShownAt: 0,
        patchWorkerRequestedAt: 0,
        patchWorkerCompletedAt: 0,
        gpuPatchDisplayedAt: 0,
        overlayRemovedAt: 0,
      };
      for (const id of ids) countryOverrideIds.add(id);
      for (const feature of features) {
        const id = String(feature?.id || '');
        if (id) overrideFeatureSnapshots.set(id, deepClone(feature));
      }
      for (const id of removedIds) overrideFeatureSnapshots.delete(String(id));
      for (const id of ids) state.pendingCountryRenderIds.add(id);
      renderPendingCountryOverlays?.();
      lastGeometryCommitTimings.optimisticOverlayShownAt = performance.now();
      if (rendererMode === 'canvas-worker' && canvasWorker) {
        postCanvasWorkerMessage({
          type: 'patch',
          features,
          removedIds,
          ids,
          revision: currentRenderRevision,
          geometryRevision: commit.revision,
          taskToken: commit.token,
        });
        lastGeometryCommitTimings.patchWorkerRequestedAt = performance.now();
        renderViewFrame();
        lastGeometryCommitTimings.baseHiddenAt = performance.now();
        return Promise.resolve(true);
      }
      if (!isWebGlRenderer()) {
        renderViewFrame();
        lastGeometryCommitTimings.baseHiddenAt = performance.now();
        completeGeometryDisplay(ids, commit.revision, { renderFrame: false });
        return Promise.resolve(true);
      }
      updatePalette();
      renderViewFrame();
      lastGeometryCommitTimings.baseHiddenAt = performance.now();
      const patchFeatures = [...overrideFeatureSnapshots.values()].map(deepClone);
      const snapshotIds = [...countryOverrideIds];
      const token = commit.token;
      return new Promise(resolve => requestAnimationFrame(resolve)).then(() => {
        if (!geometryRevisionTracker.isCurrent(token, commit.revision)) return false;
        lastGeometryCommitTimings.patchWorkerRequestedAt = performance.now();
        const ticket = patchJobScheduler.enqueue({
          jobKey: 'mesh:country-overrides',
          geometryRevision: commit.revision,
          targetRevision: token,
          priority: 80,
          payload: { token, features: patchFeatures },
        });
        return ticket.promise.then(next => {
          if (!next || !geometryRevisionTracker.isCurrent(token, commit.revision)) return false;
          setOverrideMesh(remapOverrideMesh(next, next.countryIds || []), { renderFrame: false });
          completeGeometryDisplay(snapshotIds, commit.revision);
          if (countryOverrideIds.size > 48 || (overrideMesh?.countryIndices?.length || 0) > (mesh?.countryIndices?.length || 1) * 0.25) {
            mapWorkScheduler.scheduleIdle('country-mesh-compaction', compactCountryOverrides, 2000);
          }
          return true;
        });
      }).catch(error => {
        if (!geometryRevisionTracker.isCurrent(token, commit.revision)) return false;
        console.error('[PL-GPU-PATCH-002]', error);
        scheduleGpuMeshRebuild(0);
        return false;
      });
    }

    function compactCountryOverrides() {
      if (!countryOverrideIds.size) return;
      rebuildFromCountries(state.countriesData?.features || [], {
        geometryRevision: geometryRevisionTracker.committedRevision(),
        reason: 'compaction',
      });
    }

    function resetCountryGeometryVisualState({ renderFrame = false, renderPending = true } = {}) {
      mapWorkScheduler.cancel('country-mesh-compaction');
      geometryRevisionTracker.reset();
      stopPatchWorkerJobs('geometry-reset');
      worker?.terminate();
      worker = null;
      workerCompletionResolver?.(false);
      workerCompletionResolver = null;
      countryOverrideIds.clear();
      overrideFeatureSnapshots.clear();
      overrideMesh = null;
      // Clearing an override removes geometry from the base scene as well as
      // from the interaction state.  Drop the cached scene before the next
      // draw so the removed border cannot remain in the framebuffer.
      lastBaseSceneResult = null;
      sceneColorCache.invalidate('country-override-cleared');
      state.pendingCountryRenderIds.clear();
      lastGeometryCommitTimings = null;
      if (renderFrame) {
        updatePalette();
        renderLatestVisualFrame();
      }
      if (renderPending) renderPendingCountryOverlays?.();
      window.__PANDOLAB_GPU_METRICS__ = getStats();
      rendererUi.onContextStateChange?.('fallback');
    }

    function resetProjectRenderState({ generation = null } = {}) {
      const requested = Number(generation);
      projectGeneration = Number.isFinite(requested) && requested > projectGeneration
        ? requested
        : projectGeneration + 1;
      projectRenderBlocked = true;
      resetCountryGeometryVisualState({ renderFrame: false, renderPending: false });
      sceneColorCache.reset?.({ dropActive: true });
      renderScene = null;
      renderInteractionState = Object.freeze({
        selectionPacket: null,
        genericFillItems: Object.freeze([]),
        previewPackets: Object.freeze([]),
        draftPackets: Object.freeze([]),
      });
      lastSelectionRenderResult = null;
      lastBaseSceneResult = null;
      lastSceneFrameContext = null;
      selectionPass?.clear?.();
      countryEmphasis = { primaryId: '', hoverId: '', selectedIds: new Set() };
      countryEmphasisRevision += 1;
      markPaletteDirty({ emphasis: true });
      for (const entry of meshVariants.values()) disposeMeshResources(entry.resources);
      meshVariants.clear();
      mesh = null;
      meshCountryIds = [];
      qualityPhase = previewAllowed ? 'startup-preview' : 'canonical-loading';
      activeMeshQuality = previewAllowed ? 'preview' : 'canonical';
      meshQuality = previewAllowed ? 'preview' : 'canonical';
      canonicalMeshReady = false;
      for (const pending of terrainUploadQueue.splice(0)) pending.bitmap?.close?.();
      terrainFetchQueue.length = 0;
      terrainFetchQueuedKeys.clear();
      terrainTileQueuedKeys.clear();
      terrainTileRequests.clear();
      terrainTileFailures.clear();
      for (const entry of terrainTiles.values()) if (entry.texture && gl) gl.deleteTexture(entry.texture);
      terrainTiles.clear();
      terrainLastLevel = -1;
      terrainRenderedLevel = -1;
      terrainTargetTileCount = 0;
      terrainTargetTilesLoaded = 0;
      // The legacy renderer owns its default framebuffer, so clear the old
      // project immediately during a project reset.
      if (gl && !gl.isContextLost?.()) {
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, Math.max(1, pixelWidth), Math.max(1, pixelHeight));
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        } catch (_) {
          // A reset must not surface a renderer cleanup failure as a runtime error.
        }
      }
      return projectGeneration;
    }

    async function decodeBuiltInMesh(rawBuffer = null, features = null) {
      const buffer = rawBuffer || window.PANDOLAB_GPU_MESH_BUFFER;
      if (!(buffer instanceof ArrayBuffer)) throw new Error('외부 GPU 메시가 준비되지 않았습니다.');
      if (!rawBuffer) window.PANDOLAB_GPU_MESH_BUFFER = null;
      const prefix = new Uint32Array(buffer, 0, 8);
      const formatVersion = Number(prefix[1]);
      const headerWords = formatVersion >= 2 ? 12 : 8;
      const header = new Uint32Array(buffer, 0, headerWords);
      if (header[0] !== 0x434d4731 || ![1, 2].includes(formatVersion) || header[2] !== 258 || header[6] < 1 || header[7] !== 3) {
        throw new Error('외부 GPU 메시 형식 또는 알고리즘 리비전이 올바르지 않습니다.');
      }
      const countryCount = header[2];
      const vertexCount = header[3];
      const triangleIndexCount = header[4];
      const lineIndexCount = header[5];
      const triangleRangeLength = formatVersion >= 2 ? Number(header[8]) : 0;
      const boundaryRangeLength = formatVersion >= 2 ? Number(header[9]) : 0;
      const boundsLength = formatVersion >= 2 ? Number(header[10]) : 0;
      const boundsFlagsLength = formatVersion >= 2 ? Number(header[11]) : 0;
      if (formatVersion >= 2 && (
        triangleRangeLength !== countryCount * 2
        || boundaryRangeLength !== countryCount * 2
        || boundsLength !== countryCount * 4
        || boundsFlagsLength !== countryCount
      )) throw new Error('외부 GPU 메시의 국가별 범위 메타데이터가 손상되었습니다.');
      let offset = headerWords * 4;
      const positions = new Int32Array(buffer, offset, vertexCount * 2);
      offset += positions.byteLength;
      const countryIndices = new Uint16Array(buffer, offset, vertexCount);
      offset += (countryIndices.byteLength + 3) & ~3;
      const triangleIndices = new Uint32Array(buffer, offset, triangleIndexCount);
      offset += triangleIndices.byteLength;
      const lineIndices = new Uint32Array(buffer, offset, lineIndexCount);
      offset += lineIndices.byteLength;
      const countryTriangleRanges = formatVersion >= 2 ? new Uint32Array(buffer, offset, triangleRangeLength) : null;
      offset += countryTriangleRanges?.byteLength || 0;
      const countryBoundaryRanges = formatVersion >= 2 ? new Uint32Array(buffer, offset, boundaryRangeLength) : null;
      offset += countryBoundaryRanges?.byteLength || 0;
      const countryBounds = formatVersion >= 2 ? new Int32Array(buffer, offset, boundsLength) : null;
      offset += countryBounds?.byteLength || 0;
      const countryBoundsFlags = formatVersion >= 2 ? new Uint32Array(buffer, offset, boundsFlagsLength) : null;
      offset += countryBoundsFlags?.byteLength || 0;
      if (offset !== buffer.byteLength) throw new Error('외부 GPU 메시의 크기가 헤더와 일치하지 않습니다.');
      const ids = (features || window.PANDOLAB_COUNTRIES?.features || []).slice(0, countryCount)
        .map((feature, index) => String(feature?.id || index));
      return {
        mesh: {
          positions,
          countryIndices,
          triangleIndices,
          lineIndices,
          countryTriangleRanges,
          countryBoundaryRanges,
          countryBounds,
          countryBoundsFlags,
          metadataCountryIds: ids,
        },
        ids,
        sourceCoordinateCount: header[6],
        buffer,
      };
    }

    function createWorker() {
      if (worker) {
        worker.terminate();
        workerCompletionResolver?.(false);
        workerCompletionResolver = null;
      }
      worker = new Worker(runtimeAssetUrl('workers/gpu-mesh-worker.js'), {
        name: 'pandolab-gpu-mesh',
      });
      return worker;
    }

    function rebuildFromCountries(features, {
      geometryRevision = geometryRevisionTracker.committedRevision(),
      reason = 'full-rebuild',
      projectGeneration: taskProjectGeneration = projectGeneration,
    } = {}) {
      if (Number(taskProjectGeneration) !== projectGeneration) return Promise.resolve(false);
      const task = geometryRevisionTracker.beginTask(geometryRevision);
      stopPatchWorkerJobs(reason);
      const pendingIds = geometryRevisionTracker.pendingIds();
      if (rendererMode === 'canvas-worker' && canvasWorker) {
        meshQuality = 'canonical';
        canonicalMeshReady = true;
        recordCanonicalFrameReady();
        qualityPhase = 'canonical-ready';
        previewAllowed = false;
        canonicalPromotionCount += 1;
        canonicalReadyFrameId = currentRenderRevision;
        projectRenderBlocked = false;
        postCanvasWorkerMessage({
          type: 'data', features, ids: pendingIds,
          revision: currentRenderRevision,
          geometryRevision: task.revision,
          taskToken: task.token,
          reason,
        });
        renderCanvasWorker(currentRenderRevision);
        return Promise.resolve(true);
      }
      if (!isWebGlRenderer()) {
        meshQuality = 'canonical';
        canonicalMeshReady = true;
        recordCanonicalFrameReady();
        qualityPhase = 'canonical-ready';
        previewAllowed = false;
        canonicalPromotionCount += 1;
        canonicalReadyFrameId = currentRenderRevision;
        projectRenderBlocked = false;
        countryOverrideIds.clear();
        overrideFeatureSnapshots.clear();
        overrideMesh = null;
        renderViewFrame();
        completeGeometryDisplay(pendingIds, task.revision, { renderFrame: false });
        return Promise.resolve(true);
      }
      const token = task.token;
      let currentWorker;
      try { currentWorker = createWorker(); }
      catch (error) {
        console.error('[PL-GPU-001]', error);
        activateCanvasFallback('동적 지도 메시를 준비하지 못했습니다.');
        return Promise.resolve(false);
      }
      updateRendererStatus(`${rendererName()} · 편집 메시지를 계산하는 중입니다.`);
      return new Promise(resolve => {
        const settle = value => {
          if (workerCompletionResolver === settle) workerCompletionResolver = null;
          resolve(value);
        };
        workerCompletionResolver = settle;
        currentWorker.onmessage = event => {
          if (event.data?.token !== token
            || Number(event.data?.projectGeneration ?? taskProjectGeneration) !== projectGeneration
            || !geometryRevisionTracker.isCurrent(token, task.revision)) {
            currentWorker.terminate();
            settle(false);
            return;
          }
          currentWorker.terminate();
          if (worker === currentWorker) worker = null;
          if (!event.data?.ok) {
            console.error('[PL-GPU-003]', event.data?.message || event.data);
            activateCanvasFallback('동적 지도 메시를 준비하지 못했습니다.');
            settle(false);
            return;
          }
          const next = event.data.mesh;
          countryOverrideIds.clear();
          overrideFeatureSnapshots.clear();
          overrideMesh = null;
          setMesh({
            positions: new Int32Array(next.positions),
            countryIndices: new Uint16Array(next.countryIndices),
            triangleIndices: new Uint32Array(next.triangleIndices),
            lineIndices: new Uint32Array(next.lineIndices),
            strokeStartsEnds: new Float32Array(next.strokeStartsEnds || []),
            strokeOwnerRanges: next.strokeOwnerRanges || null,
            countryTriangleRanges: new Uint32Array(next.countryTriangleRanges || []),
            countryBoundaryRanges: new Uint32Array(next.countryBoundaryRanges || []),
            countryBounds: new Int32Array(next.countryBounds || []),
            countryBoundsFlags: new Uint32Array(next.countryBoundsFlags || []),
          }, next.countryIds || [], { renderFrame: false, quality: 'canonical', preserveOtherVariants: false });
          completeGeometryDisplay(pendingIds, task.revision);
          promoteCanonicalMesh({ frameId: currentRenderRevision });
          projectRenderBlocked = false;
          sceneColorCache.invalidate('project-mesh-ready');
          invalidateGpuFrame('project-mesh-ready');
          updateRendererStatus(`${rendererName()} · GPU 실시간`);
          settle(true);
        };
        currentWorker.onerror = event => {
          if (Number(taskProjectGeneration) !== projectGeneration
            || !geometryRevisionTracker.isCurrent(token, task.revision)) {
            settle(false);
            return;
          }
          console.error('[PL-GPU-004]', event.message || event);
          activateCanvasFallback('동적 지도 메시 Worker를 사용할 수 없습니다.');
          settle(false);
        };
        currentWorker.postMessage({ token, projectGeneration: taskProjectGeneration, geometryRevision: task.revision, features });
      });
    }

    function parseColor(value) {
      const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
      if (!match) return parseColor(defaultCountryColor());
      const n = Number.parseInt(match[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function colorHex(values) {
      return `#${values.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
    }

    function countryEmphasisStyle(id) {
      const normalizedId = String(id || '');
      const kind = normalizedId === countryEmphasis.primaryId ? 'primary'
        : countryEmphasis.selectedIds.has(normalizedId) ? 'secondary'
          : normalizedId === countryEmphasis.hoverId ? 'hover' : '';
      if (!kind) return null;
      const fillAlpha = {
        primary: Math.round(Number(interactionStyle.selection.primary.fillAlpha || 0) * 255),
        secondary: Math.round(Number(interactionStyle.selection.secondary.fillAlpha || 0) * 255),
        hover: Math.round(Number(interactionStyle.hover.fillAlpha || 0) * 255),
      };
      const selectionRgb = parseColor(kind === 'hover' ? interactionStyle.hover.color : interactionStyle.selection.color);
      const styles = {
        primary: { color: selectionRgb, alphaByte: fillAlpha.primary },
        secondary: { color: selectionRgb, alphaByte: fillAlpha.secondary },
        hover: { color: selectionRgb, alphaByte: fillAlpha.hover },
      };
      return { kind, ...styles[kind] };
    }

    function configurePaletteTexture(texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, paletteCapacity, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }

    function ensurePaletteStorage() {
      const capacity = Math.max(1, meshCountryIds.length);
      if (palettePixels && paletteCapacity === capacity) return;
      paletteCapacity = capacity;
      palettePixels = {
        base: new Uint8Array(capacity * 4),
        override: new Uint8Array(capacity * 4),
        emphasis: new Uint8Array(capacity * 4),
        overrideEmphasis: new Uint8Array(capacity * 4),
      };
      for (const texture of [paletteTexture, overridePaletteTexture, emphasisPaletteTexture, overrideEmphasisPaletteTexture]) configurePaletteTexture(texture);
      paletteDirty.base = true;
      paletteDirty.emphasis = true;
    }

    function uploadPalettePixels(texture, pixels) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, paletteCapacity, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      performanceMetrics.paletteUploadCount += 1;
      performanceMetrics.paletteUploadBytes += pixels.byteLength;
    }

    function uploadPaletteRange(texture, pixels, first, count) {
      if (!count) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const offset = first * 4;
      const range = pixels.subarray(offset, offset + count * 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, first, 0, count, 1, gl.RGBA, gl.UNSIGNED_BYTE, range);
      performanceMetrics.paletteUploadCount += 1;
      performanceMetrics.paletteUploadBytes += range.byteLength;
    }

    function markPaletteDirty({ base = false, emphasis = false, countryIds = null } = {}) {
      paletteDirty.base ||= base;
      paletteDirty.emphasis ||= emphasis;
      if (emphasis) {
        if (Array.isArray(countryIds) && countryIds.length && !emphasisPaletteFullDirty) {
          for (const id of countryIds) pendingEmphasisCountryIds.add(String(id));
        } else if (!Array.isArray(countryIds) || !countryIds.length) {
          emphasisPaletteFullDirty = true;
          pendingEmphasisCountryIds.clear();
        }
      }
    }

    function flushPaletteUpdates() {
      if (!gl || !meshCountryIds.length || (!paletteDirty.base && !paletteDirty.emphasis)) return false;
      ensurePaletteStorage();
      const { base, override, emphasis, overrideEmphasis } = palettePixels;
      if (paletteDirty.base) {
        pendingOldMeshVisibleCount = 0;
        for (let index = 0; index < meshCountryIds.length; index += 1) {
          const id = meshCountryIds[index];
          const feature = countryFeatureById(id);
          const color = parseColor(feature ? countryColor(feature) : '#000000');
          const offset = index * 4;
          base[offset] = override[offset] = color[0];
          base[offset + 1] = override[offset + 1] = color[1];
          base[offset + 2] = override[offset + 2] = color[2];
          const visible = feature && isCountryVisibleById(id) ? mapTheme().fillAlphaByte : 0;
          const overridden = countryOverrideIds.has(id);
          const pending = geometryRevisionTracker.isPending(id);
          base[offset + 3] = overridden ? 0 : visible;
          override[offset + 3] = overridden && !pending ? visible : 0;
          if (pending && (base[offset + 3] || override[offset + 3])) pendingOldMeshVisibleCount += 1;
        }
        uploadPalettePixels(paletteTexture, base);
        uploadPalettePixels(overridePaletteTexture, override);
        paletteDirty.base = false;
        performanceMetrics.paletteRebuildCount += 1;
      }
      if (paletteDirty.emphasis) {
        const indices = emphasisPaletteFullDirty
          ? meshCountryIds.map((_, index) => index)
          : [...pendingEmphasisCountryIds]
            .map(id => meshCountryIds.indexOf(id))
            .filter(index => index >= 0);
        performanceMetrics.paletteChangedCountryCount += indices.length;
        for (const index of indices) {
          const id = meshCountryIds[index];
          const offset = index * 4;
          const visible = base[offset + 3] || override[offset + 3];
          const overridden = countryOverrideIds.has(id);
          const pending = geometryRevisionTracker.isPending(id);
          const entry = countryEmphasisStyle(id);
          const color = entry?.color || [0, 0, 0];
          emphasis[offset] = overrideEmphasis[offset] = color[0];
          emphasis[offset + 1] = overrideEmphasis[offset + 1] = color[1];
          emphasis[offset + 2] = overrideEmphasis[offset + 2] = color[2];
          const alpha = visible && entry ? entry.alphaByte : 0;
          emphasis[offset + 3] = overridden ? 0 : alpha;
          overrideEmphasis[offset + 3] = overridden && !pending ? alpha : 0;
        }
        if (emphasisPaletteFullDirty) {
          uploadPalettePixels(emphasisPaletteTexture, emphasis);
          uploadPalettePixels(overrideEmphasisPaletteTexture, overrideEmphasis);
          performanceMetrics.paletteFullRebuildCount += 1;
        } else if (indices.length) {
          const sorted = [...new Set(indices)].sort((a, b) => a - b);
          let start = sorted[0];
          let previous = start;
          for (let index = 1; index <= sorted.length; index += 1) {
            const current = sorted[index];
            if (current !== previous + 1) {
              const count = previous - start + 1;
              uploadPaletteRange(emphasisPaletteTexture, emphasis, start, count);
              uploadPaletteRange(overrideEmphasisPaletteTexture, overrideEmphasis, start, count);
              performanceMetrics.paletteUploadRangeCount += 1;
              start = current;
            }
            previous = current;
          }
        }
        paletteDirty.emphasis = false;
        emphasisPaletteFullDirty = false;
        pendingEmphasisCountryIds.clear();
        performanceMetrics.paletteRebuildCount += 1;
      }
      return true;
    }

    function updatePalette(domains = null) {
      const nextDomains = domains || { base: true, emphasis: true };
      markPaletteDirty(nextDomains);
      if (nextDomains.base) countryPaletteRevision += 1;
      return flushPaletteUpdates();
    }

    function invalidateCountryPalette(domains = null, reason = 'country-palette') {
      const nextDomains = domains || { base: true, emphasis: true };
      markPaletteDirty(nextDomains);
      if (nextDomains.base) countryPaletteRevision += 1;
      if (rendererMode !== 'pending') invalidateGpuFrame(reason);
      return true;
    }

    function getRenderViewState() {
      if (activeRenderViewState && typeof activeRenderViewState === 'object') return activeRenderViewState;
      const projection = state.projection;
      const active = projection === 'globe' ? globeProjection : flatProjection;
      return {
        revision: currentRenderRevision,
        projection,
        flatProjectionKind: 'equirectangular',
        size: { width: state.size.width, height: state.size.height },
        dpr: resolveRenderPixelRatio(),
        translate: active.translate().map(Number),
        scale: Number(active.scale()),
        rotation: projection === 'globe' ? state.view.globeRotation.map(Number) : null,
        projectionCenter: projection === 'flat' ? state.view.flatCenter.map(Number) : null,
        zoom: Number(projection === 'globe' ? state.view.globeZoom : state.view.flatZoom),
      };
    }

    function setViewUniforms(program, worldOffset = 0, frameContext = activeFrameContext || lastVisualFrame) {
      if (!frameContext) return false;
      return setGpuViewUniforms(gl, {
        frameContext,
        worldOffset,
        getLocation: name => cachedUniformLocation(program, name),
      });
    }

    function resize() {
      if (!canvas) return;
      cssWidth = Math.max(1, state.size.width);
      cssHeight = Math.max(1, state.size.height);
      const dpr = resolveRenderPixelRatio();
      const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
      const backingChanged = pixelWidth !== nextWidth || pixelHeight !== nextHeight;
      if (backingChanged) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        pickFramebuffer = null;
        pickTexture = null;
        pickSceneKey = '';
        sceneColorCache.invalidate('viewport-resize');
      }
      pixelWidth = nextWidth;
      pixelHeight = nextHeight;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      resizePending = false;
    }

    function layoutMismatch() {
      const mapElement = rendererUi.getMapElement();
      if (!canvas || !mapElement?.isConnected || !canvas.isConnected) return 0;
      const mapRect = mapElement.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      lastLayoutMismatchCssPx = Math.max(
        Math.abs(mapRect.left - canvasRect.left),
        Math.abs(mapRect.top - canvasRect.top),
        Math.abs(mapRect.width - canvasRect.width),
        Math.abs(mapRect.height - canvasRect.height),
      );
      return lastLayoutMismatchCssPx;
    }

    function verifyLayout() {
      if (!canvas) return true;
      const mismatch = layoutMismatch();
      if (mismatch <= 0.5) {
        layoutMismatchCount = 0;
        return true;
      }
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      resize();
      if (layoutVerificationFrame) cancelAnimationFrame(layoutVerificationFrame);
      layoutVerificationFrame = requestAnimationFrame(() => {
        layoutVerificationFrame = 0;
        if (layoutMismatch() <= 0.5) {
          layoutMismatchCount = 0;
          renderLatestVisualFrame();
          return;
        }
        layoutMismatchCount += 1;
        if (layoutMismatchCount <= 3) {
          queueMapResize();
          verifyLayout();
        } else {
          console.warn('지도 레이어 크기를 완전히 맞추지 못했습니다.', layoutMismatch());
          layoutMismatchCount = 0;
        }
      });
      return false;
    }

    function bindWebGl1Attributes(program, indexBuffer, resources = null) {
      const coordLocation = cachedAttributeLocation(program, 'aCoord');
      const countryLocation = cachedAttributeLocation(program, 'aCountry');
      gl.bindBuffer(gl.ARRAY_BUFFER, resources?.positionBuffer || positionBuffer);
      if (coordLocation >= 0) {
        gl.enableVertexAttribArray(coordLocation);
        gl.vertexAttribPointer(coordLocation, 2, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, resources?.countryBuffer || countryBuffer);
      if (countryLocation >= 0) {
        gl.enableVertexAttribArray(countryLocation);
        gl.vertexAttribPointer(countryLocation, 1, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      return [coordLocation, countryLocation];
    }

    function drawProgram(program, vao, indexBuffer, indexCount, primitive, resources = null, palette = paletteTexture, lineColor = null, lineWidth = null, drawRanges = null) {
      gl.useProgram(program);
      if (program === fillProgram || program === lineProgram || program === pickProgram) {
        gl.uniform1i(cachedUniformLocation(program, 'uPalette'), 0);
        const paletteWidthLocation = cachedUniformLocation(program, 'uPaletteWidth');
        if (paletteWidthLocation) gl.uniform1f(paletteWidthLocation, Math.max(1, meshCountryIds.length));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, palette);
      }
      if (program === lineProgram) {
        const theme = mapTheme();
        gl.lineWidth(Math.max(1, Number(lineWidth) || Number(theme.borderWidth) || 1));
        const color = lineColor || [theme.borderGpu[0], theme.borderGpu[1], theme.borderGpu[2], theme.borderAlpha];
        gl.uniform4f(cachedUniformLocation(program, 'uBorderColor'), color[0], color[1], color[2], color[3]);
      }
      const webGl1Locations = glVersion === 2 ? null : bindWebGl1Attributes(program, indexBuffer, resources);
      if (glVersion === 2) gl.bindVertexArray(vao);
      const frameContext = activeFrameContext || lastVisualFrame;
      if (!frameContext) return null;
      const ranges = Array.isArray(drawRanges)
        ? drawRanges
        : [{ first: 0, count: indexCount }];
      for (const worldOffset of frameContext.worldOffsets) {
        setViewUniforms(program, worldOffset, frameContext);
        for (const range of ranges) {
          const count = Math.max(0, Number(range?.count || 0));
          if (count) gl.drawElements(primitive, count, gl.UNSIGNED_INT, Math.max(0, Number(range?.first || 0)) * Uint32Array.BYTES_PER_ELEMENT);
        }
      }
      if (glVersion === 2) gl.bindVertexArray(null);
      else {
        for (const location of webGl1Locations) if (location >= 0) gl.disableVertexAttribArray(location);
      }
    }

    function uploadHydroPack(entry) {
      if (!gl || !isWebGlRenderer() || entry.resources) return;
      const meshData = entry.mesh;
      if (!entry.uploadState) {
        entry.uploadState = {
          resources: {
            riverSegmentCount: meshData.riverFeatureIds.length,
            borderRiverSegmentCount: meshData.borderRiverFeatureIds.length,
            lakeIndexCount: meshData.lakeIndices.length,
            lakeBoundarySegmentCount: meshData.lakeBoundaryFeatureIds.length,
          },
          tasks: [
            ['riverStartBuffer', meshData.riverStarts, gl.ARRAY_BUFFER, true], ['riverEndBuffer', meshData.riverEnds, gl.ARRAY_BUFFER, true],
            ['riverFeatureBuffer', meshData.riverFeatureIds, gl.ARRAY_BUFFER, true], ['riverStartWidthBuffer', meshData.riverStartWidths, gl.ARRAY_BUFFER],
            ['riverEndWidthBuffer', meshData.riverEndWidths, gl.ARRAY_BUFFER], ['borderRiverStartBuffer', meshData.borderRiverStarts, gl.ARRAY_BUFFER, true],
            ['borderRiverEndBuffer', meshData.borderRiverEnds, gl.ARRAY_BUFFER, true], ['borderRiverFeatureBuffer', meshData.borderRiverFeatureIds, gl.ARRAY_BUFFER, true],
            ['borderRiverStartWidthBuffer', meshData.borderRiverStartWidths, gl.ARRAY_BUFFER], ['borderRiverEndWidthBuffer', meshData.borderRiverEndWidths, gl.ARRAY_BUFFER],
            ['lakePositionBuffer', meshData.lakePositions, gl.ARRAY_BUFFER, true], ['lakeFeatureBuffer', meshData.lakeFeatureIds, gl.ARRAY_BUFFER, true],
            ['lakeIndexBuffer', meshData.lakeIndices, gl.ELEMENT_ARRAY_BUFFER],
            ['lakeBoundaryStartBuffer', meshData.lakeBoundaryStarts, gl.ARRAY_BUFFER, true], ['lakeBoundaryEndBuffer', meshData.lakeBoundaryEnds, gl.ARRAY_BUFFER, true],
            ['lakeBoundaryFeatureBuffer', meshData.lakeBoundaryFeatureIds, gl.ARRAY_BUFFER, true], ['lakeBoundaryStartWidthBuffer', meshData.lakeBoundaryWidths, gl.ARRAY_BUFFER],
            ['lakeBoundaryEndWidthBuffer', meshData.lakeBoundaryWidths, gl.ARRAY_BUFFER],
          ].map(([key, data, target, webGl1Float]) => ({ key, data, target, webGl1Float, offset: 0, buffer: null })),
        };
      }
      const task = entry.uploadState.tasks[0];
      if (task) {
        const convertToFloat = task.webGl1Float && glVersion === 1 && !(task.data instanceof Float32Array);
        const outputBytes = convertToFloat ? task.data.length * 4 : task.data.byteLength;
        if (!task.buffer) {
          task.buffer = gl.createBuffer();
          gl.bindBuffer(task.target, task.buffer);
          gl.bufferData(task.target, outputBytes, gl.STATIC_DRAW);
          entry.uploadState.resources[task.key] = task.buffer;
        } else {
          gl.bindBuffer(task.target, task.buffer);
        }
        const byteBudget = Math.max(64 * 1024, Number(renderQuality.uploadBudgetBytes) || (interactionActive ? 512 * 1024 : 4 * 1024 * 1024));
        if (convertToFloat) {
          const start = Math.floor(task.offset / 4);
          const count = Math.min(task.data.length - start, Math.floor(byteBudget / 4));
          const chunk = Float32Array.from(task.data.subarray(start, start + count));
          gl.bufferSubData(task.target, task.offset, chunk);
          task.offset += chunk.byteLength;
          performanceMetrics.hydroUploadBytes += chunk.byteLength;
        } else {
          const count = Math.min(outputBytes - task.offset, byteBudget);
          const chunk = new Uint8Array(task.data.buffer, task.data.byteOffset + task.offset, count);
          gl.bufferSubData(task.target, task.offset, chunk);
          task.offset += count;
          performanceMetrics.hydroUploadBytes += count;
        }
        if (task.offset >= outputBytes) entry.uploadState.tasks.shift();
      }
      if (!entry.uploadState.tasks.length) {
        entry.resources = entry.uploadState.resources;
        entry.uploadState = null;
      }
    }

    function deleteHydroPackResources(entry) {
      if (!entry || !gl) return;
      if (entry.uploadState?.resources) {
        for (const buffer of Object.values(entry.uploadState.resources)) {
          if (buffer && gl.isBuffer(buffer)) gl.deleteBuffer(buffer);
        }
      }
      entry.uploadState = null;
      if (!entry.resources) return;
      for (const key of [
        'riverStartBuffer', 'riverEndBuffer', 'riverFeatureBuffer', 'riverStartWidthBuffer', 'riverEndWidthBuffer',
        'borderRiverStartBuffer', 'borderRiverEndBuffer', 'borderRiverFeatureBuffer', 'borderRiverStartWidthBuffer', 'borderRiverEndWidthBuffer',
        'lakePositionBuffer', 'lakeFeatureBuffer', 'lakeIndexBuffer',
        'lakeBoundaryStartBuffer', 'lakeBoundaryEndBuffer', 'lakeBoundaryFeatureBuffer', 'lakeBoundaryStartWidthBuffer', 'lakeBoundaryEndWidthBuffer',
      ]) {
        if (entry.resources[key]) gl.deleteBuffer(entry.resources[key]);
      }
      entry.resources = null;
    }

    function hydroLineParts(geometry) {
      if (geometry?.type === 'LineString') return [geometry.coordinates || []];
      if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
      return [];
    }

    function hydroPolygonParts(geometry) {
      if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
      if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
      return [];
    }

    function buildHydroEditMesh(features, firstFid) {
      const riverStarts = [], riverEnds = [], riverFeatureIds = [], riverStartWidths = [], riverEndWidths = [];
      const borderRiverStarts = [], borderRiverEnds = [], borderRiverFeatureIds = [], borderRiverStartWidths = [], borderRiverEndWidths = [];
      const lakePositions = [], lakeFeatureIds = [], lakeIndices = [];
      const lakeBoundaryStarts = [], lakeBoundaryEnds = [], lakeBoundaryFeatureIds = [], lakeBoundaryWidths = [];
      for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
        const feature = features[featureIndex];
        const fid = firstFid + featureIndex;
        hydroEditFeatureByFid.set(fid, feature);
        if (feature.properties?.category !== 'lake') {
          const aligned = feature.properties?.border_aligned === true;
          const starts = aligned ? borderRiverStarts : riverStarts;
          const ends = aligned ? borderRiverEnds : riverEnds;
          const ids = aligned ? borderRiverFeatureIds : riverFeatureIds;
          const startWidths = aligned ? borderRiverStartWidths : riverStartWidths;
          const endWidths = aligned ? borderRiverEndWidths : riverEndWidths;
          for (const part of hydroLineParts(feature.geometry)) for (let index = 0; index < part.length - 1; index += 1) {
            starts.push(Math.round(part[index][0] * 1e6), Math.round(part[index][1] * 1e6));
            ends.push(Math.round(part[index + 1][0] * 1e6), Math.round(part[index + 1][1] * 1e6));
            ids.push(fid);
            const width = Number(feature.properties?.stroke_width || 1);
            startWidths.push(width); endWidths.push(width);
          }
          continue;
        }
        for (const polygon of hydroPolygonParts(feature.geometry)) {
          const vertices = [], holes = [];
          for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
            const sourceRing = polygon[ringIndex] || [];
            const last = sourceRing[sourceRing.length - 1];
            const ring = sourceRing.length > 1 && sourceRing[0][0] === last?.[0] && sourceRing[0][1] === last?.[1]
              ? sourceRing.slice(0, -1) : sourceRing;
            if (ring.length < 3) continue;
            if (ringIndex) holes.push(vertices.length / 2);
            for (const point of ring) vertices.push(point[0], point[1]);
          }
          if (vertices.length < 6) continue;
          const base = lakePositions.length / 2;
          const triangles = globalThis.earcut?.(vertices, holes, 2) || [];
          for (let index = 0; index < vertices.length; index += 2) {
            lakePositions.push(Math.round(vertices[index] * 1e6), Math.round(vertices[index + 1] * 1e6));
            lakeFeatureIds.push(fid);
          }
          for (const triangle of triangles) lakeIndices.push(base + triangle);
        }
        const outline = countryOutlineFeature(feature);
        for (const line of outline?.geometry?.coordinates || []) for (let index = 0; index < line.length - 1; index += 1) {
          const start = line[index], end = line[index + 1];
          lakeBoundaryStarts.push(Math.round(start[0] * 1e6), Math.round(start[1] * 1e6));
          lakeBoundaryEnds.push(Math.round(end[0] * 1e6), Math.round(end[1] * 1e6));
          lakeBoundaryFeatureIds.push(fid); lakeBoundaryWidths.push(1);
        }
      }
      return {
        riverStarts: new Int32Array(riverStarts), riverEnds: new Int32Array(riverEnds), riverFeatureIds: new Uint32Array(riverFeatureIds),
        riverStartWidths: new Float32Array(riverStartWidths), riverEndWidths: new Float32Array(riverEndWidths),
        borderRiverStarts: new Int32Array(borderRiverStarts), borderRiverEnds: new Int32Array(borderRiverEnds), borderRiverFeatureIds: new Uint32Array(borderRiverFeatureIds),
        borderRiverStartWidths: new Float32Array(borderRiverStartWidths), borderRiverEndWidths: new Float32Array(borderRiverEndWidths),
        lakePositions: new Int32Array(lakePositions), lakeFeatureIds: new Uint32Array(lakeFeatureIds), lakeIndices: new Uint32Array(lakeIndices),
        lakeBoundaryStarts: new Int32Array(lakeBoundaryStarts), lakeBoundaryEnds: new Int32Array(lakeBoundaryEnds),
        lakeBoundaryFeatureIds: new Uint32Array(lakeBoundaryFeatureIds), lakeBoundaryWidths: new Float32Array(lakeBoundaryWidths),
      };
    }

    function setHydroEdits(features = [], revision = 0) {
      const nextRevision = Number(revision || 0);
      if (nextRevision === hydroEditRevision) return false;
      for (const entry of hydroEditEntries) deleteHydroPackResources(entry);
      hydroEditEntries = [];
      hydroEditFeatureByFid.clear();
      const baseFid = Math.max(0, Number(hydroManifest?.stats?.featureCount || 0));
      let nextFid = baseFid;
      const groups = new Map();
      for (const feature of features || []) {
        if (!feature?.geometry) continue;
        const category = feature.properties?.category === 'lake' ? 'lake' : 'river';
        const color = String(feature.properties?.editorColor || hydroDisplayColor(category));
        const key = `${category}:${color}`;
        if (!groups.has(key)) groups.set(key, { category, color, features: [] });
        groups.get(key).features.push(feature);
      }
      for (const group of groups.values()) {
        const meshData = buildHydroEditMesh(group.features, nextFid);
        const entry = { id: `edit:${group.category}:${group.color}`, mesh: meshData, color: group.color, resources: null, uploadQueued: false, lastUsed: performance.now() };
        entry.byteLength = Object.values(meshData).reduce((sum, value) => sum + value.byteLength, 0);
        hydroEditEntries.push(entry);
        nextFid += group.features.length;
        if (isWebGlRenderer()) scheduleHydroUpload(entry);
      }
      hydroEditRevision = nextRevision;
      hydroVisibilityDirty = true;
      if (rendererMode === 'canvas-worker' && canvasWorker) postCanvasWorkerMessage({ type: 'hydro-edits', revision: hydroEditRevision, features: features || [] });
      invalidatePhysicalScene('hydro-edit-data');
      return true;
    }

    function updateHydroVisibility() {
      if (!gl || !hydroVisibilityTexture || !hydroVisibilityDirty) return;
      const count = Math.max(1, Number(hydroManifest?.stats?.featureCount || 0) + hydroEditFeatureByFid.size);
      hydroVisibilityWidth = Math.min(4096, Math.max(1, count));
      hydroVisibilityHeight = Math.ceil(count / hydroVisibilityWidth);
      const pixels = new Uint8Array(hydroVisibilityWidth * hydroVisibilityHeight * 4);
      for (const [fidValue, feature] of state.hydroFeatureByFid?.entries?.() || []) {
        const fid = Number(fidValue);
        if (!Number.isInteger(fid) || fid < 0 || fid >= count || !isHydroFeatureVisible(feature)) continue;
        const offset = fid * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = pixels[offset + 3] = 255;
      }
      for (const [fid, feature] of hydroEditFeatureByFid) {
        if (!isHydroFeatureVisible(feature)) continue;
        const offset = fid * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = pixels[offset + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, hydroVisibilityTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, hydroVisibilityWidth, hydroVisibilityHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      hydroVisibilityDirty = false;
    }

    function bindLakeAttributes(program, resources) {
      const coordLocation = glVersion === 2 ? 0 : cachedAttributeLocation(program, 'aCoord');
      const featureLocation = glVersion === 2 ? 1 : cachedAttributeLocation(program, 'aCountry');
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.lakePositionBuffer);
      gl.enableVertexAttribArray(coordLocation);
      if (glVersion === 2) gl.vertexAttribIPointer(coordLocation, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(coordLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.lakeFeatureBuffer);
      gl.enableVertexAttribArray(featureLocation);
      if (glVersion === 2) gl.vertexAttribIPointer(featureLocation, 1, gl.UNSIGNED_INT, 0, 0);
      else gl.vertexAttribPointer(featureLocation, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.lakeIndexBuffer);
      return [coordLocation, featureLocation];
    }

    function setHydroUniforms(program, color) {
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, hydroVisibilityTexture);
      gl.uniform1i(cachedUniformLocation(program, 'uHydroVisibility'), 2);
      const sizeLocation = cachedUniformLocation(program, 'uHydroVisibilitySize');
      if (glVersion === 2) gl.uniform2i(sizeLocation, hydroVisibilityWidth, hydroVisibilityHeight);
      else gl.uniform2f(sizeLocation, hydroVisibilityWidth, hydroVisibilityHeight);
      const colorLocation = cachedUniformLocation(program, 'uHydroColor');
      if (colorLocation && color) gl.uniform4fv(colorLocation, color);
    }

    function setInstanceDivisor(location, divisor) {
      if (glVersion === 2) gl.vertexAttribDivisor(location, divisor);
      else instancedExtension.vertexAttribDivisorANGLE(location, divisor);
    }

    function bindRiverAttributes(program, resources, category = 'river') {
      const locations = glVersion === 2 ? [0, 1, 2, 3, 4, 5] : [
        cachedAttributeLocation(program, 'aCorner'), cachedAttributeLocation(program, 'aStart'),
        cachedAttributeLocation(program, 'aEnd'), cachedAttributeLocation(program, 'aCountry'),
        cachedAttributeLocation(program, 'aStartWidth'), cachedAttributeLocation(program, 'aEndWidth'),
      ];
      const [corner, start, end, feature, startWidth, endWidth] = locations;
      const prefix = category === 'lake-boundary' ? 'lakeBoundary' : category === 'border-river' ? 'borderRiver' : 'river';
      gl.bindBuffer(gl.ARRAY_BUFFER, hydroCornerBuffer);
      gl.enableVertexAttribArray(corner);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}StartBuffer`]);
      gl.enableVertexAttribArray(start);
      if (glVersion === 2) gl.vertexAttribIPointer(start, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(start, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}EndBuffer`]);
      gl.enableVertexAttribArray(end);
      if (glVersion === 2) gl.vertexAttribIPointer(end, 2, gl.INT, 0, 0);
      else gl.vertexAttribPointer(end, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}FeatureBuffer`]);
      gl.enableVertexAttribArray(feature);
      if (glVersion === 2) gl.vertexAttribIPointer(feature, 1, gl.UNSIGNED_INT, 0, 0);
      else gl.vertexAttribPointer(feature, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}StartWidthBuffer`]);
      gl.enableVertexAttribArray(startWidth);
      gl.vertexAttribPointer(startWidth, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources[`${prefix}EndWidthBuffer`]);
      gl.enableVertexAttribArray(endWidth);
      gl.vertexAttribPointer(endWidth, 1, gl.FLOAT, false, 0, 0);
      setInstanceDivisor(corner, 0);
      for (const location of [start, end, feature, startWidth, endWidth]) setInstanceDivisor(location, 1);
      return locations;
    }

    function drawHydroEntry(program, entry, category, color = null, picking = false) {
      const resources = entry.resources;
      if (!resources) return;
      const borderAligned = category === 'border-river';
      const count = category === 'lake'
        ? resources.lakeIndexCount
        : category === 'lake-boundary'
          ? resources.lakeBoundarySegmentCount
          : (borderAligned ? resources.borderRiverSegmentCount : resources.riverSegmentCount);
      if (!count) return;
      setHydroUniforms(program, color);
      const locations = category === 'lake' ? bindLakeAttributes(program, resources) : bindRiverAttributes(program, resources, category);
      const widthBoostLocation = cachedUniformLocation(program, 'uWidthBoost');
      if (widthBoostLocation) gl.uniform1f(widthBoostLocation, picking ? 6 : 0);
      const widthScaleLocation = cachedUniformLocation(program, 'uWidthScale');
      if (widthScaleLocation) {
        const theme = mapTheme();
        const width = category === 'lake-boundary' ? theme.lakeBoundaryWidth : theme.riverWidth;
        gl.uniform1f(widthScaleLocation, Math.max(0.5, Number(width) || 1));
      }
      const frameContext = activeFrameContext || lastVisualFrame;
      if (!frameContext) return false;
      for (const offset of frameContext.worldOffsets) {
        setViewUniforms(program, offset, frameContext);
        if (category === 'lake') gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
        else if (glVersion === 2) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        else instancedExtension.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);
      }
      if (category !== 'lake') for (const location of locations.slice(1)) setInstanceDivisor(location, 0);
      for (const location of locations) gl.disableVertexAttribArray(location);
      entry.lastUsed = performance.now();
    }

    function scheduleHydroUpload(entry) {
      if (!entry || entry.resources || entry.uploadQueued) return;
      entry.uploadQueued = true;
      hydroUploadQueue.push(entry);
      if (hydroUploadFrame) return;
      const drain = () => {
        hydroUploadFrame = 0;
        const next = hydroUploadQueue.shift();
        if (next) {
          next.uploadQueued = false;
          uploadHydroPack(next);
          if (next.resources) queueHydroRender('hydro-upload-ready');
          else scheduleHydroUpload(next);
        }
        if (hydroUploadQueue.length) {
          hydroUploadFrame = requestAnimationFrame(drain);
        }
      };
      hydroUploadFrame = requestAnimationFrame(drain);
    }

    function drawHydro(category, picking = false) {
      if ((!hydroManifest || !hydroActivePackIds.size) && !hydroEditEntries.length) return;
      const theme = mapTheme();
      const isLake = category === 'lake' || category === 'lake-boundary';
      if (state.layerVisibility[isLake ? 'lakes' : 'rivers'] === false) return;
      const hydroOpacity = Number.isFinite(Number(isLake ? theme.lakeOpacity : theme.riverOpacity))
        ? Math.max(0, Math.min(1, Number(isLake ? theme.lakeOpacity : theme.riverOpacity)))
        : 1;
      if (hydroOpacity <= 0 || (category === 'lake-boundary' && theme.lakeBoundaryVisible === false)) return;
      updateHydroVisibility();
      const program = category === 'river' || category === 'border-river' || category === 'lake-boundary'
        ? (picking ? hydroLinePickProgram : hydroLineProgram)
        : (picking ? hydroPickProgram : hydroFillProgram);
      const rgb = hydroDisplayColor(isLake ? 'lake' : 'river', true);
      const color = [...rgb, hydroOpacity];
      for (const packId of hydroActivePackIds) {
        const entry = hydroPacks.get(packId);
        if (entry) drawHydroEntry(program, entry, category, color, picking);
      }
      for (const entry of picking ? [] : hydroEditEntries) {
        const editRgb = parseColor(entry.color).map(value => value / 255);
        drawHydroEntry(program, entry, category, [...editRgb, hydroOpacity], picking);
      }
    }

    function requestHydroView(viewState = getRenderViewState()) {
      if (!hydroWorker || !hydroWorkerReady || !hydroManifest) return;
      const threshold = hydroVisibilityThreshold();
      const projection = viewState?.projection || state.projection;
      const activeProjectionState = projection === 'globe' ? globeProjection : flatProjection;
      const tileWindow = createHydroTileWindow({
        manifest: hydroManifest,
        projection,
        threshold,
        width: Number(viewState?.size?.width || state.size.width),
        height: Number(viewState?.size?.height || state.size.height),
        scale: Number(viewState?.scale || activeProjectionState.scale()),
        flatCenter: viewState?.projectionCenter || viewState?.flatCenter || state.view.flatCenter,
        rotation: viewState?.rotation || state.view.globeRotation,
      });
      if (hydroVisibleTileCache.signature !== tileWindow.signature) {
        const tiles = hydroTileSpecsForWindow(tileWindow);
        hydroVisibleTileCache = {
          signature: tileWindow.signature,
          tiles,
          key: tiles.map(spec => `${spec.stage}/${spec.x}-${spec.y}`).join('|'),
          window: tileWindow,
        };
        performanceMetrics.hydroTileWindowRecomputeCount += 1;
      } else {
        performanceMetrics.hydroTileWindowCacheHitCount += 1;
      }
      const { tiles, key } = hydroVisibleTileCache;
      if (key === hydroViewLoadedKey || key === hydroViewRequestedKey) return;
      if (key !== hydroViewRetryKey) {
        hydroViewRetryKey = key;
        hydroViewRetryAttempts = 0;
      }
      hydroViewRequestedKey = key;
      hydroViewRequestedRevision = ++hydroRequestRevision;
      state.physicalLoadState.hydroView = 'loading';
      performanceMetrics.hydroViewRequestCount += 1;
      hydroWorker.postMessage({
        type: 'view',
        revision: hydroViewRequestedRevision,
        tiles,
        mobile: isMobile(),
      });
    }

    let hydroRenderFrame = 0;
    function queueHydroRender(reason = 'hydro-ready') {
      if (hydroRenderFrame) return;
      hydroRenderFrame = requestAnimationFrame(() => {
        hydroRenderFrame = 0;
        invalidatePhysicalScene(reason);
      });
    }

    function registerHydroDescriptors(descriptors) {
      const logicalIds = new Set();
      for (const row of descriptors || []) {
        const logicalId = String(row.awId || row.logicalFid);
        let aggregate = state.hydroFeatureCache.get(logicalId);
        if (!aggregate) {
          aggregate = {
            type: 'Feature', id: logicalId, geometry: null,
            properties: {
              pandolab_id: logicalId, __logicalFid: Number(row.logicalFid),
              category: row.category, layer_id: row.layerId,
              name: row.name || '', name_ko: row.name || '', source: row.source || '',
              system_id: row.systemId || '', mainstem_name_ko: row.mainstemNameKo || row.name || '', role: row.role || '',
              source_id: row.sourceId || '', fragment_count: Number(row.fragmentCount || 1),
              min_zoom: Number(row.minZoom ?? 99), stroke_width: Number(row.width || 1), pack_ids: [],
            },
            __awBounds: [Infinity, Infinity, -Infinity, -Infinity],
          };
        }
        aggregate.properties.pack_ids = [...new Set([...(aggregate.properties.pack_ids || []), Number(row.packId)])];
        aggregate.properties.min_zoom = Math.min(Number(aggregate.properties.min_zoom ?? 99), Number(row.minZoom ?? 99));
        const bounds = (row.bounds || []).map(value => Number(value) / 1e6);
        if (bounds.length === 4) {
          aggregate.__awBounds = [
            Math.min(aggregate.__awBounds[0], bounds[0]), Math.min(aggregate.__awBounds[1], bounds[1]),
            Math.max(aggregate.__awBounds[2], bounds[2]), Math.max(aggregate.__awBounds[3], bounds[3]),
          ];
        }
        const b = aggregate.__awBounds;
        aggregate.__awCentroid = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        aggregate.__awRadius = Math.min(180, Math.hypot(b[2] - b[0], b[3] - b[1]) / 2);
        state.hydroFeatureCache.set(logicalId, aggregate);
        state.hydroFeatureByFid.set(Number(row.fid), aggregate);
        logicalIds.add(logicalId);
      }
      if (logicalIds.size) hydroVisibilityDirty = true;
    }

    function aggregateHydroLogicalFeature(logicalId) {
      const fragments = state.hydroFragmentsByLogicalId.get(logicalId);
      if (!fragments?.size) {
        state.hydroFragmentsByLogicalId.delete(logicalId);
        state.hydroFeatureCache.delete(logicalId);
        return null;
      }
      const ordered = [...fragments.values()].sort((left, right) => (
        Number(left.properties?.fragment_index || 0) - Number(right.properties?.fragment_index || 0)
      ));
      const first = ordered[0];
      let aggregate = first;
      if (first.properties?.category === 'river') {
        const parts = ordered.flatMap(feature => feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry?.coordinates || []);
        const widths = ordered.flatMap(feature => feature.properties?.stroke_widths || []);
        const sourceIds = [...new Set(ordered.flatMap(feature => String(feature.properties?.source_id || '').split(',').filter(Boolean)))];
        aggregate = {
          type: 'Feature', id: logicalId,
          properties: {
            ...first.properties,
            source_id: sourceIds.join(','),
            stroke_widths: widths,
            pack_ids: [...new Set(ordered.map(feature => Number(feature.properties?.pack_id)))],
            fragment_count: Math.max(...ordered.map(feature => Number(feature.properties?.fragment_count || 1))),
            loaded_fragment_count: ordered.length,
            min_zoom: Math.min(...ordered.map(feature => Number(feature.properties?.min_zoom ?? 99))),
          },
          geometry: parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts },
        };
      }
      prepareHydroFeature(aggregate);
      state.hydroFeatureCache.set(logicalId, aggregate);
      for (const fragment of ordered) state.hydroFeatureByFid.set(Number(fragment.properties?.__fid), aggregate);
      const sourceIds = new Set(String(aggregate.properties?.source_id || '').split(',').filter(Boolean));
      const legacyHidden = Object.keys(state.physicalSettings.hiddenHydroIds || {}).find(id => (
        state.physicalSettings.hiddenHydroIds[id] === true && id !== logicalId && sourceIds.has(String(id).split(':').pop())
      ));
      if (legacyHidden) state.physicalSettings.hiddenHydroIds[logicalId] = true;
      return aggregate;
    }

    function registerHydroFragments(features) {
      const logicalIds = new Set();
      for (const fragment of features) {
        const logicalId = String(fragment.properties?.pandolab_id || fragment.id);
        if (!state.hydroFragmentsByLogicalId.has(logicalId)) state.hydroFragmentsByLogicalId.set(logicalId, new Map());
        state.hydroFragmentsByLogicalId.get(logicalId).set(Number(fragment.properties?.__fid), fragment);
        logicalIds.add(logicalId);
      }
      for (const logicalId of logicalIds) aggregateHydroLogicalFeature(logicalId);
      if (logicalIds.size) hydroVisibilityDirty = true;
    }

    function unregisterHydroFragments(features) {
      const logicalIds = new Set();
      for (const fragment of features || []) {
        const logicalId = String(fragment.properties?.pandolab_id || fragment.id);
        state.hydroFragmentsByLogicalId.get(logicalId)?.delete(Number(fragment.properties?.__fid));
        state.hydroFeatureByFid.delete(Number(fragment.properties?.__fid));
        logicalIds.add(logicalId);
      }
      for (const logicalId of logicalIds) aggregateHydroLogicalFeature(logicalId);
      if (logicalIds.size) hydroVisibilityDirty = true;
    }

    function loadHydroLogicalFeature(logicalFid) {
      if (!hydroWorker || !hydroWorkerReady) return Promise.reject(new Error('강·호수 로더가 준비되지 않았습니다.'));
      const requestId = ++hydroFeatureRequestId;
      return new Promise((resolve, reject) => {
        hydroFeatureRequests.set(requestId, { resolve, reject });
        hydroWorker.postMessage({ type: 'load-feature', requestId, logicalFid });
      });
    }

    function queryHydroLogicalFeatures(bounds, { category = 'river' } = {}) {
      if (!hydroWorker || !hydroWorkerReady) return Promise.reject(new Error('강·호수 로더가 준비되지 않았습니다.'));
      const requestId = ++hydroFeatureRequestId;
      return new Promise((resolve, reject) => {
        hydroLogicalQueryRequests.set(requestId, { resolve, reject });
        hydroWorker.postMessage({ type: 'query-logical-features', requestId, bounds, category });
      });
    }

    function retryHydroCache() {
      hydroWorker?.postMessage({ type: 'retry-cache' });
    }

    function receiveHydroWorkerMessage(event) {
      const message = event.data || {};
      if (message.type === 'ready') {
        hydroWorkerReady = true;
        hydroViewRequestedKey = '';
        hydroViewLoadedKey = '';
        hydroViewRetryAttempts = 0;
        state.physicalLoadState.hydroWorker = 'ready';
        if (hydroWorkerReadyTimer) clearTimeout(hydroWorkerReadyTimer);
        hydroWorkerReadyTimer = 0;
        hydroWorkerReadyResolve?.(true);
        hydroWorkerReadyResolve = null;
        requestHydroView();
        return;
      }
      if (message.type === 'init-error') {
        hydroWorkerReady = false;
        state.physicalLoadState.hydroWorker = 'error';
        if (hydroWorkerReadyTimer) clearTimeout(hydroWorkerReadyTimer);
        hydroWorkerReadyTimer = 0;
        hydroWorkerReadyResolve?.(false);
        hydroWorkerReadyResolve = null;
        hydroWorker?.terminate();
        hydroWorker = null;
        console.warn('Hydro worker initialization failed', message.message);
        return;
      }
      if (message.type === 'view-ready') {
        const revision = Number(message.revision || 0);
        if (revision < hydroViewRequestedRevision) return;
        hydroViewLoadedKey = hydroViewRequestedKey;
        hydroViewRequestedKey = '';
        hydroViewRetryAttempts = 0;
        hydroViewRetryKey = '';
        state.physicalLoadState.hydroView = 'ready';
        if (hydroViewRetryTimer) clearTimeout(hydroViewRetryTimer);
        hydroViewRetryTimer = 0;
        return;
      }
      if (message.type === 'view-error') {
        const revision = Number(message.revision || 0);
        if (revision < hydroViewRequestedRevision) return;
        const failedKey = hydroViewRequestedKey || hydroViewRetryKey;
        hydroViewRequestedKey = '';
        if (failedKey !== hydroViewRetryKey) {
          hydroViewRetryKey = failedKey;
          hydroViewRetryAttempts = 0;
        }
        hydroViewRetryAttempts += 1;
        if (message.retryable !== false && hydroViewRetryAttempts <= 3) {
          state.physicalLoadState.hydroView = 'retrying';
          const delay = Math.min(2400, 400 * (2 ** (hydroViewRetryAttempts - 1)));
          if (hydroViewRetryTimer) clearTimeout(hydroViewRetryTimer);
          hydroViewRetryTimer = setTimeout(() => {
            hydroViewRetryTimer = 0;
            requestHydroView();
          }, delay);
        } else {
          state.physicalLoadState.hydroView = 'error';
          reportOperationError(
            new Error(message.message || ''),
            '현재 화면의 강·호수 데이터를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 이동하거나 시도하세요.',
            'PL-WATER-003',
            4200,
          );
        }
        return;
      }
      if (message.type === 'active') {
        if (Number(message.revision || 0) < hydroAcceptedRevision) return;
        hydroAcceptedRevision = Number(message.revision || hydroAcceptedRevision);
        hydroActivePackIds = new Set(message.packIds || []);
        pruneHydroCache();
        queueHydroRender();
        return;
      }
      if (message.type === 'pack') {
        if (Number(message.revision || 0) < hydroAcceptedRevision) return;
        const meshData = message.mesh || {};
        const features = message.features || [];
        const descriptors = message.descriptors || [];
        const entry = {
          id: Number(message.packId), features, descriptors, resources: null, uploadQueued: false, lastUsed: performance.now(),
          mesh: {
            riverStarts: new Int32Array(meshData.riverStarts || 0),
            riverEnds: new Int32Array(meshData.riverEnds || 0),
            riverFeatureIds: new Uint32Array(meshData.riverFeatureIds || 0),
            riverStartWidths: new Float32Array(meshData.riverStartWidths || 0),
            riverEndWidths: new Float32Array(meshData.riverEndWidths || 0),
            borderRiverStarts: new Int32Array(meshData.borderRiverStarts || 0),
            borderRiverEnds: new Int32Array(meshData.borderRiverEnds || 0),
            borderRiverFeatureIds: new Uint32Array(meshData.borderRiverFeatureIds || 0),
            borderRiverStartWidths: new Float32Array(meshData.borderRiverStartWidths || 0),
            borderRiverEndWidths: new Float32Array(meshData.borderRiverEndWidths || 0),
            lakePositions: new Int32Array(meshData.lakePositions || 0),
            lakeFeatureIds: new Uint32Array(meshData.lakeFeatureIds || 0),
            lakeIndices: new Uint32Array(meshData.lakeIndices || 0),
            lakeBoundaryStarts: new Int32Array(meshData.lakeBoundaryStarts || 0),
            lakeBoundaryEnds: new Int32Array(meshData.lakeBoundaryEnds || 0),
            lakeBoundaryFeatureIds: new Uint32Array(meshData.lakeBoundaryFeatureIds || 0),
            lakeBoundaryWidths: new Float32Array(meshData.lakeBoundaryWidths || 0),
          },
        };
        entry.byteLength = Object.values(entry.mesh).reduce((sum, value) => sum + value.byteLength, 0);
        hydroPacks.set(entry.id, entry);
        if (features.length) registerHydroFragments(features);
        else registerHydroDescriptors(descriptors);
        if (isWebGlRenderer()) scheduleHydroUpload(entry);
        pruneHydroCache();
        return;
      }
      if (message.type === 'feature' || message.type === 'feature-error') {
        const pending = hydroFeatureRequests.get(Number(message.requestId));
        if (!pending) return;
        hydroFeatureRequests.delete(Number(message.requestId));
        if (message.type === 'feature-error') pending.reject(new Error(message.message || '강·호수 전체 형상을 불러오지 못했습니다.'));
        else pending.resolve(message.feature ? prepareHydroFeature(message.feature) : null);
        return;
      }
      if (message.type === 'logical-features' || message.type === 'logical-features-error') {
        const pending = hydroLogicalQueryRequests.get(Number(message.requestId));
        if (!pending) return;
        hydroLogicalQueryRequests.delete(Number(message.requestId));
        if (message.type === 'logical-features-error') pending.reject(new Error(message.message || '수계 후보를 찾지 못했습니다.'));
        else pending.resolve((message.logicalFids || []).map(Number).filter(Number.isFinite));
        return;
      }
      if (message.type === 'cache-progress') {
        state.physicalLoadState.hydroCache = 'loading';
        state.physicalLoadState.hydroCachePercent = Number(message.percent || 0);
        return;
      }
      if (message.type === 'cache-complete') {
        state.physicalLoadState.hydroCache = 'ready';
        state.physicalLoadState.hydroCachePercent = 100;
        if (!hydroCacheCompletionNotified) {
          hydroCacheCompletionNotified = true;
          setActionStatus('전 세계 강·호수 데이터를 오프라인 저장소에 준비했습니다.', 'success', 3200);
        }
        return;
      }
      if (message.type === 'cache-unavailable') {
        state.physicalLoadState.hydroCache = 'unavailable';
        console.warn('Hydro persistent cache unavailable', message.message);
        return;
      }
      if (message.type === 'error') {
        console.warn('Hydro tile worker failed', message.message);
        if (!hydroWorkerReady) {
          state.physicalLoadState.hydroWorker = 'error';
          if (hydroWorkerReadyTimer) clearTimeout(hydroWorkerReadyTimer);
          hydroWorkerReadyTimer = 0;
          hydroWorkerReadyResolve?.(false);
          hydroWorkerReadyResolve = null;
          hydroWorker?.terminate();
          hydroWorker = null;
        } else {
          reportOperationError(new Error(message.message || ''), '강·호수 처리 중 오류가 발생했습니다. 현재 지도는 계속 사용할 수 있습니다.', 'PL-WATER-003', 4200);
        }
      }
    }

    function pruneHydroCache() {
      const limit = Math.max(8 * 1024 * 1024, Number(renderQuality.hydroCacheBudgetBytes) || (isMobile() ? 48 : 96) * 1024 * 1024);
      let total = [...hydroPacks.values()].reduce((sum, entry) => sum + entry.byteLength, 0);
      if (total <= limit) return;
      const selectedFeature = state.selected?.type === 'hydro' ? hydroFeatureById(state.selected.id) : null;
      const selectedPacks = new Set(selectedFeature?.properties?.pack_ids || [selectedFeature?.properties?.pack_id].filter(Number.isFinite));
      const candidates = [...hydroPacks.values()]
        .filter(entry => !hydroActivePackIds.has(entry.id) && !selectedPacks.has(entry.id))
        .sort((left, right) => left.lastUsed - right.lastUsed);
      const released = [];
      for (const entry of candidates) {
        if (total <= limit) break;
        deleteHydroPackResources(entry);
        hydroPacks.delete(entry.id);
        unregisterHydroFragments(entry.features);
        total -= entry.byteLength;
        released.push(entry.id);
      }
      if (released.length) hydroWorker?.postMessage({ type: 'release', packIds: released });
    }

    function setHydroManifest(nextManifest, sourceUrl) {
      const normalizedManifest = nextManifest?.stages?.length ? nextManifest : null;
      const normalizedUrl = sourceUrl ? new URL(sourceUrl) : null;
      const wantedIncludeGeometry = rendererMode === 'canvas2d';
      const sameManifest = hydroManifest === normalizedManifest
        && String(hydroManifestUrl || '') === String(normalizedUrl || '');

      if (sameManifest && hydroWorker && hydroWorkerIncludesGeometry === wantedIncludeGeometry) {
        connectHydroCanvasWorkers();
        return hydroWorkerReady ? Promise.resolve(true) : hydroWorkerReadyPromise;
      }

      hydroManifest = normalizedManifest;
      hydroManifestUrl = normalizedUrl;
      hydroWorkerGeneration += 1;
      const generation = hydroWorkerGeneration;
      hydroWorker?.terminate();
      hydroWorker = null;
      hydroWorkerReady = false;
      hydroWorkerIncludesGeometry = wantedIncludeGeometry;
      hydroViewRequestedKey = '';
      hydroViewLoadedKey = '';
      hydroViewRequestedRevision = 0;
      hydroViewRetryAttempts = 0;
      hydroViewRetryKey = '';
      hydroVisibleTileCache = { signature: '', tiles: [], key: '', window: null };
      if (hydroViewRetryTimer) clearTimeout(hydroViewRetryTimer);
      hydroViewRetryTimer = 0;
      hydroAcceptedRevision = 0;
      hydroActivePackIds.clear();
      hydroUploadQueue.length = 0;
      if (hydroUploadFrame) cancelAnimationFrame(hydroUploadFrame);
      hydroUploadFrame = 0;
      hydroVisibilityDirty = true;
      invalidatePhysicalScene('hydro-manifest');
      for (const entry of hydroPacks.values()) deleteHydroPackResources(entry);
      hydroPacks.clear();
      for (const entry of hydroEditEntries) deleteHydroPackResources(entry);
      hydroEditEntries = [];
      hydroEditFeatureByFid.clear();
      hydroEditRevision = -1;
      setHydroEdits(state.hydroEdits || [], Number(state.stateRevision || 0));
      for (const pending of hydroFeatureRequests.values()) pending.reject(new Error('강·호수 로더가 다시 시작되었습니다.'));
      hydroFeatureRequests.clear();
      for (const pending of hydroLogicalQueryRequests.values()) pending.reject(new Error('강·호수 로더가 다시 시작되었습니다.'));
      hydroLogicalQueryRequests.clear();
      state.hydroFragmentsByLogicalId = new Map();

      if (hydroWorkerReadyTimer) clearTimeout(hydroWorkerReadyTimer);
      hydroWorkerReadyTimer = 0;
      hydroWorkerReadyResolve?.(false);
      hydroWorkerReadyResolve = null;

      if (!hydroManifest || !hydroManifestUrl || typeof Worker !== 'function') {
        hydroWorkerReadyPromise = Promise.resolve(false);
        return hydroWorkerReadyPromise;
      }

      state.physicalLoadState.hydroWorker = 'starting';
      hydroWorkerReadyPromise = new Promise(resolve => { hydroWorkerReadyResolve = resolve; });
      hydroWorker = new Worker(runtimeAssetUrl('workers/hydro-tile-worker.js'), { name: 'pandolab-hydro-tiles' });
      hydroWorker.onmessage = event => {
        if (generation !== hydroWorkerGeneration) return;
        receiveHydroWorkerMessage(event);
      };
      hydroWorker.onerror = event => {
        if (generation !== hydroWorkerGeneration) return;
        receiveHydroWorkerMessage({ data: { type: 'error', message: event.message || '강·호수 Worker 실행 오류' } });
      };
      const hydroRevision = `${DATA_REVISION || ASSET_REVISION}-${String(hydroManifest.index?.sha256 || '').slice(0, 12)}`;
      hydroWorker.postMessage({
        type: 'init',
        manifest: hydroManifest,
        baseUrl: new URL('./', hydroManifestUrl).href,
        assetRevision: hydroRevision,
        dataRevision: DATA_REVISION || hydroRevision,
        includeGeometry: wantedIncludeGeometry,
      });
      hydroWorkerReadyTimer = setTimeout(() => {
        if (generation !== hydroWorkerGeneration || hydroWorkerReady) return;
        state.physicalLoadState.hydroWorker = 'error';
        hydroWorker?.terminate();
        hydroWorker = null;
        hydroWorkerGeneration += 1;
        hydroWorkerReadyResolve?.(false);
        hydroWorkerReadyResolve = null;
      }, 30000);
      connectHydroCanvasWorkers();
      return hydroWorkerReadyPromise;
    }

    function setHydroInteractionActive(active) {
      interactionActive = active === true;
      hydroWorker?.postMessage({ type: 'interaction', active: interactionActive });
      if (!interactionActive) {
        if (terrainUploadQueue.length) scheduleTerrainUpload();
      }
    }

    function setRenderQuality(nextProfile = {}) {
      const previousRevision = Number(renderQuality.revision || 0);
      const previousTier = renderQuality.tier;
      const previousDprCap = Number(renderQuality.dprCap || Infinity);
      renderQuality = Object.freeze({ ...DEFAULT_RENDER_QUALITY, ...nextProfile });
      if (previousRevision !== Number(renderQuality.revision || 0) || previousTier !== renderQuality.tier) {
        renderQualityChangeCount += 1;
      }
      const overlayBudget = Math.max(8 * 1024 * 1024, Number(renderQuality.overlayGpuBudgetBytes) || DEFAULT_RENDER_QUALITY.overlayGpuBudgetBytes);
      polygonOverlayPass.setByteBudget(Math.floor(overlayBudget * 0.62));
      strokeRenderer.setByteBudget(Math.floor(overlayBudget * 0.38));
      if (previousDprCap !== Number(renderQuality.dprCap || Infinity)) {
        effectivePixelRatio = 0;
        sceneColorCache.invalidate('quality-dpr');
        queueMapResize?.('adaptive-render-quality');
      }
      // Adaptive quality only controls cadence, upload budgets and DPR. Mesh
      // resolution is gated by canonical readiness and never changes during
      // interaction.
      renderQuality = Object.freeze({ ...renderQuality, countryMeshQuality: 'canonical', terrainResolutionScale: 1 });
      return renderQuality;
    }

    function invalidateHydroVisibility() {
      hydroVisibilityDirty = true;
      physicalStyleStateRevision += 1;
      queueHydroRender('hydro-visibility');
    }

    function invalidatePhysicalStyle(reason = 'physical-style') {
      physicalStyleStateRevision += 1;
      invalidatePhysicalScene(reason);
      return true;
    }

    function terrainLevelForView(frameContext = activeFrameContext) {
      if (!terrainManifest?.levels?.length) return null;
      const scale = Number(frameContext?.scale) || Number(activeProjection().scale()) || 1;
      // frameContext.scale is already in physical pixels; do not apply DPR a
      // second time or movement/resize would spuriously request a lower LOD.
      const desiredWidth = Math.max(1, 2 * PI * scale);
      return terrainManifest.levels.find(level => level.width >= desiredWidth * 1.12)
        || terrainManifest.levels[terrainManifest.levels.length - 1];
    }

    function terrainTileSpec(level, column, row) {
      const x0 = column * level.tileSize;
      const y0 = row * level.tileSize;
      const x1 = Math.min(level.width, x0 + level.tileSize);
      const y1 = Math.min(level.height, y0 + level.tileSize);
      return {
        key: `${level.id}/${column}-${row}`,
        level: level.id,
        column,
        row,
        pixelWidth: x1 - x0,
        pixelHeight: y1 - y0,
        bounds: [
          -180 + x0 / level.width * 360,
          90 - y0 / level.height * 180,
          -180 + x1 / level.width * 360,
          90 - y1 / level.height * 180,
        ],
      };
    }

    function visibleTerrainTileSpecs(level, includeAll = false, frameContext = activeFrameContext) {
      const specs = [];
      const projection = activeProjection();
      const viewport = frameContext?.viewport || [cssWidth, cssHeight];
      const scale = Number(frameContext?.scale) || projection.scale();
      const flatHalfLon = viewport[0] / Math.max(1, scale) * 90 / PI;
      const flatHalfLat = viewport[1] / Math.max(1, scale) * 90 / PI;
      const rotation = frameContext?.viewState?.rotation || state.view.globeRotation;
      const flatCenter = frameContext?.viewState?.projectionCenter || state.view.flatCenter;
      const globeCenter = [-Number(rotation?.[0] || 0), -Number(rotation?.[1] || 0)];
      const globeRadius = Math.asin(Math.min(1, Math.hypot(viewport[0], viewport[1]) * 0.5 / Math.max(1, scale)));
      for (let row = 0; row < level.rows; row += 1) {
        for (let column = 0; column < level.columns; column += 1) {
          const spec = terrainTileSpec(level, column, row);
          if (includeAll) {
            specs.push(spec);
            continue;
          }
          const [west, north, east, south] = spec.bounds;
          const center = [(west + east) / 2, (north + south) / 2];
          const halfLon = (east - west) / 2;
          const halfLat = (north - south) / 2;
          const projectionKind = frameContext?.viewState?.projection || state.projection;
          if (projectionKind === 'flat') {
            const deltaLon = Math.abs((((center[0] - flatCenter[0]) + 540) % 360) - 180);
            const deltaLat = Math.abs(center[1] - flatCenter[1]);
            if (deltaLon <= flatHalfLon + halfLon + 2 && deltaLat <= flatHalfLat + halfLat + 2) specs.push(spec);
          } else {
            const padding = Math.hypot(halfLon, halfLat) * PI / 180;
            if (d3.geo.distance(globeCenter, center) <= globeRadius + padding + 0.04) specs.push(spec);
          }
        }
      }
      return specs;
    }

    function terrainTileUrl(spec) {
      const relative = terrainManifest.urlTemplate
        .replace('{level}', String(spec.level))
        .replace('{column}', String(spec.column))
        .replace('{row}', String(spec.row));
      const url = new URL(relative, PHYSICAL_DATA_BASE_URL);
      url.searchParams.set('v', DATA_REVISION || terrainManifest.version || APP_VERSION);
      return url;
    }

    function requestTerrainTile(spec, priority = 0) {
      if (!gl || terrainTiles.has(spec.key) || terrainTileRequests.has(spec.key)
          || terrainTileQueuedKeys.has(spec.key) || terrainFetchQueuedKeys.has(spec.key)) return;
      const previousFailure = terrainTileFailures.get(spec.key);
      if (previousFailure?.retryAt > performance.now()) return;
      terrainFetchQueuedKeys.add(spec.key);
      terrainFetchQueue.push({ spec, priority: Number(priority || 0) });
      terrainFetchQueue.sort((left, right) => right.priority - left.priority || left.spec.key.localeCompare(right.spec.key));
      pumpTerrainFetchQueue();
    }

    function pumpTerrainFetchQueue() {
      const concurrency = isMobile() ? 2 : 4;
      while (terrainActiveFetches < concurrency && terrainFetchQueue.length) {
        const next = terrainFetchQueue.shift();
        terrainFetchQueuedKeys.delete(next.spec.key);
        startTerrainTileRequest(next.spec, next.priority);
      }
    }

    function startTerrainTileRequest(spec, priority = 0) {
      const previousFailure = terrainTileFailures.get(spec.key);
      const requestGeneration = projectGeneration;
      terrainActiveFetches += 1;
      const request = (async () => {
        const response = await fetch(terrainTileUrl(spec));
        if (!response.ok) throw new Error(`지형 타일 HTTP ${response.status}`);
        const blob = await response.blob();
        let bitmap;
        try { bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
        catch (_) { bitmap = await createImageBitmap(blob); }
        if (requestGeneration !== projectGeneration) {
          bitmap.close?.();
          return;
        }
        if (!gl || !isWebGlRenderer()) {
          bitmap.close?.();
          return;
        }
        terrainTileFailures.delete(spec.key);
        terrainTileQueuedKeys.add(spec.key);
        terrainUploadQueue.push({ spec, bitmap });
        scheduleTerrainUpload();
      })().catch(error => {
        const attempts = Number(previousFailure?.attempts || 0) + 1;
        const retryDelay = attempts <= 3 ? Math.min(4000, 400 * 2 ** (attempts - 1)) : 30000;
        terrainTileFailures.set(spec.key, { attempts, retryAt: performance.now() + retryDelay });
        if (attempts <= 3) {
          setTimeout(() => {
            requestTerrainTile(spec, priority);
          }, retryDelay + 16);
        }
        console.warn(`지형 타일을 불러오지 못했습니다: ${spec.key}`, error);
      }).finally(() => {
        if (terrainTileRequests.get(spec.key) === request) terrainTileRequests.delete(spec.key);
        terrainActiveFetches = Math.max(0, terrainActiveFetches - 1);
        pumpTerrainFetchQueue();
      });
      terrainTileRequests.set(spec.key, request);
    }

    function uploadTerrainTile(next) {
      if (!next) return false;
      const { spec, bitmap } = next;
      terrainTileQueuedKeys.delete(spec.key);
      if (!gl || !isWebGlRenderer()) {
        bitmap.close?.();
        return false;
      }
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        bitmap.close?.();
        const byteLength = Math.max(1, Number(spec.pixelWidth || bitmap.width || 1))
          * Math.max(1, Number(spec.pixelHeight || bitmap.height || 1)) * 4;
        terrainTiles.set(spec.key, { texture, lastUsed: performance.now(), byteLength });
        performanceMetrics.terrainUploadCount += 1;
        let terrainBytes = [...terrainTiles.values()].reduce((sum, entry) => sum + Number(entry.byteLength || 0), 0);
        const terrainBudget = Math.max(8 * 1024 * 1024, Number(renderQuality.terrainCacheBudgetBytes) || DEFAULT_RENDER_QUALITY.terrainCacheBudgetBytes);
        while (terrainBytes > terrainBudget) {
          let oldest = null;
          for (const item of terrainTiles.entries()) if (!oldest || item[1].lastUsed < oldest[1].lastUsed) oldest = item;
          if (!oldest || oldest[0] === spec.key) break;
          gl.deleteTexture(oldest[1].texture);
          terrainTiles.delete(oldest[0]);
          terrainBytes -= Number(oldest[1].byteLength || 0);
        }
      return true;
    }

    function scheduleTerrainUpload() {
      if (terrainUploadFrame || !terrainUploadQueue.length) return;
      terrainUploadFrame = requestAnimationFrame(() => {
        terrainUploadFrame = 0;
        const startedAt = performance.now();
        const uploadBudget = Math.max(64 * 1024, Number(renderQuality.uploadBudgetBytes) || 4 * 1024 * 1024);
        const limit = interactionActive ? 1 : Math.max(1, Math.min(4, Math.floor(uploadBudget / (1024 * 1024))));
        let uploaded = 0;
        while (terrainUploadQueue.length && uploaded < limit && (uploaded === 0 || performance.now() - startedAt < 4)) {
          if (uploadTerrainTile(terrainUploadQueue.shift())) uploaded += 1;
        }
        // A texture upload is not itself a visible frame change. Repaint only
        // when it completes a coherent terrain level; otherwise every tile
        // caused a redundant base-scene draw (especially costly on mobile).
        const readyLevel = uploaded ? completeTerrainLevelForFrame(activeFrameContext)?.level : null;
        if (readyLevel && Number(readyLevel.id) !== terrainRenderedLevel) {
          invalidatePhysicalScene('terrain-level-ready');
        }
        if (terrainUploadQueue.length) scheduleTerrainUpload();
      });
    }

    function terrainGridMesh(spec, frameContext = activeFrameContext || lastVisualFrame) {
      const spanLon = Math.abs(spec.bounds[2] - spec.bounds[0]);
      const spanLat = Math.abs(spec.bounds[1] - spec.bounds[3]);
      // Equirectangular terrain is affine inside a tile, so four vertices are
      // exact. On the globe, tessellate only enough to keep spherical chord
      // error below roughly one physical pixel. The old fixed 0.499-degree
      // grid generated hundreds of thousands of triangles for a single
      // overview tile and saturated mobile GPUs without improving the raster.
      const globe = Number(frameContext?.mode) === 0;
      const scale = Math.max(1, Number(frameContext?.scale) || 1);
      const angularStep = globe
        ? Math.max(0.75, Math.min(8, Math.sqrt(4 / scale) * 180 / PI))
        : 360;
      const stepsX = Math.max(1, Math.ceil(spanLon / angularStep));
      const stepsY = Math.max(1, Math.ceil(spanLat / angularStep));
      const key = `${globe ? 'globe' : 'flat'}:${stepsX}x${stepsY}`;
      if (terrainGridMeshes.has(key)) return terrainGridMeshes.get(key);
      const vertices = new Float32Array((stepsX + 1) * (stepsY + 1) * 2);
      let vertexOffset = 0;
      for (let y = 0; y <= stepsY; y += 1) {
        for (let x = 0; x <= stepsX; x += 1) {
          vertices[vertexOffset++] = x / stepsX;
          vertices[vertexOffset++] = y / stepsY;
        }
      }
      const indices = new Uint32Array(stepsX * stepsY * 6);
      let indexOffset = 0;
      for (let y = 0; y < stepsY; y += 1) {
        for (let x = 0; x < stepsX; x += 1) {
          const a = y * (stepsX + 1) + x;
          const b = a + 1;
          const c = a + stepsX + 1;
          const d = c + 1;
          indices[indexOffset++] = a; indices[indexOffset++] = c; indices[indexOffset++] = b;
          indices[indexOffset++] = b; indices[indexOffset++] = c; indices[indexOffset++] = d;
        }
      }
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      const meshEntry = { vertexBuffer, indexBuffer, indexCount: indices.length };
      terrainGridMeshes.set(key, meshEntry);
      return meshEntry;
    }

    function drawTerrainTile(spec) {
      const tile = terrainTiles.get(spec.key);
      if (!tile || !terrainProgram) return false;
      tile.lastUsed = performance.now();
      const frameContext = activeFrameContext || lastVisualFrame;
      if (!frameContext) return false;
      const grid = terrainGridMesh(spec, frameContext);
      gl.useProgram(terrainProgram);
      const gridLocation = glVersion === 2 ? 0 : cachedAttributeLocation(terrainProgram, 'aGrid');
      gl.bindBuffer(gl.ARRAY_BUFFER, grid.vertexBuffer);
      gl.enableVertexAttribArray(gridLocation);
      gl.vertexAttribPointer(gridLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.indexBuffer);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tile.texture);
      gl.uniform1i(cachedUniformLocation(terrainProgram, 'uTerrain'), 1);
      const [west, north, east, south] = spec.bounds;
      gl.uniform4f(cachedUniformLocation(terrainProgram, 'uGeoBounds'), west, north, east, south);
      const gutter = Number(terrainManifest.gutter || 0);
      const u0 = gutter / (spec.pixelWidth + gutter * 2);
      const v0 = gutter / (spec.pixelHeight + gutter * 2);
      const u1 = (gutter + spec.pixelWidth) / (spec.pixelWidth + gutter * 2);
      const v1 = (gutter + spec.pixelHeight) / (spec.pixelHeight + gutter * 2);
      gl.uniform4f(cachedUniformLocation(terrainProgram, 'uUvBounds'), u0, v0, u1, v1);
      gl.uniform1f(cachedUniformLocation(terrainProgram, 'uPhysicalStyle'), state.physicalSettings.terrainStyle === 'physical' ? 1 : 0);
      gl.uniform1f(cachedUniformLocation(terrainProgram, 'uDarkTheme'), getSystemTheme() === 'dark' ? 1 : 0);
      for (const offset of frameContext.worldOffsets) {
        setViewUniforms(terrainProgram, offset, frameContext);
        gl.drawElements(gl.TRIANGLES, grid.indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.disableVertexAttribArray(gridLocation);
      return true;
    }

    function terrainCandidateLevels(frameContext = activeFrameContext || lastVisualFrame) {
      if (!frameContext) return [];
      const levels = terrainManifest.levels;
      const baseLevel = levels[0];
      const targetLevel = terrainLevelForView(frameContext) || baseLevel;
      const targetIndex = Math.max(0, levels.findIndex(level => Number(level.id) === Number(targetLevel.id)));
      const candidateLevels = levels.slice(0, (state.dataReadiness === 'enhanced' ? targetIndex : 0) + 1).reverse();
      return candidateLevels.map(level => ({
        level,
        specs: visibleTerrainTileSpecs(level, false, frameContext),
      }));
    }

    function completeTerrainLevelForFrame(frameContext = activeFrameContext || lastVisualFrame) {
      if (!state.physicalSettings.terrainVisible || !terrainManifest?.levels?.length || !terrainProgram) return null;
      return terrainCandidateLevels(frameContext)
        .find(entry => entry.specs.length > 0 && entry.specs.every(spec => terrainTiles.has(spec.key))) || null;
    }

    function renderTerrain() {
      if (!state.physicalSettings.terrainVisible || !terrainManifest?.levels?.length || !terrainProgram) return;
      const frameContext = activeFrameContext || lastVisualFrame;
      if (!frameContext) return false;
      const specsByLevel = terrainCandidateLevels(frameContext);
      // Never mix parent and child rasters, and never expose a partially
      // uploaded base level. The previous complete level remains active until
      // one coherent candidate can replace it.
      const selected = specsByLevel.find(entry => entry.specs.length > 0 && entry.specs.every(spec => terrainTiles.has(spec.key))) || null;
      const targetSpecs = specsByLevel[0]?.specs || [];
      terrainLastLevel = Number(selected?.level?.id ?? -1);
      terrainTargetTileCount = targetSpecs.length;
      terrainTargetTilesLoaded = targetSpecs.filter(spec => terrainTiles.has(spec.key)).length;
      for (let index = 0; index < specsByLevel.length; index += 1) {
        const priority = index === 0 ? 10_000 : 1_000 - index;
        for (const spec of specsByLevel[index].specs) requestTerrainTile(spec, priority);
      }
      terrainRenderedLevel = -1;
      if (selected) {
        for (const spec of selected.specs) {
          if (drawTerrainTile(spec)) terrainRenderedLevel = Number(selected.level.id);
        }
      }
    }

    function buildCountryStrokeResource(sourceMesh, countryIds, sourceName, revision) {
      if (!sourceMesh?.lineIndices?.length || !sourceMesh?.positions?.length || !sourceMesh?.countryIndices?.length) return null;
      const cache = countryStrokePacketCache[sourceName];
      if (cache.mesh === sourceMesh && cache.countryIds === countryIds && cache.revision === revision) return cache.resource;
      let startsEnds = sourceMesh.strokeStartsEnds;
      let ownerRanges = sourceMesh.strokeOwnerRanges;
      if (!(startsEnds instanceof Float32Array) || !ownerRanges) {
        const counts = new Map();
        for (let offset = 0; offset + 1 < sourceMesh.lineIndices.length; offset += 2) {
          const startIndex = Number(sourceMesh.lineIndices[offset]);
          const countryIndex = Number(sourceMesh.countryIndices[startIndex]);
          const id = String(countryIds?.[countryIndex] || '');
          if (id) counts.set(id, (counts.get(id) || 0) + 1);
        }
        const ownerIds = [...counts.keys()].sort((left, right) => countryIds.indexOf(left) - countryIds.indexOf(right));
        ownerRanges = {};
        const cursorByOwner = new Map();
        let segmentOffset = 0;
        for (const id of ownerIds) {
          ownerRanges[id] = { first: segmentOffset, count: counts.get(id) || 0 };
          cursorByOwner.set(id, segmentOffset);
          segmentOffset += counts.get(id) || 0;
        }
        startsEnds = new Float32Array(segmentOffset * 4);
        const coordinateScale = sourceMesh.positions instanceof Int32Array
          || sourceMesh.positions instanceof Uint32Array
          || Math.max(Math.abs(Number(sourceMesh.positions[0] || 0)), Math.abs(Number(sourceMesh.positions[1] || 0))) > 1000
          ? 1e-6 : 1;
        for (let offset = 0; offset + 1 < sourceMesh.lineIndices.length; offset += 2) {
          const startIndex = Number(sourceMesh.lineIndices[offset]);
          const endIndex = Number(sourceMesh.lineIndices[offset + 1]);
          const countryIndex = Number(sourceMesh.countryIndices[startIndex]);
          const id = String(countryIds?.[countryIndex] || '');
          if (!cursorByOwner.has(id)) continue;
          const cursor = cursorByOwner.get(id);
          const target = cursor * 4;
          startsEnds[target] = Number(sourceMesh.positions[startIndex * 2]) * coordinateScale;
          startsEnds[target + 1] = Number(sourceMesh.positions[startIndex * 2 + 1]) * coordinateScale;
          startsEnds[target + 2] = Number(sourceMesh.positions[endIndex * 2]) * coordinateScale;
          startsEnds[target + 3] = Number(sourceMesh.positions[endIndex * 2 + 1]) * coordinateScale;
          cursorByOwner.set(id, cursor + 1);
        }
        sourceMesh.strokeStartsEnds = startsEnds;
        sourceMesh.strokeOwnerRanges = ownerRanges;
      }
      const ownerIds = Object.entries(ownerRanges)
        .filter(([, range]) => Number(range?.count || 0) > 0)
        .map(([id]) => id);
      const segmentOffset = startsEnds.length / 4;
      const packet = Object.freeze({
        key: `country-boundary:${sourceName}`,
        geometryRevision: String(revision),
        startsEnds,
        segmentCount: segmentOffset,
        ownerRanges: Object.freeze(Object.fromEntries(Object.entries(ownerRanges).map(([id, range]) => [id, Object.freeze(range)]))),
      });
      const resource = Object.freeze({ packet, ownerIds: Object.freeze(ownerIds) });
      cache.mesh = sourceMesh;
      cache.countryIds = countryIds;
      cache.revision = revision;
      cache.resource = resource;
      return resource;
    }

    function countryStrokeMeshRevision(sourceMesh) {
      if (!sourceMesh || typeof sourceMesh !== 'object') return 0;
      let revision = countryStrokeMeshRevisions.get(sourceMesh);
      if (!revision) {
        revision = ++countryStrokeMeshRevisionSequence;
        countryStrokeMeshRevisions.set(sourceMesh, revision);
      }
      return revision;
    }

    function currentCountryStrokeResources() {
      const canonicalEntry = meshVariants.get('canonical');
      const canonicalMesh = canonicalEntry?.mesh || mesh;
      const canonicalCountryIds = canonicalEntry?.countryIds || meshCountryIds;
      const activeRevision = `${activeMeshQuality}:${countryStrokeMeshRevision(mesh)}:${mesh?.lineIndices?.length || 0}`;
      const canonicalRevision = `canonical:${countryStrokeMeshRevision(canonicalMesh)}:${canonicalMesh?.lineIndices?.length || 0}`;
      const revisionOverride = `override:${countryStrokeMeshRevision(overrideMesh)}:${overrideMesh?.lineIndices?.length || 0}`;
      const selectionBase = buildCountryStrokeResource(canonicalMesh, canonicalCountryIds, 'canonical', canonicalRevision);
      const base = mesh === canonicalMesh && meshCountryIds === canonicalCountryIds
        ? selectionBase
        : buildCountryStrokeResource(mesh, meshCountryIds, 'preview', activeRevision);
      return Object.freeze({
        base,
        selectionBase,
        override: buildCountryStrokeResource(overrideMesh, meshCountryIds, 'override', revisionOverride),
      });
    }

    function prewarmCountryStrokeResources() {
      if (!strokeRenderer.isAvailable?.() || !mesh) return false;
      const packets = new Map();
      for (const resource of Object.values(currentCountryStrokeResources())) {
        if (resource?.packet) packets.set(resource.packet.key, resource.packet);
      }
      for (const packet of packets.values()) strokeRenderer.ensureResource(packet);
      return packets.size > 0;
    }

    function drawCountryBoundaryStrokes(dynamicResources, baseBoundaryDraw, overrideBoundaryDraw) {
      if (!state.layerVisibility.countries) return { succeeded: true, renderedKeys: [], missingKeys: [] };
      drawProgram(lineProgram, lineVao, lineIndexBuffer, mesh.lineIndices.length, gl.LINES, null, paletteTexture, null, null, baseBoundaryDraw.ranges);
      if (overrideMesh?.lineIndices?.length) {
        drawProgram(lineProgram, overrideLineVao, overrideLineIndexBuffer, overrideMesh.lineIndices.length, gl.LINES, dynamicResources, overridePaletteTexture, null, null, overrideBoundaryDraw.ranges);
      }
      return {
        succeeded: true,
        renderedKeys: [],
        missingKeys: [],
      };
    }

    function drawBaseSceneContent() {
      if (!gl || !mesh || !activeFrameContext || projectRenderBlocked) return false;
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.disable(gl.BLEND);
      const dynamicResources = overrideMesh ? { positionBuffer: overridePositionBuffer, countryBuffer: overrideCountryBuffer } : null;
      const baseTriangleDraw = countryDrawRangesForFrame(mesh, activeFrameContext, { kind: 'triangle' });
      const baseBoundaryDraw = countryDrawRangesForFrame(mesh, activeFrameContext, { kind: 'boundary' });
      const overrideTriangleDraw = countryDrawRangesForFrame(overrideMesh, activeFrameContext, { kind: 'triangle' });
      const overrideBoundaryDraw = countryDrawRangesForFrame(overrideMesh, activeFrameContext, { kind: 'boundary' });
      performanceMetrics.countryBaseIndexCount = baseTriangleDraw.indexCount + overrideTriangleDraw.indexCount;
      performanceMetrics.countryBaseFullIndexCount = baseTriangleDraw.fullIndexCount + overrideTriangleDraw.fullIndexCount;
      performanceMetrics.countryBaseRangeCount = baseTriangleDraw.ranges.length + overrideTriangleDraw.ranges.length;
      performanceMetrics.countryBoundaryIndexCount = baseBoundaryDraw.indexCount + overrideBoundaryDraw.indexCount;
      performanceMetrics.countryBoundaryFullIndexCount = baseBoundaryDraw.fullIndexCount + overrideBoundaryDraw.fullIndexCount;
      performanceMetrics.countryVisibleCount = baseTriangleDraw.visibleCountryCount + overrideTriangleDraw.visibleCountryCount;
      if (baseTriangleDraw.fallback || baseBoundaryDraw.fallback || (overrideMesh && (overrideTriangleDraw.fallback || overrideBoundaryDraw.fallback))) {
        performanceMetrics.countryCullingFallbackCount += 1;
      }
      if (state.physicalSettings.terrainVisible && state.physicalSettings.terrainStyle !== 'physical') {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.colorMask(false, false, false, false);
        drawProgram(landMaskProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES, null, paletteTexture, null, null, baseTriangleDraw.ranges);
        if (overrideMesh?.triangleIndices?.length) drawProgram(landMaskProgram, overrideFillVao, overrideFillIndexBuffer, overrideMesh.triangleIndices.length, gl.TRIANGLES, dynamicResources, overridePaletteTexture, null, null, overrideTriangleDraw.ranges);
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0x00);
        gl.stencilFunc(gl.EQUAL, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        renderTerrain();
        gl.disable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
      } else {
        renderTerrain();
      }
      flushPaletteUpdates();
      resetGpuNormalBlend(gl);
      if (state.layerVisibility.countries) {
        drawProgram(fillProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES, null, paletteTexture, null, null, baseTriangleDraw.ranges);
        if (overrideMesh?.triangleIndices?.length) drawProgram(fillProgram, overrideFillVao, overrideFillIndexBuffer, overrideMesh.triangleIndices.length, gl.TRIANGLES, dynamicResources, overridePaletteTexture, null, null, overrideTriangleDraw.ranges);
      }
      drawHydro('lake');
      drawHydro('lake-boundary');
      drawHydro('river');
      drawHydro('border-river');
      const countryStrokeResult = drawCountryBoundaryStrokes(dynamicResources, baseBoundaryDraw, overrideBoundaryDraw);
      const overlayItems = [
        ...(renderScene?.polygons || []).map(packet => ({ kind: 'polygon', packet })),
        ...(renderScene?.strokes || []).map(packet => ({ kind: 'stroke', packet })),
      ].sort((left, right) => Number(left.packet.order || 0) - Number(right.packet.order || 0));
      const uploadBudget = Math.max(64 * 1024, Number(renderQuality.uploadBudgetBytes) || DEFAULT_RENDER_QUALITY.uploadBudgetBytes);
      let overlayUploadBytes = 0;
      const deferredOverlayKeys = new Set();
      const failedOverlayKeys = new Set();
      const uploadCandidates = overlayItems.filter(item => {
        const pass = item.kind === 'polygon' ? polygonOverlayPass : strokeRenderer;
        return !pass.hasResource?.(item.packet.key);
      }).sort((left, right) => Number(right.packet.protected === true) - Number(left.packet.protected === true)
        || Number(right.packet.priority || 0) - Number(left.packet.priority || 0)
        || Number(left.packet.order || 0) - Number(right.packet.order || 0));
      for (const item of uploadCandidates) {
        const byteLength = Math.max(0, Number(item.packet.byteLength
          || item.packet.positions?.byteLength + item.packet.indices?.byteLength
          || item.packet.startsEnds?.byteLength || 0));
        const protectedUpload = item.packet.protected === true;
        if (!protectedUpload && overlayUploadBytes > 0 && overlayUploadBytes + byteLength > uploadBudget) {
          deferredOverlayKeys.add(String(item.packet.key));
          continue;
        }
        const pass = item.kind === 'polygon' ? polygonOverlayPass : strokeRenderer;
        const uploaded = pass.ensureResource?.(item.packet)?.resource;
        if (uploaded) {
          overlayUploadBytes += Number(uploaded.byteLength || byteLength);
          if (overlayUploadBytes > uploadBudget) performanceMetrics.uploadBudgetOverrunCount += 1;
        } else failedOverlayKeys.add(String(item.packet.key));
      }
      const overlayRenderedKeys = [];
      const overlayMissingKeys = [];
      for (const item of overlayItems) {
        const pass = item.kind === 'polygon' ? polygonOverlayPass : strokeRenderer;
        if (deferredOverlayKeys.has(String(item.packet.key)) || failedOverlayKeys.has(String(item.packet.key)) || !pass.hasResource?.(item.packet.key)) {
          overlayMissingKeys.push(String(item.packet.key));
          continue;
        }
        const result = item.kind === 'polygon'
          ? polygonOverlayPass.drawPackets([item.packet], activeFrameContext)
          : strokeRenderer.drawBatches([item.packet], activeFrameContext);
        overlayRenderedKeys.push(...(result?.renderedKeys || []));
        overlayMissingKeys.push(...(result?.missingKeys || []));
      }
      performanceMetrics.overlayUploadBytes += overlayUploadBytes;
      performanceMetrics.lastOverlayUploadBytes = overlayUploadBytes;
      performanceMetrics.overlayDeferredItemCount = deferredOverlayKeys.size;
      if (deferredOverlayKeys.size) invalidateGpuFrame('overlay-upload-budget');
      performanceMetrics.baseSceneDrawCount += 1;
      sceneCacheFullDrawCount += 1;
      lastBaseSceneResult = { overlayRenderedKeys, overlayMissingKeys, countryStrokeResult };
      return lastBaseSceneResult;
    }

    function drawCountryInteractionFills() {
      if (projectRenderBlocked) return;
      performanceMetrics.countryInteractionIndexCount = 0;
      performanceMetrics.countryInteractionRangeCount = 0;
      performanceMetrics.countryInteractionFullIndexCount = Number(mesh?.triangleIndices?.length || 0) + Number(overrideMesh?.triangleIndices?.length || 0);
      if (!state.layerVisibility.countries) return;
      const dynamicResources = overrideMesh ? { positionBuffer: overridePositionBuffer, countryBuffer: overrideCountryBuffer } : null;
      const emphasizedIds = new Set([
        ...countryEmphasis.selectedIds,
        countryEmphasis.primaryId,
        countryEmphasis.hoverId,
      ].map(String).filter(Boolean));
      if (!emphasizedIds.size) return;
      flushPaletteUpdates();
      resetGpuNormalBlend(gl);
      const visibleBaseRanges = [...emphasizedIds]
        .filter(id => !countryOverrideIds.has(id) && !geometryRevisionTracker.isPending(id) && isCountryVisibleById(id))
        .flatMap(id => mesh?.triangleRangesByCountryId?.get(id) || []);
      if (visibleBaseRanges.length) {
        performanceMetrics.countryInteractionIndexCount += visibleBaseRanges.reduce((sum, range) => sum + Number(range.count || 0), 0);
        performanceMetrics.countryInteractionRangeCount += visibleBaseRanges.length;
        drawProgram(fillProgram, fillVao, fillIndexBuffer, mesh.triangleIndices.length, gl.TRIANGLES, null, emphasisPaletteTexture, null, null, visibleBaseRanges);
      }
      if (overrideMesh?.triangleIndices?.length) {
        const visibleOverrideRanges = [...emphasizedIds]
          .filter(id => countryOverrideIds.has(id) && !geometryRevisionTracker.isPending(id) && isCountryVisibleById(id))
          .flatMap(id => overrideMesh.triangleRangesByCountryId?.get(id) || []);
        if (visibleOverrideRanges.length) {
          performanceMetrics.countryInteractionIndexCount += visibleOverrideRanges.reduce((sum, range) => sum + Number(range.count || 0), 0);
          performanceMetrics.countryInteractionRangeCount += visibleOverrideRanges.length;
          drawProgram(fillProgram, overrideFillVao, overrideFillIndexBuffer, overrideMesh.triangleIndices.length, gl.TRIANGLES, dynamicResources, overrideEmphasisPaletteTexture, null, null, visibleOverrideRanges);
        }
      }
    }

    function drawInteractionPasses(viewState) {
      drawCountryInteractionFills();
      const genericFillResult = polygonOverlayPass.drawResourceItems(
        renderInteractionState.genericFillItems || [],
        activeFrameContext,
      );
      lastSelectionRenderResult = selectionPass?.draw?.(viewState, {
        size: { width: cssWidth, height: cssHeight },
        dpr: effectivePixelRatio,
        pixelWidth,
        pixelHeight,
      }, { clear: false, frameContext: activeFrameContext }) || null;
      const drawPackets = packets => (packets || []).map(item => (
        item?.kind === 'polygon'
          ? polygonOverlayPass.drawPackets([item.packet], activeFrameContext)
          : strokeRenderer.drawBatches([item.packet], activeFrameContext)
      ));
      const previewResults = drawPackets(renderInteractionState.previewPackets);
      const draftResults = drawPackets(renderInteractionState.draftPackets);
      sceneCacheInteractionDrawCount += 1;
      performanceMetrics.interactionFrameCount += 1;
      return { genericFillResult, selection: lastSelectionRenderResult, previewResults, draftResults };
    }

    function sceneViewSignature(viewState = activeRenderViewState || getRenderViewState()) {
      return [
        renderDeviceContextRevision,
        viewState?.projection,
        viewState?.translate?.join(','),
        viewState?.scale,
        viewState?.rotation?.join(','),
        viewState?.projectionCenter?.join(','),
        pixelWidth,
        pixelHeight,
      ].join(':');
    }

    // The scene cache stores a flat projection in screen pixels.  During a
    // small flat pan/zoom we can reproject that texture with one affine quad
    // instead of traversing every canonical triangle again. Globe frames and
    // large moves fall back to the exact scene rebuild because their mapping
    // is non-linear or would expose pixels outside the cached viewport.
    function flatSceneReprojection(frameContext) {
      const previous = lastSceneFrameContext;
      if (!previous || previous.mode !== 1 || frameContext?.mode !== 1) return null;
      if (previous.viewport?.[0] !== frameContext.viewport?.[0]
        || previous.viewport?.[1] !== frameContext.viewport?.[1]) return null;
      const oldScale = Number(previous.scale || 0);
      const nextScale = Number(frameContext.scale || 0);
      if (!(oldScale > 0) || !(nextScale > 0)) return null;
      const scale = nextScale / oldScale;
      if (scale < 0.85 || scale > 1.15) return null;
      const oldCenter = previous.flatCenter || [0, 0];
      const nextCenter = frameContext.flatCenter || [0, 0];
      const oldTranslate = previous.translate || [0, 0];
      const nextTranslate = frameContext.translate || [0, 0];
      const offsetX = nextTranslate[0] - scale * oldTranslate[0]
        + nextScale * (oldCenter[0] - nextCenter[0]);
      const offsetYScreen = nextTranslate[1] - scale * oldTranslate[1]
        + nextScale * (nextCenter[1] - oldCenter[1]);
      const width = Number(frameContext.viewport?.[0] || 0);
      const height = Number(frameContext.viewport?.[1] || 0);
      if (!(width > 0 && height > 0)
        || Math.abs(offsetX) > width * 0.2
        || Math.abs(offsetYScreen) > height * 0.2) return null;
      return {
        sourceViewport: previous.viewport,
        scale: [scale, scale],
        // Composite coordinates use a bottom-left origin while D3 view
        // translations use a top-left origin.
        offset: [offsetX, height - scale * height - offsetYScreen],
      };
    }

    function renderWebGl(visualFrame, { interactionOnly = false } = {}) {
      if (!gl || !mesh) return null;
      if (!isMapVisualFrame(visualFrame)) throw new TypeError('GPU render requires a MapVisualFrame.');
      if (resizePending) resize();
      activeFrameContext = visualFrame;
      lastVisualFrame = visualFrame;
      performanceMetrics.visualFrameConsumeCount += 1;
      const viewState = visualFrame.viewState;
      const started = performance.now();
      let sceneCacheHit = false;
      let baseResult = null;
      sceneCacheFallbackFrame = false;
      const viewSignature = sceneViewSignature(viewState);
      const exactSceneCacheHit = sceneColorCache.canComposite?.(viewSignature, projectGeneration) || false;
      const reproject = !exactSceneCacheHit && !sceneColorCache.isDirty?.()
        && sceneColorCache.hasActiveProject?.(projectGeneration)
        ? flatSceneReprojection(activeFrameContext)
        : null;
      const needsBaseScene = !exactSceneCacheHit && !reproject;
      if (needsBaseScene) {
        if (interactionOnly) sceneCacheSelectionOnlyBaseDrawCount += 1;
        if (sceneColorCache.beginScene(pixelWidth, pixelHeight, viewSignature, projectGeneration)) {
          baseResult = drawBaseSceneContent();
          if (baseResult !== false) {
            const promoted = sceneColorCache.finishScene(null, viewSignature, projectGeneration);
            lastBaseSceneResult = baseResult;
            lastSceneFrameContext = activeFrameContext;
            // finishScene() only promotes the staging texture and restores the
            // default framebuffer. Present that texture in this same frame.
            // Without this composite, a continuously changing view keeps
            // producing offscreen scenes that are never shown; only the first
            // unchanged settle frame can hit the cache, making the map jump on
            // pointer release while DOM labels move throughout the drag.
            if (!promoted || !sceneColorCache.composite(pixelWidth, pixelHeight, { clearTarget: true })) {
              recordSceneCacheFallback();
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              baseResult = drawBaseSceneContent();
            }
          }
        } else {
          recordSceneCacheFallback();
          // A failed staging allocation must not clear the only visible
          // scene. Keep the last scene when it belongs to this exact view;
          // direct redraw is only safe before the first scene exists.
          if (sceneColorCache.hasActiveFor?.(viewSignature, projectGeneration)) {
            baseResult = lastBaseSceneResult;
          } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            baseResult = drawBaseSceneContent();
          }
        }
      } else {
        sceneCacheHit = true;
      }
      if (exactSceneCacheHit || reproject) {
        // This canvas is owned by PandoLab. Clear before compositing so pixels
        // removed from the active scene (for example an edited border) cannot
        // survive in the default framebuffer as an afterimage.
        if (!sceneColorCache.composite(pixelWidth, pixelHeight, { clearTarget: true, reproject })) {
          recordSceneCacheFallback();
          // A failed composite does not make a same-view active scene stale.
          // Preserve the already displayed frame instead of clearing it and
          // exposing a partially redrawn/transparent framebuffer.
          if (sceneColorCache.hasActiveFor?.(viewSignature, projectGeneration)) {
            baseResult = lastBaseSceneResult;
          } else {
            // Do not expose a transparent failed composite. If there is no
            // usable current-view cache, draw the scene directly as the only
            // safe first-frame fallback.
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            baseResult = drawBaseSceneContent();
          }
        }
        if (reproject) sceneCacheReprojectCount += 1;
        if (!baseResult) baseResult = lastBaseSceneResult;
      } else if (!baseResult) {
        recordSceneCacheFallback();
        if (sceneColorCache.hasActiveFor?.(viewSignature, projectGeneration)) {
          baseResult = lastBaseSceneResult;
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          baseResult = drawBaseSceneContent();
        }
      }
      const interactionResult = drawInteractionPasses(viewState);
      gl.flush();
      displayedRenderRevision = currentRenderRevision;
      frameTimes.push(performance.now() - started);
      if (frameTimes.length > 240) frameTimes.shift();
      activeFrameContext = null;
      publishLightweightMetrics();
      return {
        succeeded: !webglContextLost,
        frameId: visualFrame.frameId,
        viewRevision: visualFrame.viewRevision,
        projectionRevision: visualFrame.projectionRevision,
        sceneCacheHit,
        baseResult,
        interactionResult,
        selection: interactionResult.selection,
      };
    }

    function renderCanvasHydro(canvasPath, theme) {
      const builtIn = [];
      for (const packId of hydroActivePackIds) builtIn.push(...(hydroPacks.get(packId)?.features || []));
      const features = [...builtIn, ...(state.hydroEdits || [])];
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      for (const feature of features) {
        if (!feature?.geometry || !isHydroFeatureVisible(feature)) continue;
        const lake = feature.properties?.category === 'lake';
        if (state.layerVisibility[lake ? 'lakes' : 'rivers'] === false) continue;
        const opacity = lake ? theme.lakeOpacity : theme.riverOpacity;
        if (Number(opacity) <= 0) continue;
        const color = feature.properties?.editorColor || hydroDisplayColor(lake ? 'lake' : 'river');
        if (lake) {
          ctx2d.beginPath(); canvasPath(feature);
          ctx2d.globalAlpha = opacity; ctx2d.fillStyle = color; ctx2d.fill();
          if (theme.lakeBoundaryVisible !== false) {
            ctx2d.beginPath(); canvasPath(countryOutlineFeature(feature));
            ctx2d.strokeStyle = color; ctx2d.lineWidth = Math.max(0.5, Number(theme.lakeBoundaryWidth) || 1); ctx2d.stroke();
          }
          continue;
        }
        const profiles = feature.properties?.stroke_widths || [];
        const fallback = Math.max(0.55, Math.min(2.6, Number(feature.properties?.stroke_width || 0.8)));
        ctx2d.globalAlpha = opacity; ctx2d.strokeStyle = color;
        for (const [partIndex, part] of hydroLineParts(feature.geometry).entries()) {
          const widths = profiles[partIndex] || [];
          for (let index = 0; index < part.length - 1; index += 1) {
            ctx2d.beginPath();
            canvasPath({ type: 'LineString', coordinates: [part[index], part[index + 1]] });
            const start = Number(widths[index] ?? fallback);
            const end = Number(widths[index + 1] ?? start);
            ctx2d.lineWidth = (start + end) / 2 * Math.max(0.5, Number(theme.riverWidth) || 1);
            ctx2d.stroke();
          }
        }
      }
    }

    function renderCanvasFallback() {
      if (!ctx2d || !canvas) return;
      if (resizePending) resize();
      const dpr = pixelWidth / cssWidth;
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.clearRect(0, 0, pixelWidth, pixelHeight);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      const canvasPath = d3.geo.path().projection(activeProjection()).context(ctx2d);
      const theme = mapTheme();
      ctx2d.lineJoin = 'round';
      ctx2d.lineWidth = 0.72 * Math.max(0.5, Number(theme.borderWidth) || 1);
      if (state.layerVisibility.countries) {
        for (const feature of state.countriesData?.features || []) {
          const id = String(feature?.id || '');
          if (!isLayerItemVisible('countries', id)) continue;
          ctx2d.beginPath();
          canvasPath(feature);
          ctx2d.globalAlpha = theme.fillAlpha;
          ctx2d.fillStyle = countryColor(feature);
          ctx2d.fill();
          const emphasis = countryEmphasisStyle(id);
          if (emphasis) {
            ctx2d.beginPath();
            canvasPath(feature);
            ctx2d.globalAlpha = emphasis.alphaByte / 255;
            ctx2d.fillStyle = colorHex(emphasis.color);
            ctx2d.fill();
          }
        }
      }
      renderCanvasHydro(canvasPath, theme);
      if (state.layerVisibility.countries) for (const feature of state.countriesData?.features || []) {
          const id = String(feature?.id || '');
          if (!isLayerItemVisible('countries', id)) continue;
          ctx2d.beginPath();
          canvasPath(countryOutlineFeature(feature));
          ctx2d.globalAlpha = theme.borderAlpha;
          ctx2d.strokeStyle = theme.border;
          ctx2d.lineWidth = 0.72 * Math.max(0.5, Number(theme.borderWidth) || 1);
          ctx2d.stroke();
        }
      ctx2d.globalAlpha = 1;
      displayedRenderRevision = currentRenderRevision;
    }

    function canvasWorkerStyleMessage() {
      const colors = {};
      for (const feature of state.countriesData?.features || []) {
        colors[String(feature?.id || '')] = countryColor(feature);
      }
      return {
        type: 'style',
        styleRevision: ++canvasStyleRevision,
        visible: !!state.layerVisibility.countries,
        hiddenCountryIds: Object.keys(state.itemVisibility.countries || {}).filter(id => state.itemVisibility.countries[id] === false),
        colors,
        countryEmphasis: {
          primaryId: countryEmphasis.primaryId,
          hoverId: countryEmphasis.hoverId,
          selectedIds: [...countryEmphasis.selectedIds],
          primaryColor: interactionStyle.selection.color,
          secondaryColor: interactionStyle.selection.color,
          hoverColor: interactionStyle.hover.color,
          primaryAlpha: interactionStyle.selection.primary.fillAlpha,
          secondaryAlpha: interactionStyle.selection.secondary.fillAlpha,
          hoverAlpha: interactionStyle.hover.fillAlpha,
          boundaryEnabled: false,
        },
        interactionStyle,
        theme: mapTheme(),
        darkTheme: getSystemTheme() === 'dark',
      };
    }

    function canvasWorkerPhysicalStyleMessage() {
      return {
        type: 'physical-style',
        physicalStyleRevision: ++canvasPhysicalStyleRevision,
        riversVisible: !!state.layerVisibility.rivers,
        lakesVisible: !!state.layerVisibility.lakes,
        physicalSettings: deepClone(state.physicalSettings),
        theme: mapTheme(),
        darkTheme: getSystemTheme() === 'dark',
        dataReadiness: state.dataReadiness,
        terrainFetchConcurrency: isMobile() ? 2 : 4,
      };
    }

    function canvasWorkerViewMessage(revision = currentRenderRevision, visualFrame = null) {
      const frame = isMapVisualFrame(visualFrame) ? visualFrame : lastVisualFrame;
      const view = frame?.viewState || visualFrame || getRenderViewState();
      const workerView = {
        ...deepClone(state.view),
        ...deepClone(view),
        flatCenter: view.projectionCenter || state.view.flatCenter,
        globeRotation: view.rotation || state.view.globeRotation,
        flatZoom: view.zoom ?? state.view.flatZoom,
        globeZoom: view.zoom ?? state.view.globeZoom,
      };
      return {
        type: 'view',
        width: Math.max(1, Number(view.size?.width || state.size.width)),
        height: Math.max(1, Number(view.size?.height || state.size.height)),
        dpr: Number(view.dpr || resolveRenderPixelRatio()),
        projection: view.projection || state.projection,
        view: workerView,
        revision: Number(revision || 0),
        viewRevision: Number(view.revision || revision || 0),
        frameId: Number(frame?.frameId || revision || 0),
        projectionRevision: Number(frame?.projectionRevision || 0),
        projectGeneration: Number(frame?.projectGeneration || projectGeneration),
        geometryRevision: geometryRevisionTracker.committedRevision(),
      };
    }

    function canvasWorkerInitMessage() {
      const message = {
        ...canvasWorkerViewMessage(currentRenderRevision),
        ...canvasWorkerStyleMessage(),
        ...canvasWorkerPhysicalStyleMessage(),
        geometryRevision: geometryRevisionTracker.committedRevision(),
        terrainManifestUrl: (() => {
          const url = new URL('terrain/v0.12.6/manifest.json', PHYSICAL_DATA_BASE_URL);
          url.searchParams.set('v', DATA_REVISION || terrainManifest?.version || APP_VERSION);
          return url.href;
        })(),
      };
      message.type = 'init';
      return message;
    }

    function estimateCanvasMessageBytes(message) {
      if (message?.type === 'view') return 192;
      try { return new Blob([JSON.stringify(message)]).size; }
      catch (_) { return 0; }
    }

    function postCanvasWorkerMessage(message) {
      if (!canvasWorker) return false;
      performanceMetrics.canvasWorkerMessageCount += 1;
      performanceMetrics.canvasWorkerMessageBytes += estimateCanvasMessageBytes(message);
      performanceMetrics.canvasWorkerMessagesByType[message.type] = Number(performanceMetrics.canvasWorkerMessagesByType[message.type] || 0) + 1;
      if (message.type === 'view') performanceMetrics.canvasWorkerViewMessageCount += 1;
      else performanceMetrics.canvasWorkerStateMessageCount += 1;
      canvasWorker.postMessage(message);
      return true;
    }

    function syncCanvasWorkerState() {
      if (!canvasWorker || !canvasWorkerReady) return;
      const styleSignature = [countryPaletteRevision, countryEmphasisRevision, state.layerVisibility.countries, getSystemTheme()].join(':');
      if (styleSignature !== canvasLastStyleSignature) {
        canvasLastStyleSignature = styleSignature;
        postCanvasWorkerMessage(canvasWorkerStyleMessage());
      }
      const theme = mapTheme();
      const physicalSignature = [physicalStyleStateRevision, state.layerVisibility.rivers, state.layerVisibility.lakes,
        theme.riverOpacity, theme.lakeOpacity, theme.lakeBoundaryVisible, theme.ocean,
        state.physicalSettings.terrainVisible, state.physicalSettings.terrainStyle, state.physicalSettings.terrainStrength,
        state.dataReadiness].join(':');
      if (physicalSignature !== canvasLastPhysicalStyleSignature) {
        canvasLastPhysicalStyleSignature = physicalSignature;
        postCanvasWorkerMessage(canvasWorkerPhysicalStyleMessage());
      }
    }

    function postCanvasWorkerFrame(message) {
      if (!canvasWorker || !canvasWorkerReady) {
        canvasWorkerPendingMessage = message;
        return;
      }
      canvasWorkerBusy = true;
      postCanvasWorkerMessage(message);
    }

    function renderCanvasWorker(revision = currentRenderRevision, visualFrame = null) {
      if (!canvasWorker) return;
      if (resizePending) resize();
      syncCanvasWorkerState();
      const message = canvasWorkerViewMessage(revision, visualFrame);
      canvasWorkerLatestRequestedRevision = Math.max(canvasWorkerLatestRequestedRevision, message.revision);
      if (!canvasWorkerReady || canvasWorkerBusy) {
        canvasWorkerPendingMessage = message;
        return;
      }
      postCanvasWorkerFrame(message);
    }

    function renderLatestVisualFrame() {
      return lastVisualFrame ? renderFrame(lastVisualFrame) : null;
    }

    function renderFrame(visualFrame, { interactionOnly = false } = {}) {
      if (!isMapVisualFrame(visualFrame)) throw new TypeError('renderFrame() requires a MapVisualFrame.');
      currentRenderRevision = Math.max(currentRenderRevision, Number(visualFrame.viewRevision || 0));
      lastVisualFrame = visualFrame;
      activeRenderViewState = visualFrame.viewState;
      requestHydroView(activeRenderViewState);
      let result = null;
      if (isWebGlRenderer()) {
        result = renderWebGl(visualFrame, { interactionOnly });
      }
      else if (rendererMode === 'canvas-worker') {
        renderCanvasWorker(currentRenderRevision, visualFrame);
        result = { deferred: true, frameId: visualFrame.frameId, viewRevision: visualFrame.viewRevision };
      }
      else if (rendererMode === 'canvas2d') renderCanvasFallback();
      publishLightweightMetrics();
      return result;
    }

    function renderInteraction(visualFrame = lastVisualFrame) {
      if (!isMapVisualFrame(visualFrame)) return null;
      currentRenderRevision = Math.max(currentRenderRevision, Number(visualFrame.viewRevision || 0));
      activeRenderViewState = visualFrame.viewState;
      if (!isWebGlRenderer()) return null;
      performanceMetrics.selectionOnlyFrameCount += 1;
      return renderWebGl(visualFrame, { interactionOnly: true });
    }

    function prioritizeLatest() {
      if (rendererMode !== 'canvas-worker' || !canvasWorker) return;
      syncCanvasWorkerState();
      const message = canvasWorkerViewMessage(currentRenderRevision, activeRenderViewState);
      canvasWorkerLatestRequestedRevision = Math.max(canvasWorkerLatestRequestedRevision, message.revision);
      if (!canvasWorkerReady || canvasWorkerBusy) {
        if (!canvasWorkerPendingMessage || canvasWorkerPendingMessage.revision <= message.revision) {
          canvasWorkerPendingMessage = message;
        }
        return;
      }
      postCanvasWorkerFrame(message);
    }

    function failCanvasWorker(message) {
      console.warn('Canvas worker failed', message);
      canvasWorker?.terminate();
      canvasWorker = null;
      canvasWorkerReady = false;
      canvasWorkerBusy = false;
      canvasWorkerPendingMessage = null;
      for (const pending of canvasHydroPickRequests.values()) pending.resolve(null);
      canvasHydroPickRequests.clear();
      replaceCanvas();
      rendererMode = 'canvas2d';
      resize();
      ctx2d = canvas.getContext('2d', { alpha: true });
      if (!ctx2d) throw new Error('Canvas 대체 렌더러도 사용할 수 없습니다.');
      updateRendererStatus(`Canvas · ${meshQualityLabel()} 대체`, fallbackReason);
      setActionStatus(`${meshQualityLabel()} Canvas로 전환했습니다.`, 'working', 4200);
      if (hydroManifest && hydroManifestUrl) setHydroManifest(hydroManifest, hydroManifestUrl);
      renderCanvasFallback();
      completeGeometryDisplay(
        geometryRevisionTracker.pendingIds(),
        geometryRevisionTracker.committedRevision(),
        { renderFrame: false },
      );
    }

    function receiveCanvasWorkerMessage(event) {
      const message = event.data || {};
      if (message.type === 'ready') {
        canvasWorkerReady = true;
        postCanvasWorkerMessage({ type: 'hydro-edits', revision: hydroEditRevision, features: state.hydroEdits || [] });
        canvasLastStyleSignature = '';
        canvasLastPhysicalStyleSignature = '';
        syncCanvasWorkerState();
        const pending = canvasWorkerPendingMessage || canvasWorkerViewMessage(currentRenderRevision);
        canvasWorkerPendingMessage = null;
        postCanvasWorkerFrame(pending);
        return;
      }
      if (message.type === 'terrain-ready') {
        invalidateGpuFrame('canvas-terrain-ready');
        return;
      }
      if (message.type === 'terrain-warning') {
        console.warn('Canvas 지형 타일을 불러오지 못했습니다.', message.message || '알 수 없는 오류');
        return;
      }
      if (message.type === 'data-ready') {
        const geometryRevision = Number(message.geometryRevision || 0);
        const taskToken = Number(message.taskToken || 0);
        if (taskToken && !geometryRevisionTracker.isCurrent(taskToken, geometryRevision)) return;
        if (lastGeometryCommitTimings && geometryRevision === geometryRevisionTracker.committedRevision()) {
          lastGeometryCommitTimings.patchWorkerCompletedAt ||= performance.now();
        }
        if (message.replaceAll) {
          countryOverrideIds.clear();
          overrideFeatureSnapshots.clear();
          overrideMesh = null;
        }
        canvasDataReplacementResolver?.();
        canvasDataReplacementResolver = null;
        invalidateGpuFrame('canvas-data-ready');
        renderCanvasWorker(Math.max(currentRenderRevision, Number(message.revision || 0)));
        return;
      }
      if (message.type === 'hydro-pick') {
        const pending = canvasHydroPickRequests.get(Number(message.requestId));
        if (pending) {
          canvasHydroPickRequests.delete(Number(message.requestId));
          pending.resolve(Number.isFinite(Number(message.fid)) ? state.hydroFeatureByFid.get(Number(message.fid)) || null : null);
        }
        return;
      }
      if (message.type === 'error') {
        failCanvasWorker(message.message || 'Canvas Worker 렌더링 오류');
        return;
      }
      if (message.type !== 'frame') return;
      canvasWorkerBusy = false;
      const revision = Number(message.revision || 0);
      const geometryRevision = Number(message.geometryRevision || 0);
      const canDisplay = revision >= canvasWorkerDisplayedRevision
        && revision >= canvasWorkerLatestRequestedRevision
        && Number(message.projectGeneration || projectGeneration) === projectGeneration
        && geometryRevision >= geometryRevisionTracker.committedRevision();
      if (canDisplay && message.bitmap && message.terrainComplete !== false) {
        if (canvasWorkerBitmapContext) {
          canvasWorkerBitmapContext.transferFromImageBitmap(message.bitmap);
        } else if (canvasWorker2dContext) {
          canvasWorker2dContext.setTransform(1, 0, 0, 1, 0, 0);
          canvasWorker2dContext.clearRect(0, 0, canvas.width, canvas.height);
          canvasWorker2dContext.drawImage(message.bitmap, 0, 0, canvas.width, canvas.height);
          message.bitmap.close?.();
        }
        canvasWorkerDisplayedRevision = revision;
        displayedRenderRevision = revision;
        framePresentationListener?.({
          frameId: Number(message.frameId || revision || 0),
          viewRevision: Number(message.viewRevision || revision || 0),
          projectionRevision: Number(message.projectionRevision || 0),
          projectGeneration: Number(message.projectGeneration || projectGeneration),
          renderer: 'canvas-worker',
        });
        completeGeometryDisplay(geometryRevisionTracker.pendingIds(), geometryRevision, { renderFrame: false });
      } else {
        if (message.bitmap) performanceMetrics.canvasWorkerStaleFrameCount += 1;
        if (canDisplay && message.bitmap && message.terrainComplete === false) performanceMetrics.terrainIncompleteFrameCount += 1;
        message.bitmap?.close?.();
      }
      const pending = canvasWorkerPendingMessage;
      canvasWorkerPendingMessage = null;
      if (pending) postCanvasWorkerFrame(pending);
    }

    function activateCanvasFallback(reason) {
      const rawReason = String(reason || '');
      if (rawReason && !isSafeKoreanErrorMessage({ message: rawReason })) console.warn('[PL-GPU-005]', rawReason);
      fallbackReason = isSafeKoreanErrorMessage({ message: rawReason }) ? rawReason : 'GPU 렌더러를 사용할 수 없습니다.';
      clearTimeout(webglRecoveryTimer);
      webglContextLost = false;
      canvasWorker?.terminate();
      canvasWorker = null;
      canvasWorkerReady = false;
      canvasWorkerBusy = false;
      canvasWorkerPendingMessage = null;
      if (canvasWorkerUrl) URL.revokeObjectURL(canvasWorkerUrl);
      canvasWorkerUrl = null;
      if (canvas) replaceCanvas();
      if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') {
        try {
          rendererMode = 'canvas-worker';
          resize();
          const canvasRuntimeUrl = runtimeAssetUrl('workers/canvas-render-worker.js');
          canvasRuntimeUrl.searchParams.set('physical', '1');
          canvasWorker = new Worker(canvasRuntimeUrl, {
            name: 'pandolab-canvas-renderer',
          });
          canvasWorkerReady = false;
          canvasWorkerBusy = false;
          canvasWorkerPendingMessage = canvasWorkerViewMessage(currentRenderRevision);
          canvasWorkerLatestRequestedRevision = currentRenderRevision;
          canvasWorkerDisplayedRevision = 0;
          canvasWorkerBitmapContext = canvas.getContext('bitmaprenderer');
          if (!canvasWorkerBitmapContext) canvasWorker2dContext = canvas.getContext('2d', { alpha: true });
          if (!canvasWorkerBitmapContext && !canvasWorker2dContext) throw new Error('Canvas 표시 컨텍스트를 만들 수 없습니다.');
          const initMessage = canvasWorkerInitMessage();
          initMessage.features = state.countriesData?.features || [];
          postCanvasWorkerMessage(initMessage);
          canvasWorker.onmessage = receiveCanvasWorkerMessage;
          canvasWorker.onerror = event => failCanvasWorker(event.message || 'Canvas Worker 실행 오류');
          if (hydroManifest && hydroManifestUrl) setHydroManifest(hydroManifest, hydroManifestUrl);
          else connectHydroCanvasWorkers();
          updateRendererStatus('Canvas Worker · 완성 프레임 즉시 표시', fallbackReason);
          setActionStatus(`${meshQualityLabel()} Canvas Worker로 전환했습니다.`, 'working', 4200);
          window.__PANDOLAB_GPU_METRICS__ = getStats();
          return;
        } catch (error) {
          console.warn('Canvas worker unavailable', error);
          canvasWorker?.terminate();
          canvasWorker = null;
          replaceCanvas();
        }
      }
      rendererMode = 'canvas2d';
      ctx2d = canvas.getContext('2d', { alpha: true });
      if (!ctx2d) throw new Error('Canvas 대체 렌더러도 사용할 수 없습니다.');
      updateRendererStatus(`Canvas · ${meshQualityLabel()} 대체`, fallbackReason);
      setActionStatus(`${meshQualityLabel()} Canvas로 전환했습니다.`, 'working', 4200);
      if (hydroManifest && hydroManifestUrl) setHydroManifest(hydroManifest, hydroManifestUrl);
      renderCanvasFallback();
      completeGeometryDisplay(
        geometryRevisionTracker.pendingIds(),
        geometryRevisionTracker.committedRevision(),
        { renderFrame: false },
      );
      window.__PANDOLAB_GPU_METRICS__ = getStats();
    }

    function ensurePickTarget() {
      if (pickFramebuffer && pickTexture) return;
      pickFramebuffer = gl.createFramebuffer();
      pickTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, pickTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const internalFormat = glVersion === 2 ? gl.RGBA8 : gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTexture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU 선택 버퍼 생성 실패');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    function countryIdSceneKey(pickEntry) {
      return [
        Number(window.__PANDOLAB_VIEW_REVISION__ || 0),
        geometryRevisionTracker.displayedRevision(),
        Number(state.layerTreeRevision || 0),
        pixelWidth,
        pixelHeight,
        pickEntry?.quality || activeMeshQuality,
      ].join(':');
    }

    function ensureCountryIdScene() {
      if (!isWebGlRenderer() || !gl || !mesh || !state.layerVisibility.countries) return false;
      try { ensurePickTarget(); } catch (_) { return false; }
      const pickEntry = meshVariants.get(activeMeshQuality) || meshVariants.get(meshQuality);
      const pickMesh = pickEntry?.mesh || mesh;
      const pickResources = pickEntry?.resources;
      const nextSceneKey = countryIdSceneKey(pickEntry);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      if (nextSceneKey !== pickSceneKey) {
        flushPaletteUpdates();
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawProgram(
          pickProgram,
          pickResources?.fillVao || fillVao,
          pickResources?.fillIndexBuffer || fillIndexBuffer,
          pickMesh.triangleIndices.length,
          gl.TRIANGLES,
          pickResources ? { positionBuffer: pickResources.positionBuffer, countryBuffer: pickResources.countryBuffer } : null,
        );
        if (overrideMesh?.triangleIndices?.length) {
          drawProgram(
            pickProgram,
            overrideFillVao,
            overrideFillIndexBuffer,
            overrideMesh.triangleIndices.length,
            gl.TRIANGLES,
            { positionBuffer: overridePositionBuffer, countryBuffer: overrideCountryBuffer },
            overridePaletteTexture,
          );
        }
        pickSceneKey = nextSceneKey;
        pickSceneRenderCount += 1;
      }
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    }

    function pick(screenPoint) {
      if (!isWebGlRenderer() || !gl || !mesh || !state.layerVisibility.countries) return null;
      resize();
      const pickEntry = meshVariants.get(activeMeshQuality) || meshVariants.get(meshQuality);
      if (!ensureCountryIdScene()) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      const dpr = pixelWidth / cssWidth;
      const x = Math.max(0, Math.min(pixelWidth - 1, Math.round(screenPoint[0] * dpr)));
      const y = Math.max(0, Math.min(pixelHeight - 1, Math.round(pixelHeight - 1 - screenPoint[1] * dpr)));
      const pixel = new Uint8Array(4);
      const readStartedAt = performance.now();
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      pickLastReadPixelsMs = performance.now() - readStartedAt;
      pickReadPixelsMs += pickLastReadPixelsMs;
      pickCount += 1;
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const index = (pixel[0] | (pixel[1] << 8) | (pixel[2] << 16)) - 1;
      return index >= 0 ? pickEntry?.countryIds?.[index] || meshCountryIds[index] || null : null;
    }

    function pickHydro(screenPoint) {
      if (!isWebGlRenderer() || !gl || !hydroManifest || !hydroActivePackIds.size || !(state.layerVisibility.rivers || state.layerVisibility.lakes)) return null;
      resize();
      try { ensurePickTarget(); } catch (_) { return null; }
      pickSceneKey = '';
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFramebuffer);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawHydro('lake', true);
      drawHydro('river', true);
      drawHydro('border-river', true);
      const dpr = pixelWidth / cssWidth;
      const x = Math.max(0, Math.min(pixelWidth - 1, Math.round(screenPoint[0] * dpr)));
      const y = Math.max(0, Math.min(pixelHeight - 1, Math.round(pixelHeight - 1 - screenPoint[1] * dpr)));
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const fid = (pixel[0] | (pixel[1] << 8) | (pixel[2] << 16)) - 1;
      return fid >= 0 ? state.hydroFeatureByFid.get(fid) || null : null;
    }

    function pickHydroAsync(screenPoint) {
      if (rendererMode !== 'canvas-worker' || !canvasWorker || !canvasWorkerReady) return Promise.resolve(null);
      const requestId = ++canvasHydroPickRequestId;
      return new Promise(resolve => {
        canvasHydroPickRequests.set(requestId, { resolve });
        postCanvasWorkerMessage({ type: 'hydro-pick', requestId, point: screenPoint });
        setTimeout(() => {
          const pending = canvasHydroPickRequests.get(requestId);
          if (!pending) return;
          canvasHydroPickRequests.delete(requestId);
          pending.resolve(null);
        }, 900);
      });
    }

    async function initialize() {
      if (forcedRenderer === 'canvas') {
        activateCanvasFallback('강제 Canvas 테스트');
        return false;
      }
      let decoded = null;
      const failures = [];
      const versions = forcedRenderer === 'webgl2' ? [2] : forcedRenderer === 'webgl1' ? [1] : [2, 1];
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        if (index > 0 || gl) replaceCanvas();
        try {
          initWebGl(version);
          updateRendererStatus(`${rendererName()} · 빠른 GPU 지도를 준비하는 중입니다.`);
          if ((!previewAllowed || canonicalMeshReady) && meshVariants.has('canonical')) {
            qualityPhase = 'canonical-loading';
            if (meshVariants.has('canonical')) activateMeshVariant('canonical', { renderFrame: false });
            return true;
          }
          if (!previewAllowed || canonicalMeshReady) throw new Error('canonical mesh unavailable after startup preview');
          if (!decoded) decoded = await decodeBuiltInMesh();
          setMesh(decoded.mesh, decoded.ids, { quality: 'preview', preserveOtherVariants: false });
          meshQuality = 'preview';
          canonicalMeshReady = false;
          if (isWebGlRenderer()) {
            updateRendererStatus(`${rendererName()} · 빠른 GPU 미리보기`);
            return true;
          }
        } catch (error) {
          const message = error?.message || String(error);
          failures.push(`${version === 2 ? 'WebGL2' : 'WebGL1'}: ${message}`);
          console.warn(`${version === 2 ? 'WebGL2' : 'WebGL1'} renderer unavailable`, error);
        }
      }
      if (gl) replaceCanvas();
      activateCanvasFallback(failures.join(' / ') || 'WebGL을 사용할 수 없습니다.');
      return false;
    }

    async function replaceBuiltInMesh({ meshBuffer, features, quality = 'canonical', projectGeneration: requestedGeneration = projectGeneration }) {
      if (Number(requestedGeneration) !== projectGeneration) return false;
      const decoded = await decodeBuiltInMesh(meshBuffer, features);
      if (Number(requestedGeneration) !== projectGeneration) return false;
      setMesh(decoded.mesh, decoded.ids, {
        renderFrame: false,
        quality,
        preserveOtherVariants: quality === 'canonical' && meshVariants.has('preview'),
      });
      meshQuality = quality;
      if (quality === 'canonical') promoteCanonicalMesh({ frameId: currentRenderRevision });
      prewarmCountryStrokeResources();
      if (rendererMode === 'canvas-worker' && canvasWorker) {
        await new Promise(resolve => {
          const timeout = setTimeout(() => {
            if (canvasDataReplacementResolver === complete) canvasDataReplacementResolver = null;
            resolve();
          }, 3000);
          const complete = () => {
            clearTimeout(timeout);
            resolve();
          };
          canvasDataReplacementResolver = complete;
          postCanvasWorkerMessage({
            type: 'replace-data',
            revision: Number(currentRenderRevision || 0),
            geometryRevision: geometryRevisionTracker.committedRevision(),
            features: features || state.countriesData?.features || [],
          });
        });
      } else {
        completeGeometryDisplay(
          geometryRevisionTracker.pendingIds(),
          geometryRevisionTracker.committedRevision(),
        );
      }
      updateRendererStatus(isWebGlRenderer()
        ? `${rendererName()} · GPU ${meshQualityLabel()}`
        : `${rendererMode === 'canvas-worker' ? 'Canvas Worker' : 'Canvas'} · ${meshQualityLabel()}`,
        fallbackReason);
      projectRenderBlocked = false;
      sceneColorCache.invalidate('built-in-mesh-ready');
      return decoded;
    }

    function setCountryEmphasis({ primaryId = '', hoverId = '', selectedIds = [] } = {}) {
      const nextSelected = new Set((selectedIds || []).map(String).filter(Boolean));
      const nextPrimary = String(primaryId || '');
      const nextHover = String(hoverId || '');
      const unchanged = countryEmphasis.primaryId === nextPrimary
        && countryEmphasis.hoverId === nextHover
        && countryEmphasis.selectedIds.size === nextSelected.size
        && [...nextSelected].every(id => countryEmphasis.selectedIds.has(id));
      if (unchanged) {
        performanceMetrics.paletteSkippedUnchangedCount += 1;
        return false;
      }
      const changedIds = new Set([
        countryEmphasis.primaryId,
        countryEmphasis.hoverId,
        ...countryEmphasis.selectedIds,
        nextPrimary,
        nextHover,
        ...nextSelected,
      ].map(String).filter(Boolean));
      countryEmphasis = { primaryId: nextPrimary, hoverId: nextHover, selectedIds: nextSelected };
      countryEmphasisRevision += 1;
      markPaletteDirty({ emphasis: true, countryIds: [...changedIds] });
      if (rendererMode !== 'pending') invalidateGpuInteraction('country-emphasis');
      return true;
    }

    function clearCountryEmphasis() {
      return setCountryEmphasis();
    }

    function setInteractionStyle(nextStyle) {
      if (!nextStyle?.hover || !nextStyle?.selection) return false;
      interactionStyle = nextStyle;
      countryEmphasisRevision += 1;
      markPaletteDirty({ emphasis: true });
      if (rendererMode !== 'pending') invalidateGpuInteraction('interaction-style');
      return true;
    }

    function getCountryInteractionBoundaryData() {
      const pendingIds = geometryRevisionTracker.pendingIds().map(String).sort();
      const overriddenIds = [...countryOverrideIds].map(String).sort();
      const visibleIds = meshCountryIds.filter(id => isCountryVisibleById(id));
      const strokeResources = currentCountryStrokeResources();
      return {
        revision: [activeMeshQuality, geometryRevisionTracker.committedRevision(), geometryRevisionTracker.displayedRevision(), mesh?.lineIndices?.length || 0, overrideMesh?.lineIndices?.length || 0, pendingIds.join(','), overriddenIds.join(','), Number(state.layerTreeRevision || 0)].join(':'),
        base: mesh,
        override: overrideMesh,
        countryIds: meshCountryIds,
        pendingIds,
        overriddenIds,
        visibleIds,
        strokeResources,
      };
    }

    function supportsCountryEmphasis() {
      return isWebGlRenderer();
    }

    function setSelectionPass(nextPass) {
      if (selectionPass === nextPass) return !!selectionPass;
      selectionPass?.dispose?.();
      selectionPass = nextPass || null;
      lastSelectionRenderResult = null;
      if (selectionPass && renderDevice && isWebGlRenderer()) {
        selectionPass.initialize?.(renderDevice, { strokeRenderer, polygonPass: polygonOverlayPass });
      }
      invalidateGpuInteraction('selection-pass');
      return !!selectionPass;
    }

    function retainSceneResources() {
      const interactionPackets = [
        ...(renderInteractionState.previewPackets || []),
        ...(renderInteractionState.draftPackets || []),
      ].map(item => item?.packet).filter(Boolean);
      const protectedKeys = new Set([
        ...(renderScene?.polygons || []).filter(packet => packet.protected).map(packet => packet.key),
        ...(renderScene?.strokes || []).filter(packet => packet.protected).map(packet => packet.key),
        ...(selectionPass?.resourceKeys?.() || []),
      ]);
      polygonOverlayPass.retain([
        ...(renderScene?.polygons || []).map(packet => packet.key),
        ...interactionPackets.filter(packet => packet.positions instanceof Float32Array).map(packet => packet.key),
      ], { protectedKeys });
      const countryStrokeKeys = Object.values(currentCountryStrokeResources())
        .map(resource => resource?.packet?.key).filter(Boolean);
      strokeRenderer.retain([
        ...(renderScene?.strokes || []).map(packet => packet.key),
        ...interactionPackets.filter(packet => packet.startsEnds instanceof Float32Array).map(packet => packet.key),
        ...countryStrokeKeys,
        ...(selectionPass?.resourceKeys?.() || []),
      ], { protectedKeys });
    }

    function setRenderScene(nextScene) {
      if (nextScene != null && !isRenderScene(nextScene)) return false;
      const previousBaseSignature = renderScene ? [
        renderScene.revisions?.geometry,
        renderScene.revisions?.style,
        renderScene.revisions?.overlayOrder,
        renderScene.revisions?.countryState,
        renderScene.country?.meshRevision,
        renderScene.country?.overrideRevision,
        renderScene.physical?.hydroVisibilityRevision,
        renderScene.physical?.hydroStyleRevision,
      ].join(':') : '';
      renderScene = nextScene || null;
      renderInteractionState = renderScene?.interaction || Object.freeze({ selectionPacket: null, genericFillItems: Object.freeze([]) });
      lastRenderSceneRevision = Number(renderScene?.revision || 0);
      const nextBaseSignature = renderScene ? [
        renderScene.revisions?.geometry,
        renderScene.revisions?.style,
        renderScene.revisions?.overlayOrder,
        renderScene.revisions?.countryState,
        renderScene.country?.meshRevision,
        renderScene.country?.overrideRevision,
        renderScene.physical?.hydroVisibilityRevision,
        renderScene.physical?.hydroStyleRevision,
      ].join(':') : '';
      retainSceneResources();
      if (previousBaseSignature !== nextBaseSignature) {
        lastBaseSceneResult = null;
        sceneColorCache.invalidate('render-scene');
      }
      return true;
    }

    function setInteractionState(nextInteraction = {}) {
      renderInteractionState = Object.freeze({
        selectionPacket: nextInteraction.selectionPacket || null,
        genericFillKeys: Object.freeze([...(nextInteraction.genericFillKeys || [])].map(String)),
        genericFillItems: Object.freeze([...(nextInteraction.genericFillItems || [])]),
        previewPackets: Object.freeze([...(nextInteraction.previewPackets || [])]),
        draftPackets: Object.freeze([...(nextInteraction.draftPackets || [])]),
      });
      retainSceneResources();
      return true;
    }

    function invalidateSceneCache(reason = 'explicit') {
      sceneColorCache.invalidate(reason);
    }

    function setTerrainManifest(manifest) {
      terrainManifest = manifest?.levels?.length ? manifest : null;
      terrainLastLevel = -1;
      if (terrainManifest && isWebGlRenderer()) {
        for (const spec of visibleTerrainTileSpecs(terrainManifest.levels[0], false)) requestTerrainTile(spec, 10_000);
      }
      invalidatePhysicalScene('terrain-manifest');
    }

    function setFramePresentationListener(listener) {
      framePresentationListener = typeof listener === 'function' ? listener : null;
    }

    function publishLightweightMetrics() {
      const target = window.__PANDOLAB_GPU_METRICS__ ||= {};
      target.renderer = rendererMode;
      target.requestedRevision = currentRenderRevision;
      target.displayedRevision = displayedRenderRevision;
      target.p95CpuSubmitMs = cachedDetailedStats.p95CpuSubmitMs;
      target.p99CpuSubmitMs = cachedDetailedStats.p99CpuSubmitMs;
      target.paletteRebuildCount = performanceMetrics.paletteRebuildCount;
      target.paletteUploadCount = performanceMetrics.paletteUploadCount;
      target.paletteUploadBytes = performanceMetrics.paletteUploadBytes;
      target.hydroViewRequestCount = performanceMetrics.hydroViewRequestCount;
      target.hydroTileWindowCacheHitCount = performanceMetrics.hydroTileWindowCacheHitCount;
      target.hydroTileWindowRecomputeCount = performanceMetrics.hydroTileWindowRecomputeCount;
      target.hydroTileWindowSignature = hydroVisibleTileCache.signature;
      target.canvasWorkerMessageCount = performanceMetrics.canvasWorkerMessageCount;
      target.canvasWorkerMessageBytes = performanceMetrics.canvasWorkerMessageBytes;
      target.countryBaseIndexCount = performanceMetrics.countryBaseIndexCount;
      target.countryBaseFullIndexCount = performanceMetrics.countryBaseFullIndexCount;
      target.countryBaseRangeCount = performanceMetrics.countryBaseRangeCount;
      target.countryVisibleCount = performanceMetrics.countryVisibleCount;
      target.countryCullingFallbackCount = performanceMetrics.countryCullingFallbackCount;
      target.pendingCountryCount = geometryRevisionTracker.pendingIds().length;
      target.pendingOldMeshVisibleCount = pendingOldMeshVisibleCount;
      target.activeWebGlContextCount = renderDevice && isWebGlRenderer() ? 1 : 0;
      target.sceneCacheValid = sceneColorCache.isValid();
      target.projectGeneration = projectGeneration;
      target.projectRenderBlocked = projectRenderBlocked;
      target.mapHost = 'legacy';
    }

    function getRuntimeState() {
      return {
        renderer: rendererMode,
        fallbackReason,
        effectivePixelRatio,
        devicePixelRatio: Math.max(1, Number(window.devicePixelRatio || 1)),
        activeWebGlContextCount: renderDevice && isWebGlRenderer() ? 1 : 0,
        canonicalMeshReady,
        previewAllowed,
        firstCanonicalFrameMs,
        canonicalFrameFallbackCount,
        projectGeneration,
        projectRenderBlocked,
        sceneCacheValid: sceneColorCache.isValid(),
      };
    }

    function getStats({ detailed = true } = {}) {
      if (detailed && performance.now() - cachedDetailedStats.at > 250) {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
        const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0;
        cachedDetailedStats = {
          at: performance.now(),
          p95CpuSubmitMs: Number(p95.toFixed(3)),
          p99CpuSubmitMs: Number(p99.toFixed(3)),
        };
      }
      return {
        renderer: rendererMode,
        mapHost: 'legacy',
        assetRevision: ASSET_REVISION,
        dataRevision: DATA_REVISION,
        dataCacheName: `pandolab-data-${DATA_REVISION}`,
        projectGeneration,
        projectRenderBlocked,
        activeWebGlContextCount: renderDevice && isWebGlRenderer() ? 1 : 0,
        renderSceneRevision: lastRenderSceneRevision,
        sceneCacheValid: sceneColorCache.isValid(),
        sceneCache: sceneColorCache.stats(),
        sceneCacheFullDrawCount,
        sceneCacheInteractionDrawCount,
        sceneCacheReprojectCount,
        selectionOnlyBaseDrawCount: sceneCacheSelectionOnlyBaseDrawCount,
        sceneCacheFallbackFrame,
        canonicalFrameFallbackCount,
        firstCanonicalFrameMs,
        polygonOverlay: polygonOverlayPass.stats(),
        stroke: strokeRenderer.stats(),
        selection: selectionPass?.stats?.() || null,
        lastSelectionRenderResult,
        effectivePixelRatio,
        devicePixelRatio: Math.max(1, Number(window.devicePixelRatio || 1)),
        meshQuality,
        activeMeshQuality,
        canonicalMeshReady,
        availableMeshQualities: [...meshVariants.keys()],
        meshVariantBytes: Object.fromEntries([...meshVariants.entries()].map(([quality, entry]) => [quality, Number(entry.resources?.byteLength || 0)])),
        meshRestorePending: false,
        qualityPhase,
        previewAllowed,
        previewActivationCount,
        previewActivationAfterCanonical,
        canonicalPromotionCount,
        canonicalPromotionError,
        canonicalReadyFrameId,
        meshSwitchCount,
        renderQualityChangeCount,
        renderQuality: { ...renderQuality },
        countries: meshCountryIds.length,
        renderVertices: mesh?.countryIndices?.length || 0,
        triangleCount: (mesh?.triangleIndices?.length || 0) / 3,
        lineSegmentCount: (mesh?.lineIndices?.length || 0) / 2,
        p95CpuSubmitMs: cachedDetailedStats.p95CpuSubmitMs,
        p99CpuSubmitMs: cachedDetailedStats.p99CpuSubmitMs,
        pickCount,
        pickReadPixelsMs: Number(pickReadPixelsMs.toFixed(3)),
        pickLastReadPixelsMs: Number(pickLastReadPixelsMs.toFixed(3)),
        pickSceneRenderCount,
        countryEmphasisRevision,
        countryEmphasis: {
          primaryId: countryEmphasis.primaryId,
          hoverId: countryEmphasis.hoverId,
          selectedIds: [...countryEmphasis.selectedIds],
          boundaryEnabled: false,
          primaryBoundaryColor: interactionStyle.selection.color,
          secondaryBoundaryColor: interactionStyle.selection.color,
        },
        interactionStyle,
        boundaryOwner: 'interaction-overlay',
        visualPassOrder: ['country-fill', 'lake', 'lake-boundary', 'river', 'border-river', 'country-boundary', 'hover', 'secondary-selection', 'primary-selection'],
        emphasizedCountryCount: countryEmphasis.selectedIds.size,
        viewportCss: [Number(cssWidth.toFixed(3)), Number(cssHeight.toFixed(3))],
        canvasBackingPixels: [pixelWidth, pixelHeight],
        layoutMismatchCssPx: Number(lastLayoutMismatchCssPx.toFixed(3)),
        requestedRevision: currentRenderRevision,
        displayedRevision: displayedRenderRevision,
        committedGeometryRevision: geometryRevisionTracker.committedRevision(),
        displayedGeometryRevision: geometryRevisionTracker.displayedRevision(),
        pendingCountryCount: geometryRevisionTracker.pendingIds().length,
        pendingOldMeshVisibleCount,
        geometryRenderTaskToken: geometryRevisionTracker.taskToken(),
        patchWorkerJobs: patchJobScheduler.stats(),
        patchWorkerOutputBytes,
        lastGeometryCommitTimings: lastGeometryCommitTimings ? { ...lastGeometryCommitTimings } : null,
        canvasWorkerBusy,
        canvasWorkerHasPendingFrame: !!canvasWorkerPendingMessage,
        webglContextLost,
        webGlVersion: glVersion || null,
        forcedRenderer: forcedRenderer || null,
        fallbackReason,
        terrainLevel: terrainLastLevel,
        terrainRenderedLevel,
        terrainTargetTileCount,
        terrainTargetTilesLoaded,
        terrainTilesLoaded: terrainTiles.size,
        terrainCacheBytes: [...terrainTiles.values()].reduce((sum, entry) => sum + Number(entry.byteLength || 0), 0),
        terrainTilesLoading: terrainTileRequests.size + terrainFetchQueue.length,
        terrainFetchConcurrency: isMobile() ? 2 : 4,
        hydroFeaturesLoaded: state.hydroFeatureCache?.size || 0,
        hydroPacksLoaded: hydroPacks.size,
        hydroPacksActive: hydroActivePackIds.size,
        hydroEditRevision,
        interactionActive,
        paletteDirty: { ...paletteDirty },
        ...performanceMetrics,
        canvasWorkerMessagesByType: { ...performanceMetrics.canvasWorkerMessagesByType },
        hydroEditBatchCount: hydroEditEntries.length,
        hydroCacheBytes: [...hydroPacks.values()].reduce((sum, entry) => sum + Number(entry.byteLength || 0), 0),
      };
    }

    return {
      attach,
      initialize, replaceBuiltInMesh, renderFrame, renderInteraction,
      resize, verifyLayout, pick, pickHydro, pickHydroAsync,
      rebuildFromCountries, applyCountryPatch, compactCountryOverrides, prioritizeLatest, getStats, getRuntimeState, setTerrainManifest,
      setHydroManifest, loadHydroLogicalFeature, queryHydroLogicalFeatures, retryHydroCache,
      setHydroEdits,
      setHydroInteractionActive, setRenderQuality,
      invalidateHydroVisibility, invalidatePhysicalStyle, resetCountryGeometryVisualState,
      resetProjectRenderState, getProjectGeneration: () => projectGeneration,
      invalidateCountryPalette,
      setCountryEmphasis, clearCountryEmphasis, supportsCountryEmphasis,
      setInteractionStyle, getCountryInteractionBoundaryData,
      setSelectionPass, setRenderScene, setInteractionState, invalidateSceneCache,
      setFramePresentationListener,
      getSelectionRenderResult: () => lastSelectionRenderResult,
      getRenderDevice: () => renderDevice,
    };
  })();
}
