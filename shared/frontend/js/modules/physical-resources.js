import {geometryReferenceFor} from './geometry-version-store.js';
import '../vendor/polygon-clipping.min.js';
import { createStoredAssetLoader } from './stored-asset-loader.js';
import { sharedCalculationCore } from './temporal.js';
import { timelineObjectKey } from './timeline-records.js';
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
export function resolvePhysicalWaterObjects(catalog,date) {
  if(!catalog || !Array.isArray(catalog.identities) || !Array.isArray(catalog.geometries))throw new Error('Missing common physical-water catalog.');
  if(!date)return [];
  const assets=new Map(catalog.geometries.map(row=>[JSON.stringify(row.geometryRef),row]));
  const identities=new Map(catalog.identities.map(row=>[timelineObjectKey(row.objectRef),row]));
  return sharedCalculationCore.timelineResolveWorld(catalog.timelineRecords,{
    entities:catalog.identities.map(({objectRef,entityKind})=>({objectRef,entityKind})),
    geometryExists:ref=>assets.has(JSON.stringify(ref)),
  },date).entities.map(row=>({...row,identity:identities.get(timelineObjectKey(row.objectRef)),assets:assets.get(JSON.stringify(row.geometryRef))}));
}
// Runtime and prepared-mesh generation must concatenate the same selected
// waters in the canonical selection order, including islands and holes.
export function composePhysicalWaterGeometry(waters) {
  return waters.length===1?waters[0]:waters.length?{type:'MultiPolygon',coordinates:waters.flatMap(value=>value.type==='Polygon'?[value.coordinates]:value.coordinates)}:null;
}
// Derived mask presentation belongs to the existing physical resource owner.
// Project water identity/periods remain owned by the common C++ document.
export function createPhysicalWaterPresentation() {
  let previousKey=null,previous=null;
  return (context,replacement,visible)=>{
    if(!replacement)return visible?context:{...context,water:null};
    const ref=geometryReferenceFor(replacement.geometry);
    if(!ref)throw new Error('A copied water mask requires an admitted geometry version.');
    const key=JSON.stringify([context.revision,context.waterRevision,ref.id,ref.version]);
    if(key===previousKey)return previous;
    const polygons=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const extent=polygons(replacement.geometry).concat(polygons(context.water)).flat(2).reduce((box,[x,y])=>[Math.min(box[0],x),Math.min(box[1],y),Math.max(box[2],x),Math.max(box[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
    const local=[],unchanged=[];
    for(const polygon of context.geometry.coordinates){
      const box=polygon[0].reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
      (box[0]<=extent[2]&&box[2]>=extent[0]&&box[1]<=extent[3]&&box[3]>=extent[1]?local:unchanged).push(polygon);
    }
    const filled=globalThis.polygonClipping.union(...local.map(polygon=>[polygon]),polygons(context.water));
    const changed=globalThis.polygonClipping.difference(filled,polygons(replacement.geometry));
    previousKey=key;previous=Object.freeze({...context,geometry:{type:'MultiPolygon',coordinates:[...unchanged,...changed]},revision:key,water:null});
    return previous;
  };
}
export function createPhysicalResources({ buildMeta,capabilities = {terrain:true,builtinHydro:true,eagerBuiltinHydro:true} } = {}) {
  let dependencies;
  let terrainService;
  let hydroService;
  let physicalLand = null, landLoading = null,physicalAssetLoader=null;
  let initialPreviewLoading=null;
  function storedPhysicalAssets() {
    if(!physicalAssetLoader)physicalAssetLoader=createStoredAssetLoader({dataRevision:buildMeta.dataRevision,
      resolveUrl:spec=>new URL(spec.url.replace(/^assets\/data\//,''),dependencies.physicalConfig.PHYSICAL_DATA_BASE_URL).href});
    return physicalAssetLoader;
  }
  const waterContexts=new Map();
  let requestedWaterKey=null;
  let physicalSelection=null;
  function physicalSelectionFor(date) {
    const catalog=buildMeta.physicalWaterObjects;
    const rows=resolvePhysicalWaterObjects(catalog,date)
      .sort((a,b)=>timelineObjectKey(a.objectRef).localeCompare(timelineObjectKey(b.objectRef)));
    if(rows.some(row=>row.assets.land.sha256!==rows[0].assets.land.sha256))throw new Error('Selected water objects require one coherent physical land derivative.');
    return {catalog,date,rows,key:JSON.stringify(rows.map(row=>[row.objectRef,row.geometryRef]))};
  }
  function selectedPhysicalWater() {
    const catalog=buildMeta.physicalWaterObjects,date=dependencies.projectState.state.timelineCursor;
    if(!physicalSelection||physicalSelection.catalog!==catalog||physicalSelection.date!==date){
      physicalSelection=physicalSelectionFor(date);
    }
    return physicalSelection;
  }
  function ensurePhysicalContext({rows:selected,key}) {
    if(waterContexts.has(key))return waterContexts.get(key);
    const landAsset=selected[0].assets.land;
    const entry={status:'loading',value:null,promise:null,activation:null,presentation:null,presentationKey:null};
    waterContexts.set(key,entry);
    const loader=storedPhysicalAssets(),decode=buffer=>JSON.parse(new TextDecoder().decode(buffer));
    entry.promise=Promise.all([
      landAsset.sha256===buildMeta.physicalLand.sha256?loadPhysicalLandMask({notify:false}).then(value=>({value:value.geometry})):loader.loadAsset(landAsset,'background',key+'-land','육지 배경',decode),
      ...selected.map(row=>loader.loadAsset(row.assets.asset,'background',JSON.stringify(row.geometryRef)+'-water','수역 형상',decode)),
    ]).then(([land,...waters])=>{
      if(land.value.type!=='MultiPolygon'||waters.some(water=>!['Polygon','MultiPolygon'].includes(water.value.type)))throw new Error('Invalid physical-water geometry.');
      entry.value=Object.freeze({geometry:land.value,revision:landAsset.sha256,
        waters:selected.map((row,index)=>({row,water:waters[index].value,waterRevision:row.assets.asset.sha256}))});
      entry.status='ready';return entry.value;
    }).catch(error=>{entry.status='error';entry.error=error;throw error;});
    return entry;
  }
  async function preparePhysicalContext(month,{isCurrent=()=>true}={}) {
    const assertCurrent=()=>{if(!isCurrent())throw Object.assign(new Error('Physical preparation superseded'),{name:'AbortError',cancelled:true});};
    assertCurrent();
    const selection=physicalSelectionFor(month),entry=waterContexts.get(selection.key);
    if(entry?.status==='error')waterContexts.delete(selection.key);
    const result=selection.rows.length?await ensurePhysicalContext(selection).promise:await loadPhysicalLandMask({notify:false});
    assertCurrent();return result;
  }
  function activatePhysicalContext(entry,key) {
    const cache=dependencies.projectState.state.hydroFeatureCache;
    if(entry.activation&&entry.activation.cache===cache)return;
    const activation={cache};entry.activation=activation;
    activation.promise=entry.promise.then(async()=>{
      for(const value of entry.value.waters){
        if(requestedWaterKey!==key||selectedPhysicalWater().key!==key||dependencies.projectState.state.hydroFeatureCache!==cache)break;
        await admitSelectedWater(value.row,value);
      }
      dependencies.domains.renderingDomain.invalidateProject('physical-water-ready');
    }).catch(error=>{
      dependencies.feedback.reportOperationError(error,'수역 형상을 준비하지 못했습니다. 시점을 바꿨다가 돌아오면 다시 불러옵니다.','PL-PHYSICAL-HISTORY-001',4200);
    });
  }
  const presentPhysicalWater=createPhysicalWaterPresentation();
  function currentPhysicalContext() {
    const {rows:selected,key}=selectedPhysicalWater();
    if(!selected.length){requestedWaterKey=null;return physicalLand;}
    if(key!==requestedWaterKey){
      requestedWaterKey=key;
      if(waterContexts.get(key)?.status==='error')waterContexts.delete(key);
      if(waterContexts.has(key))waterContexts.get(key).activation=null;
      // An old version cannot remain selectable while its successor loads.
      for(const row of selected)dependencies.projectState.state.hydroFeatureCache?.delete(row.objectRef.id);
    }
    const entry=ensurePhysicalContext({rows:selected,key}),state=dependencies.projectState.state;
    activatePhysicalContext(entry,key);
    // Core catalog admission can be queued behind the current project
    // replacement. Immutable mask readiness cannot wait for that queue.
    if(entry.status!=='ready')return physicalLand;
    const presentations=entry.value.waters.map(value=>{
      const id=value.row.objectRef.id,replacement=(state.hydroEdits||[]).find(feature=>feature.properties.sourceFeatureId===id);
      const feature=state.hydroFeatureCache?.get(id);
      const descriptor=feature||{id,properties:{pandolab_id:id,category:value.row.identity.entityKind,layer_id:value.row.identity.layerId}};
      const visible=capabilities.builtinHydro||feature?dependencies.physicalServices.isHydroFeatureVisible(descriptor):true;
      return {...value,replacement,visible};
    });
    const presentationKey=JSON.stringify(presentations.map(value=>[value.row.objectRef,value.row.geometryRef,
      value.replacement?geometryReferenceFor(value.replacement.geometry):null,value.visible]));
    if(entry.presentationKey===presentationKey)return entry.presentation;
    let geometry=entry.value.geometry,revision=entry.value.revision;
    const visibleWater=[];
    for(const value of presentations){
      const result=presentPhysicalWater({geometry,revision,water:value.water,waterRevision:value.waterRevision,waterObjectRef:value.row.objectRef},value.replacement,value.visible);
      geometry=result.geometry;revision=result.revision;
      if(result.water)visibleWater.push(result.water);
    }
    const water=composePhysicalWaterGeometry(visibleWater);
    entry.presentationKey=presentationKey;
    entry.presentation=Object.freeze({geometry,revision,water,waterRevision:JSON.stringify([key,presentationKey])});
    return entry.presentation;
  }

  async function admitSelectedWater(row,value) {
    const state=dependencies.projectState.state;
    if(!capabilities.builtinHydro)return;
    if(!(state.hydroFeatureCache instanceof Map))throw new TypeError("The canonical hydro resource cache is required.");
    const feature=prepareHydroFeature({type:'Feature',id:row.objectRef.id,geometry:value.water,
      properties:{pandolab_id:row.objectRef.id,category:row.identity.entityKind,layer_id:row.identity.layerId,
        name:row.identity.name,name_ko:row.identity.name,source:row.identity.source,source_id:row.identity.sourceId||row.objectRef.id,
        min_zoom:0,physical_water:true,geometryRef:row.geometryRef}});
    await admitHydroFeatures([feature]);
  }
  let builtinTimelineView=null;
  function isHydroObjectActive(feature) {
    if(feature.properties?.pandolab_domain==='hydro')return true; // Already projected by the authoritative document world.
    const state=dependencies.projectState.state,revision=state.hydroFeatureCatalogRevision||0,date=state.timelineCursor;
    if(!date)return false;
    const {rows:selected,key:selectionKey}=selectedPhysicalWater();
    const entry=waterContexts.get(selectionKey);
    const readyKey=entry?.status==='ready'?selectionKey:null;
    if(!builtinTimelineView || builtinTimelineView.revision!==revision || builtinTimelineView.date!==date || builtinTimelineView.readyKey!==readyKey) {
      const catalog=buildMeta.physicalWaterObjects;
      const identities=[...catalog.identities],records=structuredClone(catalog.timelineRecords);
      const ids=new Set(identities.map(row=>row.objectRef.id)),refs=new Set(catalog.geometries.map(row=>JSON.stringify(row.geometryRef)));
      for(const value of state.hydroFeatureCache.values()) {
        const id=String(value.properties?.pandolab_id||value.id);if(ids.has(id))continue;ids.add(id);
        const objectRef={domain:'hydroBuiltin',id},key='builtin:'+id;
        identities.push({objectRef,entityKind:value.properties.category});
        records.lifetimes.push({id:key+':life',objectRef,validFrom:null,validTo:null});
        const geometryRef={id:'hydro:'+String(state.hydroManifest?.index?.sha256||'source')+':'+id,version:1};refs.add(JSON.stringify(geometryRef));
        records.geometryBindings.push({id:key+':geometry',objectRef,validFrom:null,validTo:null,geometryRef});
      }
      const resolved=sharedCalculationCore.timelineResolveWorld(records,{entities:identities,geometryExists:ref=>refs.has(JSON.stringify(ref))},date);
      const active=new Set(resolved.entities.map(row=>timelineObjectKey(row.objectRef)));
      // Source substitution is a presentation relation of the selected version,
      // not a rewritten lifetime or a second temporal selector. Keep originals
      // visible while a replacement is loading or has failed.
      if(readyKey)for(const row of selected)for(const ref of row.assets.replaces||[]) {
        if(ref.domain!=='hydroBuiltin'||!ref.id)throw new Error('Invalid physical-water source replacement reference.');
        active.delete(timelineObjectKey(ref));
      }
      builtinTimelineView={revision,date,readyKey,active};
    }
    return builtinTimelineView.active.has(timelineObjectKey({domain:'hydroBuiltin',id:String(feature.properties?.pandolab_id||feature.id)}));
  }
  function loadInitialLandPreview(){
    if(!initialPreviewLoading){
      const source=buildMeta.physicalLand,spec=buildMeta.initialLandPreview;
      if(!spec?.url||spec.sourceSha256!==source?.sha256)
        return Promise.reject(new Error('Initial land preview does not match the pinned physical source.'));
      initialPreviewLoading=storedPhysicalAssets().loadAsset(spec,'background','initial-land-preview','초기 지도 윤곽',buffer=>{
        const geometry=JSON.parse(new TextDecoder().decode(buffer));
        if(geometry?.type!=='MultiPolygon'||!Array.isArray(geometry.coordinates)
          ||geometry.coordinates.length!==spec.polygonCount)throw new Error('Invalid initial land preview geometry.');
        return geometry;
      }).then(result=>Object.freeze({geometry:result.value,revision:spec.sha256}));
      initialPreviewLoading=initialPreviewLoading.catch(error=>{initialPreviewLoading=null;throw error;});
    }
    return initialPreviewLoading;
  }
  function loadPhysicalLandMask({notify=true}={}) {
    if (physicalLand) return Promise.resolve(physicalLand);
    if (!landLoading) landLoading = (async () => {
      const meta = buildMeta;
      if (!meta?.physicalLand) throw new Error('Missing pinned physical land asset.');
      const loader = storedPhysicalAssets();
      const result = await loader.loadAsset(meta.physicalLand, 'background', 'physical-land', '육지 배경', buffer => {
        const geometry = JSON.parse(new TextDecoder().decode(buffer));
        if (geometry.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates)) throw new Error('Invalid physical land geometry.');
        return geometry;
      });
      physicalLand = Object.freeze({ geometry: result.value, revision: meta.physicalLand.sha256 });
      if(notify)dependencies.domains.renderingDomain.invalidateProject('physical-land-ready');
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
      dependencies.projectState.state.hydroFeatureCatalogRevision=(dependencies.projectState.state.hydroFeatureCatalogRevision||0)+1;
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
      if (!feature.geometry || feature.properties?.physical_water) continue;
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
    loadInitialLandPreview,
    preparePhysicalContext,
    get physicalLand() { return currentPhysicalContext(); },
    get physicalContextState() {
      const context=currentPhysicalContext(),selection=selectedPhysicalWater(),entry=waterContexts.get(selection.key);
      const ready=selection.rows.length?entry?.status==='ready':!!physicalLand;
      return {ready,error:entry?.error||null,
        landRevision:ready?context.revision:null,waterRevision:ready&&context.water?context.waterRevision:null};
    },
    get hydroEditColor() { return hydroEditColor; },
    get hydroFeatureInView() { return hydroFeatureInView; },
    get hydroRenderGroups() { return hydroRenderGroups; },
    get hydroVisibilityThreshold() { return hydroVisibilityThreshold; },
    get loadHydroData() { return loadHydroData; },
    builtinHydroSelectionReferences,
    isHydroObjectActive,
    admitHydroFeatures,
    get loadPhysicalData() { return loadPhysicalData; },
    get loadTerrainManifest() { return loadTerrainManifest; },
    get prepareHydroFeature() { return prepareHydroFeature; },
  });
}
