/** Decorative first-map land only. Never owns a camera, document or ready state. */
export function createViewerInitialPreview({element, loadLand, isInitial, onError}) {
  const oceanPath = element.querySelector('.viewer-initial-preview-ocean');
  const landPath = element.querySelector('.viewer-initial-preview-land');
  if (!oceanPath || !landPath || typeof loadLand !== 'function'
    || typeof isInitial !== 'function' || typeof onError !== 'function') {
    throw new TypeError('Initial preview requires its SVG paths and lifecycle/resource ports.');
  }
  let disposed = false, finishing = false, fade = null, removeVisibilityListener = null;
  let loading = null, geometry = null, lastFrame = null, lastTheme = null, pathKey = null;
  element.setAttribute('hidden', '');
  function dispose() {
    if (disposed) return;
    disposed = true;
    removeVisibilityListener?.();
    removeVisibilityListener = null;
    const pendingFade = fade;
    fade = null;
    pendingFade?.cancel?.();
    const root = element.closest?.('.viewer-root');
    if (root?.dataset.initialReveal === 'countries') root.dataset.initialReveal = 'complete';
    geometry = lastFrame = lastTheme = pathKey = null;
    element.setAttribute('hidden', '');
    oceanPath.removeAttribute('d');
    landPath.removeAttribute('d');
    oceanPath.removeAttribute('transform');
    landPath.removeAttribute('transform');
  }
  // The accepted country + border frame is already displayed behind the
  // decorative land SVG. Fading that SVG reveals the real map, then labels.
  // Neither phase delays Core acceptance, map readiness, or user input.
  function finish() {
    if (disposed || finishing) return false;
    const root = element.closest?.('.viewer-root');
    const doc = element.ownerDocument;
    const view = doc?.defaultView;
    if (element.hasAttribute('hidden') || !root || !view ||
      doc.visibilityState !== 'visible' ||
      typeof view.matchMedia !== 'function' ||
      view.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof element.animate !== 'function' ||
      typeof doc.addEventListener !== 'function' ||
      typeof doc.removeEventListener !== 'function') {
      dispose();
      return false;
    }
    finishing = true;
    root.dataset.initialReveal = 'countries';
    try {
      fade = element.animate([{opacity: 1}, {opacity: 0}],
        {duration: 180, easing: 'ease-out', fill: 'forwards'});
      if (!fade?.finished || typeof fade.finished.then !== 'function')
        throw new TypeError('First-map reveal did not return a completion promise.');
      const onVisibility = () => { if (doc.visibilityState === 'hidden') dispose(); };
      doc.addEventListener('visibilitychange', onVisibility);
      removeVisibilityListener = () => doc.removeEventListener('visibilitychange', onVisibility);
      fade.finished.then(() => {
        if (disposed) return;  // A newer date/file or hidden tab canceled it.
        const revealLabels = root.dataset.initialReveal === 'countries' && doc.visibilityState === 'visible';
        dispose();
        if (revealLabels) root.dataset.initialReveal = 'labels';
      }, () => { if (!disposed) dispose(); });
      return true;
    } catch (error) {
      dispose();
      onError(error);
      return false;
    }
  }
  function fail(error) {
    if (!disposed && isInitial()) {
      dispose();
      onError(error);
    }
    return false;
  }
  function render(frame, theme) {
    if (disposed) return false;
    if (!isInitial()) { if (!finishing) dispose(); return false; }
    lastFrame = frame; lastTheme = theme;
    if (!geometry || !frame) return false;
    try {
      const [width, height] = frame.cssViewport;
      if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))
        || typeof frame.projectPath !== 'function' || !theme?.ocean || !theme?.defaultLand) {
        throw new TypeError('Initial preview requires the current map frame and theme.');
      }
      // Frame ids change for uploads too; project the unchanged coastline only
      // when camera/projection/viewport changes, never stringify its coordinates.
      const nextKey = JSON.stringify([frame.viewRevision, frame.projectionRevision, frame.mode,
        frame.cssViewport, frame.cssScale, frame.cssTranslate, frame.worldOffsets,
        frame.viewState?.rotation, frame.viewState?.projectionCenter]);
      if (pathKey !== nextKey) {
        const ocean = frame.projectPath({type: 'Sphere'}), land = frame.projectPath(geometry);
        if ((ocean != null && typeof ocean !== 'string') || (land != null && typeof land !== 'string')) {
          throw new TypeError('Initial preview projection must return SVG paths.');
        }
        element.setAttribute('viewBox', `0 0 ${width} ${height}`);
        oceanPath.setAttribute('d', ocean || ''); landPath.setAttribute('d', land || '');
        pathKey = nextKey;
      }
      // The first built-in world is fitted at a minimum globe zoom of 1.25
      // (camera-navigation.fitMapToFeature). Project the temporary ornament
      // at that scale without changing the canonical camera or its frame.
      const zoom = Number(frame.globeZoom);
      const scale = frame.projection === 'globe' && Number.isFinite(zoom) && zoom > 0
        ? Math.max(1, 1.25 / zoom) : 1;
      if (scale > 1 + 1e-9) {
        const [x, y] = frame.cssTranslate;
        if (![x, y].every(Number.isFinite)) throw new TypeError('Initial globe preview requires its projection center.');
        const transform = `translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`;
        oceanPath.setAttribute('transform', transform);
        landPath.setAttribute('transform', transform);
      } else {
        oceanPath.removeAttribute('transform');
        landPath.removeAttribute('transform');
      }
      oceanPath.setAttribute('fill', theme.ocean);
      landPath.setAttribute('fill', theme.defaultLand);
      landPath.setAttribute('fill-opacity', '0.45');
      element.removeAttribute('hidden');
      return true;
    } catch (error) { return fail(error); }
  }
  function start() {
    if (disposed || !isInitial()) return Promise.resolve(false);
    // Join the existing physical-land owner. This optional promise is never
    // awaited by startup or replacement and must not cancel the shared load.
    if (!loading) loading = Promise.resolve().then(() => disposed || !isInitial() ? null : loadLand())
      .then(result => {
        if (disposed || !isInitial()) return false;
        if (result?.geometry?.type !== 'MultiPolygon' || !Array.isArray(result.geometry.coordinates)) {
          throw new TypeError('Initial preview requires the pinned physical-land geometry.');
        }
        geometry = result.geometry;
        return render(lastFrame, lastTheme);
      }).catch(fail);
    return loading;
  }
  return Object.freeze({start, render, finish, dispose});
}
