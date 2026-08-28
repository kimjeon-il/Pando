const workerStates = new WeakMap();
const STALE_BITMAP_GRACE_MS = 48;
let installed = false;

function publicMetrics() {
  return window.__PANDOLAB_BOUNDARY_GHOSTING__ ||= {
    installed: false,
    transitionActive: false,
    pendingGeometryRevision: 0,
    hiddenAt: 0,
    restoredAt: 0,
    lastRestoredGeometryRevision: 0,
  };
}

function currentMapCanvas() {
  return document.querySelector('.gpu-map-canvas');
}

function hideStaleCanvas(state) {
  if (!state.pendingGeometryRevision) return;
  const metrics = window.__PANDOLAB_GPU_METRICS__ || {};
  if (Number(metrics.pendingCountryCount || 0) <= 0) return;
  if (Number(metrics.displayedGeometryRevision || 0) >= state.pendingGeometryRevision) return;

  const canvas = currentMapCanvas();
  if (!canvas) return;
  canvas.style.visibility = 'hidden';
  canvas.dataset.geometryTransitionHidden = 'true';
  state.hiddenCanvas = canvas;

  const exposed = publicMetrics();
  exposed.transitionActive = true;
  exposed.pendingGeometryRevision = state.pendingGeometryRevision;
  exposed.hiddenAt = performance.now();
}

function restoreCanvas(state, geometryRevision) {
  const canvas = state.hiddenCanvas;
  if (canvas?.isConnected && canvas.dataset.geometryTransitionHidden === 'true') {
    canvas.style.visibility = '';
    delete canvas.dataset.geometryTransitionHidden;
  }
  state.hiddenCanvas = null;
  state.pendingGeometryRevision = 0;
  if (state.hideTimer) clearTimeout(state.hideTimer);
  state.hideTimer = 0;

  const exposed = publicMetrics();
  exposed.transitionActive = false;
  exposed.pendingGeometryRevision = 0;
  exposed.restoredAt = performance.now();
  exposed.lastRestoredGeometryRevision = Math.max(
    Number(exposed.lastRestoredGeometryRevision || 0),
    Number(geometryRevision || 0),
  );
}

function frameIsCurrent(frame, state) {
  const metrics = window.__PANDOLAB_GPU_METRICS__ || {};
  const frameRevision = Number(frame.revision || 0);
  const frameGeometryRevision = Number(frame.geometryRevision || 0);
  const requestedRevision = Number(metrics.requestedRevision || state.latestRequestedRevision || 0);
  const committedGeometryRevision = Number(metrics.committedGeometryRevision || state.pendingGeometryRevision || 0);
  return frameRevision >= requestedRevision
    && frameGeometryRevision >= committedGeometryRevision
    && frameGeometryRevision >= state.pendingGeometryRevision;
}

function ensureWorkerState(worker) {
  let state = workerStates.get(worker);
  if (state) return state;

  state = {
    pendingGeometryRevision: 0,
    latestRequestedRevision: 0,
    hideTimer: 0,
    hiddenCanvas: null,
  };
  workerStates.set(worker, state);

  worker.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type !== 'frame' || !state.pendingGeometryRevision) return;
    const frame = {
      revision: Number(message.revision || 0),
      geometryRevision: Number(message.geometryRevision || 0),
    };
    queueMicrotask(() => {
      // The renderer's own onmessage handler has run by this point. Re-read its
      // public revision metrics so a frame rejected as stale never reveals the
      // previous bitmap again.
      if (!state.pendingGeometryRevision || !frameIsCurrent(frame, state)) return;
      restoreCanvas(state, frame.geometryRevision);
    });
  });

  worker.addEventListener('error', () => {
    if (!state.pendingGeometryRevision) return;
    queueMicrotask(() => restoreCanvas(state, state.pendingGeometryRevision));
  });

  return state;
}

function isCanvasGeometryPatch(message) {
  return message?.type === 'patch'
    && Number.isFinite(Number(message.geometryRevision))
    && Number(message.geometryRevision) > 0
    && Array.isArray(message.ids)
    && Array.isArray(message.features)
    && Array.isArray(message.removedIds);
}

export function installBoundaryGhostingGuard() {
  if (installed) return publicMetrics();
  if (typeof Worker !== 'function' || !Worker.prototype?.postMessage) return publicMetrics();

  const prototype = Worker.prototype;
  if (prototype.__pandolabBoundaryGhostingGuard === true) {
    installed = true;
    const exposed = publicMetrics();
    exposed.installed = true;
    return exposed;
  }

  const nativePostMessage = prototype.postMessage;
  prototype.postMessage = function guardedWorkerPostMessage(message, transferOrOptions) {
    let state = workerStates.get(this);

    if (isCanvasGeometryPatch(message)) {
      state = ensureWorkerState(this);
      state.pendingGeometryRevision = Math.max(
        state.pendingGeometryRevision,
        Number(message.geometryRevision || 0),
      );
      if (state.hideTimer) clearTimeout(state.hideTimer);
      state.hideTimer = setTimeout(() => hideStaleCanvas(state), STALE_BITMAP_GRACE_MS);

      const exposed = publicMetrics();
      exposed.transitionActive = true;
      exposed.pendingGeometryRevision = state.pendingGeometryRevision;
    } else if (state && message?.type === 'render') {
      state.latestRequestedRevision = Math.max(
        state.latestRequestedRevision,
        Number(message.revision || 0),
      );
    }

    return arguments.length >= 2
      ? nativePostMessage.call(this, message, transferOrOptions)
      : nativePostMessage.call(this, message);
  };

  Object.defineProperty(prototype, '__pandolabBoundaryGhostingGuard', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  installed = true;
  const exposed = publicMetrics();
  exposed.installed = true;
  return exposed;
}
