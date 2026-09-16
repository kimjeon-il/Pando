/** CountryIndex: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createCountryIndex() {
  let dependencies;
  let countryLandRevision;
  let pendingCountryLabelAnchors;
  let countryLabelAnchorVersions;
  let countryLabelAnchors;
  let countryLabelAnchorWorker;
  let countryLabelAnchorTimer;
  let countryLabelAnchorRequestId;
  let countryLabelAnchorFlight;
  let labelFallbackQueue;
  const countryLabelAnchorGeometries = new Map();
  function connect(ports) {
    if (dependencies) throw new Error('country-index already connected');
    dependencies = ports;
  }

  function featureCountryId(feature, index) {
    return String(feature?.id || `country_${index}`);
  }

  function featureCountryName(feature) {
    const p = feature.properties || {};
    return p.name || '이름 없는 국가';
  }

  function reindexCountries(fc, applyOverrides = true, { assumeCanonical = false } = {}) {
    const out = fc?.type === 'FeatureCollection' ? fc : { type: 'FeatureCollection', features: [] };
    dependencies.projectState.state.countryIndex.clear();
    out.features.forEach((feature, index) => {
      if (!assumeCanonical && !(0, dependencies.geometryModel.hasCanonicalCountryWinding)(feature.geometry)) {
        const normalizedGeometry = (0, dependencies.geometryModel.normalizeCountryGeometry)(feature.geometry);
        if (normalizedGeometry) feature.geometry = normalizedGeometry;
      }
      feature.properties = feature.properties || {};
      const id = featureCountryId(feature, index);
      feature.id = id;
      feature.properties = {
        name: featureCountryName(feature),
        ...(feature.properties.validFrom ? { validFrom: String(feature.properties.validFrom) } : {}),
        ...(feature.properties.validTo ? { validTo: String(feature.properties.validTo) } : {}),
      };
      dependencies.projectState.state.countryIndex.set(id, index);
    });
    (0, dependencies.spatialQuery.rebuildSpatialIndex)(out.features);
    (0, dependencies.layers.markLayerTreeDirty)();
    return out;
  }

  function validLabelAnchor(value) {
    return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
  }

  function applyPristineLabelAnchors(collection, onlyIds = null) {
    const filter = onlyIds ? new Set([...onlyIds].map(String)) : null;
    for (const feature of collection?.features || []) {
      const id = String(feature?.id || '');
      if (filter && !filter.has(id)) continue;
      const anchor = dependencies.countries.PRISTINE_LABEL_ANCHORS[id];
      if (!validLabelAnchor(anchor)) continue;
      countryLabelAnchors.set(id, [Number(anchor[0]), Number(anchor[1])]);
      pendingCountryLabelAnchors.delete(id);
    }
  }

  function largestCountryComponentFeature(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return null;
    if (geometry.type === 'Polygon') return { type: 'Feature', properties: feature.properties || {}, geometry: (0, dependencies.platform.deepClone)(geometry) };
    if (geometry.type !== 'MultiPolygon') return null;
    let bestCoordinates = null;
    let bestArea = -Infinity;
    for (const coordinates of geometry.coordinates || []) {
      let area = 0;
      try { area = dependencies.platform.d3.geo.area({ type: 'Polygon', coordinates }); } catch (_) {}
      if (area > bestArea) { bestArea = area; bestCoordinates = coordinates; }
    }
    return bestCoordinates
      ? { type: 'Feature', properties: feature.properties || {}, geometry: { type: 'Polygon', coordinates: (0, dependencies.platform.deepClone)(bestCoordinates) } }
      : null;
  }

  function fallbackCountryLabelAnchor(feature) {
    const primary = largestCountryComponentFeature(feature) || feature;
    try {
      const centroid = dependencies.platform.d3.geo.centroid(primary);
      if (validLabelAnchor(centroid)) return centroid;
    } catch (_) {}
    const ring = primary?.geometry?.coordinates?.[0] || [];
    return (0, dependencies.mapView.ringRepresentativePoint)(ring);
  }

  function queueCountryLabelFallback(id) {
    if (validLabelAnchor(countryLabelAnchors.get(id))) return;
    labelFallbackQueue.set(id, { generation: dependencies.domains.projectDomain.getGeneration(), version: countryLabelAnchorVersions.get(id) });
    dependencies.projectState.mapWorkScheduler.scheduleIdle('country-label-fallback', drainCountryLabelFallback, 20);
  }

  function drainCountryLabelFallback() {
    if (dependencies.projectState.state.mapMoving || document.hidden || navigator.scheduling?.isInputPending?.()) {
      dependencies.projectState.mapWorkScheduler.scheduleIdle('country-label-fallback', drainCountryLabelFallback, 100); return;
    }
    const start = performance.now();
    let changed = false;
    for (const [id, task] of labelFallbackQueue) {
      labelFallbackQueue.delete(id);
      if (task.generation !== dependencies.domains.projectDomain.getGeneration() || task.version !== countryLabelAnchorVersions.get(id)) continue;
      const feature = (0, dependencies.countries.countryLabelFeatureById)(id);
      if (feature && !validLabelAnchor(countryLabelAnchors.get(id))) { countryLabelAnchors.set(id, fallbackCountryLabelAnchor(feature)); changed = true; }
      if (performance.now() - start >= 4) break;
    }
    if (changed) dependencies.domains.renderingDomain?.invalidateLabels?.('country-label-fallback');
    if (labelFallbackQueue.size) dependencies.projectState.mapWorkScheduler.scheduleIdle('country-label-fallback', drainCountryLabelFallback, 20);
  }

  function ensureCountryLabelAnchorWorker() {
    if (countryLabelAnchorWorker) return countryLabelAnchorWorker;
    const worker = new Worker((0, dependencies.platform.runtimeAssetUrl)('workers/label-anchor-worker.js'), {
      name: 'pandolab-label-anchors',
    });
    worker.onmessage = event => {
      const message = event.data || {};
      const flight = countryLabelAnchorFlight;
      if (!flight || message.requestId !== flight.requestId) return;
      countryLabelAnchorFlight = null;
      if (flight.generation !== dependencies.domains.projectDomain.getGeneration()) return;
      dependencies.projectState.mapWorkScheduler.scheduleIdle('country-label-anchor-batch', flushCountryLabelAnchorQueue, 20);
      if (message.type === 'error') {
        console.warn('Country label anchor worker failed', message.message);
        for (const { id } of flight.items) {
          const feature = (0, dependencies.countries.countryLabelFeatureById)(id);
          if (feature) queueCountryLabelFallback(id);
          pendingCountryLabelAnchors.delete(id);
        }
        dependencies.domains.renderingDomain?.invalidateLabels?.('country-label-anchor-fallback');
        return;
      }
      if (message.type !== 'anchors') return;
      for (const result of message.results || []) {
        const id = String(result.id || '');
        if (countryLabelAnchorVersions.get(id) !== Number(result.version || 0)) continue;
        const feature = (0, dependencies.countries.countryLabelFeatureById)(id);
        if (feature && validLabelAnchor(result.anchor)) countryLabelAnchors.set(id, [Number(result.anchor[0]), Number(result.anchor[1])]);
        else if (feature) queueCountryLabelFallback(id);
        pendingCountryLabelAnchors.delete(id);
      }
      dependencies.domains.renderingDomain?.invalidateLabels?.('country-label-anchor-ready');
    };
    worker.onerror = event => {
      console.warn('Country label anchor worker error', event.message || event);
      countryLabelAnchorFlight = null;
      countryLabelAnchorWorker?.terminate();
      countryLabelAnchorWorker = null;
      for (const id of [...pendingCountryLabelAnchors]) {
        const feature = (0, dependencies.countries.countryLabelFeatureById)(id);
        if (feature) queueCountryLabelFallback(id);
        pendingCountryLabelAnchors.delete(id);
      }
      dependencies.domains.renderingDomain?.invalidateLabels?.('country-label-anchor-error');
    };
    countryLabelAnchorWorker = worker;
    return worker;
  }

  function resetCountryLabelAnchorRuntime() {
    labelFallbackQueue.clear();
    dependencies.projectState.mapWorkScheduler.cancel('country-label-fallback');
    countryLabelAnchorFlight = null;
    dependencies.projectState.mapWorkScheduler.cancel('country-label-anchor-batch');
    clearTimeout(countryLabelAnchorTimer);
    countryLabelAnchorTimer = 0;
    countryLabelAnchorWorker?.terminate();
    countryLabelAnchorWorker = null;
    pendingCountryLabelAnchors.clear();
    countryLabelAnchorVersions.clear();
    countryLabelAnchors.clear();
    countryLabelAnchorGeometries.clear();
    countryLabelAnchorRequestId += 1;
  }

  function flushCountryLabelAnchorQueue() {
    countryLabelAnchorTimer = 0;
    if (countryLabelAnchorFlight) return;
    if (dependencies.projectState.state.mapMoving || document.hidden || navigator.scheduling?.isInputPending?.()) {
      dependencies.projectState.mapWorkScheduler.scheduleIdle('country-label-anchor-batch', flushCountryLabelAnchorQueue, 100);
      return;
    }
    const batchStartedAt = performance.now();
    const items = [];
    for (const id of pendingCountryLabelAnchors) {
      const feature = (0, dependencies.countries.countryLabelFeatureById)(id);
      if (!feature?.geometry) continue;
      items.push({
        id,
        version: countryLabelAnchorVersions.get(id) || 0,
        geometry: feature.geometry,
      });
      if (items.length >= 4 || performance.now() - batchStartedAt >= 4) break;
    }
    if (!items.length) return;
    try {
      countryLabelAnchorFlight = { requestId: ++countryLabelAnchorRequestId, generation: dependencies.domains.projectDomain.getGeneration(), items };
      ensureCountryLabelAnchorWorker().postMessage(countryLabelAnchorFlight);
    } catch (error) {
      console.warn('Country label anchor request failed', error);
      countryLabelAnchorFlight = null;
      countryLabelAnchorWorker = null;
      for (const item of items) {
        const feature = (0, dependencies.countries.countryLabelFeatureById)(item.id);
        if (feature) queueCountryLabelFallback(item.id);
        pendingCountryLabelAnchors.delete(item.id);
      }
    }
  }

  function scheduleCountryLabelAnchors(ids = null, delay = 30) {
    const requested = ids ? new Set([...ids].map(String)) : null;
    const sources = (0, dependencies.countries.builtinRenderCountries)();
    for (const id of countryLabelAnchorGeometries.keys()) {
      if (sources.labelById.has(id)) continue;
      countryLabelAnchorGeometries.delete(id);
      countryLabelAnchors.delete(id);
      pendingCountryLabelAnchors.delete(id);
      countryLabelAnchorVersions.delete(id);
    }
    let changed = false;
    for (const feature of sources.labelById.values()) {
      const id = String(feature?.id || '');
      if (requested && !requested.has(id) && !requested.has(String(sources.labelRefs.get(id)?.id))) continue;
      const previousGeometry = countryLabelAnchorGeometries.get(id);
      countryLabelAnchorGeometries.set(id, feature.geometry);
      if (!requested && (!previousGeometry || previousGeometry === feature.geometry)
        && (validLabelAnchor(countryLabelAnchors.get(id)) || pendingCountryLabelAnchors.has(id))) continue;
      countryLabelAnchors.delete(id);
      countryLabelAnchorVersions.set(id, (countryLabelAnchorVersions.get(id) || 0) + 1);
      pendingCountryLabelAnchors.add(id);
      changed = true;
    }
    if (!changed) return;
    (0, dependencies.layers.markLayerTreeDirty)();
    clearTimeout(countryLabelAnchorTimer);
    countryLabelAnchorTimer = setTimeout(flushCountryLabelAnchorQueue, delay);
  }

  function countryFeatureById(id) {
    const idx = dependencies.projectState.state.countryIndex.get(String(id));
    return idx === undefined ? null : dependencies.projectState.state.countriesData?.features?.[idx] || null;
  }

  function initializeCountryLandRevision() {
    (countryLandRevision = 0);

    (pendingCountryLabelAnchors = new Set());

    (countryLabelAnchorVersions = new Map());

    (countryLabelAnchors = new Map());
  }

  function initializeCountryLabelAnchorWorker() {
    (countryLabelAnchorWorker = null);

    (countryLabelAnchorTimer = 0);

    (countryLabelAnchorRequestId = 0);

    (countryLabelAnchorFlight = null);
  }

  function initializeLabelFallbackQueue() {
    (labelFallbackQueue = new Map());
  }

  return Object.freeze({
    connect,
    initializeCountryLandRevision,
    initializeCountryLabelAnchorWorker,
    initializeLabelFallbackQueue,
    get applyPristineLabelAnchors() { return applyPristineLabelAnchors; },
    get countryFeatureById() { return countryFeatureById; },
    get countryLabelAnchors() { return countryLabelAnchors; },
    get countryLandRevision() { return countryLandRevision; },
    set countryLandRevision(value) { countryLandRevision = value; },
    get featureCountryId() { return featureCountryId; },
    get pendingCountryLabelAnchors() { return pendingCountryLabelAnchors; },
    get reindexCountries() { return reindexCountries; },
    get resetCountryLabelAnchorRuntime() { return resetCountryLabelAnchorRuntime; },
    get scheduleCountryLabelAnchors() { return scheduleCountryLabelAnchors; },
    get validLabelAnchor() { return validLabelAnchor; },
  });
}
