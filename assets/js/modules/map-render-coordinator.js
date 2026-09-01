const DIRTY_BITS = {
  VIEW: 1 << 0,
  GPU_FRAME: 1 << 1,
  BASE: 1 << 2,
  PROJECTED_OVERLAYS: 1 << 3,
  INTERACTION_OVERLAYS: 1 << 4,
  EDITING_OVERLAYS: 1 << 5,
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
};

export const MAP_RENDER_DIRTY = Object.freeze({
  ...DIRTY_BITS,
  // Compatibility aliases for call sites that are progressively moving to
  // the narrower rendering vocabulary.
  GPU_COUNTRIES: DIRTY_BITS.GPU_FRAME,
  GPU_SCENE: DIRTY_BITS.GPU_FRAME,
  STATIC_OVERLAYS: DIRTY_BITS.OVERLAY_DATA,
  DYNAMIC_OVERLAYS: DIRTY_BITS.INTERACTION_OVERLAYS,
  FULL: Object.values(DIRTY_BITS).reduce((mask, value) => mask | value, 0),
});

// A view gesture only changes uniforms/positions.  Scene geometry is rebuilt
// by an explicit GPU_SCENE invalidation (or by the external MapLibre frame),
// so it must not be pulled into every interaction frame.
const INTERACTION_MASK = MAP_RENDER_DIRTY.VIEW
  | MAP_RENDER_DIRTY.SELECTION_VIEW
  | MAP_RENDER_DIRTY.LABEL_POSITIONS;

const SETTLE_MASK = MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.HUD;

const STRING_MASKS = Object.freeze({
  full: MAP_RENDER_DIRTY.FULL,
  view: INTERACTION_MASK,
  countries: MAP_RENDER_DIRTY.GPU_FRAME,
  'gpu-frame': MAP_RENDER_DIRTY.GPU_FRAME,
  'static-overlays': MAP_RENDER_DIRTY.OVERLAY_DATA,
  'projected-overlays': MAP_RENDER_DIRTY.PROJECTED_OVERLAYS,
  'dynamic-overlays': MAP_RENDER_DIRTY.INTERACTION_OVERLAYS,
  'interaction-overlays': MAP_RENDER_DIRTY.INTERACTION_OVERLAYS,
  'selection-data': MAP_RENDER_DIRTY.SELECTION_DATA,
  'selection-view': MAP_RENDER_DIRTY.SELECTION_VIEW,
  'selection-style': MAP_RENDER_DIRTY.SELECTION_STYLE,
  'gpu-interaction': MAP_RENDER_DIRTY.GPU_INTERACTION,
  'overlay-geometry': MAP_RENDER_DIRTY.OVERLAY_GEOMETRY,
  'overlay-style': MAP_RENDER_DIRTY.OVERLAY_STYLE,
  'country-patch': MAP_RENDER_DIRTY.COUNTRY_PATCH,
  'generic-patch': MAP_RENDER_DIRTY.GENERIC_PATCH,
  'hydro-edit-patch': MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH,
  'territorial-patch': MAP_RENDER_DIRTY.TERRITORIAL_PATCH,
  labels: MAP_RENDER_DIRTY.LABEL_LAYOUT,
  'layer-tree': MAP_RENDER_DIRTY.LAYER_TREE,
});

function normalizedMask(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value | 0;
  if (typeof value === 'string') return STRING_MASKS[value] || MAP_RENDER_DIRTY.FULL;
  if (Array.isArray(value) || value instanceof Set) return [...value].reduce((mask, entry) => mask | normalizedMask(entry), 0);
  return MAP_RENDER_DIRTY.FULL;
}

export function createMapRenderCoordinator({
  requestFrame,
  prepareView,
  renderers,
  onFrameComplete = null,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
}) {
  let renderRevision = 0;
  let frameQueued = false;
  let rendering = false;
  let pendingMask = 0;
  let interactionActive = false;
  let settleTimer = 0;
  const pendingReasons = new Set();
  const metrics = {
    fullRenderCount: 0,
    viewRenderCount: 0,
    requestCount: 0,
    mergedRequestCount: 0,
    labelLayoutCount: 0,
    lastRenderMs: 0,
    lastMode: '',
    lastDirtyMask: 0,
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

  function render({ dirtyMask = MAP_RENDER_DIRTY.FULL, reasons = [] } = {}) {
    const mask = normalizedMask(dirtyMask);
    const startedAt = now();
    const rendererTimes = {};
    const full = (mask & MAP_RENDER_DIRTY.FULL) === MAP_RENDER_DIRTY.FULL;
    rendering = true;
    renderRevision += 1;
    try {
      const needsView = !!(mask & (MAP_RENDER_DIRTY.VIEW | MAP_RENDER_DIRTY.GPU_FRAME | MAP_RENDER_DIRTY.GPU_INTERACTION
        | MAP_RENDER_DIRTY.BASE | MAP_RENDER_DIRTY.PROJECTED_OVERLAYS | MAP_RENDER_DIRTY.INTERACTION_OVERLAYS
        | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.SELECTION_VIEW | MAP_RENDER_DIRTY.SELECTION_STYLE
        | MAP_RENDER_DIRTY.EDITING_OVERLAYS | MAP_RENDER_DIRTY.LABEL_POSITIONS | MAP_RENDER_DIRTY.LABEL_LAYOUT
        | MAP_RENDER_DIRTY.COUNTRY_PATCH | MAP_RENDER_DIRTY.GENERIC_PATCH
        | MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH | MAP_RENDER_DIRTY.TERRITORIAL_PATCH));
      const viewState = needsView ? prepareView() : undefined;
      const viewRevision = Number(viewState?.revision ?? viewState ?? 0);

      // Legacy WebGL/Canvas hosts still need a view draw. MapLibre owns its
      // own custom-layer frame and therefore returns no-op from this hook.
      if (!full && (mask & MAP_RENDER_DIRTY.VIEW)) callRenderer('view', rendererTimes, viewState);

      if (mask & MAP_RENDER_DIRTY.BASE) callRenderer('base', rendererTimes, viewState);

      if (mask & (MAP_RENDER_DIRTY.OVERLAY_DATA | MAP_RENDER_DIRTY.OVERLAY_GEOMETRY | MAP_RENDER_DIRTY.OVERLAY_STYLE)) {
        callRenderer('hydro', rendererTimes, viewState);
        callRenderer('hydroEdits', rendererTimes, viewState);
        callRenderer('territorialUnits', rendererTimes, viewState);
        callRenderer('distributions', rendererTimes, viewState);
        callRenderer('genericFeatures', rendererTimes, viewState);
        callRenderer('stackOverlays', rendererTimes, viewState);
      } else if (mask & MAP_RENDER_DIRTY.PROJECTED_OVERLAYS) {
        callRenderer('projectedOverlays', rendererTimes, viewState);
        callRenderer('stackOverlays', rendererTimes, viewState);
      } else {
        if (mask & MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH) callRenderer('hydroEdits', rendererTimes, viewState);
        if (mask & MAP_RENDER_DIRTY.TERRITORIAL_PATCH) callRenderer('territorialUnits', rendererTimes, viewState);
        if (mask & MAP_RENDER_DIRTY.GENERIC_PATCH) callRenderer('genericFeatures', rendererTimes, viewState);
      }

      if (mask & (MAP_RENDER_DIRTY.GPU_FRAME | MAP_RENDER_DIRTY.OVERLAY_DATA
        | MAP_RENDER_DIRTY.OVERLAY_GEOMETRY | MAP_RENDER_DIRTY.OVERLAY_STYLE
        | MAP_RENDER_DIRTY.COUNTRY_PATCH | MAP_RENDER_DIRTY.GENERIC_PATCH | MAP_RENDER_DIRTY.TERRITORIAL_PATCH)) {
        callRenderer('countries', rendererTimes, viewState);
      }

      if (mask & MAP_RENDER_DIRTY.INTERACTION_OVERLAYS) {
        callRenderer('geometryPreview', rendererTimes, viewState);
        callRenderer('validation', rendererTimes, viewState);
      }

      if (mask & MAP_RENDER_DIRTY.SELECTION_DATA) {
        callRenderer('selectionData', rendererTimes, viewState);
      } else if (mask & MAP_RENDER_DIRTY.SELECTION_STYLE) {
        callRenderer('selectionStyle', rendererTimes, viewState);
      } else if (mask & MAP_RENDER_DIRTY.SELECTION_VIEW) {
        callRenderer('selectionView', rendererTimes, viewState);
      }
      if ((mask & MAP_RENDER_DIRTY.GPU_INTERACTION)
        && !(mask & (MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.SELECTION_STYLE | MAP_RENDER_DIRTY.SELECTION_VIEW))) {
        callRenderer('gpuInteraction', rendererTimes, viewState);
      }

      if (mask & MAP_RENDER_DIRTY.EDITING_OVERLAYS) {
        const domainPatch = mask & (MAP_RENDER_DIRTY.COUNTRY_PATCH | MAP_RENDER_DIRTY.GENERIC_PATCH
          | MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH | MAP_RENDER_DIRTY.TERRITORIAL_PATCH);
        if (!(mask & MAP_RENDER_DIRTY.OVERLAY_DATA) && !domainPatch) {
          callRenderer('hydroEdits', rendererTimes, viewState);
        }
        if (!domainPatch || (mask & MAP_RENDER_DIRTY.COUNTRY_PATCH)) {
          callRenderer('boundaryEdit', rendererTimes, viewState);
        }
        callRenderer('vertices', rendererTimes, viewState);
        callRenderer('draft', rendererTimes, viewState);
        callRenderer('snapIndicator', rendererTimes, viewState);
      }

      if (mask & MAP_RENDER_DIRTY.LABEL_LAYOUT) {
        const labelLayout = callRenderer('labelLayout', rendererTimes, viewState);
        if (renderers.labelLayout) metrics.labelLayoutCount += 1;
        callRenderer('countryLabels', rendererTimes, labelLayout, viewState);
        callRenderer('userLabels', rendererTimes, labelLayout, viewState);
      } else if (mask & MAP_RENDER_DIRTY.LABEL_POSITIONS) {
        callRenderer('countryLabelPositions', rendererTimes, viewState);
        callRenderer('userLabelPositions', rendererTimes, viewState);
      }

      if (mask & MAP_RENDER_DIRTY.LAYER_TREE) callRenderer('layerTree', rendererTimes);
      metrics.lastRenderMs = Math.max(0, now() - startedAt);
      metrics.lastMode = full ? 'full' : 'partial';
      metrics.lastDirtyMask = mask;
      metrics.lastReasons = [...reasons];
      metrics.lastRendererTimes = rendererTimes;
      if (mask & MAP_RENDER_DIRTY.HUD) callRenderer('debug', rendererTimes);
      metrics.recentFrames.push({ revision: renderRevision, mode: metrics.lastMode, dirtyMask: mask, reasons: [...reasons] });
      if (metrics.recentFrames.length > 20) metrics.recentFrames.splice(0, metrics.recentFrames.length - 20);
      if (full) metrics.fullRenderCount += 1;
      else metrics.viewRenderCount += 1;
      try {
        onFrameComplete?.({
          renderRevision,
          durationMs: metrics.lastRenderMs,
          dirtyMask: mask,
          reasons: [...reasons],
          rendererTimes: { ...rendererTimes },
          interactionActive,
          full,
        });
      } catch (_) {}
      return {
        renderRevision,
        viewRevision,
        viewState,
        viewOnly: mask === INTERACTION_MASK,
      };
    } finally {
      rendering = false;
      if (pendingMask && !frameQueued) queueFrame();
    }
  }

  function queueFrame() {
    if (frameQueued) return false;
    frameQueued = true;
    requestFrame(() => {
      frameQueued = false;
      const dirtyMask = pendingMask || INTERACTION_MASK;
      const reasons = [...pendingReasons];
      pendingMask = 0;
      pendingReasons.clear();
      render({ dirtyMask, reasons });
    });
    return true;
  }

  function invalidate(mask = MAP_RENDER_DIRTY.FULL, reason = '') {
    const nextMask = normalizedMask(mask);
    metrics.requestCount += 1;
    if (pendingMask || frameQueued || rendering) metrics.mergedRequestCount += 1;
    pendingMask |= nextMask;
    if (reason) pendingReasons.add(String(reason));
    return queueFrame();
  }

  function scheduleFull(reason = 'full') {
    return invalidate(MAP_RENDER_DIRTY.FULL, reason);
  }

  function scheduleView(reason = 'view') {
    return invalidate(INTERACTION_MASK, reason);
  }

  function beginInteraction(reason = 'interaction') {
    interactionActive = true;
    clearTimeout(settleTimer);
    settleTimer = 0;
    if (reason) pendingReasons.add(String(reason));
  }

  function endInteraction(reason = 'interaction-end') {
    interactionActive = false;
    clearTimeout(settleTimer);
    settleTimer = 0;
    invalidate(SETTLE_MASK, reason);
    return true;
  }

  function advanceRevision() {
    renderRevision += 1;
    return renderRevision;
  }

  return Object.freeze({
    renderFull: () => render({ dirtyMask: MAP_RENDER_DIRTY.FULL }),
    renderView: () => render({ dirtyMask: INTERACTION_MASK }),
    renderFrame: ({ mode = 'full', dirtyMask = null, reasons = [] } = {}) => render({
      dirtyMask: dirtyMask == null ? (mode === 'view' ? INTERACTION_MASK : MAP_RENDER_DIRTY.FULL) : dirtyMask,
      reasons,
    }),
    invalidate,
    scheduleFull,
    scheduleView,
    beginInteraction,
    endInteraction,
    isInteractionActive: () => interactionActive,
    advanceRevision,
    revision: () => renderRevision,
    getStats: () => ({
      ...metrics,
      lastReasons: [...metrics.lastReasons],
      lastRendererTimes: { ...metrics.lastRendererTimes },
      recentFrames: metrics.recentFrames.map(frame => ({ ...frame, reasons: [...frame.reasons] })),
      pendingMask,
      pendingMode: pendingMask === MAP_RENDER_DIRTY.FULL ? 'full' : pendingMask ? 'partial' : null,
      frameQueued,
      interactionActive,
      settlePending: !!settleTimer,
    }),
  });
}
