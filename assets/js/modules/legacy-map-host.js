import { MAP_HOST_KINDS, createMapHostEventHub, normalizeMapProjectionKind } from './map-host.js';

export function createLegacyMapHost({
  getProjectionKind,
  setProjectionKind,
  getViewState,
  setViewState,
  getViewportSize,
  project,
  unproject,
  requestRepaint,
  resize,
  panBy = null,
  zoomAround = null,
  fitGeometry = null,
  focusCoordinate = null,
  getDebugState = null,
} = {}) {
  const events = createMapHostEventHub();
  let container = null;
  let initialized = false;

  function attach(nextContainer) {
    container = nextContainer || null;
    return !!container;
  }

  async function initialize() {
    initialized = true;
    events.emit('ready', { host: api });
    return true;
  }

  function destroy() {
    initialized = false;
    container = null;
    events.clear();
  }

  const api = Object.freeze({
    attach,
    initialize,
    destroy,
    getKind: () => MAP_HOST_KINDS.LEGACY,
    isReady: () => initialized,
    getProjectionKind: () => normalizeMapProjectionKind(getProjectionKind?.()),
    setProjectionKind: kind => !!setProjectionKind?.(normalizeMapProjectionKind(kind)),
    getViewState: () => getViewState?.() || null,
    setViewState: (view, options) => !!setViewState?.(view, options),
    getViewportSize: () => getViewportSize?.() || { width: 1, height: 1, dpr: 1 },
    project: coordinate => project?.(coordinate) || null,
    unproject: point => unproject?.(point) || null,
    requestRepaint: reason => requestRepaint?.(reason) ?? false,
    resize: () => resize?.() ?? false,
    panBy: (dx, dy, options) => panBy?.(dx, dy, options) ?? false,
    zoomAround: options => zoomAround?.(options) ?? false,
    fitGeometry: (geometry, options) => fitGeometry?.(geometry, options) ?? false,
    focusCoordinate: (coordinate, options) => focusCoordinate?.(coordinate, options) ?? false,
    setNavigationEnabled: () => false,
    setForcedPan: () => false,
    getRenderDevice: () => null,
    on: events.on,
    off: events.off,
    getDebugState: () => ({
      kind: MAP_HOST_KINDS.LEGACY,
      ready: initialized,
      projection: normalizeMapProjectionKind(getProjectionKind?.()),
      ...(getDebugState?.() || {}),
    }),
  });

  return api;
}
