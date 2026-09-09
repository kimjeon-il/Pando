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
      if ((dependencies.selectionDomain.snapshot().hover?.key || '') === (nextRef?.key || '')) return;
      lastHoverHit = hoveredCountry ? { ref: nextRef, feature: hoveredCountry } : null;
      dependencies.selectionDomain.setHover(nextRef);
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

  function featureNearCoordinate(feature, coordinate, margin) {
    if (!feature?.geometry) return false;
    const bounds = (0, dependencies.geometryBounds)(feature.geometry);
    return coordinate[0] >= bounds[0] - margin && coordinate[0] <= bounds[2] + margin
      && coordinate[1] >= bounds[1] - margin && coordinate[1] <= bounds[3] + margin;
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

  function appendLocalGeometryCandidates(output, geometry, coordinate, margin, {
    ownerId = '', segmentKind = 'edge', maxCandidates = 1800,
  } = {}) {
    const ownerIds = ownerId ? [String(ownerId)] : [];
    const nodeKeys = new Set(output.filter(candidate => candidate.nodeKey).map(candidate => candidate.nodeKey));
    (0, dependencies.geometryPolygonSets)(geometry).forEach((polygon, polygonIndex) => {
      (polygon || []).forEach((ring, ringIndex) => {
        const count = Math.max(0, (ring?.length || 0) - 1);
        for (let segmentIndex = 0; segmentIndex < count && output.length < maxCandidates; segmentIndex += 1) {
          const a = ring[segmentIndex];
          const b = ring[segmentIndex + 1];
          if (Math.max(a[0], b[0]) < coordinate[0] - margin || Math.min(a[0], b[0]) > coordinate[0] + margin
            || Math.max(a[1], b[1]) < coordinate[1] - margin || Math.min(a[1], b[1]) > coordinate[1] + margin) continue;
          for (const vertex of [a, b]) {
            const nodeKey = (0, dependencies.coordKey)(vertex);
            if (nodeKeys.has(nodeKey)) continue;
            nodeKeys.add(nodeKey);
            output.push({ kind: 'vertex', coordinate: vertex, ownerIds, nodeKey });
          }
          output.push({
            kind: segmentKind,
            a, b, ownerIds,
            segmentKey: `${ownerId || 'geometry'}:${polygonIndex}:${ringIndex}:${segmentIndex}`,
          });
        }
      });
    });
    return output;
  }

  function localSnapCandidates(coordinate) {
    if (!coordinate) return [];
    const projectionScale = Math.max(1, (0, dependencies.activeProjection)().scale());
    const margin = (0, dependencies.clamp)(26 * 180 / (Math.PI * projectionScale), 0.03, 4);
    const tileSize = margin;
    const cacheKey = [
      dependencies.state.stateRevision, dependencies.countryLandRevision, dependencies.state.tool, dependencies.state.selected?.type || '', dependencies.state.selected?.id || '', dependencies.state.boundaryEditCountryIds.join('|'),
      dependencies.state.territorialUnits.length, dependencies.state.genericFeatures.length, dependencies.state.hydroEdits.length, margin.toFixed(4),
      Math.floor(coordinate[0] / tileSize), Math.floor(coordinate[1] / tileSize),
    ].join(':');
    if (snapCandidateCache.key === cacheKey) return snapCandidateCache.candidates;
    const bounds = [coordinate[0] - margin, coordinate[1] - margin, coordinate[0] + margin, coordinate[1] + margin];
    const countryFeatures = (0, dependencies.spatialFeatures)(bounds);
    const nearbyUnits = dependencies.state.territorialUnits.filter(feature => featureNearCoordinate(feature, coordinate, margin)).slice(0, 32);
    const nearbyGenericFeatures = dependencies.state.genericFeatures.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
      && featureNearCoordinate(feature, coordinate, margin)).slice(0, 24);
    const activeOwners = new Set(activeSnapOwnerIds());
    const candidates = [];
    for (const feature of [...countryFeatures, ...nearbyUnits, ...nearbyGenericFeatures]) {
      const ownerId = String(feature?.id || '');
      const segmentKind = activeOwners.size && !activeOwners.has(ownerId) ? 'neighbor' : 'edge';
      appendLocalGeometryCandidates(candidates, feature.geometry, coordinate, margin * 2, { ownerId, segmentKind });
      if (candidates.length >= 1800) break;
    }
    const sourceGeometry = (0, dependencies.activeCutDraftSourceGeometry)();
    if (sourceGeometry) appendLocalGeometryCandidates(candidates, sourceGeometry, coordinate, margin * 2, {
      ownerId: activeSnapOwnerIds()[0] || 'source', segmentKind: 'boundary', maxCandidates: 2200,
    });
    const segments = candidates.filter(candidate => candidate.a && candidate.b).slice(0, 80);
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        if (segments[left].segmentKey === segments[right].segmentKey) continue;
        const intersection = (0, dependencies.segmentIntersectionDetail)(segments[left].a, segments[left].b, segments[right].a, segments[right].b);
        if (!intersection || intersection.overlap || intersection.lineT <= 1e-7 || intersection.lineT >= 1 - 1e-7
          || intersection.boundaryT <= 1e-7 || intersection.boundaryT >= 1 - 1e-7) continue;
        candidates.push({ kind: 'intersection', coordinate: intersection.coord, ownerIds: [...new Set([...(segments[left].ownerIds || []), ...(segments[right].ownerIds || [])])] });
        if (candidates.length >= 240) {
          snapCandidateCache = { key: cacheKey, candidates };
          return candidates;
        }
      }
    }
    snapCandidateCache = { key: cacheKey, candidates };
    return candidates;
  }

  function mapClickBlocked(event = dependencies.d3.event) {
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
