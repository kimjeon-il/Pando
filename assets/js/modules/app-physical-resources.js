/** PhysicalResources: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createPhysicalResources() {
  let dependencies;
  let terrainService;
  let hydroService;
  function connect(ports) {
    if (dependencies) throw new Error('physical-resources already connected');
    dependencies = ports;
  }

  function prepareHydroFeature(feature) {
    const bounds = (0, dependencies.coordinateBounds)(feature?.geometry?.coordinates);
    feature.__awBounds = bounds.every(Number.isFinite) ? bounds : [-180, -90, 180, 90];
    try { feature.__awCentroid = dependencies.d3.geo.centroid(feature); }
    catch (_) { feature.__awCentroid = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]; }
    feature.__awRadius = Math.min(180, Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2);
    return feature;
  }

  async function loadTerrainManifest(force = false) {
    return terrainService.load(force);
  }

  async function loadHydroData(force = false) {
    return hydroService.load(force);
  }

  function loadPhysicalData() {
    loadTerrainManifest();
    loadHydroData();
  }

  function hydroVisibilityThreshold() {
    return 2.4 + Math.log2(Math.max(1, (0, dependencies.currentMapZoom)())) * 2.05;
  }

  function hydroFeatureInView(feature) {
    if (!(0, dependencies.isHydroFeatureVisible)(feature)) return false;
    const minZoom = Number(feature.properties?.min_zoom ?? feature.properties?.scale_rank ?? 10);
    if (minZoom > hydroVisibilityThreshold()) return false;
    const bounds = feature.__awBounds || [-180, -90, 180, 90];
    if (dependencies.state.projection === 'flat') {
      const scale = dependencies.flatProjection.scale();
      const halfLon = dependencies.state.size.width / Math.max(1, scale) * 90 / Math.PI;
      const halfLat = dependencies.state.size.height / Math.max(1, scale) * 90 / Math.PI;
      const centerLon = (bounds[0] + bounds[2]) / 2;
      const centerLat = (bounds[1] + bounds[3]) / 2;
      const deltaLon = Math.abs((((centerLon - dependencies.state.view.flatCenter[0]) + 540) % 360) - 180);
      return deltaLon <= halfLon + Math.abs(bounds[2] - bounds[0]) / 2 + 2
        && Math.abs(centerLat - dependencies.state.view.flatCenter[1]) <= halfLat + Math.abs(bounds[3] - bounds[1]) / 2 + 2;
    }
    const center = [-Number(dependencies.state.view.globeRotation?.[0] || 0), -Number(dependencies.state.view.globeRotation?.[1] || 0)];
    const radius = Math.asin(Math.min(1, Math.hypot(dependencies.state.size.width, dependencies.state.size.height) * 0.5 / Math.max(1, dependencies.globeProjection.scale())));
    return dependencies.d3.geo.distance(center, feature.__awCentroid || [0, 0]) <= radius + Number(feature.__awRadius || 0) * Math.PI / 180 + 0.04;
  }

  function hydroRenderGroups(category) {
    const groups = new Map();
    const addFeature = (layerId, width, feature) => {
      const widthBucket = category === 'river' ? Math.round(width * 10) / 10 : 1;
      const key = `${layerId}:${widthBucket}`;
      if (!groups.has(key)) groups.set(key, { key, layerId, width: widthBucket, features: [] });
      groups.get(key).features.push(feature);
    };
    for (const feature of (0, dependencies.allBuiltInHydroFeatures)()) {
      if (!feature.geometry) continue;
      const layerId = feature.properties?.layer_id;
      if (dependencies.HYDRO_LAYER_META[layerId]?.category !== category || !(0, dependencies.hydroLayerVisible)(layerId) || !hydroFeatureInView(feature)) continue;
      if (category !== 'river') {
        addFeature(layerId, 1, feature);
        continue;
      }
      const parts = (0, dependencies.hydroLineParts)(feature.geometry);
      const widthProfiles = feature.properties?.stroke_widths || [];
      const fallbackWidth = Math.max(0.55, Math.min(2.6, Number(feature.properties?.stroke_width || 0.8)));
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const part = parts[partIndex];
        const widths = widthProfiles[partIndex] || [];
        for (let index = 0; index < part.length - 1; index += 1) {
          const startWidth = Number(widths[index] ?? fallbackWidth);
          const endWidth = Number(widths[index + 1] ?? startWidth);
          addFeature(layerId, (startWidth + endWidth) / 2, {
            type: 'Feature',
            properties: feature.properties,
            geometry: { type: 'LineString', coordinates: [part[index], part[index + 1]] },
          });
        }
      }
    }
    return [...groups.values()].map(group => ({ ...group, collection: { type: 'FeatureCollection', features: group.features } }));
  }

  function hydroEditColor(feature) {
    const category = feature?.properties?.category === 'lake' ? 'lake' : 'river';
    return feature?.properties?.editorColor || dependencies.HYDRO_TOOL_CONFIG[category].color;
  }

  function initializeTerrainService() {
    (terrainService = (0, dependencies.createTerrainService)({
      fetchWithRetry: dependencies.fetchWithRetry,
      manifestUrl: () => {
        const url = new URL('terrain/v0.12.6/manifest.json', dependencies.PHYSICAL_DATA_BASE_URL);
        url.searchParams.set('v', dependencies.DATA_REVISION);
        return url;
      },
      getLoadState: () => dependencies.state.physicalLoadState.terrain,
      onLoading: () => {
        dependencies.state.physicalLoadState.terrain = 'loading';
        dependencies.state.physicalLoadState.terrainManifest = 'loading';
        (0, dependencies.markLayerTreeDirty)();
        dependencies.layerTreeController?.render();
      },
      onRetry: (_operation, attempt) => dependencies.reliabilityDiagnostic.push({
        category: 'asset', operation: 'terrain-manifest', result: `retry-${attempt}`,
      }),
      acceptManifest: manifest => {
        dependencies.state.terrainManifest = manifest;
        dependencies.state.physicalLoadState.terrainManifest = 'ready';
        dependencies.state.physicalLoadState.terrain = 'ready';
        dependencies.gpuMapRenderer.setTerrainManifest(manifest);
        (0, dependencies.markLayerTreeDirty)();
        dependencies.layerTreeController?.render();
        dependencies.renderingDomain?.invalidateBaseScene?.('terrain-manifest-ready');
      },
      onFailure: error => {
        dependencies.state.physicalLoadState.terrainManifest = 'error';
        dependencies.state.physicalLoadState.terrain = 'error';
        dependencies.reliabilityDiagnostic.push({ category: 'asset', operation: 'terrain-manifest', result: 'failed', errorCode: 'PL-TERRAIN-001' });
        (0, dependencies.markLayerTreeDirty)();
        dependencies.layerTreeController?.render();
        console.warn('Terrain load failed', error);
        (0, dependencies.reportOperationError)(error, '지형 데이터를 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 잠시 후 다시 시도하세요.', 'PL-TERRAIN-001', 0);
      },
    }));

    (hydroService = (0, dependencies.createHydroService)({
      fetchWithRetry: dependencies.fetchWithRetry,
      dataVersion: dependencies.HYDRO_DATA_VERSION,
      manifestUrl: () => {
        const manifestUrl = new URL(`hydro/v${dependencies.HYDRO_DATA_VERSION}/manifest.json`, dependencies.PHYSICAL_DATA_BASE_URL);
        manifestUrl.searchParams.set('v', dependencies.DATA_REVISION);
        return manifestUrl;
      },
      getLoadState: () => dependencies.state.physicalLoadState.hydro,
      onLoading: () => {
        dependencies.state.physicalLoadState.hydro = 'loading';
        dependencies.state.physicalLoadState.hydroManifest = 'loading';
        dependencies.state.physicalLoadState.hydroWorker = 'starting';
        dependencies.state.physicalLoadState.hydroView = 'idle';
        (0, dependencies.markLayerTreeDirty)();
        dependencies.layerTreeController?.render();
      },
      onRetry: (_operation, attempt) => dependencies.reliabilityDiagnostic.push({
        category: 'asset', operation: 'hydro-manifest', result: `retry-${attempt}`,
      }),
      acceptManifest: async (manifest, manifestUrl) => {
        dependencies.state.hydroManifest = manifest;
        dependencies.state.hydroCollections = {};
        dependencies.state.hydroFeatureCache = new Map();
        dependencies.state.hydroFeatureByFid = new Map();
        dependencies.state.hydroFragmentsByLogicalId = new Map();
        dependencies.state.physicalLoadState.hydroManifest = 'ready';
        dependencies.state.physicalLoadState.hydroCache = 'idle';
        dependencies.state.physicalLoadState.hydroCachePercent = 0;
        const workerReady = await dependencies.gpuMapRenderer.setHydroManifest(manifest, manifestUrl);
        if (!workerReady) return false;
        dependencies.state.physicalLoadState.hydroWorker = 'ready';
        dependencies.state.physicalLoadState.hydro = 'ready';
        (0, dependencies.markLayerTreeDirty)();
        dependencies.layerTreeController?.render();
        dependencies.renderingDomain?.renderHydro?.();
        return true;
      },
      onFailure: error => {
        if (dependencies.state.physicalLoadState.hydroManifest !== 'ready') dependencies.state.physicalLoadState.hydroManifest = 'error';
        dependencies.state.physicalLoadState.hydroWorker = 'error';
        dependencies.state.physicalLoadState.hydro = 'error';
        dependencies.reliabilityDiagnostic.push({ category: 'asset', operation: 'hydro-init', result: 'failed', errorCode: 'PL-WATER-001' });
        (0, dependencies.markLayerTreeDirty)();
        dependencies.layerTreeController?.render();
        console.warn('Hydro load failed', error);
        (0, dependencies.reportOperationError)(error, '강·호수 목록을 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 페이지를 새로고침하거나 잠시 후 다시 시도하세요.', 'PL-WATER-001', 0);
      },
    }));
  }

  return Object.freeze({
    connect,
    initializeTerrainService,
    get hydroEditColor() { return hydroEditColor; },
    get hydroFeatureInView() { return hydroFeatureInView; },
    get hydroRenderGroups() { return hydroRenderGroups; },
    get hydroVisibilityThreshold() { return hydroVisibilityThreshold; },
    get loadHydroData() { return loadHydroData; },
    get loadPhysicalData() { return loadPhysicalData; },
    get loadTerrainManifest() { return loadTerrainManifest; },
    get prepareHydroFeature() { return prepareHydroFeature; },
  });
}
