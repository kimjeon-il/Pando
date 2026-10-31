/** Decorative first-map land only. Never owns a camera, document or ready state. */
export function createViewerInitialPreview({element, loadLand, isInitial, onError}) {
  const oceanPath = element.querySelector('.viewer-initial-preview-ocean');
  const landPath = element.querySelector('.viewer-initial-preview-land');
  if (!oceanPath || !landPath || typeof loadLand !== 'function'
    || typeof isInitial !== 'function' || typeof onError !== 'function') {
    throw new TypeError('Initial preview requires its SVG paths and lifecycle/resource ports.');
  }
  let disposed = false, loading = null, geometry = null, lastFrame = null, lastTheme = null, pathKey = null;
  element.setAttribute('hidden', '');
  function dispose() {
    disposed = true;
    geometry = lastFrame = lastTheme = pathKey = null;
    element.setAttribute('hidden', '');
    oceanPath.removeAttribute('d');
    landPath.removeAttribute('d');
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
    if (!isInitial()) { dispose(); return false; }
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
  return Object.freeze({start, render, dispose});
}
