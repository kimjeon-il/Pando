import { overlayVisualOrder } from './layer-presentation.js';
import { geometryRevisionKey } from './geometry-versions.js';
import { createGpuMeshWorkerJobs } from './gpu-mesh-worker-jobs.js';
import { makeSvgSceneProxy } from './render-channel-ownership.js';
/** GpuScene: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGpuScene({getPhysicalLand=()=>null}={}) {
  let dependencies;
  let selectionPass;
  let renderSceneBuilder;
  let gpuSceneDomains;
  let gpuSceneDirtyDomains;
  let gpuSceneBuiltDomainKeys;
  let currentRenderScene;
  let renderSceneRevision;
  let renderSceneGeometryRevision;
  let renderSceneStyleRevision;
  let renderSceneOrderRevision;
  let currentSelectionPacket;
  let gpuSceneResourceObjectKeys;
  let polygonKeysByObject = new Map();
  const sameValue = (left,right) => {
    if(Object.is(left,right))return true;
    if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
    if(Array.isArray(left)!==Array.isArray(right))return false;
    const keys=Object.keys(left);
    return keys.length===Object.keys(right).length
      &&keys.every(key=>Object.hasOwn(right,key)&&sameValue(left[key],right[key]));
  };
  let hoverRequestSequence = 0;
  let pendingPreparation = null;
  let preparationFailure = null;
  let lastOverlayOrderSignature = null, lastQualitySignature = null;
  function connect(ports) {
    if (dependencies) throw new Error('gpu-scene already connected');
    dependencies = ports;
  }

  function featureFromGeometry(geometry, properties = {}) {
    return geometry ? { type: 'Feature', properties, geometry } : null;
  }

  function mapFeatureForObjectRef(value) {
    const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
    if (!ref) return null;
    if (ref.domain === 'territorial') return dependencies.objectModelB.territorialScope.displayFeature(ref.id);
    if (ref.domain === 'generic') {
      return dependencies.projectState.state.genericFeatures.find(feature => String(feature.id) === ref.id) || null;
    }
    if (ref.domain === 'hydro') return (0, dependencies.hydroModel.hydroFeatureById)(ref.id);
    if (ref.domain === 'distribution') {
      const features = (0, dependencies.distributionServices.distributionEntriesForLayer)(dependencies.projectState.state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === dependencies.territorialModel.DISTRIBUTION_MODES.TERRITORIAL ? dependencies.objectModelB.territorialScope.displayFeature(entry.territorialUnitId)?.geometry : entry.geometry;
        return geometry ? featureFromGeometry(geometry) : null;
      }).filter(Boolean);
      return features.length ? { type: 'FeatureCollection', features } : null;
    }
    return null;
  }

  function selectionGeometryRevision(key, role = 'outline', feature = null) {
    // Geometry revisions are advanced at the canonical mutation boundary.
    // Avoid serializing multipart geometry in the selection hot path; callers
    // still use the geometry object itself for exact rendering when a revision
    // changes.
    const geometry = feature?.geometry;
    if (geometry) {
      return `${key}:${role}:${geometryRevisionKey(geometry)}`;
    }
    return `${key}:${role}:state-${dependencies.projectState.state.stateRevision}:country-${dependencies.countries.countryLandRevision}`;
  }

  function gpuSceneOrder(group, detail = 'fill', objectKey = '', fragment = 0) {
    return overlayVisualOrder(dependencies.projectState.state.layerPresentation, group, detail, objectKey, fragment);
  }

  function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {
    const independentLod = ['base-graticule', 'generic-features', 'distributions'].includes(String(domain));
    const normalizeItem = item => Object.freeze({
      ...item,
      domain: String(domain),
      chunkKey: String(item?.chunkKey || `${domain}:${item?.key || ''}`),
      lodPolicy: String(item?.lodPolicy || (independentLod ? 'independent' : 'exact')),
      priority: Number(item?.priority ?? (item?.protected ? 100 : 0)),
    });
    const normalizedPolygons = polygons.filter(item => item?.key && item?.geometry).map(normalizeItem);
    const normalizedStrokes = strokes.filter(item => item?.key && (item?.geometry || item?.startsEnds)).map(normalizeItem);
    const geometrySignature = [...normalizedPolygons, ...normalizedStrokes]
      .map(item => [item.key, item.geometryRevision, item.objectKey || '', item.chunkKey,
        item.lodPolicy, item.priority, item.protected === true, item.role, item.ownerId, item.parentId, item.territoryDepth].join(':')).join('|');
    const previous = gpuSceneDomains.get(domain);
    const currentItems=[...normalizedPolygons,...normalizedStrokes];
    const oldItems=previous?[...previous.polygons,...previous.strokes]:[];
    const sameStyle=oldItems.length===currentItems.length
      &&currentItems.every((item,index)=>{
        const prior=oldItems[index];
        return prior.key===item.key&&prior.order===item.order
          &&prior.blendMode===item.blendMode&&sameValue(prior.style,item.style);
      });
    if(previous?.geometrySignature===geometrySignature&&sameStyle)return false;
    if(previous?.geometrySignature!==geometrySignature)renderSceneGeometryRevision++;
    if(!sameStyle)renderSceneStyleRevision++;
    // Remove superseded packet-to-object links. These are presentation
    // indexes and must not retain keys from deleted scenes indefinitely.
    if(previous)for(const item of [...previous.polygons,...previous.strokes])
      if(gpuSceneResourceObjectKeys.get(String(item.key))===String(item.objectKey||''))
        gpuSceneResourceObjectKeys.delete(String(item.key));
    gpuSceneDomains.set(domain, {
      geometrySignature,
      polygons: normalizedPolygons,
      strokes: normalizedStrokes,
    });
    gpuSceneDirtyDomains.add(String(domain));
    for (const item of [...normalizedPolygons, ...normalizedStrokes]) {
      if (item.objectKey) gpuSceneResourceObjectKeys.set(String(item.key), String(item.objectKey));
    }
    return true;
  }

  function syncGpuRenderScene({ selectionPacket = currentSelectionPacket, interactionFillItems = dependencies.interactionPresentation.currentGpuInteractionFillItems } = {}) {
    const land = getPhysicalLand();
    if (land) replaceGpuSceneDomain('physical-land', { polygons: [{ key: 'physical-land', role: 'physical-land', geometryRevision: land.revision,
      geometry: land.geometry, protected: true, order: -20000, style: { color: '#ffffff', fillAlpha: 1 } }] });
    else replaceGpuSceneDomain('physical-land',{});
    replaceGpuSceneDomain('physical-water',{polygons:land?.water?[{key:'physical-water',role:'physical-water',geometryRevision:land.waterRevision,
      geometry:land.water,protected:true,order:-19000,style:{color:'#ffffff',fillAlpha:1}}]:[]});
    const overlayOrderSignature = JSON.stringify(dependencies.projectState.state.layerPresentation?.overlayOrder || dependencies.renderScene.OVERLAY_GROUPS);
    if (lastOverlayOrderSignature !== overlayOrderSignature) {
      lastOverlayOrderSignature = overlayOrderSignature;
      renderSceneOrderRevision += 1;
    }
    currentSelectionPacket = selectionPacket || null;
    dependencies.interactionStateCommands.replaceGpuInteractionFillItems(interactionFillItems || []);
    // Only a different LOD/projection changes mesh packets. Interaction,
    // frame budgets and DPR revisions must not trigger triangulation.
    const qualitySignature = `${dependencies.renderScene.currentRenderQuality.backgroundLod}:${dependencies.projectState.state.projection}`;
    if (lastQualitySignature !== qualitySignature) {
      lastQualitySignature = qualitySignature;
      renderSceneGeometryRevision += 1;
      for (const domainName of ['base-graticule', 'generic-features', 'distributions']) {
        if (gpuSceneDomains.has(domainName)) gpuSceneDirtyDomains.add(domainName);
      }
    }
    renderSceneBuilder.setCacheByteBudget(dependencies.renderScene.currentRenderQuality.renderPacketCacheBudgetBytes);
    const sceneInput = {
      revision: ++renderSceneRevision,
      revisions: {
        geometry: renderSceneGeometryRevision,
        style: renderSceneStyleRevision,
        overlayOrder: renderSceneOrderRevision,
        countryState: `${dependencies.countries.countryLandRevision}:${dependencies.projectState.state.pendingCountryRenderIds?.size || 0}`,
        selection: currentSelectionPacket?.revision || 0,
        view: dependencies.mapLayout.viewRevision,
      },
      country: {
        visible: dependencies.projectState.state.layerVisibility.objects !== false,
        meshRevision: dependencies.countries.countryLandRevision,
        overrideRevision: [...(dependencies.projectState.state.pendingCountryRenderIds || [])].sort().join(','),
      },
      physical: {
        terrainVisible: !!dependencies.projectState.state.physicalSettings.terrainVisible,
        terrainStyle: dependencies.projectState.state.physicalSettings.terrainStyle,
        hydroVisibilityRevision: dependencies.projectState.state.physicalSettings.hiddenHydroIds ? Object.keys(dependencies.projectState.state.physicalSettings.hiddenHydroIds).length : 0,
        hydroStyleRevision: `${dependencies.projectState.state.layerVisibility.rivers}:${dependencies.projectState.state.layerVisibility.lakes}:${dependencies.projectState.state.stateRevision}`,
      },
      renderQuality: dependencies.renderScene.currentRenderQuality,
      projection: dependencies.projectState.state.projection,
      interaction: {
        selectionPacket: currentSelectionPacket,
        genericFillItems: dependencies.interactionPresentation.currentGpuInteractionFillItems,
      },
    };
    const requiredPolygons = [...gpuSceneDomains].flatMap(([name, domain]) =>
      !currentRenderScene || gpuSceneDirtyDomains.has(name)
        ? [...domain.polygons, ...domain.strokes.filter(item =>
          item.geometry?.type === 'Polygon' || item.geometry?.type === 'MultiPolygon')]
        : []);
    const missing = renderSceneBuilder.missingPolygons(requiredPolygons, sceneInput);
    if (missing.length) {
      const signature = missing.map(item => item.cacheKey).join('|');
      if (preparationFailure?.signature !== signature) preparationFailure = null;
      // Exhausted retry budgets are terminal for this input. A new scene
      // signature or builder resets the budget, not an unrelated redraw.
      if (preparationFailure?.attempts >= 3) return currentRenderScene;
      if (pendingPreparation?.signature !== signature) {
        const builder = renderSceneBuilder;
        const pending = { signature };
        pendingPreparation = pending;
        builder.preparePolygons(requiredPolygons, sceneInput).then(() => {
          if (pendingPreparation !== pending || builder !== renderSceneBuilder) return;
          pendingPreparation = null;
          preparationFailure = null;
          syncGpuRenderScene();
          // An interaction-only invalidation does not request the Canvas Worker
          // base bitmap. Physical substrate packets remain absent from the
          // accepted bitmap, so initial countries can never leave 'pending'.
          const mode = dependencies.rendering.gpuMapRenderer.getRuntimeState?.()?.renderer;
          if (mode === 'canvas-worker') {
            // A prepared physical scene needs a real current Worker bitmap,
            // not only a pending coordinator invalidation. The renderer checks
            // the project, frame and physical scene before submitting.
            dependencies.rendering.gpuMapRenderer.requestPreparedCanvasFrame?.();
            dependencies.domains.renderingDomain.invalidateBaseScene('canvas-scene-ready');
          } else
            dependencies.domains.renderingDomain.invalidateGpuInteraction('overlay-mesh-ready');
        }).catch(error => {
          if (pendingPreparation !== pending || builder !== renderSceneBuilder) return;
          pendingPreparation = null;
          if (error?.cancelled || error?.name === 'AbortError') return;
          const attempts = (preparationFailure?.signature === signature ? preparationFailure.attempts : 0) + 1;
          preparationFailure = { signature, attempts };
          if (attempts < 3 && dependencies.projectState.mapWorkScheduler?.scheduleIdle) {
            // One bounded retry family per unchanged input. A new scene/builder
            // cancels the old candidate instead of posting a stale bitmap.
            dependencies.projectState.mapWorkScheduler.scheduleIdle('gpu-scene-mesh-retry', () => {
              if (renderSceneBuilder === builder && !pendingPreparation
                && preparationFailure?.signature === signature)
                dependencies.domains.renderingDomain.invalidateBaseScene('overlay-mesh-retry');
            }, 120 * attempts);
          } else dependencies.feedback.reportOperationError(error,
            '지도 면을 준비하지 못했습니다.', 'PL-MESH-PREPARE', 4200);
        });
      }
      return currentRenderScene;
    }
    if (pendingPreparation) { pendingPreparation = null; renderSceneBuilder.cancelPreparation(); }
    if (currentRenderScene && gpuSceneDirtyDomains.size) {
      const polygons = [];
      const strokes = [];
      const removePolygonKeys = new Set();
      const removeStrokeKeys = new Set();
      for (const domainName of gpuSceneDirtyDomains) {
        const previousKeys = gpuSceneBuiltDomainKeys.get(domainName);
        for (const key of previousKeys?.polygons || []) removePolygonKeys.add(key);
        for (const key of previousKeys?.strokes || []) removeStrokeKeys.add(key);
        const domain = gpuSceneDomains.get(domainName);
        if (!domain) {
          gpuSceneBuiltDomainKeys.delete(domainName);
          continue;
        }
        polygons.push(...domain.polygons);
        strokes.push(...domain.strokes);
        gpuSceneBuiltDomainKeys.set(domainName, {
          polygons: new Set(domain.polygons.map(item => String(item.key))),
          strokes: new Set(domain.strokes.map(item => String(item.key))),
        });
      }
      currentRenderScene = renderSceneBuilder.patch(currentRenderScene, {
        ...sceneInput,
        polygons,
        strokes,
        removePolygonKeys,
        removeStrokeKeys,
      });
    } else if (!currentRenderScene) {
      const polygons = [];
      const strokes = [];
      for (const [domainName, domain] of gpuSceneDomains) {
        polygons.push(...domain.polygons);
        strokes.push(...domain.strokes);
        gpuSceneBuiltDomainKeys.set(domainName, {
          polygons: new Set(domain.polygons.map(item => String(item.key))),
          strokes: new Set(domain.strokes.map(item => String(item.key))),
        });
      }
      currentRenderScene = renderSceneBuilder.build({ ...sceneInput, polygons, strokes });
    } else {
      currentRenderScene = renderSceneBuilder.patch(currentRenderScene, sceneInput);
    }
    gpuSceneDirtyDomains.clear();
    // Invert the accepted scene once, not once for each selected object.
    const objectIndex=new Map();
    for(const packet of currentRenderScene.polygons){
      const owner=gpuSceneResourceObjectKeys.get(String(packet.key));
      if(!owner)continue;
      if(!objectIndex.has(owner))objectIndex.set(owner,[]);
      objectIndex.get(owner).push(String(packet.key));
    }
    polygonKeysByObject=new Map([...objectIndex].map(([owner,keys])=>[owner,Object.freeze(keys)]));
    renderSceneBuilder.releasePrepared();
    dependencies.rendering.gpuMapRenderer.setRenderScene?.(currentRenderScene);
    return currentRenderScene;
  }

  function syncGpuInteractionState({ selectionPacket = currentSelectionPacket, interactionFillItems = dependencies.interactionPresentation.currentGpuInteractionFillItems } = {}) {
    currentSelectionPacket = selectionPacket || null;
    dependencies.interactionStateCommands.replaceGpuInteractionFillItems(interactionFillItems || []);
    dependencies.rendering.gpuMapRenderer.setInteractionState?.({
      selectionPacket: currentSelectionPacket,
      genericFillItems: dependencies.interactionPresentation.currentGpuInteractionFillItems,
    });
  }

  function gpuPolygonResourceKeysForObject(objectKey) {
    const normalizedKey = String(objectKey || '');
    if (!normalizedKey) return [];
    return polygonKeysByObject.get(normalizedKey) || [];
  }

  function buildGpuInteractionFillItems(requests = []) {
    const items = [];
    const resourcesByObject = new Map();
    for (const request of requests) {
      const objectKey = String(request?.objectKey || '');
      if (!objectKey) continue;
      const resourceKeys = gpuPolygonResourceKeysForObject(objectKey);
      if (!resourceKeys.length || (request.singleResourceOnly && resourceKeys.length !== 1)) continue;
      resourcesByObject.set(objectKey, resourceKeys);
      for (const key of resourceKeys) {
        items.push({ key, priority: request.priority || 2, depth: request.depth || 0, objectKey, style: request.style, blendMode: 'normal' });
      }
    }
    return { items, resourcesByObject };
  }

  function applyGpuSceneCoverage(frameResult) {
    const webGlReady = ['webgl2', 'webgl1'].includes(dependencies.rendering.gpuMapRenderer.getRuntimeState?.()?.renderer);
    const ownedSceneKeys = new Set([
      ...(currentRenderScene?.polygons || []).map(packet => packet.key),
      ...(currentRenderScene?.strokes || []).map(packet => packet.key),
    ]);
    const rendered = new Set(frameResult?.baseResult?.overlayRenderedKeys || []);
    const missing = new Set(frameResult?.baseResult?.overlayMissingKeys || []);
    dependencies.mapLayers.svg?.selectAll?.('[data-gpu-scene-key]')?.each(function() {
      const key = this.getAttribute('data-gpu-scene-key') || '';
      // Scene geometry has one visual owner. SVG remains only as a pointer
      // target, including while a WebGL upload is late or Canvas owns the frame.
      if (ownedSceneKeys.has(key) || (webGlReady && rendered.has(key) && !missing.has(key))) makeSvgSceneProxy(this);
    });
  }

  async function setMapHover(feature, ref = null) {
    const sequence = ++hoverRequestSequence;
    try {
      if ((0, dependencies.surfaces.isMobile)() || dependencies.projectState.state.mapMoving) return false;
      const generation = dependencies.domains.projectDomain.getGeneration(), viewRevision = dependencies.mapLayout.viewRevision;
      const nextRef = feature?.geometry ? (0, dependencies.selectionServices.normalizeObjectRef)(ref) : null;
      const accepted = await dependencies.domains.selectionDomain.setHover(nextRef, { source: 'map',
        expectedKey: !feature && ref ? (0, dependencies.selectionServices.normalizeObjectRef)(ref)?.key : '' });
      if (!accepted || !Object.hasOwn(accepted,'hover')) throw new TypeError('An accepted Core hover snapshot is required.');
      if (sequence !== hoverRequestSequence || generation !== dependencies.domains.projectDomain.getGeneration()
        || viewRevision !== dependencies.mapLayout.viewRevision || dependencies.surfaces.isMobile()
        || dependencies.projectState.state.mapMoving) return false;
      const key = nextRef?.key || null;
      if ((accepted.hover?.key || null) !== key || (dependencies.domains.selectionDomain.snapshot().hover?.key || null) !== key) return false;
      dependencies.interactionStateCommands.setHoverHit(nextRef ? { ref: nextRef, feature } : null);
      return true;
    } catch (error) {
      if (!error.cancelled && error.name !== 'AbortError'
        && !['STALE_REVISION','PL-CORE-STALE','PL-CORE-CANCELLED','PL-WORKER-RPC-STALE'].includes(error.code))
        dependencies.feedback.reportOperationError(error,'지도 hover를 갱신하지 못했습니다.','PL-MAP-HOVER-001',4200);
      return false;
    }
  }

  function initializeSelectionPass() {
    (selectionPass = null);
  }

  function initializeRenderSceneBuilder() {
    dependencies?.projectState?.mapWorkScheduler?.cancel?.('gpu-scene-mesh-retry');
    renderSceneBuilder?.clear();
    pendingPreparation = null;
    preparationFailure = null;
    (renderSceneBuilder = (0, dependencies.renderScene.createRenderSceneBuilder)({
      meshJobs: createGpuMeshWorkerJobs({
        createWorker: () => new Worker(dependencies.platform.runtimeAssetUrl('workers/gpu-mesh-worker.js'), { name: 'pandolab-overlay-mesh' }),
        isCurrent: () => true,
      }),
      cacheByteBudget: dependencies.renderScene.currentRenderQuality.renderPacketCacheBudgetBytes,
    }));
  }

  function initializeGpuSceneDomains() {
    (gpuSceneDomains = new Map());

    (gpuSceneDirtyDomains = new Set());

    (gpuSceneBuiltDomainKeys = new Map());

    (currentRenderScene = null);

    (renderSceneRevision = 0);

    (renderSceneGeometryRevision = 0);

    (renderSceneStyleRevision = 0);

    (renderSceneOrderRevision = 0);

    (currentSelectionPacket = null);
    polygonKeysByObject.clear();
    preparationFailure = null;
    lastOverlayOrderSignature = null;
    lastQualitySignature = null;
  }

  function initializeGpuSceneResourceObjectKeys() {
    (gpuSceneResourceObjectKeys = new Map());
    polygonKeysByObject = new Map();
  }

  return Object.freeze({
    connect,
    initializeSelectionPass,
    initializeRenderSceneBuilder,
    initializeGpuSceneDomains,
    initializeGpuSceneResourceObjectKeys,
    get applyGpuSceneCoverage() { return applyGpuSceneCoverage; },
    get buildGpuInteractionFillItems() { return buildGpuInteractionFillItems; },
    get currentSelectionPacket() { return currentSelectionPacket; },
    set currentSelectionPacket(value) { currentSelectionPacket = value; },
    get featureFromGeometry() { return featureFromGeometry; },
    get gpuSceneOrder() { return gpuSceneOrder; },
    get mapFeatureForObjectRef() { return mapFeatureForObjectRef; },
    get renderSceneBuilder() { return renderSceneBuilder; },
    get replaceGpuSceneDomain() { return replaceGpuSceneDomain; },
    get selectionGeometryRevision() { return selectionGeometryRevision; },
    get selectionPass() { return selectionPass; },
    set selectionPass(value) { selectionPass = value; },
    get setMapHover() { return setMapHover; },
    get syncGpuInteractionState() { return syncGpuInteractionState; },
    get syncGpuRenderScene() { return syncGpuRenderScene; },
  });
}
