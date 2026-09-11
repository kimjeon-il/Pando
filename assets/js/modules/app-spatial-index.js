/** SpatialIndex: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createSpatialIndex() {
  let dependencies;
  let geometryBoundsCache;
  let mapObjectSpatialIndex;
  let mapObjectDistributionRowCache;
  let mapObjectSpatialIndexSources;
  let mapObjectGeometryRevisions;
  let viewportCullingMetrics;
  let applyingMapEditWorkerResult;
  let mapEditClient;
  function connect(ports) {
    if (dependencies) throw new Error('spatial-index already connected');
    dependencies = ports;
  }

  function geometryBounds(geometry) {
    if (!geometry || typeof geometry !== 'object') return [Infinity, Infinity, -Infinity, -Infinity];
    const cached = geometryBoundsCache.get(geometry);
    if (cached) return cached;
    const bounds = (0, dependencies.coordinateBounds)(geometry.coordinates);
    geometryBoundsCache.set(geometry, bounds);
    return bounds;
  }

  function geometryMayIntersectViewport(geometry, overscan = 48) {
    const bounds = geometryBounds(geometry);
    if (!bounds.every(Number.isFinite)) return true;
    const longitudeSpan = bounds[2] - bounds[0];
    const latitudeSpan = bounds[3] - bounds[1];
    // The spatial tier query already removes large objects that cannot meet the
    // current view. Keep the exact projected test conservative for the remaining
    // large/date-line candidates so culling never creates a visible false negative.
    if (longitudeSpan > 40 || latitudeSpan > 40 || longitudeSpan < 0) return true;
    const samples = [
      [bounds[0], bounds[1]], [bounds[0], bounds[3]],
      [bounds[2], bounds[1]], [bounds[2], bounds[3]],
      [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    ];
    const projected = samples
      .filter(coordinate => dependencies.state.projection !== 'globe' || (0, dependencies.isCoordVisible)(coordinate))
      .map(coordinate => (0, dependencies.activeProjection)()(coordinate))
      .filter(Boolean);
    if (!projected.length) return false;
    const xs = projected.map(point => point[0]);
    const ys = projected.map(point => point[1]);
    return Math.max(...xs) >= -overscan && Math.min(...xs) <= dependencies.state.size.width + overscan
      && Math.max(...ys) >= -overscan && Math.min(...ys) <= dependencies.state.size.height + overscan;
  }

  function sameSourceParts(left = [], right = []) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function replaceSpatialDomain(domain, sourceParts, buildRecords) {
    const previous = mapObjectSpatialIndexSources.get(domain);
    if (previous && sameSourceParts(previous, sourceParts)) return false;
    mapObjectSpatialIndex.clearDomain(domain);
    for (const record of buildRecords()) mapObjectSpatialIndex.upsert(record);
    mapObjectSpatialIndexSources.set(domain, sourceParts.slice());
    return true;
  }

  function visibleFlatGeographicBounds(overscan = 64) {
    const width = Math.max(1, Number(dependencies.state.size.width || 1));
    const height = Math.max(1, Number(dependencies.state.size.height || 1));
    const center = (0, dependencies.screenToGeo)([width / 2, height / 2]) || dependencies.state.view.flatCenter || [0, 0];
    const samples = [
      [-overscan, -overscan], [width / 2, -overscan], [width + overscan, -overscan],
      [-overscan, height / 2], [width / 2, height / 2], [width + overscan, height / 2],
      [-overscan, height + overscan], [width / 2, height + overscan], [width + overscan, height + overscan],
    ].map(dependencies.screenToGeo).filter(Boolean);
    if (!samples.length) return [-180, -90, 180, 90];
    const longitudes = samples.map(coordinate => {
      let longitude = Number(coordinate[0]);
      while (longitude - center[0] > 180) longitude -= 360;
      while (longitude - center[0] < -180) longitude += 360;
      return longitude;
    });
    const latitudes = samples.map(coordinate => Number(coordinate[1]));
    return [Math.min(...longitudes), Math.max(-90, Math.min(...latitudes)), Math.max(...longitudes), Math.min(90, Math.max(...latitudes))];
  }

  function visibleMapObjectCandidates(domains) {
    rebuildMapObjectSpatialIndex();
    const started = performance.now();
    const records = dependencies.state.projection === 'globe'
      ? mapObjectSpatialIndex.querySphericalCap({
          center: [-Number(dependencies.state.view.globeRotation?.[0] || 0), -Number(dependencies.state.view.globeRotation?.[1] || 0)],
          radius: 91,
          domains,
        })
      : mapObjectSpatialIndex.query(visibleFlatGeographicBounds(), { domains });
    viewportCullingMetrics.queryCount += 1;
    viewportCullingMetrics.candidateCount = records.length;
    viewportCullingMetrics.queryMs = performance.now() - started;
    viewportCullingMetrics.lastByDomain[domains.join(',')] = {
      candidateCount: records.length,
      queryMs: viewportCullingMetrics.queryMs,
    };
    return records;
  }

  function pointBounds(coordinate) {
    const longitude = Number(coordinate?.[0]);
    const latitude = Number(coordinate?.[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude)
      ? [longitude, latitude, longitude, latitude]
      : null;
  }

  function rebuildMapObjectSpatialIndex(force = false) {
    if (force) mapObjectSpatialIndexSources.clear();
    let changed = false;
    changed = replaceSpatialDomain('label', [dependencies.state.labels, dependencies.state.labels?.length || 0, mapObjectGeometryRevisions.label], () => (dependencies.state.labels || []).flatMap(label => {
      const bounds = pointBounds(label.coordinates);
      return bounds ? [{
        key: `label:${label.id}`, domain: 'label', type: label.kind || 'label', id: label.id, bounds,
      }] : [];
    })) || changed;
    changed = replaceSpatialDomain('generic', [dependencies.state.genericFeatures, dependencies.state.genericFeatures?.length || 0, mapObjectGeometryRevisions.generic], () => (dependencies.state.genericFeatures || []).flatMap(feature => feature?.geometry ? [{
        key: `generic:${feature.id}`, domain: 'generic', type: 'feature', id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    changed = replaceSpatialDomain('territorial', [dependencies.state.territorialUnits, dependencies.state.territorialUnits?.length || 0, mapObjectGeometryRevisions.territorial], () => (dependencies.state.territorialUnits || []).flatMap(feature => feature?.geometry ? [{
        key: `territorial:${feature.id}`, domain: 'territorial', type: feature.properties?.unitType || dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT, id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    const distributionRows = dependencies.renderingDomain?.getDistributionRenderRows?.() || [];
    if (force || mapObjectSpatialIndexSources.get('distribution')?.[0] !== distributionRows) mapObjectDistributionRowCache.clear();
    changed = replaceSpatialDomain('distribution', [distributionRows], () => distributionRows.map(row => {
      mapObjectDistributionRowCache.set(String(row.id), row);
      return {
        key: `distribution:${row.id}`, domain: 'distribution', type: row.layer.type, id: row.id,
        bounds: row.bounds,
      };
    })) || changed;
    changed = replaceSpatialDomain('hydro', [dependencies.state.hydroEdits, dependencies.state.hydroEdits?.length || 0, mapObjectGeometryRevisions.hydro], () => (dependencies.state.hydroEdits || []).flatMap(feature => feature?.geometry ? [{
        key: `hydro:${feature.id}`, domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id,
        bounds: geometryBounds(feature.geometry),
      }] : [])) || changed;
    return changed;
  }

  function scheduleMapObjectSpatialIndexRebuild() {
    dependencies.mapWorkScheduler.scheduleIdle('map-object-spatial-index', () => rebuildMapObjectSpatialIndex(), 40);
  }

  function selectionQueryBounds(screenPoint, tolerance = 8) {
    const center = (0, dependencies.screenToGeo)(screenPoint);
    if (!center) return null;
    const samples = [[0, 0], [-tolerance, 0], [tolerance, 0], [0, -tolerance], [0, tolerance],
      [-tolerance, -tolerance], [tolerance, -tolerance], [-tolerance, tolerance], [tolerance, tolerance]]
      .map(([dx, dy]) => (0, dependencies.screenToGeo)([screenPoint[0] + dx, screenPoint[1] + dy]))
      .filter(Boolean);
    if (!samples.length) return [center[0], center[1], center[0], center[1]];
    const longitudes = samples.map(coordinate => {
      let value = Number(coordinate[0]);
      while (value - center[0] > 180) value -= 360;
      while (value - center[0] < -180) value += 360;
      return value;
    });
    const latitudes = samples.map(coordinate => Number(coordinate[1]));
    return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
  }

  function indexedMapObjectCandidates(screenPoint) {
    rebuildMapObjectSpatialIndex();
    const bounds = selectionQueryBounds(screenPoint, (0, dependencies.isMobile)() ? 18 : 11);
    if (!bounds) return [];
    const startedAt = performance.now();
    const candidates = mapObjectSpatialIndex.query(bounds);
    dependencies.selectionPerformanceMetrics.indexQueryMs = performance.now() - startedAt;
    dependencies.selectionPerformanceMetrics.indexedCandidateCount = candidates.length;
    return candidates;
  }

  function indexedDistributionRow(id) {
    return mapObjectDistributionRowCache.get(String(id)) || null;
  }

  function rebuildSpatialIndex(features = dependencies.state.countriesData?.features || []) {
    dependencies.state.spatialIndex = (features || []).map(feature => ({
      id: String(feature?.id || ''),
      feature,
      bounds: geometryBounds(feature.geometry),
    }));
  }

  function spatialFeatures(bounds, excludeIds = null) {
    const excluded = excludeIds ? new Set([...excludeIds].map(String)) : null;
    return (dependencies.state.spatialIndex || [])
      .filter(item => (!excluded || !excluded.has(item.id)) && (0, dependencies.boundsOverlap)(bounds, item.bounds))
      .map(item => item.feature);
  }

  function invalidateGeometryCaches(ids = []) {
    const wanted = new Set([...ids].map(String));
    for (const feature of dependencies.state.countriesData?.features || []) {
      if (!wanted.size || wanted.has(String(feature?.id || ''))) {
        geometryBoundsCache.delete(feature.geometry);
        dependencies.ringHitTester.invalidate(feature.geometry);
        dependencies.countryOutlineCache.delete(feature.geometry);
      }
    }
    if (!wanted.size) rebuildSpatialIndex();
    else for (const item of dependencies.state.spatialIndex || []) {
      if (!wanted.has(item.id)) continue;
      const feature = (0, dependencies.countryFeatureById)(item.id);
      if (feature) { item.feature = feature; item.bounds = geometryBounds(feature.geometry); }
    }
  }

  function markCountryGeometriesChanged(ids = []) {
    const changed = new Set();
    for (const rawId of ids) {
      const id = String(rawId || '');
      if (!id) continue;
      changed.add(id);
      dependencies.state.historyDirtyCountryIds.add(id);
      dependencies.state.pendingCountryRenderIds.add(id);
    }
    const currentFeatures = new Map((dependencies.state.countriesData?.features || []).map(feature => [
      String(feature?.id || ''),
      feature,
    ]));
    const features = [];
    const removedIds = [];
    for (const id of changed) {
      const feature = currentFeatures.get(id);
      if (feature) features.push(feature);
      else removedIds.push(id);
    }
    invalidateGeometryCaches(changed);
    if (changed.size) {
      dependencies.state.stateRevision += 1;
    }
    dependencies.countryLandRevision += 1;
    dependencies.boundarySelectionAnalysisCache.clear();
    dependencies.genericFeatureLandClipCache = new WeakMap();
    dependencies.state.boundaryTopology = { edges: new Map(), nodes: new Map() };
    dependencies.gpuMapRenderer.applyCountryPatch({ ids: [...changed], features, removedIds });
    if (!applyingMapEditWorkerResult) mapEditClient.syncPatch(changed);
  }

  function initializeGeometryBoundsCache() {
    (geometryBoundsCache = new WeakMap());
  }

  function initializeMapObjectSpatialIndex() {
    (mapObjectSpatialIndex = (0, dependencies.createMapObjectSpatialIndex)());

    (mapObjectDistributionRowCache = new Map());

    (mapObjectSpatialIndexSources = new Map());

    (mapObjectGeometryRevisions = { label: 0, generic: 0, territorial: 0, hydro: 0 });
  }

  function initializeViewportCullingMetrics() {
    (viewportCullingMetrics = {
      queryCount: 0,
      candidateCount: 0,
      finalVisibleCount: 0,
      projectedVerificationCount: 0,
      projectedVerificationMs: 0,
      lastByDomain: {},
    });
  }

  function initializeApplyingMapEditWorkerResult() {
    (applyingMapEditWorkerResult = false);

    (mapEditClient = (0, dependencies.createMapEditWorkerClient)({
      createWorker: () => new Worker((0, dependencies.runtimeAssetUrl)('workers/map-edit-worker.js'), { name: 'pandolab-map-edit' }),
      getFeatures: () => dependencies.state.countriesData?.features || [],
      getFeatureById: dependencies.countryFeatureById,
      getTargetRevision: () => dependencies.state.stateRevision,
    }));
  }

  return Object.freeze({
    connect,
    initializeGeometryBoundsCache,
    initializeMapObjectSpatialIndex,
    initializeViewportCullingMetrics,
    initializeApplyingMapEditWorkerResult,
    get applyingMapEditWorkerResult() { return applyingMapEditWorkerResult; },
    set applyingMapEditWorkerResult(value) { applyingMapEditWorkerResult = value; },
    get geometryBounds() { return geometryBounds; },
    get geometryBoundsCache() { return geometryBoundsCache; },
    get geometryMayIntersectViewport() { return geometryMayIntersectViewport; },
    get indexedDistributionRow() { return indexedDistributionRow; },
    get indexedMapObjectCandidates() { return indexedMapObjectCandidates; },
    get mapEditClient() { return mapEditClient; },
    get mapObjectGeometryRevisions() { return mapObjectGeometryRevisions; },
    get mapObjectSpatialIndex() { return mapObjectSpatialIndex; },
    get markCountryGeometriesChanged() { return markCountryGeometriesChanged; },
    get rebuildMapObjectSpatialIndex() { return rebuildMapObjectSpatialIndex; },
    get rebuildSpatialIndex() { return rebuildSpatialIndex; },
    get scheduleMapObjectSpatialIndexRebuild() { return scheduleMapObjectSpatialIndexRebuild; },
    get spatialFeatures() { return spatialFeatures; },
    get viewportCullingMetrics() { return viewportCullingMetrics; },
    get visibleMapObjectCandidates() { return visibleMapObjectCandidates; },
  });
}
