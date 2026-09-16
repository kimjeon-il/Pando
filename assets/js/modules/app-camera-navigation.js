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
    const [dragX, dragY] = (0, dependencies.mapNavigation.normalizeMapSurfaceDragDelta)(dx, dy);
    if (dragX === 0 && dragY === 0) return false;
    if (dependencies.projectState.state.projection === 'globe') {
      const sensitivity = 0.22 / Math.max(0.75, Math.sqrt(dependencies.projectState.state.view.globeZoom));
      dependencies.projectState.state.view.globeRotation[0] += dragX * sensitivity;
      dependencies.projectState.state.view.globeRotation[1] -= dragY * sensitivity;
      dependencies.projectState.state.view.globeRotation[1] = (0, dependencies.platform.clamp)(dependencies.projectState.state.view.globeRotation[1], -89, 89);
      return true;
    }
    const scale = dependencies.mapView.flatProjection.scale();
    dependencies.projectState.state.view.flatCenter[0] -= dragX * 180 / (Math.PI * scale);
    dependencies.projectState.state.view.flatCenter[1] += dragY * 180 / (Math.PI * scale);
    dependencies.projectState.state.view.flatCenter[1] = (0, dependencies.platform.clamp)(dependencies.projectState.state.view.flatCenter[1], -dependencies.mapNavigation.FLAT_LATITUDE_LIMIT, dependencies.mapNavigation.FLAT_LATITUDE_LIMIT);
    dependencies.projectState.state.view.flatCenter[0] = ((dependencies.projectState.state.view.flatCenter[0] + 540) % 360) - 180;
    return true;
  }

  function dragMapBy(dx, dy) {
    if (dependencies.mapView.mapHost?.isReady?.() && typeof dependencies.mapView.mapHost.dragBy === 'function') {
      return dependencies.mapView.mapHost.dragBy(dx, dy, { animate: false });
    }
    return dragLegacyMapViewBy(dx, dy);
  }

  function wrappedLongitudeDelta(value) {
    return ((Number(value || 0) + 540) % 360) - 180;
  }

  function setMapZoomValue(value) {
    if (dependencies.projectState.state.projection === 'globe') {
      const next = (0, dependencies.platform.clamp)(Number(value || dependencies.projectState.state.view.globeZoom), dependencies.mapNavigation.ZOOM_LIMITS.globe.min, dependencies.mapNavigation.ZOOM_LIMITS.globe.max);
      const changed = Math.abs(next - dependencies.projectState.state.view.globeZoom) > 1e-9;
      dependencies.projectState.state.view.globeZoom = next;
      return changed;
    }
    const next = (0, dependencies.platform.clamp)(Number(value || dependencies.projectState.state.view.flatZoom), dependencies.mapNavigation.ZOOM_LIMITS.flat.min, dependencies.mapNavigation.ZOOM_LIMITS.flat.max);
    const changed = Math.abs(next - dependencies.projectState.state.view.flatZoom) > 1e-9;
    dependencies.projectState.state.view.flatZoom = next;
    return changed;
  }

  function alignGeographicAnchor(coordinate, screenPoint) {
    if (!coordinate || !screenPoint) return false;
    if (dependencies.projectState.state.projection === 'flat') {
      const layout = (0, dependencies.mapView.projectionLayoutMetrics)();
      const nextCenter = (0, dependencies.mapNavigation.equirectangularCenterForAnchor)({
        coordinate,
        screenPoint,
        translate: [layout.centerX, layout.centerY],
        scale: layout.flatBaseScale * dependencies.projectState.state.view.flatZoom,
        latitudeLimit: dependencies.mapNavigation.FLAT_LATITUDE_LIMIT,
      });
      if (!nextCenter) return false;
      const changed = Math.abs(wrappedLongitudeDelta(nextCenter[0] - dependencies.projectState.state.view.flatCenter[0])) > 1e-9
        || Math.abs(nextCenter[1] - dependencies.projectState.state.view.flatCenter[1]) > 1e-9;
      if (changed) dependencies.projectState.state.view.flatCenter = nextCenter;
      (0, dependencies.mapView.updateProjection)();
      return changed;
    }

    let changed = false;
    // Orthographic projection needs a bounded correction because longitude
    // and latitude are coupled near the horizon. Flat equirectangular view
    // alignment above is exact and never enters this iterative path.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      (0, dependencies.mapView.updateProjection)();
      const projected = (0, dependencies.mapView.activeProjection)()(coordinate);
      if (projected && Math.hypot(projected[0] - screenPoint[0], projected[1] - screenPoint[1]) < 0.1) break;
      const targetCoordinate = (0, dependencies.mapView.screenToGeo)(screenPoint);
      if (!targetCoordinate) return changed;
      const longitudeDelta = wrappedLongitudeDelta(coordinate[0] - targetCoordinate[0]);
      const latitudeDelta = Number(coordinate[1]) - Number(targetCoordinate[1]);
      if (Math.abs(longitudeDelta) < 1e-7 && Math.abs(latitudeDelta) < 1e-7) break;
      dependencies.projectState.state.view.globeRotation[0] -= longitudeDelta;
      dependencies.projectState.state.view.globeRotation[1] = (0, dependencies.platform.clamp)(dependencies.projectState.state.view.globeRotation[1] - latitudeDelta, -89, 89);
      changed = true;
    }
    (0, dependencies.mapView.updateProjection)();
    return changed;
  }

  function transformMapView({ zoom, fromPoint, toPoint }) {
    const source = Array.isArray(fromPoint) ? fromPoint : null;
    const target = Array.isArray(toPoint) ? toPoint : source;
    (0, dependencies.mapView.updateProjection)();
    const anchor = source ? (0, dependencies.mapView.screenToGeo)(source) : null;
    let changed = setMapZoomValue(zoom);
    if (anchor && target) {
      changed = alignGeographicAnchor(anchor, target) || changed;
    } else if (source && target && (source[0] !== target[0] || source[1] !== target[1])) {
      dragMapBy(target[0] - source[0], target[1] - source[1]);
      (0, dependencies.mapView.updateProjection)();
      changed = true;
    } else {
      (0, dependencies.mapView.updateProjection)();
    }
    return changed;
  }

  function zoomBy(factor, announce = true) {
    const current = dependencies.projectState.state.projection === 'globe' ? dependencies.projectState.state.view.globeZoom : dependencies.projectState.state.view.flatZoom;
    const next = current * factor;
    if (!setMapZoomValue(next)) return false;
    dependencies.domains.renderingDomain?.endInteraction?.('zoom-control-settle');
    dependencies.domains.projectDomain.queueViewAutosave();
    return true;
  }

  function currentObjectFitInsets() {
    return { ...(0, dependencies.mapView.projectionLayoutMetrics)().fitInsets };
  }

  function focusCountry(feature, { announce = false, maxZoom = null, preferredAnchor = null } = {}) {
    if (!feature?.geometry && feature?.type !== 'FeatureCollection') return;
    const geometryCenter = dependencies.platform.d3.geo.centroid(feature);
    const anchor = (0, dependencies.countries.validLabelAnchor)(preferredAnchor) ? preferredAnchor.map(Number) : geometryCenter;
    if (!(0, dependencies.countries.validLabelAnchor)(anchor)) return;
    const { width, height } = dependencies.projectState.state.size;
    const mobile = (0, dependencies.surfaces.isMobile)();
    const safe = currentObjectFitInsets();
    const contentWidth = Math.max(96, width - safe.left - safe.right);
    const contentHeight = Math.max(96, height - safe.top - safe.bottom);
    if (dependencies.projectState.state.projection === 'globe') {
      dependencies.projectState.state.view.globeRotation = [-anchor[0], -anchor[1], 0];
      dependencies.projectState.state.view.globeZoom = 1;
    } else {
      dependencies.projectState.state.view.flatCenter = [anchor[0], anchor[1]];
      dependencies.projectState.state.view.flatZoom = 1;
    }
    (0, dependencies.mapView.updateProjection)();
    let bounds;
    try { bounds = dependencies.mapView.path.bounds(feature); } catch (_) { bounds = null; }
    if (bounds && bounds[0] && bounds[1]) {
      const bw = Math.max(1, Math.abs(bounds[1][0] - bounds[0][0]));
      const bh = Math.max(1, Math.abs(bounds[1][1] - bounds[0][1]));
      const targetW = contentWidth * 0.82;
      const targetH = contentHeight * 0.82;
      const fitted = Math.min(targetW / bw, targetH / bh) * 0.88;
      if (dependencies.projectState.state.projection === 'globe') {
        dependencies.projectState.state.view.globeZoom = (0, dependencies.platform.clamp)(fitted, 1.25, Math.min(dependencies.mapNavigation.ZOOM_LIMITS.globe.max, maxZoom || (mobile ? 9.5 : 8)));
      } else {
        dependencies.projectState.state.view.flatZoom = (0, dependencies.platform.clamp)(fitted, 1.25, Math.min(dependencies.mapNavigation.ZOOM_LIMITS.flat.max, maxZoom || (mobile ? 16 : 13)));
      }
    } else if (dependencies.projectState.state.projection === 'globe') {
      dependencies.projectState.state.view.globeZoom = 3.2;
    } else {
      dependencies.projectState.state.view.flatZoom = 5;
    }
    (0, dependencies.mapView.updateProjection)();
    // Object focus is centered on the actual map viewport. Insets constrain the
    // fitted zoom only; transient panels must not permanently offset the camera.
    const viewportCenter = [width / 2, height / 2];
    // Always align the stable geographic anchor. Projected-bounds panning can
    // diverge on a globe while label anchors are still loading, which used to
    // move a focused European country to the opposite hemisphere.
    alignGeographicAnchor(anchor, viewportCenter);
    (0, dependencies.mapView.syncMapHostFromState)();
    dependencies.domains.renderingDomain?.invalidateView?.('focus-country');
    dependencies.domains.projectDomain.queueViewAutosave();
  }

  function focusCoordinate(coord, zoom = null) {
    if (!(0, dependencies.countries.validLabelAnchor)(coord)) return;
    if (dependencies.projectState.state.projection === 'globe') {
      dependencies.projectState.state.view.globeRotation = [-Number(coord[0]), -Number(coord[1]), 0];
      dependencies.projectState.state.view.globeZoom = (0, dependencies.platform.clamp)(zoom || Math.max(4.5, dependencies.projectState.state.view.globeZoom), dependencies.mapNavigation.ZOOM_LIMITS.globe.min, dependencies.mapNavigation.ZOOM_LIMITS.globe.max);
    } else {
      dependencies.projectState.state.view.flatCenter = [Number(coord[0]), Number(coord[1])];
      dependencies.projectState.state.view.flatZoom = (0, dependencies.platform.clamp)(zoom || Math.max(6, dependencies.projectState.state.view.flatZoom), dependencies.mapNavigation.ZOOM_LIMITS.flat.min, dependencies.mapNavigation.ZOOM_LIMITS.flat.max);
    }
    (0, dependencies.mapView.syncMapHostFromState)();
    dependencies.domains.renderingDomain?.invalidateView?.('focus-coordinate');
    dependencies.domains.projectDomain.queueViewAutosave();
  }

  function selectLayerTreeItem(group, id, { mode = 'replace', range = false, orderedRefs = [] } = {}) {
    const key = String(id);
    if (group === 'hydro' && dependencies.physicalData.HYDRO_LAYER_META[key]) {
        if (!dependencies.projectState.state.hydroManifest) (0, dependencies.physicalData.loadHydroData)(true);
        else {
          const cacheState = dependencies.projectState.state.physicalLoadState.hydroCache;
          if (cacheState === 'error') {
            dependencies.rendering.gpuMapRenderer.retryHydroCache?.();
            (0, dependencies.feedback.setActionStatus)('전 세계 강·호수 자료의 오프라인 저장을 다시 시도합니다.', 'working', 0);
          } else {
            const suffix = cacheState === 'ready' ? '오프라인에서도 바로 사용할 수 있습니다.' : `전 세계 강·호수 자료를 백그라운드에서 준비하고 있습니다. ${Math.round(dependencies.projectState.state.physicalLoadState.hydroCachePercent || 0)}%`;
            (0, dependencies.feedback.setActionStatus)(suffix, 'success', 3200);
          }
        }
        return false;
    }
    const ref = (0, dependencies.objectLookup.layerItemObjectRef)(group, key);
    if (!ref || !(0, dependencies.objectLookup.objectRefExists)(ref)) return false;
    return dependencies.domains.selectionUiController.applyIntent(ref, { mode: range ? 'range' : mode, orderedRefs, scope: 'layer-list' });
  }

  function resetView() {
    if (dependencies.projectState.state.projection === 'globe') {
      dependencies.projectState.state.view.globeZoom = 1;
    } else {
      dependencies.projectState.state.view.flatZoom = 1;
    }
    (0, dependencies.mapView.syncMapHostFromState)();
    dependencies.domains.renderingDomain?.endInteraction?.('world-view-settle');
    dependencies.domains.projectDomain.queueViewAutosave();
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
        dependencies.domains.projectDomain.queueViewAutosave();
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
      if (navigator.vibrate && (0, dependencies.surfaces.isMobile)()) navigator.vibrate(6);
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
