import { geometryRevision as readGeometryRevision } from './geometry-versions.js';
import { makeSvgSceneProxy } from './render-channel-ownership.js';
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
    const ref = (0, dependencies.selectionServices.normalizeObjectRef)(value);
    if (!ref) return null;
    if (ref.domain === 'territorial') {
      const state = dependencies.projectState.state;
      if (ref.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY) {
        const current = (0, dependencies.countries.countryFeatureById)(ref.id);
        if (state.countryVisualPhase !== 'preview') return current;
        return state.auditPreviewCountries?.features?.find(feature => String(feature.id) === String(ref.id)) || current;
      }
      const current = (0, dependencies.objectPresentation.territorialUnitById)(ref.id);
      if (state.countryVisualPhase !== 'preview') return current;
      return state.auditPreviewTerritorialUnits?.find(unit => String(unit.id) === String(ref.id)) || current;
    }
    if (ref.domain === 'generic') {
      const genericFeature = dependencies.projectState.state.genericFeatures.find(feature => String(feature.id) === ref.id) || null;
      return genericFeature ? (0, dependencies.presentation.genericFeatureDisplayFeature)(genericFeature) : null;
    }
    if (ref.domain === 'hydro') return (0, dependencies.hydroModel.hydroFeatureById)(ref.id);
    if (ref.domain === 'distribution') {
      const features = (0, dependencies.distributionServices.distributionEntriesForLayer)(dependencies.projectState.state.distributionEntries, ref.id).map(entry => {
        const geometry = entry.mode === dependencies.territorialModel.DISTRIBUTION_MODES.TERRITORIAL ? dependencies.presentation.territorialRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
        return geometry ? featureFromGeometry(geometry) : null;
      }).filter(Boolean);
      return features.length ? { type: 'FeatureCollection', features } : null;
    }
    return null;
  }

  const geometryTokens = new WeakMap();
  let geometryToken = 0;
  function selectionGeometryRevision(key, role = 'outline', feature = null) {
    // Geometry revisions are advanced at the canonical mutation boundary.
    // Avoid serializing multipart geometry in the selection hot path; callers
    // still use the geometry object itself for exact rendering when a revision
    // changes.
    const geometry = feature?.geometry;
    if (geometry) {
      if (!geometryTokens.has(geometry)) geometryTokens.set(geometry, ++geometryToken);
      return `${key}:${role}:${geometryTokens.get(geometry)}:${readGeometryRevision(geometry)}`;
    }
    return `${key}:${role}:state-${dependencies.projectState.state.stateRevision}:country-${dependencies.countries.countryLandRevision}`;
  }

  function gpuSceneOrder(group, offset = 0, objectKey = '') {
    const order = dependencies.projectState.state.layerPresentation?.overlayOrder || dependencies.renderScene.OVERLAY_GROUPS;
    const index = order.indexOf(group);
    return (index < 0 ? order.length : index) * 1000 + Number(offset || 0)
      + (0, dependencies.applicationServicesB.layerObjectRank)(dependencies.projectState.state.layerPresentation, objectKey);
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
        item.lodPolicy, item.priority, item.protected === true, item.role, item.ownerId, item.parentId, item.territoryDepth].join(':')).join('|');
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

  function syncGpuRenderScene({ selectionPacket = currentSelectionPacket, interactionFillItems = dependencies.interactionPresentation.currentGpuInteractionFillItems } = {}) {
    const overlayOrderSignature = JSON.stringify(dependencies.projectState.state.layerPresentation?.overlayOrder || dependencies.renderScene.OVERLAY_GROUPS);
    if (syncGpuRenderScene.overlayOrderSignature !== overlayOrderSignature) {
      syncGpuRenderScene.overlayOrderSignature = overlayOrderSignature;
      renderSceneOrderRevision += 1;
    }
    currentSelectionPacket = selectionPacket || null;
    dependencies.interactionStateCommands.replaceGpuInteractionFillItems(interactionFillItems || []);
    const qualitySignature = `${dependencies.renderScene.currentRenderQuality.revision}:${dependencies.renderScene.currentRenderQuality.backgroundLod}:${dependencies.projectState.state.projection}`;
    if (syncGpuRenderScene.qualitySignature !== qualitySignature) {
      syncGpuRenderScene.qualitySignature = qualitySignature;
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
        editPreview: dependencies.projectState.state.geometryPreview?.revision || 0,
        view: dependencies.mapLayout.viewRevision,
      },
      country: {
        visible: dependencies.projectState.state.layerVisibility.countries !== false,
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
        previewPackets: [...dependencies.interactionPresentation.currentGpuPreviewPackets, ...dependencies.interactionPresentation.currentGpuEditPreviewPackets],
        draftPackets: dependencies.interactionPresentation.currentGpuDraftPackets,
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
    dependencies.rendering.gpuMapRenderer.setRenderScene?.(currentRenderScene);
    return currentRenderScene;
  }

  function syncGpuInteractionState({ selectionPacket = currentSelectionPacket, interactionFillItems = dependencies.interactionPresentation.currentGpuInteractionFillItems } = {}) {
    currentSelectionPacket = selectionPacket || null;
    dependencies.interactionStateCommands.replaceGpuInteractionFillItems(interactionFillItems || []);
    const activePreview = dependencies.geometryOperations.editPreviewController.packet();
    dependencies.interactionStateCommands.replaceGpuEditPreviewPackets(activePreview ? [activePreview] : []);
    dependencies.rendering.gpuMapRenderer.setInteractionState?.({
      selectionPacket: currentSelectionPacket,
      genericFillItems: dependencies.interactionPresentation.currentGpuInteractionFillItems,
      previewPackets: [...dependencies.interactionPresentation.currentGpuPreviewPackets, ...dependencies.interactionPresentation.currentGpuEditPreviewPackets],
      draftPackets: dependencies.interactionPresentation.currentGpuDraftPackets,
    });
  }

  function syncActiveEditPreview(reason = 'edit-preview') {
    const packet = dependencies.geometryOperations.editPreviewController.packet();
    dependencies.interactionStateCommands.replaceGpuEditPreviewPackets(packet ? [packet] : []);
    syncGpuInteractionState();
    dependencies.domains.renderingDomain?.invalidateGpuInteraction?.(reason);
  }

  function beginActiveEditPreview({ key, segments }) {
    dependencies.geometryOperations.editPreviewController.begin({ key, segments, order: 25_000 });
    syncActiveEditPreview('edit-preview-start');
  }

  function updateActiveEditPreview(segments) {
    if (!dependencies.geometryOperations.editPreviewController.update(segments)) return false;
    syncActiveEditPreview('edit-preview-move');
    return true;
  }

  function clearActiveEditPreview(reason = 'edit-preview-clear') {
    if (!dependencies.geometryOperations.editPreviewController.clear() && !dependencies.interactionPresentation.currentGpuEditPreviewPackets.length) return false;
    dependencies.interactionStateCommands.replaceGpuEditPreviewPackets([]);
    syncGpuInteractionState();
    dependencies.domains.renderingDomain?.invalidateGpuInteraction?.(reason);
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

  function applyGpuInteractionCoverage(frameResult) {
    const canvasFills = ['canvas-worker', 'canvas2d'].includes(dependencies.rendering.gpuMapRenderer.getRuntimeState?.()?.renderer);
    dependencies.mapHostViewB.interactionSvg?.selectAll?.('[data-gpu-interaction-fill-keys]')?.classed('canvas-interaction-fill-proxy', canvasFills);
    const webGlReady = ['webgl2', 'webgl1'].includes(dependencies.rendering.gpuMapRenderer.getRuntimeState?.()?.renderer);
    const results = [
      ...(frameResult?.interactionResult?.previewResults || []),
      ...(frameResult?.interactionResult?.draftResults || []),
    ];
    const rendered = new Set(results.flatMap(result => result?.renderedKeys || []));
    const missing = new Set(results.flatMap(result => result?.missingKeys || []));
    const covered = (node, channel) => {
      const keys = String(node.getAttribute(`data-gpu-interaction-${channel}-keys`) || '').split(/\s+/).filter(Boolean);
      return webGlReady && keys.length > 0 && keys.every(key => rendered.has(key) && !missing.has(key));
    };
    dependencies.mapHostViewB.interactionSvg?.selectAll?.('[data-gpu-interaction-keys]')
      ?.classed('gpu-interaction-hit-proxy', false)
      .classed('gpu-interaction-fill-proxy', function() { return covered(this, 'fill'); })
      .classed('gpu-interaction-stroke-proxy', function() { return covered(this, 'stroke'); });
  }

  function setMapHover(type, id, feature, ref = null) {
    if ((0, dependencies.surfaces.isMobile)() || dependencies.projectState.state.tool !== 'select' || dependencies.projectState.state.mapMoving) return;
    void type;
    void id;
    const nextRef = feature?.geometry ? (0, dependencies.selectionServices.normalizeObjectRef)(ref) : null;

    dependencies.interactionStateCommands.setHoverHit(nextRef ? { ref: nextRef, feature } : null);
    dependencies.domains.selectionDomain.setHover(nextRef, { source: 'map', expectedKey: !feature && ref ? (0, dependencies.selectionServices.normalizeObjectRef)(ref)?.key : '' });
  }

  function initializeSelectionPass() {
    (selectionPass = null);
  }

  function initializeRenderSceneBuilder() {
    (renderSceneBuilder = (0, dependencies.renderScene.createRenderSceneBuilder)({
      triangulate: (...args) => window.earcut(...args),
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
