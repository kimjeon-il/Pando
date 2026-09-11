/** GpuScene: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGpuScene() {
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
  function connect(ports) {
    if (dependencies) throw new Error('gpu-scene already connected');
    dependencies = ports;
  }

  function featureFromGeometry(geometry, properties = {}) {
    return geometry ? { type: 'Feature', properties, geometry } : null;
  }

  function mapFeatureForObjectRef(value) {
    const ref = (0, dependencies.normalizeObjectRef)(value);
    if (!ref) return null;
    if (ref.domain === 'territorial') return ref.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY ? (0, dependencies.countryFeatureById)(ref.id) : (0, dependencies.territorialUnitById)(ref.id);
    if (ref.domain === 'generic') {
      const genericFeature = dependencies.state.genericFeatures.find(feature => String(feature.id) === ref.id) || null;
      return genericFeature ? (0, dependencies.genericFeatureDisplayFeature)(genericFeature) : null;
    }
    if (ref.domain === 'hydro') return (0, dependencies.hydroFeatureById)(ref.id);
    if (ref.domain === 'distribution') {
      const features = (0, dependencies.distributionEntriesForLayer)(dependencies.state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === dependencies.DISTRIBUTION_MODES.TERRITORIAL ? dependencies.territorialRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
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
    void feature;
    return `${key}:${role}:state-${dependencies.state.stateRevision}:country-${dependencies.countryLandRevision}`;
  }

  function gpuSceneOrder(group, offset = 0, objectKey = '') {
    const order = dependencies.state.layerPresentation?.overlayOrder || dependencies.OVERLAY_GROUPS;
    const index = order.indexOf(group);
    return (index < 0 ? order.length : index) * 1000 + Number(offset || 0)
      + (0, dependencies.layerObjectRank)(dependencies.state.layerPresentation, objectKey);
  }

  function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {
    const independentLod = ['base-graticule', 'generic-features', 'distributions'].includes(String(domain));
    const normalizeItem = item => Object.freeze({
      ...item,
      chunkKey: String(item?.chunkKey || `${domain}:${item?.key || ''}`),
      lodPolicy: String(item?.lodPolicy || (independentLod ? 'independent' : 'exact')),
      priority: Number(item?.priority ?? (item?.protected ? 100 : 0)),
    });
    const normalizedPolygons = polygons.filter(item => item?.key && item?.geometry).map(normalizeItem);
    const normalizedStrokes = strokes.filter(item => item?.key && (item?.geometry || item?.startsEnds)).map(normalizeItem);
    const geometrySignature = [...normalizedPolygons, ...normalizedStrokes]
      .map(item => [item.key, item.geometryRevision, item.objectKey || '', item.chunkKey,
        item.lodPolicy, item.priority, item.protected === true].join(':')).join('|');
    const styleSignature = [...normalizedPolygons, ...normalizedStrokes]
      .map(item => `${item.key}:${JSON.stringify(item.style || {})}:${item.order}:${item.blendMode || ''}`).join('|');
    const previous = gpuSceneDomains.get(domain);
    if (previous?.geometrySignature === geometrySignature && previous?.styleSignature === styleSignature) return false;
    if (previous?.geometrySignature !== geometrySignature) renderSceneGeometryRevision += 1;
    if (previous?.styleSignature !== styleSignature) renderSceneStyleRevision += 1;
    gpuSceneDomains.set(domain, {
      geometrySignature,
      styleSignature,
      polygons: normalizedPolygons,
      strokes: normalizedStrokes,
    });
    gpuSceneDirtyDomains.add(String(domain));
    for (const item of [...normalizedPolygons, ...normalizedStrokes]) {
      if (item.objectKey) gpuSceneResourceObjectKeys.set(String(item.key), String(item.objectKey));
    }
    return true;
  }

  function syncGpuRenderScene({ selectionPacket = currentSelectionPacket, interactionFillItems = dependencies.currentGpuInteractionFillItems } = {}) {
    const overlayOrderSignature = JSON.stringify(dependencies.state.layerPresentation?.overlayOrder || dependencies.OVERLAY_GROUPS);
    if (syncGpuRenderScene.overlayOrderSignature !== overlayOrderSignature) {
      syncGpuRenderScene.overlayOrderSignature = overlayOrderSignature;
      renderSceneOrderRevision += 1;
    }
    currentSelectionPacket = selectionPacket || null;
    dependencies.currentGpuInteractionFillItems = interactionFillItems || [];
    const qualitySignature = `${dependencies.currentRenderQuality.revision}:${dependencies.currentRenderQuality.backgroundLod}:${dependencies.state.projection}`;
    if (syncGpuRenderScene.qualitySignature !== qualitySignature) {
      syncGpuRenderScene.qualitySignature = qualitySignature;
      renderSceneGeometryRevision += 1;
      for (const domainName of ['base-graticule', 'generic-features', 'distributions']) {
        if (gpuSceneDomains.has(domainName)) gpuSceneDirtyDomains.add(domainName);
      }
    }
    renderSceneBuilder.setCacheByteBudget(dependencies.currentRenderQuality.renderPacketCacheBudgetBytes);
    const sceneInput = {
      revision: ++renderSceneRevision,
      revisions: {
        geometry: renderSceneGeometryRevision,
        style: renderSceneStyleRevision,
        overlayOrder: renderSceneOrderRevision,
        countryState: `${dependencies.countryLandRevision}:${dependencies.state.pendingCountryRenderIds?.size || 0}`,
        selection: currentSelectionPacket?.revision || 0,
        editPreview: dependencies.state.geometryPreview?.revision || 0,
        view: dependencies.viewRevision,
      },
      country: {
        visible: dependencies.state.layerVisibility.countries !== false,
        meshRevision: dependencies.countryLandRevision,
        overrideRevision: [...(dependencies.state.pendingCountryRenderIds || [])].sort().join(','),
      },
      physical: {
        terrainVisible: !!dependencies.state.physicalSettings.terrainVisible,
        terrainStyle: dependencies.state.physicalSettings.terrainStyle,
        hydroVisibilityRevision: dependencies.state.physicalSettings.hiddenHydroIds ? Object.keys(dependencies.state.physicalSettings.hiddenHydroIds).length : 0,
        hydroStyleRevision: `${dependencies.state.layerVisibility.rivers}:${dependencies.state.layerVisibility.lakes}:${dependencies.state.stateRevision}`,
      },
      renderQuality: dependencies.currentRenderQuality,
      projection: dependencies.state.projection,
      interaction: {
        selectionPacket: currentSelectionPacket,
        genericFillItems: dependencies.currentGpuInteractionFillItems,
        previewPackets: [...dependencies.currentGpuPreviewPackets, ...dependencies.currentGpuEditPreviewPackets],
        draftPackets: dependencies.currentGpuDraftPackets,
      },
    };
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
    dependencies.gpuMapRenderer.setRenderScene?.(currentRenderScene);
    return currentRenderScene;
  }

  function syncGpuInteractionState({ selectionPacket = currentSelectionPacket, interactionFillItems = dependencies.currentGpuInteractionFillItems } = {}) {
    currentSelectionPacket = selectionPacket || null;
    dependencies.currentGpuInteractionFillItems = interactionFillItems || [];
    dependencies.gpuMapRenderer.setInteractionState?.({
      selectionPacket: currentSelectionPacket,
      genericFillItems: dependencies.currentGpuInteractionFillItems,
      previewPackets: [...dependencies.currentGpuPreviewPackets, ...dependencies.currentGpuEditPreviewPackets],
      draftPackets: dependencies.currentGpuDraftPackets,
    });
  }

  function syncActiveEditPreview(reason = 'edit-preview') {
    const packet = dependencies.editPreviewController.packet();
    dependencies.currentGpuEditPreviewPackets = packet ? [packet] : [];
    syncGpuInteractionState();
    dependencies.renderingDomain?.invalidateGpuInteraction?.(reason);
  }

  function beginActiveEditPreview({ key, segments, style }) {
    dependencies.editPreviewController.begin({ key, segments, style, order: 25_000 });
    syncActiveEditPreview('edit-preview-start');
  }

  function updateActiveEditPreview(segments) {
    if (!dependencies.editPreviewController.update(segments)) return false;
    syncActiveEditPreview('edit-preview-move');
    return true;
  }

  function clearActiveEditPreview(reason = 'edit-preview-clear') {
    if (!dependencies.editPreviewController.clear() && !dependencies.currentGpuEditPreviewPackets.length) return false;
    dependencies.currentGpuEditPreviewPackets = [];
    syncGpuInteractionState();
    dependencies.renderingDomain?.invalidateGpuInteraction?.(reason);
    return true;
  }

  function gpuPolygonResourceKeysForObject(objectKey) {
    const normalizedKey = String(objectKey || '');
    if (!normalizedKey) return [];
    return (currentRenderScene?.polygons || [])
      .map(packet => String(packet.key || ''))
      .filter(key => gpuSceneResourceObjectKeys.get(key) === normalizedKey);
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
        items.push({ key, style: request.style, blendMode: 'normal' });
      }
    }
    return { items, resourcesByObject };
  }

  function applyGpuSceneCoverage(frameResult) {
    const webGlReady = ['webgl2', 'webgl1'].includes(dependencies.gpuMapRenderer.getRuntimeState?.()?.renderer);
    if (!webGlReady) {
      dependencies.svg?.selectAll?.('[data-gpu-scene-key]')?.classed('gpu-scene-hit-proxy', false);
      return;
    }
    const rendered = new Set(frameResult?.baseResult?.overlayRenderedKeys || []);
    const missing = new Set(frameResult?.baseResult?.overlayMissingKeys || []);
    if (!rendered.size && !missing.size) return;
    dependencies.svg?.selectAll?.('[data-gpu-scene-key]')?.classed('gpu-scene-hit-proxy', function() {
      const key = this.getAttribute('data-gpu-scene-key') || '';
      return webGlReady && rendered.has(key) && !missing.has(key);
    });
  }

  function applyGpuInteractionCoverage(frameResult) {
    const webGlReady = ['webgl2', 'webgl1'].includes(dependencies.gpuMapRenderer.getRuntimeState?.()?.renderer);
    const results = [
      ...(frameResult?.interactionResult?.previewResults || []),
      ...(frameResult?.interactionResult?.draftResults || []),
    ];
    const rendered = new Set(results.flatMap(result => result?.renderedKeys || []));
    const missing = new Set(results.flatMap(result => result?.missingKeys || []));
    dependencies.interactionSvg?.selectAll?.('[data-gpu-interaction-keys]')?.classed('gpu-interaction-hit-proxy', function() {
      const keys = String(this.getAttribute('data-gpu-interaction-keys') || '').split(/\s+/).filter(Boolean);
      return webGlReady && keys.length > 0 && keys.every(key => rendered.has(key) && !missing.has(key));
    });
  }

  function setMapHover(type, id, feature, ref = null) {
    if ((0, dependencies.isMobile)() || dependencies.state.tool !== 'select' || dependencies.state.mapMoving) return;
    void type;
    void id;
    const nextRef = feature?.geometry ? (0, dependencies.normalizeObjectRef)(ref) : null;
    if ((dependencies.selectionDomain.snapshot().hover?.key || '') === (nextRef?.key || '')) return;
    dependencies.lastHoverHit = nextRef ? { ref: nextRef, feature } : null;
    dependencies.selectionDomain.setHover(nextRef);
  }

  function initializeSelectionPass() {
    (selectionPass = null);
  }

  function initializeRenderSceneBuilder() {
    (renderSceneBuilder = (0, dependencies.createRenderSceneBuilder)({
      triangulate: (...args) => window.earcut(...args),
      cacheByteBudget: dependencies.currentRenderQuality.renderPacketCacheBudgetBytes,
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
  }

  function initializeGpuSceneResourceObjectKeys() {
    (gpuSceneResourceObjectKeys = new Map());
  }

  return Object.freeze({
    connect,
    initializeSelectionPass,
    initializeRenderSceneBuilder,
    initializeGpuSceneDomains,
    initializeGpuSceneResourceObjectKeys,
    get applyGpuInteractionCoverage() { return applyGpuInteractionCoverage; },
    get applyGpuSceneCoverage() { return applyGpuSceneCoverage; },
    get beginActiveEditPreview() { return beginActiveEditPreview; },
    get buildGpuInteractionFillItems() { return buildGpuInteractionFillItems; },
    get clearActiveEditPreview() { return clearActiveEditPreview; },
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
    get updateActiveEditPreview() { return updateActiveEditPreview; },
  });
}
