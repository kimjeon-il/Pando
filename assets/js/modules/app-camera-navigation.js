/** CameraNavigation: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createCameraNavigation() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('camera-navigation already connected');
    dependencies = ports;
  }

  function dragLegacyMapViewBy(dx, dy) {
    const [dragX, dragY] = (0, dependencies.normalizeMapSurfaceDragDelta)(dx, dy);
    if (dragX === 0 && dragY === 0) return false;
    if (dependencies.state.projection === 'globe') {
      const sensitivity = 0.22 / Math.max(0.75, Math.sqrt(dependencies.state.view.globeZoom));
      dependencies.state.view.globeRotation[0] += dragX * sensitivity;
      dependencies.state.view.globeRotation[1] -= dragY * sensitivity;
      dependencies.state.view.globeRotation[1] = (0, dependencies.clamp)(dependencies.state.view.globeRotation[1], -89, 89);
      return true;
    }
    const scale = dependencies.flatProjection.scale();
    dependencies.state.view.flatCenter[0] -= dragX * 180 / (Math.PI * scale);
    dependencies.state.view.flatCenter[1] += dragY * 180 / (Math.PI * scale);
    dependencies.state.view.flatCenter[1] = (0, dependencies.clamp)(dependencies.state.view.flatCenter[1], -dependencies.FLAT_LATITUDE_LIMIT, dependencies.FLAT_LATITUDE_LIMIT);
    dependencies.state.view.flatCenter[0] = ((dependencies.state.view.flatCenter[0] + 540) % 360) - 180;
    return true;
  }

  function dragMapBy(dx, dy) {
    if (dependencies.mapHost?.isReady?.() && typeof dependencies.mapHost.dragBy === 'function') {
      return dependencies.mapHost.dragBy(dx, dy, { animate: false });
    }
    return dragLegacyMapViewBy(dx, dy);
  }

  function wrappedLongitudeDelta(value) {
    return ((Number(value || 0) + 540) % 360) - 180;
  }

  function setMapZoomValue(value) {
    if (dependencies.state.projection === 'globe') {
      const next = (0, dependencies.clamp)(Number(value || dependencies.state.view.globeZoom), dependencies.ZOOM_LIMITS.globe.min, dependencies.ZOOM_LIMITS.globe.max);
      const changed = Math.abs(next - dependencies.state.view.globeZoom) > 1e-9;
      dependencies.state.view.globeZoom = next;
      return changed;
    }
    const next = (0, dependencies.clamp)(Number(value || dependencies.state.view.flatZoom), dependencies.ZOOM_LIMITS.flat.min, dependencies.ZOOM_LIMITS.flat.max);
    const changed = Math.abs(next - dependencies.state.view.flatZoom) > 1e-9;
    dependencies.state.view.flatZoom = next;
    return changed;
  }

  function alignGeographicAnchor(coordinate, screenPoint) {
    if (!coordinate || !screenPoint) return false;
    if (dependencies.state.projection === 'flat') {
      const layout = (0, dependencies.projectionLayoutMetrics)();
      const nextCenter = (0, dependencies.equirectangularCenterForAnchor)({
        coordinate,
        screenPoint,
        translate: [layout.centerX, layout.centerY],
        scale: layout.flatBaseScale * dependencies.state.view.flatZoom,
        latitudeLimit: dependencies.FLAT_LATITUDE_LIMIT,
      });
      if (!nextCenter) return false;
      const changed = Math.abs(wrappedLongitudeDelta(nextCenter[0] - dependencies.state.view.flatCenter[0])) > 1e-9
        || Math.abs(nextCenter[1] - dependencies.state.view.flatCenter[1]) > 1e-9;
      if (changed) dependencies.state.view.flatCenter = nextCenter;
      (0, dependencies.updateProjection)();
      return changed;
    }

    let changed = false;
    // Orthographic projection needs a bounded correction because longitude
    // and latitude are coupled near the horizon. Flat equirectangular view
    // alignment above is exact and never enters this iterative path.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      (0, dependencies.updateProjection)();
      const projected = (0, dependencies.activeProjection)()(coordinate);
      if (projected && Math.hypot(projected[0] - screenPoint[0], projected[1] - screenPoint[1]) < 0.1) break;
      const targetCoordinate = (0, dependencies.screenToGeo)(screenPoint);
      if (!targetCoordinate) return changed;
      const longitudeDelta = wrappedLongitudeDelta(coordinate[0] - targetCoordinate[0]);
      const latitudeDelta = Number(coordinate[1]) - Number(targetCoordinate[1]);
      if (Math.abs(longitudeDelta) < 1e-7 && Math.abs(latitudeDelta) < 1e-7) break;
      dependencies.state.view.globeRotation[0] -= longitudeDelta;
      dependencies.state.view.globeRotation[1] = (0, dependencies.clamp)(dependencies.state.view.globeRotation[1] - latitudeDelta, -89, 89);
      changed = true;
    }
    (0, dependencies.updateProjection)();
    return changed;
  }

  function transformMapView({ zoom, fromPoint, toPoint }) {
    const source = Array.isArray(fromPoint) ? fromPoint : null;
    const target = Array.isArray(toPoint) ? toPoint : source;
    (0, dependencies.updateProjection)();
    const anchor = source ? (0, dependencies.screenToGeo)(source) : null;
    let changed = setMapZoomValue(zoom);
    if (anchor && target) {
      changed = alignGeographicAnchor(anchor, target) || changed;
    } else if (source && target && (source[0] !== target[0] || source[1] !== target[1])) {
      dragMapBy(target[0] - source[0], target[1] - source[1]);
      (0, dependencies.updateProjection)();
      changed = true;
    } else {
      (0, dependencies.updateProjection)();
    }
    return changed;
  }

  function zoomBy(factor, announce = true) {
    const current = dependencies.state.projection === 'globe' ? dependencies.state.view.globeZoom : dependencies.state.view.flatZoom;
    const next = current * factor;
    if (!setMapZoomValue(next)) return false;
    dependencies.renderingDomain?.endInteraction?.('zoom-control-settle');
    dependencies.projectDomain.queueViewAutosave();
    return true;
  }

  function currentObjectFitInsets() {
    return { ...(0, dependencies.projectionLayoutMetrics)().fitInsets };
  }

  function focusCountry(feature, { announce = false, maxZoom = null, preferredAnchor = null } = {}) {
    if (!feature?.geometry && feature?.type !== 'FeatureCollection') return;
    const geometryCenter = dependencies.d3.geo.centroid(feature);
    const anchor = (0, dependencies.validLabelAnchor)(preferredAnchor) ? preferredAnchor.map(Number) : geometryCenter;
    if (!(0, dependencies.validLabelAnchor)(anchor)) return;
    const { width, height } = dependencies.state.size;
    const mobile = (0, dependencies.isMobile)();
    const safe = currentObjectFitInsets();
    const contentWidth = Math.max(96, width - safe.left - safe.right);
    const contentHeight = Math.max(96, height - safe.top - safe.bottom);
    if (dependencies.state.projection === 'globe') {
      dependencies.state.view.globeRotation = [-anchor[0], -anchor[1], 0];
      dependencies.state.view.globeZoom = 1;
    } else {
      dependencies.state.view.flatCenter = [anchor[0], anchor[1]];
      dependencies.state.view.flatZoom = 1;
    }
    (0, dependencies.updateProjection)();
    let bounds;
    try { bounds = dependencies.path.bounds(feature); } catch (_) { bounds = null; }
    if (bounds && bounds[0] && bounds[1]) {
      const bw = Math.max(1, Math.abs(bounds[1][0] - bounds[0][0]));
      const bh = Math.max(1, Math.abs(bounds[1][1] - bounds[0][1]));
      const targetW = contentWidth * 0.82;
      const targetH = contentHeight * 0.82;
      const fitted = Math.min(targetW / bw, targetH / bh) * 0.88;
      if (dependencies.state.projection === 'globe') {
        dependencies.state.view.globeZoom = (0, dependencies.clamp)(fitted, 1.25, Math.min(dependencies.ZOOM_LIMITS.globe.max, maxZoom || (mobile ? 9.5 : 8)));
      } else {
        dependencies.state.view.flatZoom = (0, dependencies.clamp)(fitted, 1.25, Math.min(dependencies.ZOOM_LIMITS.flat.max, maxZoom || (mobile ? 16 : 13)));
      }
    } else if (dependencies.state.projection === 'globe') {
      dependencies.state.view.globeZoom = 3.2;
    } else {
      dependencies.state.view.flatZoom = 5;
    }
    (0, dependencies.updateProjection)();
    // Object focus is centered on the actual map viewport. Insets constrain the
    // fitted zoom only; transient panels must not permanently offset the camera.
    const viewportCenter = [width / 2, height / 2];
    // Always align the stable geographic anchor. Projected-bounds panning can
    // diverge on a globe while label anchors are still loading, which used to
    // move a focused European country to the opposite hemisphere.
    alignGeographicAnchor(anchor, viewportCenter);
    (0, dependencies.syncMapHostFromState)();
    dependencies.renderingDomain?.invalidateView?.('focus-country');
    dependencies.projectDomain.queueViewAutosave();
  }

  function focusCoordinate(coord, zoom = null) {
    if (!(0, dependencies.validLabelAnchor)(coord)) return;
    if (dependencies.state.projection === 'globe') {
      dependencies.state.view.globeRotation = [-Number(coord[0]), -Number(coord[1]), 0];
      dependencies.state.view.globeZoom = (0, dependencies.clamp)(zoom || Math.max(4.5, dependencies.state.view.globeZoom), dependencies.ZOOM_LIMITS.globe.min, dependencies.ZOOM_LIMITS.globe.max);
    } else {
      dependencies.state.view.flatCenter = [Number(coord[0]), Number(coord[1])];
      dependencies.state.view.flatZoom = (0, dependencies.clamp)(zoom || Math.max(6, dependencies.state.view.flatZoom), dependencies.ZOOM_LIMITS.flat.min, dependencies.ZOOM_LIMITS.flat.max);
    }
    (0, dependencies.syncMapHostFromState)();
    dependencies.renderingDomain?.invalidateView?.('focus-coordinate');
    dependencies.projectDomain.queueViewAutosave();
  }

  function selectLayerTreeItem(group, id, { mode = 'replace', range = false, orderedRefs = [] } = {}) {
    const key = String(id);
    if (group === 'hydro' && dependencies.HYDRO_LAYER_META[key]) {
        if (!dependencies.state.hydroManifest) (0, dependencies.loadHydroData)(true);
        else {
          const cacheState = dependencies.state.physicalLoadState.hydroCache;
          if (cacheState === 'error') {
            dependencies.gpuMapRenderer.retryHydroCache?.();
            (0, dependencies.setActionStatus)('전 세계 강·호수 자료의 오프라인 저장을 다시 시도합니다.', 'working', 0);
          } else {
            const suffix = cacheState === 'ready' ? '오프라인에서도 바로 사용할 수 있습니다.' : `전 세계 강·호수 자료를 백그라운드에서 준비하고 있습니다. ${Math.round(dependencies.state.physicalLoadState.hydroCachePercent || 0)}%`;
            (0, dependencies.setActionStatus)(suffix, 'success', 3200);
          }
        }
        return false;
    }
    const ref = (0, dependencies.layerItemObjectRef)(group, key);
    if (!ref || !(0, dependencies.objectRefExists)(ref)) return false;
    return dependencies.selectionUiController.applyIntent(ref, { mode: range ? 'range' : mode, orderedRefs, scope: 'layer-list' });
  }

  function resetView() {
    if (dependencies.state.projection === 'globe') {
      dependencies.state.view.globeZoom = 1;
    } else {
      dependencies.state.view.flatZoom = 1;
    }
    (0, dependencies.syncMapHostFromState)();
    dependencies.renderingDomain?.endInteraction?.('world-view-settle');
    dependencies.projectDomain.queueViewAutosave();
  }

  function bindHoldZoom(button, factor) {
    if (!button) return;
    let timer = null;
    let repeater = null;
    let repeated = false;
    let suppressNextClick = false;
    const clear = () => {
      clearTimeout(timer); clearInterval(repeater); timer = repeater = null;
      if (repeated) {
        dependencies.projectDomain.queueViewAutosave();
        suppressNextClick = true;
      }
      repeated = false;
    };
    button.addEventListener('pointerdown', event => {
      repeated = false;
      suppressNextClick = false;
      if (event.button !== 0) return;
      button.setPointerCapture?.(event.pointerId);
      timer = setTimeout(() => {
        repeated = true;
        zoomBy(factor, false);
        repeater = setInterval(() => zoomBy(factor, false), 115);
      }, 360);
    });
    button.addEventListener('pointerup', clear);
    button.addEventListener('pointercancel', clear);
    button.addEventListener('lostpointercapture', clear);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    button.addEventListener('click', event => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        return;
      }
      zoomBy(factor, true);
      if (navigator.vibrate && (0, dependencies.isMobile)()) navigator.vibrate(6);
    });
  }



  return Object.freeze({
    connect,

    get bindHoldZoom() { return bindHoldZoom; },
    get dragLegacyMapViewBy() { return dragLegacyMapViewBy; },
    get dragMapBy() { return dragMapBy; },
    get focusCoordinate() { return focusCoordinate; },
    get focusCountry() { return focusCountry; },
    get resetView() { return resetView; },
    get selectLayerTreeItem() { return selectLayerTreeItem; },
    get transformMapView() { return transformMapView; },
    get wrappedLongitudeDelta() { return wrappedLongitudeDelta; },
    get zoomBy() { return zoomBy; },
  });
}
