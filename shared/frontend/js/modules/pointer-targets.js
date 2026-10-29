import {hydroLineParts} from './physical-settings.js';
import { geometryRevision } from './geometry-versions.js';
/** PointerTargets: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createPointerTargets({isDraggingDraft=null}={}) {
  let dependencies;
  let editInteractionRevision;
  let hoverPickFrame;
  let pendingHoverPick;
  let lastHoverPickPoint;
  let lastHoverPickViewRevision;
  let lastHoverHit;
  let hoverPickSequence = 0;
  let pendingHoverRequests = 0;
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
    const candidates = dependencies.projectState.state.spatialIndex || [];
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const item = candidates[i];
      const b = item.bounds;
      if (coord[0] < b[0] || coord[0] > b[2] || coord[1] < b[1] || coord[1] > b[3]) continue;
      const feature = item.feature;
      if (!(0, dependencies.layerPresentation.isLayerItemVisible)('objects', feature?.id || '')) continue;
      if ((0, dependencies.landRelations.pointInCountryFeature)(coord, feature)) return feature;
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

  const obsoleteHoverError = error => error.cancelled || error.name === 'AbortError'
    || ['STALE_REVISION','PL-CORE-STALE','PL-CORE-CANCELLED','PL-WORKER-RPC-STALE'].includes(error.code);

  async function applyCountryHover(hit, sequence, clear = false) {
    pendingHoverRequests += 1;
    try {
      const generation = dependencies.domains.projectDomain.getGeneration(), viewRevision = dependencies.mapLayout.viewRevision;
      const nextRef = hit?.ref || null;
      const isCurrent = () => sequence === hoverPickSequence && generation === dependencies.domains.projectDomain.getGeneration()
        && (clear || (viewRevision === dependencies.mapLayout.viewRevision && !dependencies.projectState.state.mapMoving
          && !dependencies.projectState.state.projectReplacing && dependencies.projectState.state.tool === 'select'
          && !(isDraggingDraft ? isDraggingDraft() : false)));
      const accepted = await dependencies.domains.selectionDomain.setHover(nextRef, { ...(clear ? {} : { source: 'map' }), isCurrent });
      if (!accepted || !Object.hasOwn(accepted,'hover')) throw new TypeError('An accepted Core hover snapshot is required.');
      if (sequence !== hoverPickSequence || generation !== dependencies.domains.projectDomain.getGeneration()
        || (!clear && (viewRevision !== dependencies.mapLayout.viewRevision || dependencies.projectState.state.mapMoving
          || dependencies.projectState.state.tool !== 'select' || (isDraggingDraft ? isDraggingDraft():false)))) return false;
      const key = nextRef?.key || null;
      if ((accepted.hover?.key || null) !== key || (dependencies.domains.selectionDomain.snapshot().hover?.key || null) !== key) return false;
      lastHoverHit = hit;
      return true;
    } catch (error) {
      if (!obsoleteHoverError(error)) dependencies.feedback.reportOperationError(error,'지도 hover를 갱신하지 못했습니다.','PL-MAP-HOVER-001',4200);
      return false;
    } finally { pendingHoverRequests -= 1; }
  }

  async function cancelCountryHoverPick({ clear = false } = {}) {
    const sequence = ++hoverPickSequence;
    if (hoverPickFrame) clearTimeout(hoverPickFrame);
    hoverPickFrame = 0;
    pendingHoverPick = null;
    lastHoverPickPoint = null;
    lastHoverPickViewRevision = -1;
    try {
      // A pending enter can still acknowledge after cancellation. Queue its
      // clear even when no hover has been accepted yet.
      if (clear && (pendingHoverRequests || dependencies.domains.selectionDomain.snapshot().hover))
        return await applyCountryHover(null,sequence,true);
      return false;
    } catch (error) {
      if (!obsoleteHoverError(error)) dependencies.feedback.reportOperationError(error,'지도 hover를 취소하지 못했습니다.','PL-MAP-HOVER-001',4200);
      return false;
    }
  }

  function queueCountryHoverPick(screenPoint, coord) {
    if (!screenPoint || !coord || dependencies.projectState.state.mapMoving || (isDraggingDraft ? isDraggingDraft():false) || dependencies.projectState.state.tool !== 'select') return;
    if (lastHoverPickPoint && Math.hypot(screenPoint[0] - lastHoverPickPoint[0], screenPoint[1] - lastHoverPickPoint[1]) < 3) return;
    pendingHoverPick = { screenPoint: [...screenPoint], coord: [...coord], sequence: ++hoverPickSequence };
    if (hoverPickFrame) return;
    hoverPickFrame = setTimeout(async () => {
      hoverPickFrame = 0;
      const pending = pendingHoverPick;
      pendingHoverPick = null;
      try {
        if (!pending || dependencies.projectState.state.mapMoving || (isDraggingDraft ? isDraggingDraft():false) || dependencies.projectState.state.tool !== 'select') return false;
        lastHoverPickPoint = pending.screenPoint;
        lastHoverPickViewRevision = dependencies.mapLayout.viewRevision;
        const generation = dependencies.domains.projectDomain.getGeneration();
        const refs = await dependencies.objectPicking.selectableObjectsAt(pending.screenPoint, pending.coord,
          { includeLabels: false, includeHydro: false });
        if (pending.sequence !== hoverPickSequence || dependencies.projectState.state.projectReplacing
          || generation !== dependencies.domains.projectDomain.getGeneration()
          || dependencies.projectState.state.mapMoving || dependencies.projectState.state.tool !== 'select'
          || lastHoverPickViewRevision !== dependencies.mapLayout.viewRevision) return false;
        return await applyCountryHover(refs[0] ? { ref: refs[0] } : null,pending.sequence);
      } catch (error) {
        if (!obsoleteHoverError(error)) dependencies.feedback.reportOperationError(error,'지도 hover 대상을 찾지 못했습니다.','PL-MAP-HOVER-001',4200);
        return false;
      }
    }, 50);
  }



  async function hydroAtScreenPoint(screenPoint, coord) {
    const hydroCategoryVisible = dependencies.projectState.state.layerVisibility.rivers || dependencies.projectState.state.layerVisibility.lakes;
    if (!hydroCategoryVisible || dependencies.projectState.state.tool !== 'select') return null;
    for (const feature of [...dependencies.projectState.state.hydroEdits].reverse()) {
      if (!(0, dependencies.physicalServices.isHydroFeatureVisible)(feature) || !(0, dependencies.objectPicking.geometryHitsScreenPoint)(feature.geometry, coord, screenPoint, (0, dependencies.surfaces.isMobile)() ? 14 : 8)) continue;
      return feature;
    }
    const picked = dependencies.rendering.gpuMapRenderer.pickHydro(screenPoint) || await dependencies.rendering.gpuMapRenderer.pickHydroAsync(screenPoint);
    if (picked && (0, dependencies.physicalServices.isHydroFeatureVisible)(picked) && (0, dependencies.physicalResources.hydroFeatureInView)(picked)) return picked;
    const projection = (0, dependencies.mapView.activeProjection)();
    const toleranceDegrees = 9 / Math.max(1, projection.scale()) * 180 / Math.PI;
    let nearest = null;
    for (const feature of (0, dependencies.hydroPresentation.allBuiltInHydroFeatures)()) {
      if (!feature.geometry) continue;
      if (!(0, dependencies.physicalResources.hydroFeatureInView)(feature)) continue;
      const bounds = feature.__awBounds || [-180, -90, 180, 90];
      const category = feature.properties?.category;
      if (category === 'lake') {
        if (coord[0] >= bounds[0] && coord[0] <= bounds[2] && coord[1] >= bounds[1] && coord[1] <= bounds[3] && (0, dependencies.landRelations.pointInCountryFeature)(coord, feature)) return feature;
        continue;
      }
      if (coord[1] < bounds[1] - toleranceDegrees || coord[1] > bounds[3] + toleranceDegrees) continue;
      for (const line of hydroLineParts(feature.geometry)) {
        for (let index = 0; index < line.length - 1; index += 1) {
          if (!(0, dependencies.mapView.isCoordVisible)(line[index]) && !(0, dependencies.mapView.isCoordVisible)(line[index + 1])) continue;
          const a = projection(line[index]);
          const b = projection(line[index + 1]);
          if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) > dependencies.projectState.state.size.width * 0.7) continue;
          const vx = b[0] - a[0], vy = b[1] - a[1];
          const length2 = vx * vx + vy * vy;
          const t = length2 ? (0, dependencies.platform.clamp)(((screenPoint[0] - a[0]) * vx + (screenPoint[1] - a[1]) * vy) / length2, 0, 1) : 0;
          const distance = Math.hypot(screenPoint[0] - (a[0] + vx * t), screenPoint[1] - (a[1] + vy * t));
          if (distance <= 7 && (!nearest || distance < nearest.distance)) nearest = { feature, distance };
        }
      }
    }
    return nearest?.feature || null;
  }

  function mapNavigationEnabled() {
    return !dependencies.projectState.state.labelPlacementMode
      && (dependencies.domains.editingDomain?.draftInputActive?.() || ['select', 'move', 'territorial-border', 'country-coast', 'merge-country', 'merge-generic-feature', 'new-country', 'annex-territory'].includes(dependencies.projectState.state.tool));
  }

  function activeSnapOwnerIds() {
    if (dependencies.projectState.state.tool === 'territorial-border') return dependencies.projectState.state.boundaryEditEntityIds.map(String);
    if (dependencies.projectState.state.coastEditCountryId) return [String(dependencies.projectState.state.coastEditCountryId)];
    if (dependencies.projectState.state.selected?.domain === 'territorial') return [String(dependencies.projectState.state.selected.id)];
    if (dependencies.projectState.state.selected?.domain === 'generic') return [String(dependencies.projectState.state.selected.id)];
    if (dependencies.projectState.state.selected?.domain === 'hydro' && (0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id)) return [String(dependencies.projectState.state.selected.id)];
    return [];
  }

  function localSnapCandidates(coordinate) {
    if (!coordinate) return [];
    const projectionScale = Math.max(1, (0, dependencies.mapView.activeProjection)().scale());
    const margin = (0, dependencies.platform.clamp)(26 * 180 / (Math.PI * projectionScale), 0.03, 4);
    const source = (0, dependencies.draftPresentation.activeCutDraftSourceGeometry)();
    if (source && !snapSources.has(source)) snapSources.set(source, `snap:${++snapSequence}`);
    const sourceKey = source ? `${snapSources.get(source)}:${geometryRevision(source)}` : '';
    const workerStats = dependencies.spatialQuery.mapEditClient.stats();
    const key = [dependencies.projectState.state.stateRevision, dependencies.countries.countryLandRevision, dependencies.projectState.state.tool,
      ...activeSnapOwnerIds(), sourceKey, margin, Math.floor(coordinate[0] / margin), Math.floor(coordinate[1] / margin)].join(':');
    if (snapCandidateCache.key === key) return snapCandidateCache.candidates;
    const entry = { key, candidates: [] };
    snapCandidateCache = entry;
    dependencies.spatialQuery.mapEditClient.execute('territorial-snap', { payload: {
      coordinate, margin: margin * 2, activeOwnerIds: activeSnapOwnerIds(), sourceKey,
      source: source && (confirmedSnapSource?.key !== sourceKey || confirmedSnapSource.revision !== workerStats.dataRevision || !workerStats.ready) ? source : undefined,
    } }, { jobKey: 'territorial-snap', priority: 50 }).then(response => {
      if (snapCandidateCache !== entry) return;
      entry.candidates = response.result.candidates;
      if (source) confirmedSnapSource = { key: sourceKey, revision: response.geometryRevision };
    }).catch(() => { if (snapCandidateCache === entry) { snapCandidateCache = { key: '', candidates: [] }; confirmedSnapSource = null; } });
    return entry.candidates;
  }

  function mapClickBlocked(event = dependencies.platform.d3.event) {
    if (dependencies.projectState.state.projectReplacing) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return true;
    }
    if (event?.defaultPrevented) {
      event.stopPropagation?.();
      return true;
    }
    const suppression = dependencies.projectState.state.suppressNextMapClick;
    if (!suppression) return false;
    const eventPoint = Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)
      ? [event.clientX, event.clientY]
      : null;
    if (suppression.point && eventPoint && Math.hypot(eventPoint[0] - suppression.point[0], eventPoint[1] - suppression.point[1]) > 18) {
      return false;
    }
    dependencies.projectState.state.suppressNextMapClick = null;
    clearTimeout(suppressNextMapClick._timer);
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }

  function suppressNextMapClick(point = null, timeout = 450) {
    dependencies.projectState.state.suppressNextMapClick = {
      point: Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null,
    };
    clearTimeout(suppressNextMapClick._timer);
    suppressNextMapClick._timer = setTimeout(() => {
      dependencies.projectState.state.suppressNextMapClick = null;
    }, timeout);
  }

  function invalidateEditInteraction() {
    editInteractionRevision += 1;
    dependencies.lifecycleUi.mapInputController?.cancel();
    dependencies.projectState.state.mapMoving = false;
    (0, dependencies.platform.$)('map')?.classList.remove('dragging');
  }

  function initializeEditInteractionRevision() {
    (editInteractionRevision = 0);
  }

  function initializeHoverPickFrame() {
    hoverPickSequence += 1;
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
