import { MAP_HOST_KINDS, normalizeMapProjectionKind } from "./map-host.js";

export function createMapSurfaceHost({
  getProjectionKind,
  setProjectionKind,
  getViewState,
  setViewState,
  getViewportSize,
  project,
  unproject,
  requestRepaint,
  resize,
  dragBy = null,
  zoomAround = null,
  fitGeometry = null,
  focusCoordinate = null,
  getDebugState = null,
} = {}) {
  let container = null;
  let initialized = false;

  function attach(nextContainer) {
    container = nextContainer || null;
    return !!container;
  }

  async function initialize() {
    initialized = true;
    return true;
  }

  function destroy() {
    initialized = false;
    container = null;
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
    dragBy: (dx, dy, options) => dragBy?.(dx, dy, options) ?? false,
    zoomAround: options => zoomAround?.(options) ?? false,
    fitGeometry: (geometry, options) => fitGeometry?.(geometry, options) ?? false,
    focusCoordinate: (coordinate, options) => focusCoordinate?.(coordinate, options) ?? false,
    getDebugState: options => ({
      kind: MAP_HOST_KINDS.LEGACY,
      ready: initialized,
      projection: normalizeMapProjectionKind(getProjectionKind?.()),
      ...(getDebugState?.(options) || {}),
    }),
  });

  return api;
}
