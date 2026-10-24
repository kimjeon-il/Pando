import { createStoredAssetLoader } from './stored-asset-loader.js';
import { parseTemporal, temporalContains, temporalMonthEnd } from './temporal.js';
// Hydro v0.13.2 keeps its published 6.0/6.7/7.0/7.5 stage metadata.
// Gate those existing stages by actual map zoom; no geometry, names, or basin
// selection data need to be rewritten.
const HYDRO_DISPLAY_ZOOM_GATES = Object.freeze([
  Object.freeze({ mapZoom: 3.5, sourceMinZoom: 6.0 }),
  Object.freeze({ mapZoom: 7, sourceMinZoom: 6.7 }),
  Object.freeze({ mapZoom: 14, sourceMinZoom: 7.0 }),
  Object.freeze({ mapZoom: 28, sourceMinZoom: 7.5 }),
]);

export function hydroVisibilityThresholdForMapZoom(mapZoom) {
  const zoom = Number(mapZoom);
  if (!Number.isFinite(zoom)) return Number.NEGATIVE_INFINITY;
  for (let index = HYDRO_DISPLAY_ZOOM_GATES.length - 1; index >= 0; index -= 1) {
    const gate = HYDRO_DISPLAY_ZOOM_GATES[index];
    if (zoom >= gate.mapZoom) return gate.sourceMinZoom;
  }
  return Number.NEGATIVE_INFINITY;
}

/** PhysicalResources: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function selectPhysicalWaterContext(contexts,date) {
  const point=parseTemporal(date);
  if(!point)return null;
  const when=point.precision==='month'?temporalMonthEnd(point):point;
  return contexts.find(row=>temporalContains(row,when))||null;
}
export function createPhysicalResources({ capabilities = {terrain:true,builtinHydro:true,eagerBuiltinHydro:true} } = {}) {
  let dependencies;
  let terrainService;
  let hydroService;
  let physicalLand = null, landLoading = null;
  const historicalContexts=new Map();
  let requestedHistoryId=null;
  function currentPhysicalContext() {
    const rows=globalThis.PANDOLAB_BUILD_META.physicalWaterHistory;
    if(!Array.isArray(rows))throw new Error('Missing pinned historical physical-water manifest.');
    const row=selectPhysicalWaterContext(rows,dependencies.projectState.state.timelineCursor);
    const nextId=row?.id||null;
    if(nextId!==requestedHistoryId){
      requestedHistoryId=nextId;
      if(row&&historicalContexts.get(row.id)?.status==='error')historicalContexts.delete(row.id);
    }
    if(!row)return physicalLand;
    if(!historicalContexts.has(row.id)) {
      const entry={status:'loading',value:null,promise:null};
      historicalContexts.set(row.id,entry);
      const loader=createStoredAssetLoader({dataRevision:globalThis.PANDOLAB_BUILD_META.dataRevision,
        resolveUrl:spec=>new URL(spec.url.replace(/^assets\/data\//,''),dependencies.physicalConfig.PHYSICAL_DATA_BASE_URL).href});
      const decode=buffer=>JSON.parse(new TextDecoder().decode(buffer));
      entry.promise=Promise.all([loader.loadAsset(row.land,'background',row.id+'-land','역사 육지 배경',decode),loader.loadAsset(row.water,'background',row.id+'-water','역사 수역',decode)])
        .then(([land,water])=>{
          if(land.value.type!=='MultiPolygon'||water.value.type!=='Polygon')throw new Error('Invalid historical physical-water geometry.');
          entry.value=Object.freeze({geometry:land.value,revision:row.land.sha256,water:water.value,waterRevision:row.water.sha256});
          entry.status='ready';
          dependencies.domains.renderingDomain.invalidateProject('historical-physical-water-ready');
        }).catch(error=>{entry.status='error';dependencies.feedback.reportOperationError(error,'역사 수역 자료를 준비하지 못해 기본 육지 배경을 유지합니다. 시점을 바꿨다가 돌아오면 다시 불러옵니다.','PL-PHYSICAL-HISTORY-001',4200);});
    }
    return historicalContexts.get(row.id).value||physicalLand;
  }
  function loadPhysicalLandMask() {
    if (physicalLand) return Promise.resolve(physicalLand);
    if (!landLoading) landLoading = (async () => {
      const meta = globalThis.PANDOLAB_BUILD_META;
      if (!meta?.physicalLand) throw new Error('Missing pinned physical land asset.');
      const loader = createStoredAssetLoader({ dataRevision: meta.dataRevision,
        resolveUrl: spec => new URL(spec.url.replace(/^assets\/data\//, ''), dependencies.physicalConfig.PHYSICAL_DATA_BASE_URL).href });
      const result = await loader.loadAsset(meta.physicalLand, 'background', 'physical-land', '육지 배경', buffer => {
        const geometry = JSON.parse(new TextDecoder().decode(buffer));
        if (geometry.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates)) throw new Error('Invalid physical land geometry.');
        return geometry;
      });
      physicalLand = Object.freeze({ geometry: result.value, revision: meta.physicalLand.sha256 });
      dependencies.domains.renderingDomain.invalidateProject('physical-land-ready');
      return physicalLand;
    })().catch(error => { landLoading = null; throw error; });
    return landLoading;
  }
  function connect(ports) {
    if (dependencies) throw new Error('physical-resources already connected');
    dependencies = ports;
  }

  function prepareHydroFeature(feature) {
    const bounds = (0, dependencies.cutGeometry.coordinateBounds)(feature?.geometry?.coordinates);
    feature.__awBounds = bounds.every(Number.isFinite) ? bounds : [-180, -90, 180, 90];
    try { feature.__awCentroid = dependencies.platform.d3.geo.centroid(feature); }
    catch (_) { feature.__awCentroid = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]; }
    feature.__awRadius = Math.min(180, Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2);
    return feature;
  }

  async function loadTerrainManifest(force = false) {
    if (!capabilities.terrain) return false;
    return terrainService.load(force);
  }

  async function loadHydroData(force = false) {
    if (!capabilities.builtinHydro || (!capabilities.eagerBuiltinHydro && !force)) return false;
    return hydroService.load(force);
  }

  function builtinHydroSelectionReferences(features=(0,dependencies.hydroPresentation.allBuiltInHydroFeatures)()) {
    return [...new Map(features.map(feature=>{
      const id=String(feature.properties?.pandolab_id || feature.id);
      const category=dependencies.hydroPresentation.HYDRO_LAYER_META[feature.properties?.layer_id]?.category || feature.properties?.category;
      const sourceIds=String(feature.properties?.source_id || '').split(',').filter(Boolean);
      return [id,{domain:'hydroBuiltin',id,logicalId:id,type:(0,dependencies.hydroPresentation.hydroCategoryKey)(category),sourceIds}];
    })).values()];
  }

  async function admitHydroFeatures(features=[]) {
    if(typeof dependencies.domains.projectDomain?.admitSelectionCatalog!=='function')
      throw new TypeError('Hydro source identities require the canonical Core admission boundary.');
    const cache=dependencies.projectState.state.hydroFeatureCache;
    if(!(cache instanceof Map))throw new TypeError('The canonical hydro resource cache is required.');
    for(const feature of features) {
      const id=String(feature.properties?.pandolab_id || feature.id),existing=cache.get(id);
      // Descriptor/FID indexes point at this aggregate. Hydrate that same
      // resource allocation rather than replacing it with a second full row.
      if(existing && existing!==feature)Object.assign(existing,feature);
      else cache.set(id,feature);
    }
    return dependencies.domains.projectDomain.admitSelectionCatalog('hydroBuiltin',()=>builtinHydroSelectionReferences());
  }

  async function loadPhysicalData({includeHydro=true}={}){
    try{return await Promise.all([loadPhysicalLandMask(),loadTerrainManifest(),includeHydro ? loadHydroData() : false]);}
    catch(error){dependencies.feedback.reportOperationError(error,'지도 배경 자료를 준비하지 못했습니다.','PL-PHYSICAL-LOAD-001',4200);return false;}
  }

  function hydroVisibilityThreshold() {
    return hydroVisibilityThresholdForMapZoom((0, dependencies.labelPresentation.currentMapZoom)());
  }

  function hydroFeatureInView(feature) {
    if (!(0, dependencies.physicalServices.isHydroFeatureVisible)(feature)) return false;
    const minZoom = Number(feature.properties?.min_zoom ?? feature.properties?.scale_rank ?? 10);
    if (minZoom > hydroVisibilityThreshold()) return false;
    const bounds = feature.__awBounds || [-180, -90, 180, 90];
    if (dependencies.projectState.state.projection === 'flat') {
      const scale = dependencies.mapView.flatProjection.scale();
      const halfLon = dependencies.projectState.state.size.width / Math.max(1, scale) * 90 / Math.PI;
      const halfLat = dependencies.projectState.state.size.height / Math.max(1, scale) * 90 / Math.PI;
      const centerLon = (bounds[0] + bounds[2]) / 2;
      const centerLat = (bounds[1] + bounds[3]) / 2;
      const deltaLon = Math.abs((((centerLon - dependencies.projectState.state.view.flatCenter[0]) + 540) % 360) - 180);
      return deltaLon <= halfLon + Math.abs(bounds[2] - bounds[0]) / 2 + 2
        && Math.abs(centerLat - dependencies.projectState.state.view.flatCenter[1]) <= halfLat + Math.abs(bounds[3] - bounds[1]) / 2 + 2;
    }
    const center = [-Number(dependencies.projectState.state.view.globeRotation?.[0] || 0), -Number(dependencies.projectState.state.view.globeRotation?.[1] || 0)];
    const radius = Math.asin(Math.min(1, Math.hypot(dependencies.projectState.state.size.width, dependencies.projectState.state.size.height) * 0.5 / Math.max(1, dependencies.mapView.globeProjection.scale())));
    return dependencies.platform.d3.geo.distance(center, feature.__awCentroid || [0, 0]) <= radius + Number(feature.__awRadius || 0) * Math.PI / 180 + 0.04;
  }

  function hydroRenderGroups(category) {
    const groups = new Map();
    const addFeature = (layerId, width, feature) => {
      const widthBucket = category === 'river' ? Math.round(width * 10) / 10 : 1;
      const key = `${layerId}:${widthBucket}`;
      if (!groups.has(key)) groups.set(key, { key, layerId, width: widthBucket, features: [] });
      groups.get(key).features.push(feature);
    };
    for (const feature of (0, dependencies.hydroPresentation.allBuiltInHydroFeatures)()) {
      if (!feature.geometry) continue;
      const layerId = feature.properties?.layer_id;
      if (dependencies.hydroPresentation.HYDRO_LAYER_META[layerId]?.category !== category || !(0, dependencies.hydroPresentation.hydroLayerVisible)(layerId) || !hydroFeatureInView(feature)) continue;
      if (category !== 'river') {
        addFeature(layerId, 1, feature);
        continue;
      }
      const parts = (0, dependencies.hydroPresentation.hydroLineParts)(feature.geometry);
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
    return feature?.properties?.editorColor || dependencies.hydroPresentation.HYDRO_TOOL_CONFIG[category].color;
  }

  function initializeTerrainService() {
    if(capabilities.terrain)(terrainService = (0, dependencies.physicalServices.createTerrainService)({
      fetchWithRetry: dependencies.physicalServices.fetchWithRetry,
      manifestUrl: () => dependencies.physicalConfig.TERRAIN_PRIMARY_MANIFEST_URL,
      fallbackManifestUrl: dependencies.physicalConfig.TERRAIN_FALLBACK_MANIFEST_URL
        ? () => dependencies.physicalConfig.TERRAIN_FALLBACK_MANIFEST_URL : null,
      getLoadState: () => dependencies.projectState.state.physicalLoadState.terrain,
      onLoading: () => {
        dependencies.projectState.state.physicalLoadState.terrain = 'loading';
        dependencies.projectState.state.physicalLoadState.terrainManifest = 'loading';
        (0, dependencies.layerPresentation.invalidateObjectPresentation)();
        dependencies.domains.objectSearchController?.render();
      },
      onRetry: (_operation, attempt) => dependencies.operationFeedback.reliabilityDiagnostic.push({
        category: 'asset', operation: 'terrain-manifest', result: `retry-${attempt}`,
      }),
      acceptManifest: (manifest, manifestUrl, context) => {
        dependencies.projectState.state.terrainManifest = manifest;
        dependencies.projectState.state.physicalLoadState.terrainManifest = 'ready';
        dependencies.projectState.state.physicalLoadState.terrain = 'ready';
        dependencies.rendering.gpuMapRenderer.setTerrainManifest(manifest, manifestUrl, {
          source: context.usedFallback ? 'fallback' : dependencies.physicalConfig.TERRAIN_SOURCE_CHOICE,
          fallbackReason: context.fallbackReason,
        });
        (0, dependencies.layerPresentation.invalidateObjectPresentation)();
        dependencies.domains.objectSearchController?.render();
        dependencies.domains.renderingDomain?.invalidateBaseScene?.('terrain-manifest-ready');
      },
      onFailure: error => {
        dependencies.projectState.state.physicalLoadState.terrainManifest = 'error';
        dependencies.projectState.state.physicalLoadState.terrain = 'error';
        dependencies.operationFeedback.reliabilityDiagnostic.push({ category: 'asset', operation: 'terrain-manifest', result: 'failed', errorCode: 'PL-TERRAIN-001' });
        (0, dependencies.layerPresentation.invalidateObjectPresentation)();
        dependencies.domains.objectSearchController?.render();
        console.warn('Terrain load failed', error);
        (0, dependencies.feedback.reportOperationError)(error, '지형 데이터를 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 잠시 후 다시 시도하세요.', 'PL-TERRAIN-001', 0);
      },
    }));

    if(capabilities.builtinHydro)(hydroService = (0, dependencies.physicalServices.createHydroService)({
      fetchWithRetry: dependencies.physicalServices.fetchWithRetry,
      dataVersion: dependencies.physicalConfig.HYDRO_DATA_VERSION,
      manifestUrl: () => {
        const manifestUrl = new URL(`hydro/v${dependencies.physicalConfig.HYDRO_DATA_VERSION}/manifest.json`, dependencies.physicalConfig.PHYSICAL_DATA_BASE_URL);
        manifestUrl.searchParams.set('v', dependencies.physicalConfig.DATA_REVISION);
        return manifestUrl;
      },
      getLoadState: () => dependencies.projectState.state.physicalLoadState.hydro,
      onLoading: () => {
        dependencies.projectState.state.physicalLoadState.hydro = 'loading';
        dependencies.projectState.state.physicalLoadState.hydroManifest = 'loading';
        dependencies.projectState.state.physicalLoadState.hydroWorker = 'starting';
        dependencies.projectState.state.physicalLoadState.hydroView = 'idle';
        (0, dependencies.layerPresentation.invalidateObjectPresentation)();
        dependencies.domains.objectSearchController?.render();
      },
      onRetry: (_operation, attempt) => dependencies.operationFeedback.reliabilityDiagnostic.push({
        category: 'asset', operation: 'hydro-manifest', result: `retry-${attempt}`,
      }),
      acceptManifest: async (manifest, manifestUrl) => {
        dependencies.projectState.state.hydroManifest = manifest;
        dependencies.projectState.state.hydroCollections = {};
        dependencies.projectState.state.hydroFeatureCache = new Map();
        dependencies.projectState.state.hydroFeatureByFid = new Map();
        dependencies.projectState.state.hydroFragmentsByLogicalId = new Map();
        dependencies.projectState.state.physicalLoadState.hydroManifest = 'ready';
        dependencies.projectState.state.physicalLoadState.hydroCache = 'idle';
        dependencies.projectState.state.physicalLoadState.hydroCachePercent = 0;
        const renderer=dependencies.rendering.gpuMapRenderer;
        let generation,workerReady;
        do {
          generation=renderer.getProjectGeneration();
          workerReady=await renderer.setHydroManifest(manifest,manifestUrl);
        } while(generation!==renderer.getProjectGeneration());
        if (!workerReady) return false;
        await admitHydroFeatures();
        dependencies.projectState.state.physicalLoadState.hydroWorker = 'ready';
        dependencies.projectState.state.physicalLoadState.hydro = 'ready';
        (0, dependencies.layerPresentation.invalidateObjectPresentation)();
        dependencies.domains.objectSearchController?.render();
        dependencies.domains.renderingDomain?.invalidateOverlayGeometry('hydro', 'hydro-ready');
        return true;
      },
      onFailure: error => {
        if (dependencies.projectState.state.physicalLoadState.hydroManifest !== 'ready') dependencies.projectState.state.physicalLoadState.hydroManifest = 'error';
        dependencies.projectState.state.physicalLoadState.hydroWorker = 'error';
        dependencies.projectState.state.physicalLoadState.hydro = 'error';
        dependencies.operationFeedback.reliabilityDiagnostic.push({ category: 'asset', operation: 'hydro-init', result: 'failed', errorCode: 'PL-WATER-001' });
        (0, dependencies.layerPresentation.invalidateObjectPresentation)();
        dependencies.domains.objectSearchController?.render();
        console.warn('Hydro load failed', error);
        (0, dependencies.feedback.reportOperationError)(error, '강·호수 목록을 불러오지 못했습니다. 국가 지도는 계속 사용할 수 있습니다. 페이지를 새로고침하거나 잠시 후 다시 시도하세요.', 'PL-WATER-001', 0);
      },
    }));
  }

  return Object.freeze({
    connect,
    initializeTerrainService,
    loadPhysicalLandMask,
    get physicalLand() { return currentPhysicalContext(); },
    get hydroEditColor() { return hydroEditColor; },
    get hydroFeatureInView() { return hydroFeatureInView; },
    get hydroRenderGroups() { return hydroRenderGroups; },
    get hydroVisibilityThreshold() { return hydroVisibilityThreshold; },
    get loadHydroData() { return loadHydroData; },
    builtinHydroSelectionReferences,
    admitHydroFeatures,
    get loadPhysicalData() { return loadPhysicalData; },
    get loadTerrainManifest() { return loadTerrainManifest; },
    get prepareHydroFeature() { return prepareHydroFeature; },
  });
}
