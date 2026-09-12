/** ObjectPicking: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createObjectPicking() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('object-picking already connected');
    dependencies = ports;
  }

  function createCountryFeature(name, rawRing, color = null, geometryOverride = null) {
    const id = (0, dependencies.uid)('USR');
    const geometry = geometryOverride
      ? (0, dependencies.deepClone)(geometryOverride)
      : { type: 'Polygon', coordinates: [(0, dependencies.orientRing)(rawRing, true)] };
    const feature = {
      type: 'Feature',
      id,
      properties: { name },
      geometry,
    };
    if (color) dependencies.state.countryOverrides[id] = { ...(dependencies.state.countryOverrides[id] || {}), color };
    return feature;
  }

  function projectedPointDistance(left, right) {
    return Math.hypot(Number(left?.[0]) - Number(right?.[0]), Number(left?.[1]) - Number(right?.[1]));
  }

  function pointSegmentDistance(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    if (!dx && !dy) return projectedPointDistance(point, start);
    const t = (0, dependencies.clamp)(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
  }

  function projectedLineDistance(geometry, screenPoint) {
    if (!geometry) return Infinity;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates]
      : geometry.type === 'MultiLineString' ? geometry.coordinates
        : geometry.type === 'Polygon' ? geometry.coordinates
          : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
            : [];
    let minimum = Infinity;
    for (const line of lines) {
      let previous = null;
      for (const coordinate of line || []) {
        const projected = (0, dependencies.activeProjection)()(coordinate);
        if (previous && projected) minimum = Math.min(minimum, pointSegmentDistance(screenPoint, previous, projected));
        previous = projected;
      }
    }
    return minimum;
  }

  function geometryHitsScreenPoint(geometry, coord, screenPoint, tolerance = 8) {
    if (!geometry) return false;
    let bounds = dependencies.geometryBoundsCache.get(geometry);
    if (!bounds) {
      bounds = (0, dependencies.coordinateBounds)(geometry.coordinates);
      dependencies.geometryBoundsCache.set(geometry, bounds);
    }
    const longitudeSpan = Number(bounds?.[2]) - Number(bounds?.[0]);
    const geographicTolerance = Math.max(0.15, 4 / Math.max(1, (0, dependencies.currentMapZoom)()));
    if (bounds?.every(Number.isFinite) && longitudeSpan < 350 && (coord[0] < bounds[0] - geographicTolerance || coord[0] > bounds[2] + geographicTolerance || coord[1] < bounds[1] - geographicTolerance || coord[1] > bounds[3] + geographicTolerance)) return false;
    if (geometry.type === 'Point') {
      const projected = (0, dependencies.activeProjection)()(geometry.coordinates);
      return !!projected && projectedPointDistance(projected, screenPoint) <= tolerance;
    }
    if (geometry.type === 'MultiPoint') return geometry.coordinates.some(point => {
      const projected = (0, dependencies.activeProjection)()(point);
      return !!projected && projectedPointDistance(projected, screenPoint) <= tolerance;
    });
    if (geometry.type.includes('Polygon')) {
      try { if (dependencies.d3.geo.contains({ type: 'Feature', properties: {}, geometry }, coord)) return true; } catch (_) {}
    }
    return projectedLineDistance(geometry, screenPoint) <= tolerance;
  }

  function selectableVisualRank(ref) {
    const order = dependencies.state.layerPresentation?.overlayOrder || dependencies.OVERLAY_GROUPS;
    let group = '';
    if (ref.domain === 'generic') group = 'genericFeatures';
    else if (ref.domain === 'distribution') group = dependencies.DISTRIBUTION_TYPE_GROUPS[ref.type] || `${ref.type}s`;
    else if (ref.domain === 'territorial') group = ref.type === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? 'subunits' : ref.type === dependencies.TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? 'countries' : 'subunits';
    else if (ref.domain === 'label') group = 'labels';
    else if (ref.domain === 'hydro') group = 'hydro';
    const index = order.indexOf(group);
    if (index >= 0) return 1000 - index;
    return { labels: 1300, hydro: 850, countries: 500 }[group] || 700;
  }

  async function selectableObjectsAt(screenPoint, coord) {
    const candidates = [];
    const add = ref => {
      const normalized = (0, dependencies.normalizeObjectRef)(ref);
      if (normalized && !candidates.some(candidate => candidate.key === normalized.key)) candidates.push(normalized);
    };
    dependencies.selectionPerformanceMetrics.exactHitTestCount = 0;
    const indexed = (0, dependencies.indexedMapObjectCandidates)(screenPoint);
    for (const entry of indexed) {
      if (entry.domain === 'label') {
        if (!dependencies.state.layerVisibility.labels || !(0, dependencies.isLayerItemVisible)('labels', entry.id)) continue;
        const label = dependencies.state.labels.find(item => String(item.id) === entry.id);
        const projected = label ? (0, dependencies.activeProjection)()(label.coordinates) : null;
        dependencies.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (projected && projectedPointDistance(projected, screenPoint) <= ((0, dependencies.isMobile)() ? 18 : 11)) add({ domain: 'label', type: label.kind || 'label', id: label.id });
        continue;
      }
      if (entry.domain === 'generic') {
        if (!dependencies.state.layerVisibility.genericFeatures || !(0, dependencies.isLayerItemVisible)('genericFeatures', entry.id)) continue;
        const feature = dependencies.state.genericFeatures.find(item => String(item.id) === entry.id);
        dependencies.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (feature && geometryHitsScreenPoint(feature.geometry, coord, screenPoint, (0, dependencies.isMobile)() ? 14 : 8)) add({ domain: 'generic', type: 'feature', id: feature.id });
        continue;
      }
      if (entry.domain === 'distribution') {
        const row = (0, dependencies.indexedDistributionRow)(entry.id);
        dependencies.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (row && geometryHitsScreenPoint(row.geometry, coord, screenPoint, (0, dependencies.isMobile)() ? 12 : 7)) add({ domain: 'distribution', type: row.layer.type, id: row.layer.id });
        continue;
      }
      if (entry.domain === 'territorial') {
        const feature = (0, dependencies.territorialUnitById)(entry.id);
        if (!feature) continue;
        const group = feature.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT ? 'subunits' : feature.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION ? 'regions' : 'subunits';
        if (dependencies.state.layerVisibility[group] === false || !(0, dependencies.isLayerItemVisible)(group, feature.id)) continue;
        dependencies.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (geometryHitsScreenPoint(feature.geometry, coord, screenPoint, (0, dependencies.isMobile)() ? 12 : 7)) add({ domain: 'territorial', type: feature.properties?.unitType || dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT, id: feature.id });
        continue;
      }
      if (entry.domain === 'hydro') {
        const feature = (0, dependencies.hydroEditById)(entry.id);
        dependencies.selectionPerformanceMetrics.exactHitTestCount += 1;
        if (feature && (0, dependencies.isHydroFeatureVisible)(feature) && geometryHitsScreenPoint(feature.geometry, coord, screenPoint, (0, dependencies.isMobile)() ? 14 : 8)) add({ domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id });
      }
    }
    const canReuseHover = dependencies.lastHoverHit?.ref?.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY && dependencies.lastHoverHit.feature
      && dependencies.lastHoverPickViewRevision === dependencies.viewRevision && dependencies.lastHoverPickPoint
      && Math.hypot(screenPoint[0] - dependencies.lastHoverPickPoint[0], screenPoint[1] - dependencies.lastHoverPickPoint[1]) < 3;
    dependencies.selectionPerformanceMetrics.pickCacheHit = !!canReuseHover;
    if (dependencies.state.layerVisibility.countries) {
      let country;
      if (canReuseHover) country = dependencies.lastHoverHit.feature;
      else {
        const pickStartedAt = performance.now();
        country = (0, dependencies.countryAtScreenPoint)(screenPoint, coord, { verify: false });
        dependencies.selectionPerformanceMetrics.gpuPickMs = performance.now() - pickStartedAt;
      }
      if (country) add({ domain: 'territorial', type: dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY, id: country.id });
    }
    if (dependencies.state.layerVisibility.rivers || dependencies.state.layerVisibility.lakes) {
      const hydro = await (0, dependencies.hydroAtScreenPoint)(screenPoint, coord);
      if (hydro) add({ domain: 'hydro', type: hydro.properties?.category || 'river', id: hydro.properties?.pandolab_id || hydro.id });
    }
    return candidates.sort((left, right) => selectableVisualRank(right) - selectableVisualRank(left) || (0, dependencies.objectDisplayInfo)(left).name.localeCompare((0, dependencies.objectDisplayInfo)(right).name, 'ko'));
  }

  function closeObjectChooser({ restoreFocus = false } = {}) {
    const chooser = (0, dependencies.$)('objectChooser');
    if (!chooser) return;
    chooser.classList.add('hidden');
    chooser.removeAttribute('style');
    dependencies.objectChooserCandidates = [];
    if (restoreFocus) (0, dependencies.$)('map')?.focus();
  }

  function openObjectChooser(candidates, screenPoint) {
    const chooser = (0, dependencies.$)('objectChooser');
    const list = (0, dependencies.$)('objectChooserList');
    if (!chooser || !list || candidates.length < 2) return closeObjectChooser();
    if ((0, dependencies.isMobile)() && dependencies.surfaceController.activeMobileSheet) (0, dependencies.closeActiveMobileSheet)();
    dependencies.objectChooserCandidates = candidates.slice();
    list.replaceChildren(...candidates.map((ref, index) => {
      const info = (0, dependencies.objectDisplayInfo)(ref);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ui-button ui-row ui-card ui-selectable-row object-chooser-item${dependencies.selectionDomain.has(ref) ? ' is-selected' : ''}`;
      button.dataset.objectChooserIndex = String(index);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(dependencies.selectionDomain.has(ref)));
      const name = document.createElement('span');
      const type = document.createElement('small');
      name.textContent = info.name;
      type.textContent = [info.type, info.detail].filter(Boolean).join(' · ');
      button.append(name, type);
      return button;
    }));
    chooser.classList.remove('hidden');
    if ((0, dependencies.isMobile)()) {
      chooser.removeAttribute('style');
      requestAnimationFrame(() => list.querySelector('[role="option"]')?.focus({ preventScroll: true }));
      return;
    }
    const bounds = (0, dependencies.$)('map')?.getBoundingClientRect();
    if (!bounds) return;
    const edge = 8;
    requestAnimationFrame(() => {
      const width = chooser.offsetWidth || 300;
      const height = chooser.offsetHeight || 200;
      chooser.style.left = `${(0, dependencies.clamp)(screenPoint[0] + 12, edge, Math.max(edge, bounds.width - width - edge))}px`;
      chooser.style.top = `${(0, dependencies.clamp)(screenPoint[1] + 12, edge, Math.max(edge, bounds.height - height - edge))}px`;
    });
  }

  async function handleObjectSelectionAt(screenPoint, { sourceEvent = dependencies.d3.event, forcedRef = null } = {}) {
    const inputStartedAt = performance.now();
    const performanceBefore = (0, dependencies.selectionPerformanceCounterSnapshot)();
    Object.assign(dependencies.selectionPerformanceMetrics, {
      handlerMs: 0, indexQueryMs: 0, indexedCandidateCount: 0, exactHitTestCount: 0,
      gpuPickMs: 0, pickCacheHit: false, direct: false,
    });
    const normalizedForced = (0, dependencies.normalizeObjectRef)(forcedRef);
    if (normalizedForced && (0, dependencies.objectRefExists)(normalizedForced)) {
      dependencies.selectionPerformanceMetrics.direct = true;
      const event = sourceEvent?.sourceEvent || sourceEvent || {};
      const mode = event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
      dependencies.selectionUiController.applyIntent(normalizedForced, { mode, scope: 'map' });
      dependencies.selectionPerformanceMetrics.handlerMs = performance.now() - inputStartedAt;
      requestAnimationFrame(() => {
        (0, dependencies.publishSelectionPerformanceSample)(inputStartedAt, performanceBefore, `direct:${normalizedForced.key}`);
      });
      return true;
    }
    const coord = (0, dependencies.screenToGeo)(screenPoint);
    if (!coord) {
      closeObjectChooser();
      dependencies.selectionUiController.clear({ reason: 'map-background-selection-clear' });
      (0, dependencies.closeSurface)('editor', { restoreFocus: false });
      return false;
    }
    const candidates = await selectableObjectsAt(screenPoint, coord);
    if (!candidates.length) {
      closeObjectChooser();
      dependencies.selectionUiController.clear({ reason: 'map-background-selection-clear' });
      (0, dependencies.closeSurface)('editor', { restoreFocus: false });
      return false;
    }
    const event = sourceEvent?.sourceEvent || sourceEvent || {};
    if (candidates.length > 1) {
      openObjectChooser(candidates, screenPoint);
      return true;
    }
    const target = normalizedForced || candidates[0];
    const mode = event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
    dependencies.selectionUiController.applyIntent(target, { mode, scope: 'map' });
    dependencies.selectionPerformanceMetrics.handlerMs = performance.now() - inputStartedAt;
    requestAnimationFrame(() => {
      (0, dependencies.publishSelectionPerformanceSample)(inputStartedAt, performanceBefore, `map:${target.key}`);
    });
    return true;
  }

  async function handleMapClick(screenPoint) {
    if (dependencies.state.spacePanActive || dependencies.state.tool === 'move') return;
    const rawCoord = (0, dependencies.screenToGeo)(screenPoint);
    if (!rawCoord) return;
    const pointerType = dependencies.d3.event?.pointerType === 'touch' || dependencies.d3.event?.changedTouches ? 'touch' : 'mouse';
    const coord = rawCoord;
    if (dependencies.state.labelPlacementMode) {
      (0, dependencies.addLabelAt)(coord);
      return;
    }
    if (dependencies.state.tool === 'select' && !dependencies.state.labelPlacementMode) return handleObjectSelectionAt(screenPoint);
    const territoryCountryPicking = (0, dependencies.territorySelectionCountryPickingActive)();
    const needsCountryHit = (dependencies.state.tool === 'select' && !dependencies.state.labelPlacementMode) ||
      territoryCountryPicking ||
      (dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditPhase === 'selecting') ||
      (dependencies.state.tool === 'merge-country' && !!dependencies.state.mergeSourceCountryId);
    const clickedCountry = needsCountryHit && dependencies.state.layerVisibility.countries
      ? (0, dependencies.countryAtScreenPoint)(screenPoint, coord)
      : null;
    if (territoryCountryPicking) {
      if (clickedCountry) (0, dependencies.toggleTerritorySelectionSourceCountry)(clickedCountry.id);
      else (0, dependencies.setActionStatus)((0, dependencies.territorySelectionCountryInstruction)(), 'error', 2600);
      return;
    }
    if (dependencies.state.tool === 'merge-country' && dependencies.state.mergeSourceCountryId) {
      if (clickedCountry) (0, dependencies.toggleMergeTarget)(clickedCountry.id);
      else (0, dependencies.setActionStatus)('합병 대상을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (dependencies.state.tool === 'country-border' && dependencies.state.boundaryEditPhase === 'selecting') {
      if (clickedCountry) (0, dependencies.toggleBoundaryEditCountry)(clickedCountry.id);
      else (0, dependencies.setActionStatus)('접경국을 선택할 수 없습니다. 국가 영토 안쪽을 선택하세요.', 'error', 2600);
      return;
    }
    if (dependencies.state.tool === 'select' && !dependencies.state.labelPlacementMode && clickedCountry) return;
    const territorySession = dependencies.state.territorySelectionSession;
    if (territorySession) {
      if (territorySession.stage !== 'selection' || territorySession.activePhase !== 'drawing'
        || !['line', 'polygon'].includes(territorySession.activeMethod)) return;
      if ((0, dependencies.editingDraftSnapshot)().inputPhase !== 'draw') return;
      dependencies.editingDomain?.appendDraftScreenPoint?.(screenPoint, pointerType, { dedupe: true });
      return;
    }
    if ((0, dependencies.isGenericFeatureDraftTool)(dependencies.state.tool)) {
      if ((0, dependencies.editingDraftSnapshot)().inputPhase !== 'draw') return;
      dependencies.editingDomain?.appendDraftScreenPoint?.(screenPoint, pointerType);
      return;
    }
    if (dependencies.state.tool === 'point') {
      const feature = {
        type: 'Feature', id: (0, dependencies.uid)('point'),
        geometry: { type: 'Point', coordinates: coord },
        properties: { name: '', color: dependencies.DEFAULT_GENERIC_FEATURE_COLOR, role: 'generic', landBinding: 'none', schemaVersion: dependencies.GENERIC_FEATURE_SCHEMA_VERSION },
      };
      dependencies.genericFeatureService.add(feature);
      dependencies.editingDomain?.setTool('select');
      (0, dependencies.applyGenericSelectionIntent)(String(feature.id));
      (0, dependencies.setActionStatus)('점 기타 객체를 추가했습니다.', 'success');
      return;
    }
    if (dependencies.state.tool === 'select') dependencies.selectionUiController.clear({ reason: 'map-background-selection-clear' });
  }



  return Object.freeze({
    connect,

    get closeObjectChooser() { return closeObjectChooser; },
    get createCountryFeature() { return createCountryFeature; },
    get geometryHitsScreenPoint() { return geometryHitsScreenPoint; },
    get handleMapClick() { return handleMapClick; },
    get handleObjectSelectionAt() { return handleObjectSelectionAt; },
    get projectedLineDistance() { return projectedLineDistance; },
  });
}
