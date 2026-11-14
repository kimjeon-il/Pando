const DIRTY_BITS = {
  VIEW: 1 << 0,
  GPU_FRAME: 1 << 1,
  BASE: 1 << 2,
  PROJECTED_OVERLAYS: 1 << 3,
  LABEL_POSITIONS: 1 << 6,
  LABEL_LAYOUT: 1 << 7,
  LAYER_TREE: 1 << 8,
  HUD: 1 << 9,
  OVERLAY_DATA: 1 << 10,
  SELECTION_DATA: 1 << 11,
  SELECTION_VIEW: 1 << 12,
  SELECTION_STYLE: 1 << 13,
  GPU_INTERACTION: 1 << 14,
  OVERLAY_GEOMETRY: 1 << 15,
  OVERLAY_STYLE: 1 << 16,
  COUNTRY_PATCH: 1 << 17,
  GENERIC_PATCH: 1 << 18,
  HYDRO_EDIT_PATCH: 1 << 19,
  TERRITORIAL_PATCH: 1 << 20,
  RESIZE: 1 << 21,
  PROJECTION: 1 << 22,
  PROJECT: 1 << 23,
  VIEW_PRESENTATION: 1 << 24,
};

export const MAP_RENDER_DIRTY = Object.freeze({
  ...DIRTY_BITS,
});

const WORK_DIRTY_MASK = Object.entries(DIRTY_BITS)
  .filter(([name]) => !['RESIZE', 'PROJECTION', 'PROJECT'].includes(name))
  .reduce((mask, [, value]) => mask | value, 0);
const KNOWN_DIRTY_MASK = Object.values(DIRTY_BITS).reduce((mask, value) => mask | value, 0);

// A view gesture only changes uniforms/positions.  Scene geometry is rebuilt
// by an explicit scene invalidation,
// so it must not be pulled into every interaction frame.
const INTERACTION_MASK = MAP_RENDER_DIRTY.VIEW
  | MAP_RENDER_DIRTY.GPU_FRAME
  | MAP_RENDER_DIRTY.LABEL_POSITIONS
  | MAP_RENDER_DIRTY.VIEW_PRESENTATION;

// The viewport filters persistent object packets. Re-evaluate that set once
// navigation ends so newly visible descendants contribute land and terrain
// without waiting for an unrelated style change or background loading event.
const SETTLE_MASK = MAP_RENDER_DIRTY.OVERLAY_GEOMETRY
  | MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.HUD;
// One GPU result must exist before map-attached DOM can advance.
const SCENE_GPU_MASK = MAP_RENDER_DIRTY.BASE | MAP_RENDER_DIRTY.OVERLAY_DATA
  | MAP_RENDER_DIRTY.OVERLAY_GEOMETRY | MAP_RENDER_DIRTY.OVERLAY_STYLE
  | MAP_RENDER_DIRTY.COUNTRY_PATCH | MAP_RENDER_DIRTY.GENERIC_PATCH
  | MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH | MAP_RENDER_DIRTY.TERRITORIAL_PATCH;
const REPROJECT_MASK = MAP_RENDER_DIRTY.VIEW
  | MAP_RENDER_DIRTY.BASE
  | MAP_RENDER_DIRTY.PROJECTED_OVERLAYS
  | MAP_RENDER_DIRTY.OVERLAY_GEOMETRY
  | MAP_RENDER_DIRTY.LABEL_LAYOUT
  | MAP_RENDER_DIRTY.HUD
  | MAP_RENDER_DIRTY.VIEW_PRESENTATION;

export const MAP_RENDER_MASKS = Object.freeze({
  VIEW: INTERACTION_MASK,
  VIEW_SETTLE: INTERACTION_MASK | SETTLE_MASK,
  RESIZE: MAP_RENDER_DIRTY.RESIZE,
  PROJECTION: MAP_RENDER_DIRTY.PROJECTION,
  PROJECT: MAP_RENDER_DIRTY.PROJECT,
});

export class RenderInvalidationError extends TypeError {
  constructor(input, reason = '') {
    super(`Invalid render invalidation mask: ${String(input)}`);
    this.name = 'RenderInvalidationError';
    this.code = 'PL-RENDER-MASK-001';
    this.input = input;
    this.reason = String(reason || '');
    this.knownMask = KNOWN_DIRTY_MASK;
  }
}

function validatedMask(value, reason = '') {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value <= 0 || value > KNOWN_DIRTY_MASK || (value & ~KNOWN_DIRTY_MASK) !== 0) {
    throw new RenderInvalidationError(value, reason);
  }
  return value;
}

function expandedMask(requestedMask) {
  let mask = requestedMask & WORK_DIRTY_MASK;
  if (requestedMask & (MAP_RENDER_DIRTY.RESIZE | MAP_RENDER_DIRTY.PROJECTION)) mask |= REPROJECT_MASK;
  if (requestedMask & MAP_RENDER_DIRTY.PROJECT) mask |= WORK_DIRTY_MASK;
  if (requestedMask & (SCENE_GPU_MASK & ~MAP_RENDER_DIRTY.BASE)) mask |= MAP_RENDER_DIRTY.VIEW_PRESENTATION;
  return mask;
}

export function createMapRenderCoordinator({
  requestFrame,
  prepareView,
  renderers,
  isPresentationBlocked = () => false,
  canPresentFrame = (_frame, result) => !result?.preserved,
  onFrameComplete = null,
  invalidMaskMode = 'throw',
  onInvalidMask = null,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
}) {
  if (invalidMaskMode !== 'throw' && invalidMaskMode !== 'report') {
    throw new TypeError(`Unknown invalid mask mode: ${String(invalidMaskMode)}`);
  }
  let renderRevision = 0;
  let frameQueued = false;
  let rendering = false;
  let pendingMask = 0;
  let deferredPresentationMask = 0;
  let interactionActive = false;
  const pendingReasons = new Set();
  const metrics = {
    fullRenderCount: 0,
    viewRenderCount: 0,
    requestCount: 0,
    mergedRequestCount: 0,
    labelLayoutCount: 0,
    lastRenderMs: 0,
    lastMode: '',
    lastRequestedMask: 0,
    lastDirtyMask: 0,
    lastInvalidMask: null,
    invalidMaskCount: 0,
    viewFrameCount: 0,
    resizeFrameCount: 0,
    projectionFrameCount: 0,
    projectFrameCount: 0,
    lastReasons: [],
    lastRendererTimes: {},
    recentFrames: [],
  };

  function callRenderer(name, rendererTimes, ...args) {
    const renderer = renderers[name];
    if (typeof renderer !== 'function') return undefined;
    const startedAt = now();
    const value = renderer(...args);
    rendererTimes[name] = Math.max(0, now() - startedAt);
    return value;
  }

  const presentationMask = MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.VIEW_PRESENTATION
    | MAP_RENDER_DIRTY.LABEL_POSITIONS | MAP_RENDER_DIRTY.PROJECTED_OVERLAYS
    | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.SELECTION_STYLE | MAP_RENDER_DIRTY.SELECTION_VIEW
    | MAP_RENDER_DIRTY.GPU_INTERACTION | MAP_RENDER_DIRTY.LAYER_TREE | MAP_RENDER_DIRTY.HUD;

  function render({ dirtyMask, reasons = [], queuedAtMs = now() }) {
    // A replacement owns no display frame until its renderer commits one.
    // Preserve the whole old presentation, including DOM labels and shell.
    if (isPresentationBlocked()) {
      deferredPresentationMask |= expandedMask(dirtyMask);
      renderers.preservedFrame?.();

      return { deferred: true, renderRevision };
    }
    const requestedMask = dirtyMask;
    let mask = expandedMask(requestedMask | deferredPresentationMask);
    if (interactionActive) mask &= ~MAP_RENDER_DIRTY.LABEL_LAYOUT;
    const startedAt = now();
    const rendererTimes = {};
    const full = !!(requestedMask & MAP_RENDER_DIRTY.PROJECT);
    const viewFrame = requestedMask === MAP_RENDER_MASKS.VIEW
      || requestedMask === MAP_RENDER_MASKS.VIEW_SETTLE;
    rendering = true;
    renderRevision += 1;
    try {
      const viewState = prepareView({ frameId: renderRevision });
      const viewRevision = Number(viewState?.revision ?? viewState ?? 0);

      // Give domains one stable frame boundary so live render resources are
      // refreshed once before any pass consumes the shared snapshot.
      callRenderer('beginFrame', rendererTimes, viewState && typeof viewState === 'object'
        ? viewState
        : { frameId: renderRevision });

      // One coordinator frame is used by the map host and all render passes.
      // No second custom-layer rendering cycle may publish another view.
      let viewFrameResult = !full && (mask & MAP_RENDER_DIRTY.VIEW) && !(mask & SCENE_GPU_MASK)
        ? callRenderer('view', rendererTimes, viewState)
        : null;

      if (mask & MAP_RENDER_DIRTY.BASE) callRenderer('base', rendererTimes, viewState);

      let overlayStackNeeded = false;
      if (mask & (MAP_RENDER_DIRTY.OVERLAY_DATA | MAP_RENDER_DIRTY.OVERLAY_GEOMETRY | MAP_RENDER_DIRTY.OVERLAY_STYLE)) {
        callRenderer('hydro', rendererTimes, viewState);
        callRenderer('hydroEdits', rendererTimes, viewState);
        callRenderer('territorialUnits', rendererTimes, viewState);
        callRenderer('distributions', rendererTimes, viewState);
        callRenderer('genericFeatures', rendererTimes, viewState);
        overlayStackNeeded = true;
      } else {
        if (mask & MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH) callRenderer('hydroEdits', rendererTimes, viewState);
        if (mask & MAP_RENDER_DIRTY.TERRITORIAL_PATCH) callRenderer('territorialUnits', rendererTimes, viewState);
        if (mask & MAP_RENDER_DIRTY.GENERIC_PATCH) callRenderer('genericFeatures', rendererTimes, viewState);
      }
      if (mask & SCENE_GPU_MASK) {
        viewFrameResult = callRenderer('countries', rendererTimes, viewState);
      } else if (!viewFrameResult && ((mask & MAP_RENDER_DIRTY.GPU_FRAME)
        || ((mask & MAP_RENDER_DIRTY.GPU_INTERACTION) && !canPresentFrame(viewState)))) {
        // Upload completions also arrive as interaction invalidations. They
        // must be allowed to finish the pending map before DOM publication.
        viewFrameResult = callRenderer('view', rendererTimes, viewState);
      }

      const gpuDrawRequired = !!(mask & (MAP_RENDER_DIRTY.VIEW | MAP_RENDER_DIRTY.GPU_FRAME | SCENE_GPU_MASK));
      const matchingGpuFrame = viewFrameResult?.succeeded === true
        && viewFrameResult.frameId === viewState?.frameId
        && viewFrameResult.viewRevision === viewState?.viewRevision
        && viewFrameResult.projectionRevision === viewState?.projectionRevision;
      if ((gpuDrawRequired && !matchingGpuFrame) || !canPresentFrame(viewState, viewFrameResult)) {
        // A lost WebGL context cannot publish a scene or new view. Its missing
        // selection strokes still need current-view SVG fallback coverage.
        // Never use this escape hatch for a project/date/camera transition:
        // those continue to preserve the previously accepted presentation.
        if ((mask & MAP_RENDER_DIRTY.SELECTION_DATA)
          && !(mask & (MAP_RENDER_DIRTY.VIEW | MAP_RENDER_DIRTY.VIEW_PRESENTATION
            | MAP_RENDER_DIRTY.SELECTION_VIEW))
          && !(requestedMask & (MAP_RENDER_DIRTY.PROJECT | MAP_RENDER_DIRTY.PROJECTION
            | MAP_RENDER_DIRTY.RESIZE))
          && renderers.canRenderRecoverySelection?.(viewState) === true) {
          callRenderer('selectionRecovery', rendererTimes, viewState);
        }
        deferredPresentationMask |= mask & presentationMask;
        return { deferred: true, renderRevision };
      }
      deferredPresentationMask = 0;
      if (mask & MAP_RENDER_DIRTY.PROJECTED_OVERLAYS) callRenderer('projectedOverlays', rendererTimes, viewState);
      if (overlayStackNeeded || (mask & MAP_RENDER_DIRTY.PROJECTED_OVERLAYS)) callRenderer('stackOverlays', rendererTimes, viewState);

      if (mask & MAP_RENDER_DIRTY.SELECTION_DATA) {
        callRenderer('selectionData', rendererTimes, viewState);
      } else if (mask & MAP_RENDER_DIRTY.SELECTION_STYLE) {
        callRenderer('selectionStyle', rendererTimes, viewState);
      } else if (mask & MAP_RENDER_DIRTY.SELECTION_VIEW) {
        callRenderer('selectionView', rendererTimes, viewState, viewFrameResult, {
          viewOnly: true,
          updateData: false,
          sparseFallbackOnly: true,
        });
      } else if (mask & MAP_RENDER_DIRTY.VIEW) {
        // The main view renderer already drew the GPU interaction passes.
        // Pass that exact result through and only move sparse SVG fallbacks.
        callRenderer('selectionView', rendererTimes, viewState, viewFrameResult, {
          viewOnly: true,
          updateData: false,
          sparseFallbackOnly: true,
        });
      }
      if ((mask & MAP_RENDER_DIRTY.GPU_INTERACTION)
        && !(mask & (MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.SELECTION_STYLE | MAP_RENDER_DIRTY.SELECTION_VIEW))) {
        const interactionResult = callRenderer('gpuInteraction', rendererTimes, viewState);
        // A stroke upload can complete without a selection or camera change.
        // Commit its coverage to the temporary SVG layer in this same frame.
        callRenderer('selectionView', rendererTimes, viewState, interactionResult, {
          viewOnly: true,
          updateData: false,
          sparseFallbackOnly: true,
        });
      }

      if (mask & MAP_RENDER_DIRTY.LABEL_LAYOUT) {
        const labelLayout = callRenderer('labelLayout', rendererTimes, viewState);
        if (renderers.labelLayout) metrics.labelLayoutCount += 1;
        callRenderer('territorialLabels', rendererTimes, labelLayout, viewState);
        callRenderer('userLabels', rendererTimes, labelLayout, viewState);
      }

      if (mask & MAP_RENDER_DIRTY.VIEW_PRESENTATION) {
        callRenderer('viewPresentation', rendererTimes, viewState, viewFrameResult);
      }

      if (mask & MAP_RENDER_DIRTY.LAYER_TREE) callRenderer('objectSearch', rendererTimes);
      metrics.lastRenderMs = Math.max(0, now() - startedAt);
      metrics.lastMode = full ? 'full' : 'partial';
      metrics.lastRequestedMask = requestedMask;
      metrics.lastDirtyMask = mask;
      metrics.lastReasons = [...reasons];
      metrics.lastRendererTimes = rendererTimes;
      if (mask & MAP_RENDER_DIRTY.HUD) callRenderer('debug', rendererTimes);
      const frameKind = requestedMask & MAP_RENDER_DIRTY.PROJECT ? 'project'
        : requestedMask & MAP_RENDER_DIRTY.PROJECTION ? 'projection'
          : requestedMask & MAP_RENDER_DIRTY.RESIZE ? 'resize'
            : viewFrame ? 'view' : 'partial';
      metrics.recentFrames.push({
        revision: renderRevision,
        mode: metrics.lastMode,
        frameKind,
        requestedMask,
        dirtyMask: mask,
        durationMs: metrics.lastRenderMs,
        queuedMs: Math.max(0, startedAt - queuedAtMs),
        rendererTimes: { ...rendererTimes },
        reasons: [...reasons],
      });
      if (metrics.recentFrames.length > 20) metrics.recentFrames.splice(0, metrics.recentFrames.length - 20);
      if (full) metrics.fullRenderCount += 1;
      else metrics.viewRenderCount += 1;
      if (requestedMask & MAP_RENDER_DIRTY.PROJECT) metrics.projectFrameCount += 1;
      else if (requestedMask & MAP_RENDER_DIRTY.PROJECTION) metrics.projectionFrameCount += 1;
      else if (requestedMask & MAP_RENDER_DIRTY.RESIZE) metrics.resizeFrameCount += 1;
      else if (viewFrame) metrics.viewFrameCount += 1;
      try {
        onFrameComplete?.({
          renderRevision,
          durationMs: metrics.lastRenderMs,
          queuedAtMs,
          requestedMask,
          dirtyMask: mask,
          reasons: [...reasons],
          rendererTimes: { ...rendererTimes },
          interactionActive,
          full,
          frameKind,
          viewFrame,
          displayFrame: viewFrameResult?.succeeded === true,
        });
      } catch (_) {}
      return {
        renderRevision,
        viewRevision,
        viewState,
        viewOnly: requestedMask === MAP_RENDER_MASKS.VIEW,
      };
    } finally {
      rendering = false;
      if (pendingMask && !frameQueued) queueFrame();
    }
  }

  function queueFrame() {
    if (frameQueued) return false;
    frameQueued = true;
    const queuedAtMs = now();
    requestFrame(() => {
      frameQueued = false;
      const dirtyMask = pendingMask;
      const reasons = [...pendingReasons];
      pendingMask = 0;
      pendingReasons.clear();
      render({ dirtyMask, reasons, queuedAtMs });
    });
    return true;
  }

  function invalidate(mask, reason = '') {
    let nextMask;
    try {
      nextMask = validatedMask(mask, reason);
    } catch (error) {
      metrics.invalidMaskCount += 1;
      metrics.lastInvalidMask = error.input;
      try { onInvalidMask?.(error); } catch (_) {}
      if (invalidMaskMode === 'throw') throw error;
      return false;
    }
    metrics.requestCount += 1;
    if (pendingMask || frameQueued || rendering) metrics.mergedRequestCount += 1;
    pendingMask |= nextMask;
    if (reason) pendingReasons.add(String(reason));
    return queueFrame();
  }

  function beginInteraction(reason = 'interaction') {
    interactionActive = true;
    if (reason) pendingReasons.add(String(reason));
  }

  function endInteraction(reason = 'interaction-end') {
    interactionActive = false;
    invalidate(MAP_RENDER_MASKS.VIEW_SETTLE, reason);
    return true;
  }

  return Object.freeze({
    invalidate,

    beginInteraction,
    endInteraction,
    getStats: () => ({
      ...metrics,
      renderRevision,
      lastReasons: [...metrics.lastReasons],
      lastRendererTimes: { ...metrics.lastRendererTimes },
      recentFrames: metrics.recentFrames.map(frame => ({ ...frame, reasons: [...frame.reasons],
        rendererTimes: { ...frame.rendererTimes } })),
      pendingMask,
      pendingMode: pendingMask & MAP_RENDER_DIRTY.PROJECT ? 'full' : pendingMask ? 'partial' : null,
      frameQueued,
      interactionActive,
    }),
  });
}
