import { geometryRevision } from './geometry-versions.js';
/** PointerTargets: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createPointerTargets() {
  let dependencies;
  let editInteractionRevision;
  let hoverPickFrame;
  let pendingHoverPick;
  let lastHoverPickPoint;
  let lastHoverPickViewRevision;
  let lastHoverHit;
  let snapCandidateCache;
  const snapSources = new WeakMap();
  let snapSequence = 0;
  let confirmedSnapSource = null;
  function connect(ports) {
    if (dependencies) throw new Error('pointer-targets already connected');
    dependencies = ports;
  }

  function cpuCountryAtCoordinate(coord) {
    if (!coord) return null;
    const candidates = dependencies.state.spatialIndex || [];
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const item = candidates[i];
      const b = item.bounds;
      if (coord[0] < b[0] || coord[0] > b[2] || coord[1] < b[1] || coord[1] > b[3]) continue;
      const feature = item.feature;
      if (!(0, dependencies.isLayerItemVisible)('countries', feature?.id || '')) continue;
      if ((0, dependencies.pointInCountryFeature)(coord, feature)) return feature;
    }
    return null;
  }

  function countryAtScreenPoint(screenPoint, coord, { verify = true } = {}) {
    // Bounds from the spatial index already narrow the CPU test. Rebuilding a
    // full-resolution GPU ID framebuffer after every camera change made the
    // first hover/click stall while still requiring CPU geometry verification.
    void screenPoint;
    void verify;
    return cpuCountryAtCoordinate(coord);
  }

  function cancelCountryHoverPick({ clear = false } = {}) {
    if (hoverPickFrame) clearTimeout(hoverPickFrame);
    hoverPickFrame = 0;
    pendingHoverPick = null;
    lastHoverPickPoint = null;
    lastHoverPickViewRevision = -1;
    if (clear && dependencies.selectionDomain.snapshot().hover) {
      lastHoverHit = null;
      dependencies.selectionDomain.setHover(null);
    }
  }

  function queueCountryHoverPick(screenPoint, coord) {
    if (!screenPoint || !coord || dependencies.state.mapMoving || (0, dependencies.editingDraftSnapshot)().dragging || dependencies.state.tool !== 'select') return;
    if (lastHoverPickPoint && Math.hypot(screenPoint[0] - lastHoverPickPoint[0], screenPoint[1] - lastHoverPickPoint[1]) < 3) return;
    pendingHoverPick = { screenPoint: [...screenPoint], coord: [...coord] };
    if (hoverPickFrame) return;
    hoverPickFrame = setTimeout(() => {
      hoverPickFrame = 0;
      const pending = pendingHoverPick;
      pendingHoverPick = null;
      if (!pending || dependencies.state.mapMoving || (0, dependencies.editingDraftSnapshot)().dragging || dependencies.state.tool !== 'select') return;
      lastHoverPickPoint = pending.screenPoint;
      lastHoverPickViewRevision = dependencies.viewRevision;
      const hoveredCountry = dependencies.state.layerVisibility.countries
        ? countryAtScreenPoint(pending.screenPoint, pending.coord, { verify: false })
        : null;
      const nextId = hoveredCountry ? String(hoveredCountry?.id || '') : '';
      const nextRef = hoveredCountry ? (0, dependencies.countryObjectRef)(nextId) : null;
      lastHoverHit = hoveredCountry ? { ref: nextRef, feature: hoveredCountry } : null;
      dependencies.selectionDomain.setHover(nextRef, { source: 'map' });
    }, 50);
  }

  function hydroLineParts(geometry) {
    if (geometry?.type === 'LineString') return [geometry.coordinates || []];
    if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
    return [];
  }

  async function hydroAtScreenPoint(screenPoint, coord) {
    const hydroCategoryVisible = dependencies.state.layerVisibility.rivers || dependencies.state.layerVisibility.lakes;
    if (!hydroCategoryVisible || dependencies.state.tool !== 'select') return null;
    for (const feature of [...dependencies.state.hydroEdits].reverse()) {
      if (!(0, dependencies.isHydroFeatureVisible)(feature) || !(0, dependencies.geometryHitsScreenPoint)(feature.geometry, coord, screenPoint, (0, dependencies.isMobile)() ? 14 : 8)) continue;
      return feature;
    }
    const picked = dependencies.gpuMapRenderer.pickHydro(screenPoint) || await dependencies.gpuMapRenderer.pickHydroAsync(screenPoint);
    if (picked && (0, dependencies.isHydroFeatureVisible)(picked) && (0, dependencies.hydroFeatureInView)(picked)) return picked;
    const projection = (0, dependencies.activeProjection)();
    const toleranceDegrees = 9 / Math.max(1, projection.scale()) * 180 / Math.PI;
    let nearest = null;
    for (const feature of (0, dependencies.allBuiltInHydroFeatures)()) {
      if (!feature.geometry) continue;
      if (!(0, dependencies.hydroFeatureInView)(feature)) continue;
      const bounds = feature.__awBounds || [-180, -90, 180, 90];
      const category = feature.properties?.category;
      if (category === 'lake') {
        if (coord[0] >= bounds[0] && coord[0] <= bounds[2] && coord[1] >= bounds[1] && coord[1] <= bounds[3] && (0, dependencies.pointInCountryFeature)(coord, feature)) return feature;
        continue;
      }
      if (coord[1] < bounds[1] - toleranceDegrees || coord[1] > bounds[3] + toleranceDegrees) continue;
      for (const line of hydroLineParts(feature.geometry)) {
        for (let index = 0; index < line.length - 1; index += 1) {
          if (!(0, dependencies.isCoordVisible)(line[index]) && !(0, dependencies.isCoordVisible)(line[index + 1])) continue;
          const a = projection(line[index]);
          const b = projection(line[index + 1]);
          if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) > dependencies.state.size.width * 0.7) continue;
          const vx = b[0] - a[0], vy = b[1] - a[1];
          const length2 = vx * vx + vy * vy;
          const t = length2 ? (0, dependencies.clamp)(((screenPoint[0] - a[0]) * vx + (screenPoint[1] - a[1]) * vy) / length2, 0, 1) : 0;
          const distance = Math.hypot(screenPoint[0] - (a[0] + vx * t), screenPoint[1] - (a[1] + vy * t));
          if (distance <= 7 && (!nearest || distance < nearest.distance)) nearest = { feature, distance };
        }
      }
    }
    return nearest?.feature || null;
  }

  function mapNavigationEnabled() {
    return !dependencies.state.labelPlacementMode
      && (dependencies.editingDomain?.draftInputActive?.() || ['select', 'move', 'country-border', 'country-coast', 'merge-country', 'merge-generic-feature', 'new-country', 'annex-territory'].includes(dependencies.state.tool));
  }

  function activeSnapOwnerIds() {
    if (dependencies.state.tool === 'country-border') return dependencies.state.boundaryEditCountryIds.map(String);
    if (dependencies.state.coastEditCountryId) return [String(dependencies.state.coastEditCountryId)];
    if ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return [String(dependencies.state.selected.id)];
    if ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return [String(dependencies.state.selected.id)];
    if (dependencies.state.selected?.domain === 'generic') return [String(dependencies.state.selected.id)];
    if (dependencies.state.selected?.domain === 'hydro' && (0, dependencies.hydroEditById)(dependencies.state.selected.id)) return [String(dependencies.state.selected.id)];
    return [];
  }

  function localSnapCandidates(coordinate) {
    if (!coordinate) return [];
    const projectionScale = Math.max(1, (0, dependencies.activeProjection)().scale());
    const margin = (0, dependencies.clamp)(26 * 180 / (Math.PI * projectionScale), 0.03, 4);
    const source = (0, dependencies.activeCutDraftSourceGeometry)();
    if (source && !snapSources.has(source)) snapSources.set(source, `snap:${++snapSequence}`);
    const sourceKey = source ? `${snapSources.get(source)}:${geometryRevision(source)}` : '';
    const workerStats = dependencies.mapEditClient.stats();
    const key = [dependencies.state.stateRevision, dependencies.countryLandRevision, dependencies.state.tool,
      ...activeSnapOwnerIds(), sourceKey, margin, Math.floor(coordinate[0] / margin), Math.floor(coordinate[1] / margin)].join(':');
    if (snapCandidateCache.key === key) return snapCandidateCache.candidates;
    const entry = { key, candidates: [] };
    snapCandidateCache = entry;
    dependencies.mapEditClient.execute('territorial-snap', { payload: {
      coordinate, margin: margin * 2, activeOwnerIds: activeSnapOwnerIds(), sourceKey,
      source: source && (confirmedSnapSource?.key !== sourceKey || confirmedSnapSource.revision !== workerStats.dataRevision || !workerStats.ready) ? source : undefined,
    } }, { jobKey: 'territorial-snap', priority: 50 }).then(response => {
      if (snapCandidateCache !== entry) return;
      entry.candidates = response.result.candidates;
      if (source) confirmedSnapSource = { key: sourceKey, revision: response.geometryRevision };
    }).catch(() => { if (snapCandidateCache === entry) { snapCandidateCache = { key: '', candidates: [] }; confirmedSnapSource = null; } });
    return entry.candidates;
  }

  function mapClickBlocked(event = dependencies.d3.event) {
    if (dependencies.state.projectReplacing) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return true;
    }
    if (event?.defaultPrevented) {
      event.stopPropagation?.();
      return true;
    }
    const suppression = dependencies.state.suppressNextMapClick;
    if (!suppression) return false;
    const eventPoint = Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)
      ? [event.clientX, event.clientY]
      : null;
    if (suppression.point && eventPoint && Math.hypot(eventPoint[0] - suppression.point[0], eventPoint[1] - suppression.point[1]) > 18) {
      return false;
    }
    dependencies.state.suppressNextMapClick = null;
    clearTimeout(suppressNextMapClick._timer);
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }

  function suppressNextMapClick(point = null, timeout = 450) {
    dependencies.state.suppressNextMapClick = {
      point: Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null,
    };
    clearTimeout(suppressNextMapClick._timer);
    suppressNextMapClick._timer = setTimeout(() => {
      dependencies.state.suppressNextMapClick = null;
    }, timeout);
  }

  function invalidateEditInteraction() {
    editInteractionRevision += 1;
    dependencies.mapInputController?.cancel();
    dependencies.state.mapMoving = false;
    (0, dependencies.$)('map')?.classList.remove('dragging');
  }

  function initializeEditInteractionRevision() {
    (editInteractionRevision = 0);
  }

  function initializeHoverPickFrame() {
    (hoverPickFrame = 0);

    (pendingHoverPick = null);

    (lastHoverPickPoint = null);

    (lastHoverPickViewRevision = -1);

    (lastHoverHit = null);
  }

  function initializeSnapCandidateCache() {
    (snapCandidateCache = { key: '', candidates: [] });
  }

  return Object.freeze({
    connect,
    initializeEditInteractionRevision,
    initializeHoverPickFrame,
    initializeSnapCandidateCache,
    get cancelCountryHoverPick() { return cancelCountryHoverPick; },
    get countryAtScreenPoint() { return countryAtScreenPoint; },
    get editInteractionRevision() { return editInteractionRevision; },
    get hydroAtScreenPoint() { return hydroAtScreenPoint; },
    get hydroLineParts() { return hydroLineParts; },
    get invalidateEditInteraction() { return invalidateEditInteraction; },
    get lastHoverHit() { return lastHoverHit; },
    set lastHoverHit(value) { lastHoverHit = value; },
    get lastHoverPickPoint() { return lastHoverPickPoint; },
    get lastHoverPickViewRevision() { return lastHoverPickViewRevision; },
    get localSnapCandidates() { return localSnapCandidates; },
    get mapClickBlocked() { return mapClickBlocked; },
    get mapNavigationEnabled() { return mapNavigationEnabled; },
    get queueCountryHoverPick() { return queueCountryHoverPick; },
    get suppressNextMapClick() { return suppressNextMapClick; },
  });
}
