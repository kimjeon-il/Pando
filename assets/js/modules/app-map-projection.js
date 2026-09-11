/** MapProjection: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createMapProjection() {
  let dependencies;
  let mapLayoutMetricsSnapshot;
  let mapLayoutMetricsRefreshCount;
  let globeProjection;
  let flatProjection;
  let path;
  let graticule;
  function connect(ports) {
    if (dependencies) throw new Error('map-projection already connected');
    dependencies = ports;
  }

  function ringRepresentativePoint(ring) {
    if (!ring?.length) return [0, 0];
    let x = 0, y = 0, n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i += 1) { x += ring[i][0]; y += ring[i][1]; }
    return [x / n, y / n];
  }

  function activeProjection() {
    return dependencies.state.projection === 'globe' ? globeProjection : flatProjection;
  }

  function readMapSafeInsets() {
    const workspace = document.querySelector('.workspace');
    if (!workspace) return dependencies.DEFAULT_SAFE_INSETS;
    const styles = getComputedStyle(workspace);
    const read = name => Math.max(0, Number.parseFloat(styles.getPropertyValue(name)) || 0);
    return {
      left: read('--projection-safe-left'),
      right: read('--projection-safe-right'),
      top: read('--projection-safe-top'),
      bottom: Math.max(26, read('--projection-safe-bottom')),
    };
  }

  function readObjectFitInsets(mapRect, safe) {
    const insets = { ...safe };
    if (!mapRect?.width || !mapRect?.height) return insets;
    const panel = (0, dependencies.$)('rightPanel');
    const panelOpen = panel?.classList.contains('mobile-open') && getComputedStyle(panel).visibility !== 'hidden';
    if (!panelOpen) return insets;
    const panelRect = panel.getBoundingClientRect();
    const edge = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-map-edge')) || 12;
    const overlapLeft = Math.max(mapRect.left, panelRect.left);
    const overlapRight = Math.min(mapRect.right, panelRect.right);
    const overlapTop = Math.max(mapRect.top, panelRect.top);
    const overlapBottom = Math.min(mapRect.bottom, panelRect.bottom);
    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return insets;
    if (dependencies.layoutMode === 'mobile') {
      insets.bottom = Math.max(insets.bottom, mapRect.bottom - panelRect.top + edge);
    } else if (panelRect.left >= mapRect.left + mapRect.width / 2) {
      insets.right = Math.max(insets.right, mapRect.right - panelRect.left + edge);
    } else {
      insets.left = Math.max(insets.left, panelRect.right - mapRect.left + edge);
    }
    insets.left = (0, dependencies.clamp)(insets.left, 0, mapRect.width - 96);
    insets.right = (0, dependencies.clamp)(insets.right, 0, mapRect.width - insets.left - 96);
    insets.top = (0, dependencies.clamp)(insets.top, 0, mapRect.height - 96);
    insets.bottom = (0, dependencies.clamp)(insets.bottom, 0, mapRect.height - insets.top - 96);
    return insets;
  }

  function refreshMapLayoutMetrics(reason = 'layout') {
    const mapElement = (0, dependencies.$)('map');
    const bounds = mapElement?.getBoundingClientRect?.();
    const width = Math.max(1, bounds?.width || mapElement?.clientWidth || dependencies.state.size.width || 900);
    const height = Math.max(1, bounds?.height || mapElement?.clientHeight || dependencies.state.size.height || 650);
    const safe = readMapSafeInsets();
    mapLayoutMetricsRefreshCount += 1;
    mapLayoutMetricsSnapshot = (0, dependencies.createMapLayoutMetricsSnapshot)({
      width,
      height,
      dpr: Math.max(1, Number(window.devicePixelRatio || 1)),
      safeInsets: safe,
      fitInsets: readObjectFitInsets(bounds, safe),
      mobile: (0, dependencies.isMobile)(),
      revision: mapLayoutMetricsRefreshCount,
      reason,
    });
    return mapLayoutMetricsSnapshot;
  }

  function projectionLayoutMetrics() {
    if (!mapLayoutMetricsSnapshot) {
      mapLayoutMetricsSnapshot = (0, dependencies.createMapLayoutMetricsSnapshot)({
        width: dependencies.state.size.width,
        height: dependencies.state.size.height,
        dpr: Math.max(1, Number(window.devicePixelRatio || 1)),
        safeInsets: dependencies.DEFAULT_SAFE_INSETS,
        mobile: (0, dependencies.isMobile)(),
      });
    }
    return mapLayoutMetricsSnapshot;
  }

  function currentMapSafeInsets() {
    return projectionLayoutMetrics().safe;
  }

  function updateProjection() {
    const {
      width,
      height,
      safe,
      centerX,
      centerY,
      globeBaseScale,
      flatBaseScale,
    } = projectionLayoutMetrics();
    if (dependencies.state.projection === 'globe') {
      globeProjection
        .translate([centerX, centerY])
        .scale(globeBaseScale * dependencies.state.view.globeZoom)
        .rotate(dependencies.state.view.globeRotation)
        .clipAngle(90);
      path.projection(globeProjection);
    } else {
      flatProjection
        .translate([centerX, centerY])
        .scale(flatBaseScale * dependencies.state.view.flatZoom)
        .center(dependencies.state.view.flatCenter)
        .rotate([0, 0, 0])
        .clipExtent([[safe.left, safe.top], [width - safe.right, height - safe.bottom]]);
      path.projection(flatProjection);
    }
  }

  function projectVisibleCoordinate(coord, frameContext = null) {
    if (!coord) return null;
    if (typeof frameContext?.projectVisibleCoordinate === 'function') {
      return frameContext.projectVisibleCoordinate(coord);
    }
    const p = activeProjection()(coord);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    if (dependencies.state.projection === 'globe') {
      const r = frameContext?.rotation || dependencies.state.view.globeRotation;
      const center = [-r[0], -r[1]];
      return dependencies.d3.geo.distance(coord, center) <= Math.PI / 2 + 0.005 ? p : null;
    }
    const width = Number(frameContext?.size?.width || dependencies.state.size.width);
    const height = Number(frameContext?.size?.height || dependencies.state.size.height);
    return p[0] >= -30 && p[0] <= width + 30 && p[1] >= -30 && p[1] <= height + 30 ? p : null;
  }

  function isCoordVisible(coord) {
    return !!projectVisibleCoordinate(coord);
  }

  function screenToGeo(screenPoint) {
    const projection = activeProjection();
    if (dependencies.state.projection === 'globe') {
      const c = projection.translate();
      const s = projection.scale();
      const dx = screenPoint[0] - c[0];
      const dy = screenPoint[1] - c[1];
      if ((dx * dx + dy * dy) > s * s) return null;
    }
    const coord = projection.invert(screenPoint);
    if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null;
    let lon = ((coord[0] + 540) % 360) - 180;
    let lat = (0, dependencies.clamp)(coord[1], -89.999, 89.999);
    return [lon, lat];
  }

  function updatePandoGlobeShell(frameContext = null) {
    const projectionKind = frameContext?.projection || dependencies.state.projection;
    const globe = projectionKind === 'globe';
    const translate = Array.isArray(frameContext?.cssTranslate || frameContext?.translate)
      ? (frameContext.cssTranslate || frameContext.translate)
      : activeProjection().translate();
    const radius = Math.max(0, Number(frameContext?.cssScale || frameContext?.scale || activeProjection().scale() || 0));
    const width = Math.max(1, Number(frameContext?.size?.width || dependencies.state.size.width));
    const height = Math.max(1, Number(frameContext?.size?.height || dependencies.state.size.height));
    const frameSignature = `${Number(frameContext?.revision || dependencies.viewRevision)}:${projectionKind}:${translate[0]}:${translate[1]}:${radius}`;

    dependencies.baseSvg?.classed('flat-projection', !globe)
      .attr('data-shell-frame-signature', frameSignature);
    dependencies.flatOceanLayer?.attr('display', globe ? 'none' : null)
      .attr('x', 0).attr('y', 0).attr('width', width).attr('height', height);
    dependencies.oceanLayer?.attr('display', globe ? null : 'none')
      .attr('cx', translate[0]).attr('cy', translate[1]).attr('r', radius);
    dependencies.shadowLayer?.attr('display', globe ? null : 'none')
      .attr('cx', translate[0]).attr('cy', translate[1]).attr('r', radius);
  }

  function initializeMapLayoutMetricsSnapshot() {
    (mapLayoutMetricsSnapshot = null);

    (mapLayoutMetricsRefreshCount = 0);
  }

  function initializeGlobeProjection() {
    (globeProjection = dependencies.d3.geo.orthographic().clipAngle(90).precision((0, dependencies.isMobile)() ? 0.9 : 0.35));

    (flatProjection = dependencies.d3.geo.equirectangular().precision((0, dependencies.isMobile)() ? 0.7 : 0.25));

    (path = dependencies.d3.geo.path().pointRadius(5));

    (graticule = dependencies.d3.geo.graticule());
  }

  return Object.freeze({
    connect,
    initializeMapLayoutMetricsSnapshot,
    initializeGlobeProjection,
    get activeProjection() { return activeProjection; },
    get currentMapSafeInsets() { return currentMapSafeInsets; },
    get flatProjection() { return flatProjection; },
    get globeProjection() { return globeProjection; },
    get graticule() { return graticule; },
    get isCoordVisible() { return isCoordVisible; },
    get mapLayoutMetricsRefreshCount() { return mapLayoutMetricsRefreshCount; },
    get mapLayoutMetricsSnapshot() { return mapLayoutMetricsSnapshot; },
    get path() { return path; },
    get projectVisibleCoordinate() { return projectVisibleCoordinate; },
    get projectionLayoutMetrics() { return projectionLayoutMetrics; },
    get refreshMapLayoutMetrics() { return refreshMapLayoutMetrics; },
    get ringRepresentativePoint() { return ringRepresentativePoint; },
    get screenToGeo() { return screenToGeo; },
    get updatePandoGlobeShell() { return updatePandoGlobeShell; },
    get updateProjection() { return updateProjection; },
  });
}
