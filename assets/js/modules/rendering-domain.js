import {createMapContentPresentation} from './map-content-presentation.js';
import { createLabelPresentation } from './label-presentation.js';
import { SELECTION_PAINT_ORDER } from './layer-presentation.js';
import { applySvgInteractionMasks } from './interaction-svg-mask.js';
import { rendererOwnsSceneGeometry } from './render-channel-ownership.js';
import { resolveMapStrokeStyle, interactionNodeRole, scaleInteractionStroke } from './map-interaction-style.js';
import { mapInteractionEntries } from './interaction-roles.js';
import { selectionEntries, selectionDisplayPlan, orderSelectionFillMasks, selectionFrameOwnership, selectionGeometryKinds, planSelectionEntry, planHoverEntry, selectionCoverage, selectionCoverageAvailable } from './selection-overlay-plan.js';
import { geometryRevision as readGeometryRevision } from './geometry-versions.js';
import {
  createMapRenderCoordinator,
  MAP_RENDER_DIRTY,
  MAP_RENDER_MASKS,
} from './map-render-coordinator.js';
import { createGpuUploadScheduler } from './gpu-upload-scheduler.js';
import { commitSelectionFallbackCoverage } from './selection-fallback-coverage.js';
import { isMapVisualFrame } from './map-visual-frame.js';

export function createRenderingDomain({
  context = null,
  prepareMapDisplay = null,
  onMapDisplayReady = () => {},
  gpuMapRenderer = null,
  sceneBuilder = null,
  mapHost = null,
  selectionDomain = null,
  projectDomain = null,
  editPreviewController = null,
  isEditPreviewCurrent = () => true,
  domLayers = null,
  labelResources = null,
  countryResources = null,
  hydroResources = null,
  territorialResources = null,
  genericResources = null,
  distributionResources = null,
  territorialBoundaryResources = null,
  baseResources = null,
  projectedOverlayResources = null,
  editingRenderResources = null,
  interactionResources = null,
  selectionResources = null,
  refreshRenderResources = null,
  getEditingRenderPacket = null,
  emitEditingInteraction = null,
  reportEditingOperationError = null,
  renderers = {},
  requestFrame = callback => globalThis.requestAnimationFrame?.(callback) ?? globalThis.setTimeout(callback, 0),
  prepareView = () => null,
  onFrameComplete = null,
  invalidMaskMode = 'throw',
  createEditingPresentation = null,
  reportDiagnostic = () => {},
  disposeMapDisplay = null,
} = {}) {
  if (typeof emitEditingInteraction==='function' && typeof reportEditingOperationError!=='function')
    throw new TypeError('Editing interaction dispatch requires its operation error reporter.');
  let disposed = false;
  const uploadScheduler = createGpuUploadScheduler({ requestFrame, getByteBudget: () => gpuMapRenderer?.getUploadByteBudget?.() || 2 * 1024 * 1024 });
  gpuMapRenderer?.setUploadScheduler?.(uploadScheduler);
  const uploadPointers = new Set(), uploadListeners = [];
  let uploadMapMoving = false, uploadTouches = 0;
  const pulseUploadInput = () => uploadScheduler.noteInput(uploadMapMoving || uploadPointers.size > 0 || uploadTouches > 0);
  const listenUploadInput = (target, type, listener) => {
    target?.addEventListener(type, listener, { capture: true, passive: true });
    uploadListeners.push(() => target?.removeEventListener(type, listener, true));
  };
  listenUploadInput(globalThis.window, 'pandolab:interaction-state', event => { uploadMapMoving = event.detail?.active === true; pulseUploadInput(); });
  listenUploadInput(globalThis.document, 'pointerdown', event => { uploadPointers.add(event.pointerId); pulseUploadInput(); });
  listenUploadInput(globalThis.document, 'pointermove', () => {
    if (uploadMapMoving || uploadPointers.size > 0 || uploadTouches > 0) pulseUploadInput();
  });
  for (const type of ['pointerup', 'pointercancel']) listenUploadInput(globalThis.document, type, event => { uploadPointers.delete(event.pointerId); pulseUploadInput(); });
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listenUploadInput(globalThis.document, type, event => { uploadTouches = event.touches?.length || 0; pulseUploadInput(); });
  listenUploadInput(globalThis.document, 'wheel', pulseUploadInput);
  listenUploadInput(globalThis.document, 'keydown', event => { if (/^(Arrow|Page|Home|End)|^[+\-=]$/.test(event.key)) pulseUploadInput(); });
  const resetUploadInput = () => { uploadPointers.clear(); uploadTouches = 0; uploadMapMoving = false; pulseUploadInput(); };
  listenUploadInput(globalThis.window, 'blur', resetUploadInput);
  listenUploadInput(globalThis.document, 'visibilitychange', resetUploadInput);
  let coordinator = null;
  let placeInteractionActive = false;
  let editingPacket = null;
  const stats = {
    invalidations: 0,
    lastReason: '',
    renderResourceRefreshCount: 0,
    renderResourceSnapshotFrameId: null,
    renderResourceProxyCount: 0,
    labelPositionRequestCount: 0,
    labelPositionMergedCount: 0,
    labelPositionCommitCount: 0,
    labelPositionProjectionCount: 0,
    labelPositionLastFrameRevision: 0,
    visualFramePreparedCount: 0,
    visualFrameCommittedCount: 0,
    visualFrameRejectedCount: 0,
    visualFramePartialCommitCount: 0,
    lastPreparedVisualFrameId: 0,
    lastCommittedVisualFrameId: 0,
    gpuCommittedFrameId: 0,
    shellCommittedFrameId: 0,
    graticuleCommittedFrameId: 0,
    labelCommittedFrameId: 0,
    overlayCommittedFrameId: 0,
  };
  let resourceFrameToken = null;
  const active = () => { if (disposed) throw new Error('Rendering domain is disposed.'); };
  const labels = labelResources || {};
  const pendingVisualFrames = new Map();
  const countries = countryResources || {};
  const hydro = hydroResources || {};
  const territorial = territorialResources || {};
  const generic = genericResources || {};
  const distribution = distributionResources || {};
  const territorialBoundary = territorialBoundaryResources || {};
  const base = baseResources || {};
  const projected = projectedOverlayResources || {};
  const editing = editingRenderResources || {};
  const interaction = interactionResources || {};
  const selection = selectionResources || {};
  const rootGeneralSelection = ref => {
    if (ref?.domain !== 'territorial') return false;
    const feature = selection.territorialEntityById(ref.id);
    return feature?.properties.entityKind === 'general' && !feature.properties.parentId;
  };
  const requireFrame = frame => {
    if (!isMapVisualFrame(frame)) throw new TypeError('Rendering requires a MapVisualFrame.');
    return frame;
  };
  const frameProjectCoordinate = (coordinate, frameContext) => requireFrame(frameContext).projectVisibleCoordinate(coordinate);
  const framePath = frameContext => {
    const frame = requireFrame(frameContext);
    if (typeof frame.projectPath !== 'function') throw new TypeError('MapVisualFrame requires a path projector for SVG.');
    return frame.projectPath;
  };
  const projectLabelCoordinate = (coordinate, frameContext = null) => {
    const point = frameProjectCoordinate(coordinate, frameContext);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    stats.labelPositionProjectionCount += 1;
    return point;
  };
  const {renderTerritorialLabels,renderUserLabels,renderTerritorialLabelPositions,renderUserLabelPositions}=createLabelPresentation({
    labels,selectionDomain,reportDiagnostic,projectLabelCoordinate,active,stats});
  const editPresentation=createEditingPresentation ? createEditingPresentation({active,editing,interaction,selection,context,
    requireFrame,framePath,frameProjectCoordinate,getPacket:()=>editingPacket,emitEditingInteraction,reportEditingOperationError}) : null;
  const {renderBoundaryEdit,renderVertices,renderDraft,renderSnap,renderValidation,renderGeometryPreview}=editPresentation||{};
  const pendingHighlights = new Map();
  const content=createMapContentPresentation({countries,hydro,territorial,generic,distribution,territorialBoundary,base,projected,
    active,requireFrame,framePath,commitViewAttachedLayers:(...args)=>commitViewAttachedLayers(...args),
    prepareMapDisplay,onMapDisplayReady:handleMapDisplayReady,reportDiagnostic,isDisposed:()=>disposed});
  const {renderCountries,renderHydro,renderHydroEdits,renderTerritorialUnits,renderGenericFeatures,renderDistributions,
    renderBase,syncBaseView,renderProjectedOverlays,buildDistributionRenderRows,getTerritorialBoundaryStats}=content;
  const resetTerritorialBoundaryCache=()=>{pendingHighlights.clear();content.resetTerritorialBoundaryCache();};
  const invalidate = (mask, reason = 'render-invalidation') => {
    active();
    // Select the display source before the same frame builds scene packets,
    // labels and overlays, expanding a view-only frame only on a real switch.
    const qualityHost = typeof mapHost === 'function' ? mapHost() : mapHost;
    const qualityView = qualityHost?.getViewState?.();
    if (gpuMapRenderer?.syncCountryMeshQuality?.(qualityView ? { cssScale: qualityView.scale, projection: qualityView.projection } : undefined)) mask |= MAP_RENDER_DIRTY.PROJECT;
    stats.invalidations += 1;
    stats.lastReason = String(reason);
    if (!placeInteractionActive && mask & (MAP_RENDER_DIRTY.VIEW | MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.RESIZE | MAP_RENDER_DIRTY.PROJECTION | MAP_RENDER_DIRTY.PROJECT)) labels.preparePlaces?.();
    return coordinator?.invalidate?.(mask, reason) ?? false;
  };
  const invalidateView = reason => invalidate(
    MAP_RENDER_MASKS.VIEW,
    reason || 'view-change',
  );
  const invalidateViewSettle = reason => invalidate(
    MAP_RENDER_MASKS.VIEW_SETTLE,
    reason || 'view-settle',
  );
  const invalidateViewport = reason => invalidate(
    MAP_RENDER_MASKS.RESIZE,
    reason || 'viewport-resize',
  );
  const invalidateProjection = reason => invalidate(
    MAP_RENDER_MASKS.PROJECTION,
    reason || 'projection-change',
  );
  const invalidateSelection = reason => invalidate(
    MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_INTERACTION,
    reason || 'selection-change',
  );
  const invalidateSelectionStyle = reason => invalidate(
    MAP_RENDER_DIRTY.SELECTION_STYLE | MAP_RENDER_DIRTY.GPU_INTERACTION | MAP_RENDER_DIRTY.EDITING_OVERLAYS,
    reason || 'selection-style',
  );
  const invalidateOverlayGeometry = (domain = 'overlay', reason = 'overlay-geometry') => {
    const domainBit = {
      country: MAP_RENDER_DIRTY.COUNTRY_PATCH,
      hydro: MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH,
      territorial: MAP_RENDER_DIRTY.TERRITORIAL_PATCH,
      generic: MAP_RENDER_DIRTY.GENERIC_PATCH,
    }[domain] || MAP_RENDER_DIRTY.OVERLAY_GEOMETRY;
    return invalidate(domainBit | MAP_RENDER_DIRTY.LAYER_TREE, reason);
  };
  const invalidateOverlayStyle = reason => invalidate(
    MAP_RENDER_DIRTY.OVERLAY_STYLE | MAP_RENDER_DIRTY.LAYER_TREE,
    reason || 'overlay-style',
  );
  const invalidateProject = reason => invalidate(
    MAP_RENDER_MASKS.PROJECT,
    reason || 'project-render',
  );
  const invalidateGpuFrame = reason => invalidate(
    MAP_RENDER_DIRTY.GPU_FRAME,
    reason || 'gpu-frame',
  );
  const invalidateGpuInteraction = reason => invalidate(
    MAP_RENDER_DIRTY.GPU_INTERACTION,
    reason || 'gpu-interaction',
  );
  const invalidateEditingOverlays = reason => invalidate(
    MAP_RENDER_DIRTY.EDITING_OVERLAYS | MAP_RENDER_DIRTY.GPU_INTERACTION | MAP_RENDER_DIRTY.VIEW_PRESENTATION,
    reason || 'editing-overlays',
  );
  const invalidateGpuContext = (phase, reason = '') => invalidate(
    MAP_RENDER_DIRTY.GPU_FRAME | MAP_RENDER_DIRTY.GPU_INTERACTION | MAP_RENDER_DIRTY.SELECTION_DATA,
    reason || `gpu-context-${phase || 'change'}`,
  );
  const invalidateQuality = reason => invalidate(
    MAP_RENDER_DIRTY.GPU_FRAME | MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.HUD,
    reason || 'render-quality',
  );
  const invalidateBaseScene = reason => invalidate(
    MAP_RENDER_DIRTY.BASE | MAP_RENDER_DIRTY.GPU_FRAME | MAP_RENDER_DIRTY.OVERLAY_STYLE | MAP_RENDER_DIRTY.LAYER_TREE,
    reason || 'base-scene',
  );
  const invalidatePatch = (bit, reason, extra = 0) => invalidate(
    bit | extra | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.LAYER_TREE,
    reason,
  );
  const invalidateCountryPatch = reason => invalidatePatch(
    MAP_RENDER_DIRTY.COUNTRY_PATCH,
    reason || 'country-patch',
    MAP_RENDER_DIRTY.EDITING_OVERLAYS | MAP_RENDER_DIRTY.LABEL_LAYOUT,
  );
  const invalidateHydroPatch = reason => invalidatePatch(
    MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH,
    reason || 'hydro-patch',
    MAP_RENDER_DIRTY.EDITING_OVERLAYS,
  );
  const invalidateTerritorialPatch = reason => invalidatePatch(
    MAP_RENDER_DIRTY.TERRITORIAL_PATCH,
    reason || 'territorial-patch',
    MAP_RENDER_DIRTY.EDITING_OVERLAYS | MAP_RENDER_DIRTY.LABEL_LAYOUT,
  );
  const invalidateGenericPatch = reason => invalidatePatch(
    MAP_RENDER_DIRTY.GENERIC_PATCH,
    reason || 'generic-patch',
    MAP_RENDER_DIRTY.EDITING_OVERLAYS,
  );
  const invalidateEditedGeometryPatch = (domain, reason = 'geometry-edit') => {
    const domainBit = domain === 'country'
      ? MAP_RENDER_DIRTY.COUNTRY_PATCH | MAP_RENDER_DIRTY.TERRITORIAL_PATCH | MAP_RENDER_DIRTY.LABEL_LAYOUT
      : domain === 'hydro'
        ? MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH
        : MAP_RENDER_DIRTY.GENERIC_PATCH;
    interaction.scheduleSpatialIndexRebuild?.();
    return invalidate(
      domainBit | MAP_RENDER_DIRTY.EDITING_OVERLAYS | MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.HUD,
      reason,
    );
  };
  const invalidateLabels = reason => invalidate(
    MAP_RENDER_DIRTY.LABEL_LAYOUT | MAP_RENDER_DIRTY.LABEL_POSITIONS | MAP_RENDER_DIRTY.VIEW_PRESENTATION,
    reason || 'labels',
  );
  function handleMapDisplayReady(result = {}) {
    if (disposed) return;
    if (result.kind === 'highlight') invalidateSelection('highlight-ready');
    else {
      invalidateTerritorialPatch('map-display-ready');
      invalidateGpuInteraction('map-display-ready');
    }
    onMapDisplayReady(result);
  }
  const beginInteraction = reason => {
    active();
    placeInteractionActive = true;
    labels.beginPlaceInteraction?.();
    coordinator?.beginInteraction?.(reason || 'interaction');
  };
  const endInteraction = reason => {
    active();
    placeInteractionActive = false;
    labels.preparePlaces?.();
    const resolvedReason = reason || 'interaction-end';
    stats.invalidations += 1;
    stats.lastReason = String(resolvedReason);
    return coordinator?.endInteraction?.(resolvedReason) ?? false;
  };
  const requestRender = request => {
    const kind = String(request?.kind || '');
    const reason = request?.reason || kind;
    const handlers = {
      view: invalidateView,
      'view-settle': invalidateViewSettle,
      resize: invalidateViewport,
      projection: invalidateProjection,
      project: invalidateProject,
      selection: invalidateSelection,
      'selection-style': invalidateSelectionStyle,
      'gpu-frame': invalidateGpuFrame,
      'gpu-interaction': invalidateGpuInteraction,
      'editing-overlays': invalidateEditingOverlays,
      'country-patch': invalidateCountryPatch,
      'hydro-patch': invalidateHydroPatch,
      'territorial-patch': invalidateTerritorialPatch,
      'generic-patch': invalidateGenericPatch,
      'overlay-geometry': value => invalidateOverlayGeometry(request?.domain, value),
      'overlay-style': invalidateOverlayStyle,
      labels: invalidateLabels,
    };
    const handler = handlers[kind];
    if (!handler) throw new TypeError(`Unknown render invalidation kind: ${kind || '<empty>'}`);
    return handler(reason);
  };
  const setCountryPropertyEditingActive = active => {
    if (gpuMapRenderer?.setCountryPropertyEditingActive?.(active)) invalidate(MAP_RENDER_DIRTY.PROJECT, 'property-editor-quality');
  };
  const beginFrame = (frameContext = null) => {
    active();
    requireFrame(frameContext);
    const frameToken = frameContext?.frameId ?? frameContext?.revision ?? null;
    if (frameToken !== null && frameToken === resourceFrameToken) return resourceFrameToken;
    refreshRenderResources?.(frameToken);
    editingPacket = getEditingRenderPacket?.() || null;
    const preview = editPreviewController?.snapshot();
    if (preview?.id && (!isEditPreviewCurrent(preview)
      || Number(frameContext?.projectGeneration ?? preview.projectGeneration) !== preview.projectGeneration)) {
      editPreviewController.clear(preview.id);
      selection.syncGpuInteractionState();
    }
    resourceFrameToken = frameToken;
    stats.renderResourceRefreshCount += 1;
    stats.renderResourceSnapshotFrameId = frameToken;
    if (frameContext?.__mapVisualFrame) {
      stats.visualFramePreparedCount += 1;
      stats.lastPreparedVisualFrameId = Number(frameContext.frameId || 0);
    }
    return frameToken;
  };
  const renderPass = (name, ...args) => {
    active();
    const renderer = renderers?.[name];
    if (typeof renderer !== 'function') return undefined;
    return renderer(...args);
  };
  const svgStrokePresented = (node, frame) => {
    if (!node?.isConnected || !node.getAttribute('d')) return false;
    if (typeof frame?.projectPath === 'function') {
      const geometry = node.__data__?.geometry;
      if (!geometry || node.getAttribute('d') !== frame.projectPath({ type: 'Feature', properties: {}, geometry })) return false;
    }
    const view = node.ownerDocument.defaultView;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = view.getComputedStyle(parent);
      if (style.display === 'none' || Number(style.opacity) === 0) return false;
    }
    const style = view.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.stroke !== 'none'
      && Number(style.opacity) > 0 && Number(style.strokeOpacity) > 0 && parseFloat(style.strokeWidth) > 0;
  };
  const objectEditingStrokePresented = (geometry, frame) => [...(editing.vertexLayer?.node()?.querySelectorAll('path.object-edit-outline') || [])]
    .some(node => node.__data__?.geometry === geometry && svgStrokePresented(node, frame));
  const completeEditPreviewHandoff = (frame, gpuResult, objectPresentation = null, { canvasPresented = false } = {}) => {
    const preview = editPreviewController?.snapshot();
    if (preview?.status !== 'successor-ready' || !isEditPreviewCurrent(preview)) return false;
    const canvas = ['canvas-worker', 'canvas2d'].includes(gpuMapRenderer?.getRuntimeState?.()?.renderer);
    if (canvas && !canvasPresented) return false;
    const successor = preview.successor;
    let presented = null;
    if (successor.kind === 'geometry-preview') {
      const session = editingPacket.preview;
      if (session?.sessionId !== successor.sessionId || session.revision !== successor.revision) return false;
      const nodes = [...(interaction.previewLayer?.node()?.querySelectorAll('.geometry-preview-new-boundary') || [])];
      const results = (gpuResult?.interactionResult?.previewResults || []).filter(result => !result.deferred && selectionCoverageAvailable(result));
      const covered = new Set(results.flatMap(result => result.renderedKeys || []));
      const missing = new Set(results.flatMap(result => result.missingKeys || []));
      const selectionResult = gpuResult?.selection || gpuResult?.interactionResult?.selection;
      const { renderedKeys } = selectionCoverage(selectionResult, null, new Map());
      const commonCoverage = new Set(Object.values(renderedKeys).flatMap(keys => [...keys]));
      const fallbacks = [...(selection.selectionLayer?.node()?.querySelectorAll('[data-selection-fallback-key]') || []),
        ...(selection.hoverLayer?.node()?.querySelectorAll('[data-selection-fallback-key]') || [])];
      if (!nodes.length || nodes.length !== session.delta?.newBoundaries?.length
        || !nodes.every(node => node.__data__?.key?.startsWith(`${session.sessionId}:`) && (
        svgStrokePresented(node, frame) || commonCoverage.has(node.getAttribute('data-object-key'))
        || fallbacks.some(fallback => fallback.getAttribute('data-selection-fallback-key') === node.getAttribute('data-object-key') && svgStrokePresented(fallback, frame))
        || ((node.getAttribute('data-gpu-interaction-stroke-keys') || '').trim().length > 0
          && node.getAttribute('data-gpu-interaction-stroke-keys').trim().split(/\s+/)
            .every(key => covered.has(key) && !missing.has(key)))))) return false;
      presented = { kind: 'geometry-preview', sessionId: session.sessionId, revision: session.revision };
    } else {
      if (!objectPresentation) {
        const ref = preview.targetRefs.find(ref => ref.key === successor.objectKey);
        const feature = ref && selection.mapFeatureForObjectRef(ref);
        if (feature?.geometry !== successor.geometry) return false;
        const revision = selectionGeometryRevision(ref.key, 'boundary', feature);
        const packet = selection.getCurrentSelectionPacket();
        const channel = Object.keys(packet?.channels || {}).find(channel => packet.channels[channel].some(item =>
          item.key === ref.key && (item.geometryRevision === revision || item.geometryRevision.startsWith(`${revision}:owners:`))));
        const editingStroke = objectEditingStrokePresented(feature.geometry, frame);
        if (!channel && !editingStroke) return false;
        const { renderedKeys } = selectionCoverage(gpuResult?.selection || gpuResult?.interactionResult?.selection, null, new Map());
        const fallback = [...(selection.selectionLayer?.node()?.querySelectorAll('[data-selection-fallback-key]') || [])]
          .some(node => node.getAttribute('data-selection-fallback-key') === ref.key && svgStrokePresented(node, frame));
        objectPresentation = { kind: 'object', objectKey: ref.key, geometry: feature.geometry,
          geometryRevision: readGeometryRevision(feature.geometry), painted: editingStroke || !!channel && (renderedKeys[channel].has(ref.key) || fallback) };
      }
      if (objectPresentation.objectKey === successor.objectKey && objectPresentation.painted) presented = objectPresentation;
    }
    if (!presented || !editPreviewController.completeHandoff(preview.id, presented, frame)) return false;
    selection.syncGpuInteractionState();
    invalidateGpuInteraction('edit-preview-handoff');
    return true;
  };
  const selectionOverlayDiagnostics = {
    failureCount: 0,
    lastFailureStage: '',
    retainedPreviousFrame: false,
    fallbackCount: 0,
    fallbackPathMs: 0,
    geometryCacheHits: 0,
    geometryCacheMisses: 0,
    projectedPathCacheHits: 0,
    projectedPathCacheMisses: 0,
  };
  let selectionOverlayStage = '';
  const selectionBoundaryGeometryCache = new Map();
  const selectionProjectedPathCache = new Map();
  let projectedPathFrameSignature = '';
  const fallbackGeometryIds = new WeakMap();
  let fallbackGeometryId = 0;
  let sparseFallbackViewSignature = '';
  let sparseFallbackPathCount = 0;
  let sparseFallbackDirty = true;
  const setLimitedSelectionCache = (cache, key, value, limit = 160) => {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  };
  const selectionGeometryRevision = (key, role = 'outline', feature = null) => {
    const state = selection.getState?.() || {};
    const source = feature?.geometry || (key.startsWith('country:') ? state.territorialEntities?.filter(feature => (feature.properties.entityKind === 'general' && !feature.properties.parentId))?.find(item => String(item.id) === key.slice(8))?.geometry : null);
    if (source) {
      if (!fallbackGeometryIds.has(source)) fallbackGeometryIds.set(source, ++fallbackGeometryId);
      return `${key}:${role}:geometry-${fallbackGeometryIds.get(source)}:${readGeometryRevision(source)}`;
    }
    return `${key}:${role}:country-${selection.getCountryLandRevision?.() || 0}:state-${selection.getStateRevision?.() ?? state.stateRevision ?? 0}`;
  };
  const cachedSelectionBoundaryFeature = (key, feature, role = 'outline') => {
    void role;
    const revision = selectionGeometryRevision(key, 'boundary', feature);
    const cached = selectionBoundaryGeometryCache.get(revision);
    if (cached) {
      selectionOverlayDiagnostics.geometryCacheHits += 1;
      selectionBoundaryGeometryCache.delete(revision);
      selectionBoundaryGeometryCache.set(revision, cached);
      return { feature: cached, revision };
    }
    selectionOverlayDiagnostics.geometryCacheMisses += 1;
    const boundary = selection.buildRenderableStrokeFeature?.(feature);
    return { feature: setLimitedSelectionCache(selectionBoundaryGeometryCache, revision, boundary), revision };
  };
  const cachedSelectionPath = (cacheKey, feature, frameContext = null) => {
    const projection = selection.getProjection?.(frameContext) || selection.getState?.()?.projection || '';
    const viewSignature = [
      projection,
      frameContext?.mode ?? '',
      frameContext?.translate?.join(',') || '',
      frameContext?.scale ?? '',
      frameContext?.rotation?.join(',') || '',
      frameContext?.flatCenter?.join(',') || '',
      frameContext?.viewport?.join(',') || '',
    ].join(':');
    const key = `${cacheKey}:${viewSignature}`;
    if (projectedPathFrameSignature !== viewSignature) {
      selectionProjectedPathCache.clear();
      projectedPathFrameSignature = viewSignature;
    }
    if (selectionProjectedPathCache.has(key)) {
      selectionOverlayDiagnostics.projectedPathCacheHits += 1;
      return selectionProjectedPathCache.get(key);
    }
    selectionOverlayDiagnostics.projectedPathCacheMisses += 1;
    return setLimitedSelectionCache(
      selectionProjectedPathCache,
      key,
      framePath(frameContext)?.(feature),
      96,
    );
  };
  const syncSelectionEmphasis = () => {
    if (!gpuMapRenderer?.setCountryEmphasis) return false;
    const selectionState = selectionDomain?.snapshot?.() || { selection: { items: [], primaryKey: null }, hover: null };
    const state = selection.getState?.() || {};
    const entries = mapInteractionEntries(selectionState, state, {
      
      visible: ref => selection.objectRefVisible?.(ref) !== false,
      territorialEntityById: selection.territorialEntityById,
    });
    const countryEntries = entries.filter(entry => rootGeneralSelection(entry.ref));
    const primaries = countryEntries.filter(entry => entry.priority >= 4).map(entry => entry.ref.id);
    gpuMapRenderer.setCountryEmphasis({ primaryId: primaries[0] || '', primaryIds: primaries,
      priorities: Object.fromEntries(countryEntries.map(entry => [entry.ref.id, entry.priority])),
      hoverId: !selection.isMobile?.() && !state.mapMoving ? countryEntries.find(entry => entry.role === 'hover')?.ref.id || '' : '',
      selectedIds: countryEntries.filter(entry => entry.priority >= 3).map(entry => entry.ref.id) });
    return true;
  };
  const invalidateSelectionOverlay = (reason = 'selection-overlay') => {
    active();
    syncSelectionEmphasis();
    return invalidate(
      MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_INTERACTION,
      reason,
    );
  };
  const renderSparseSelectionFallbackView = (frameContext = null) => {
    const viewSignature = [
      frameContext?.mode ?? '',
      frameContext?.projection ?? '',
      frameContext?.translate?.join(',') || '',
      frameContext?.scale ?? '',
      frameContext?.rotation?.join(',') || '',
      frameContext?.flatCenter?.join(',') || '',
      frameContext?.viewport?.join(',') || '',
    ].join(':');
    if (!sparseFallbackDirty && sparseFallbackViewSignature === viewSignature) {
      return sparseFallbackPathCount > 0;
    }
    let pathCount = 0;
    const reproject = (layer, selector) => {
      const paths = layer?.selectAll?.(selector);
      if (!paths?.attr) return;
      paths.attr('d', function(feature) {
        pathCount += 1;
        try {
          const geometry = feature?.geometry || feature;
          if (geometry && typeof geometry === 'object' && !fallbackGeometryIds.has(geometry)) fallbackGeometryIds.set(geometry, ++fallbackGeometryId);
          const objectKey = this?.getAttribute?.('data-object-key') || String(feature?.id || '');
          const revision = selectionGeometryRevision(objectKey, selector, feature);
          return cachedSelectionPath(`sparse:${selector}:${objectKey}:${revision}:${fallbackGeometryIds.get(geometry) || 0}`, feature, frameContext) || '';
        } catch (_) {
          return '';
        }
      });
    };
    reproject(selection.selectionLayer, 'path.map-selection-shape');
    reproject(selection.hoverLayer, 'path.map-hover-shape');
    reproject(selection.selectionLayer, 'path.map-selection-mask-shape');
    sparseFallbackViewSignature = viewSignature;
    sparseFallbackPathCount = pathCount;
    sparseFallbackDirty = false;
    selection.publishMetrics?.({
      viewRevision: selection.getViewRevision?.(frameContext) || frameContext?.viewRevision || frameContext?.revision || 0,
      boundaryOwner: pathCount ? 'svg-fallback' : 'interaction-overlay',
      fallbackCount: selectionOverlayDiagnostics.fallbackCount,
      sparseFallbackPathCount: pathCount,
      renderSucceeded: true,
      reusedGpuFrame: true,
    });
    return pathCount > 0;
  };
  let directPreviewGeometry = null;
  const renderDirectEditPreview = (frame, result) => {
    const root = selection.selectionLayer?.node?.();
    if (!root) return;
    const packet = selection.activeEditPreview?.()?.packet;
    const covered = (result?.interactionResult?.previewResults || []).some(value => !value.deferred
      && selectionCoverageAvailable(value) && value.renderedKeys?.includes(packet?.key) && !value.missingKeys?.includes(packet?.key));
    let node = root.querySelector('.map-direct-preview');
    if (!packet || covered) { node?.remove(); if (!packet) directPreviewGeometry = null; return; }
    const key = `${packet.key}:${packet.geometryRevision}`;
    if (directPreviewGeometry?.key !== key) {
      const coordinates = [];
      for (let i = 0; i < packet.startsEnds.length; i += 4) coordinates.push([[packet.startsEnds[i], packet.startsEnds[i + 1]], [packet.startsEnds[i + 2], packet.startsEnds[i + 3]]]);
      directPreviewGeometry = { key, feature: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates } } };
    }
    if (!node) { node = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path'); root.appendChild(node); }
    const style = scaleInteractionStroke(resolveMapStrokeStyle(selection.resolvedInteractionStyle?.() || selection.getInteractionStyle?.(), 'edit-target', { directManipulation: true }), frame);
    node.__data__ = directPreviewGeometry.feature;
    for (const [name, value] of Object.entries({ class: 'map-selection-shape map-direct-preview', fill: 'none', stroke: style.color,
      'stroke-width': style.width, 'stroke-opacity': style.alpha, 'data-object-key': packet.key,
      d: cachedSelectionPath(key, directPreviewGeometry.feature, frame) })) node.setAttribute(name, value);
  };
  let lastInteractionFillOwner = '';
  const renderSelectionOverlayFrame = (frameContext = null, {
    updateData = true,
    gpuFrameResult = null,
    viewOnly = false,
  } = {}) => {
    active();
    if (!viewOnly) sparseFallbackDirty = true;
    if (viewOnly) {
      const { result: gpuSelectionResult, reuseView } = selectionFrameOwnership({ gpuFrameResult,
        renderer: gpuMapRenderer?.getRuntimeState?.()?.renderer, lastFillOwner: lastInteractionFillOwner });
      // Worker submission is not presentation. Keep the previous emphasis
      // until the accepted Canvas frame reconciles its new fill owner.
      if (gpuFrameResult?.deferred || reuseView) {
        if (gpuSelectionResult) selection.publishMetrics?.({ gpuCoverage: gpuSelectionResult.channels,
          renderSucceeded: gpuSelectionResult.succeeded, contextLost: gpuSelectionResult.contextLost === true });
        // Upload completion schedules an interaction/view frame, not a new
        // selection-data frame. Retire temporary SVGs before reprojecting them.
        const roots = [selection.selectionLayer?.node?.(), selection.hoverLayer?.node?.()];
        if (commitSelectionFallbackCoverage(roots, gpuSelectionResult)) {
          sparseFallbackDirty = true;
          const keys = new Set(roots.flatMap(root => [...(root?.querySelectorAll?.('[data-selection-fallback-key]') || [])]
            .map(node => node.getAttribute('data-selection-fallback-key'))));
          selectionOverlayDiagnostics.fallbackCount = keys.size;
          selection.publishMetrics?.({ svgFallbackKeys: [...keys] });
        }
        const drawn = renderSparseSelectionFallbackView(frameContext);
        completeEditPreviewHandoff(frameContext, gpuFrameResult);
        renderDirectEditPreview(frameContext, gpuFrameResult);
        return drawn;
      }
    }
    const selectionLayer = selection.selectionLayer;
    if (!selectionLayer) return false;
    selectionOverlayStage = 'selection-data-prepare';
    const selectionTarget = selectionLayer.node?.();
    const hoverTarget = selection.hoverLayer?.node?.();
    const d3 = selection.d3;
    const selectionStageNode = selection.document?.createElementNS?.('http://www.w3.org/2000/svg', 'g')
      || globalThis.document?.createElementNS?.('http://www.w3.org/2000/svg', 'g');
    const hoverStageNode = selection.document?.createElementNS?.('http://www.w3.org/2000/svg', 'g')
      || globalThis.document?.createElementNS?.('http://www.w3.org/2000/svg', 'g');
    if (!selectionStageNode || !hoverStageNode || !d3?.select) return false;
    const stagedSelectionLayer = d3.select(selectionStageNode);
    const stagedHoverLayer = d3.select(hoverStageNode);
    syncSelectionEmphasis();
    let pathCount = 0;
    let pathCharacterCount = 0;
    let boundarySegmentCount = 0;
    const svgFallbackKeys = [];
    const selectionState = selectionDomain?.snapshot?.() || { selection: { items: [], primaryKey: null }, hover: null };
    const state = selection.getState?.() || {};
    const toolEntries = [];
    for (const [domain, layer] of [['preview', interaction.previewLayer], ['draft', interaction.draftLayer]]) {
      const paths = layer?.selectAll?.('[data-interaction-priority]')?.nodes?.() || [];
      for (const node of paths) {
        if (node.classList.contains('geometry-preview-fill')) continue;
        const geometry = node.__data__?.geometry;
        if (!geometry) continue;
        const key = node.getAttribute('data-object-key');
        const role = interactionNodeRole(node, domain);
        const directManipulation = node.classList.contains('draft-shape') || node.classList.contains('draft-auto-close-preview');
        // Direct draft handles retain their own stroke when selection outlines are off.
        if (directManipulation && selection.resolvedInteractionStyle?.()?.selection.outlineVisible === false) {
          node.classList.remove('common-interaction-outline'); delete node.dataset.commonOutline; continue;
        }
        node.classList.add('common-interaction-outline');
        node.dataset.commonOutline = 'true';
        toolEntries.push({ key, role, ref: { key, domain: 'interaction', type: domain, id: key,
          scopeFeature: { type: 'Feature', properties: {}, geometry } } });
      }
      interaction.syncGpuInteractionLayer?.(domain, layer);
    }
    const emphasisEntries = selectionEntries(selectionState, state, {
      territorialEntityById: selection.territorialEntityById,
      visible: ref => selection.objectRefVisible?.(ref) !== false }, toolEntries);
    const selectionChannels = { candidate: [], hover: [], primary: [], secondary: [] };
    const interactionFillRequests = [];
    const fallbackRequests = { hover: [], primary: [], secondary: [], candidate: [] };
    const selectionPass = selection.selectionPass;
    const style = selection.resolvedInteractionStyle?.() || selection.getInteractionStyle?.() || {};
    const selectionStyle = style.selection || {};
    const selectionOutlinesVisible = selectionStyle.outlineVisible !== false;
    const hovered = selectionState.hover;
    const hoveredFeature = hovered && selection.objectRefVisible?.(hovered) !== false ? selection.mapFeatureForObjectRef?.(hovered) : null;
    const displayPlan = selectionDisplayPlan({ entries: emphasisEntries, style, outlineVisible: selectionOutlinesVisible,
      hoverKey: hovered?.key, hoverHasGeometry: !!hoveredFeature?.geometry, mobile: selection.isMobile?.(),
      mapMoving: state.mapMoving, draftDragging: editingPacket?.draft?.dragging });
    const { hoverActive } = displayPlan;
    labels.labelLayer?.selectAll('g.user-label').each(function(label) {
      const key = labels.normalizeObjectRef?.({ domain: 'label', type: label.kind || 'label', id: label.id })?.key;
      const entry = displayPlan.labelEntriesByKey.get(key);
      const roleStyle = entry ? scaleInteractionStroke(resolveMapStrokeStyle(style, entry.role), frameContext) : null;
      let ring = this.querySelector('.user-label-interaction');
      if (!(roleStyle?.width > 0)) { ring?.remove(); return; }
      if (!ring) { ring = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle'); this.appendChild(ring); }
      for (const [name, value] of Object.entries({ class: 'user-label-interaction', r: 7, fill: 'none', stroke: roleStyle.color,
        'stroke-width': roleStyle.width, 'stroke-opacity': roleStyle.alpha, 'pointer-events': 'none', 'vector-effect': 'non-scaling-stroke' })) ring.setAttribute(name, value);
    });
    const selectionFramePath = framePath(frameContext);
    // Historical general countries may have no entry in the immutable modern
    // country mesh. Use their actual scene geometry for GPU selection strokes
    // rather than requesting a nonexistent built-in country boundary packet.
    const countryBoundarySnapshot = gpuMapRenderer?.getCountryInteractionBoundaryData?.() || null;
    const meshBoundaryOwnerIds = new Set((countryBoundarySnapshot?.visibleIds || []).map(String));
    const isMeshBoundaryOwner = ref => rootGeneralSelection(ref) && meshBoundaryOwnerIds.has(String(ref.id));
    const selectionPassAvailable = !!selectionPass?.isAvailable?.();
    const sceneOwnsFills = rendererOwnsSceneGeometry(gpuMapRenderer?.getRuntimeState?.()?.renderer);
    const displayFeatureForRef = ref => ref.scopeFeature || (ref.domain === 'territorial'
      ? selection.territorialDisplayFeature(ref.id) : selection.mapFeatureForObjectRef?.(ref));
    const hierarchyBoundary = (ref, feature, role) => {
      const boundary = { feature, revision: selectionGeometryRevision(ref.key, 'boundary', feature) };
      const owners = (displayPlan.boundaryOwnersByKey.get(ref.key) || []).map(entry => ({
        key: entry.key, ref: entry.ref, feature: displayFeatureForRef(entry.ref),
      })).filter(item => item.feature?.geometry);
      if (!owners.length) return isMeshBoundaryOwner(ref)
        ? boundary : cachedSelectionBoundaryFeature(ref.key, feature, role);
      const signature = owners.map(item => `${item.key}:${selectionGeometryRevision(item.key, 'ownership', item.feature)}`).sort().join(',');
      const revision = `${boundary.revision}:owners:${signature}`;
      const cached = selectionBoundaryGeometryCache.get(revision);
      if (cached) return { feature: cached, revision, owned: true };
      if (prepareMapDisplay && !pendingHighlights.has(revision)) {
        const pending = prepareMapDisplay({kind:'highlight',feature,
          occluders:owners.map(item=>({feature:item.feature}))},{jobKey:`map-display:highlight:${ref.key}`});
        pendingHighlights.set(revision, pending);
        pending.then(response => {
          if (disposed || pendingHighlights.get(revision) !== pending) return;
          setLimitedSelectionCache(selectionBoundaryGeometryCache, revision, response.result.feature);
          handleMapDisplayReady({ kind: 'highlight' });
        }).catch(error => {
          if (!error?.cancelled) selection.publishMetrics?.({ highlightPreparationError: String(error?.message || error) });
        }).finally(() => pendingHighlights.delete(revision));
      }
      return { feature: { type: 'Feature', properties: {}, geometry: null }, revision: `${revision}:pending`, owned: true };
    };
    if (hoverActive) {
      const isCountry = rootGeneralSelection(hovered);
      const feature = displayFeatureForRef(hovered);
      const key = hovered.key;
      const pendingCountry = isCountry && state.pendingCountryRenderIds?.has(String(hovered.id || ''));
      const boundary = selectionGeometryKinds(feature).boundary
        ? hierarchyBoundary(hovered, feature, 'hover')
        : { feature, revision: selectionGeometryRevision(key, 'hover', feature) };
      const plan = planHoverEntry({ ref: hovered, baseBoundaryOwnerId: isCountry && isMeshBoundaryOwner(hovered) ? String(hovered.id) : '',
        feature, boundary, pendingCountry, hoverStyle: style.hover });
      if (plan.fill && !sceneOwnsFills) {
        stagedHoverLayer.append('path').datum(feature)
          .attr('class', 'map-hover-shape map-hover-fill')
          .attr('data-object-key', hovered.key || '')
          .attr('fill', plan.fill.color)
          .attr('fill-opacity', plan.fill.fillAlpha)
          .attr('d', selectionFramePath);
      }
      fallbackRequests.hover.push(plan.fallback.kind === 'base'
        ? { key, resolveFeature: () => selection.countryOutlineFeature?.(feature), cacheKey: selectionGeometryRevision(key, 'hover-country') }
        : plan.fallback);
      if (plan.stroke) selectionChannels.hover.push(plan.stroke);
      if (plan.fillRequest) interactionFillRequests.push(plan.fillRequest);
    }
    let editSuccessor = null;
    const expectedEdit = editPreviewController?.snapshot().successor;
    for (const { entry, channel, outlineVisible } of displayPlan.items) {
      const ref = entry.ref;
      const primary = channel === 'primary';
      const isCountry = rootGeneralSelection(ref);
      const feature = displayFeatureForRef(ref);
      if (expectedEdit?.kind === 'object' && expectedEdit.objectKey === ref.key && expectedEdit.geometry === feature?.geometry) {
        editSuccessor = { kind: 'object', objectKey: ref.key, geometry: feature.geometry,
          geometryRevision: readGeometryRevision(feature.geometry), channel };
      }
      if (!feature?.geometry && feature?.type !== 'FeatureCollection') continue;
      const boundary = (isCountry || selectionGeometryKinds(feature).boundary) && outlineVisible
        ? hierarchyBoundary(ref, feature, 'selection-outline')
        : { feature, revision: selectionGeometryRevision(ref.key, 'selection-outline', feature) };
      const plan = planSelectionEntry({ ref, entry, channel,
        baseBoundaryOwnerId: isCountry && isMeshBoundaryOwner(ref) ? String(ref.id) : '', feature, boundary,
        pendingCountry: state.pendingCountryRenderIds?.has(String(ref.id)), outlineVisible, selectionStyle });
      if (plan.fill && !sceneOwnsFills) stagedSelectionLayer.append('path').datum(feature)
        .attr('class', `map-selection-shape map-selection-fill${primary ? ' is-primary' : ' is-secondary'}`)
        .attr('data-object-key', ref.key).attr('fill', plan.fill.color).attr('fill-opacity', plan.fill.fillAlpha)
        .attr('stroke', 'none').attr('d', selectionFramePath);
      if (plan.fillRequest) interactionFillRequests.push(plan.fillRequest);
      if (plan.stroke) selectionChannels[channel].push(plan.stroke);
      if (plan.fallback) fallbackRequests[channel].push(plan.fallback.kind === 'base'
        ? { key: plan.fallback.key, resolveFeature: () => selection.countryOutlineFeature?.(feature), cacheKey: selectionGeometryRevision(plan.fallback.key, 'country-outline') }
        : plan.fallback);
    }
    let gpuSelectionStats = null;
    let gpuRenderResult = null;
    let directFrameResult = gpuFrameResult;
    let gpuFillResult = null;
    let fillOwner = gpuFrameResult?.interactionResult?.fillOwner || 'svg';
    let fillResourcesByObject = new Map();
    if (updateData) {
      selectionPass?.setCountryBoundaryResources?.(countryBoundarySnapshot);
      selectionOverlayStage = 'selection-buffer-build';
      const packet = selectionDomain?.createPacket?.({
        geometryRevision: countryBoundarySnapshot?.revision || selection.getCountryLandRevision?.() || 0,
        styleRevision: JSON.stringify(style),
        countryBoundaryRevision: countryBoundarySnapshot?.revision || '',
        territorialBoundaryRevision: selection.getTerritorialBoundaryRevision?.() || '',
        channels: selectionChannels,
        style,
      });
      selection.setCurrentSelectionPacket?.(packet);
      selectionPass?.updateData?.(packet);
    }
    if (selectionPass) {
      const interactionFills = selection.buildGpuInteractionFillItems?.(interactionFillRequests) || { items: [], resourcesByObject: new Map() };
      fillResourcesByObject = interactionFills.resourcesByObject;
      selection.publishMetrics?.({ interactionFillRequestCount: interactionFillRequests.length, interactionFillResourceCount: interactionFills.items.length });
      selection.syncGpuInteractionState?.({ interactionFillItems: interactionFills.items });
      selectionOverlayStage = 'selection-gpu-render';
      // A view-only frame has already drawn GPU interaction passes in the
      // shared VIEW renderer. Never start a second WebGL frame here.
      const interactionFrame = gpuFrameResult || (viewOnly ? null : renderGpuInteraction(frameContext));
      directFrameResult = interactionFrame;
      gpuRenderResult = interactionFrame?.selection || interactionFrame?.interactionResult?.selection || null;
      gpuFillResult = interactionFrame?.interactionResult?.genericFillResult || null;
      fillOwner = interactionFrame?.interactionResult?.fillOwner || 'svg';
      gpuSelectionStats = selectionPass.stats?.() || null;
      boundarySegmentCount = Number(gpuSelectionStats?.segmentCount || 0);
      selection.updatePerformanceMetrics?.({
        selectionCountryBatchCount: Number(gpuSelectionStats?.countryBatchCount || 0),
        selectionGenericBatchCount: Number(gpuSelectionStats?.genericBatchCount || 0),
        selectionStrokeDrawCallCount: Number(gpuSelectionStats?.strokeDrawCallCount || 0),
      });
    } else if (!viewOnly && ['canvas-worker', 'canvas2d'].includes(gpuMapRenderer?.getRuntimeState?.()?.renderer)) {
      // Canvas has no GPU selection pass, but still needs the committed hydro
      // frame submitted through the same accepted-frame queue as view changes.
      directFrameResult = gpuFrameResult || renderGpuInteraction(frameContext);
    }
    if (!gpuSelectionStats) gpuSelectionStats = selectionPass?.stats?.() || null;
    const { renderedKeys, gpuFilledObjectKeys } = selectionCoverage(gpuRenderResult, gpuFillResult, fillResourcesByObject);
    stagedSelectionLayer.selectAll('.map-selection-fill[data-object-key]').filter(function() {
      return gpuFilledObjectKeys.has(this.getAttribute('data-object-key') || '');
    }).remove();
    stagedHoverLayer.selectAll('.map-hover-fill[data-object-key]').filter(function() {
      return gpuFilledObjectKeys.has(this.getAttribute('data-object-key') || '');
    }).remove();
    fillOwner = selectionFrameOwnership({ gpuFrameResult: directFrameResult,
      renderer: gpuMapRenderer?.getRuntimeState?.()?.renderer, lastFillOwner: fillOwner }).fillOwner;
    if (fillOwner === 'svg' && !sceneOwnsFills) {
      for (const entry of emphasisEntries) {
        if (!rootGeneralSelection(entry.ref)) continue;
        const itemStyle = resolveMapStrokeStyle(style, entry.role);
        if (!(itemStyle.fillAlpha > 0) || (entry.role === 'hover' && !hoverActive)) continue;
        const feature = displayFeatureForRef(entry.ref);
        if (!feature?.geometry) continue;
        const root = entry.role === 'hover' ? stagedHoverLayer : stagedSelectionLayer;
        root.selectAll(`[data-object-key="${entry.key}"].map-selection-fill, [data-object-key="${entry.key}"].map-hover-fill`).remove();
        root.append('path').datum(feature).attr('class', entry.role === 'hover' ? 'map-hover-shape map-hover-fill' : 'map-selection-shape map-selection-fill')
          .attr('data-object-key', entry.key).attr('fill', itemStyle.color).attr('fill-opacity', itemStyle.fillAlpha).attr('stroke', 'none')
          .attr('d', cachedSelectionPath(selectionGeometryRevision(entry.key, 'fill-mask', feature), feature, frameContext));
      }
    }
    if (sceneOwnsFills) {
      stagedSelectionLayer.selectAll('.map-selection-fill').remove();
      stagedHoverLayer.selectAll('.map-hover-fill').remove();
    } else {
      const toolNodes = [interaction.previewLayer, interaction.draftLayer].flatMap(layer => layer?.selectAll?.('[data-gpu-interaction-fill-keys]')?.nodes?.() || []);
      const nodes = [...selectionStageNode.querySelectorAll('.map-selection-fill'), ...hoverStageNode.querySelectorAll('.map-hover-fill'), ...toolNodes];
      if (nodes.length) {
        const maskEntries = displayPlan.fillMasks.map(entry => {
          const feature = entry.ref.scopeFeature || selection.mapFeatureForObjectRef?.(entry.ref);
          return { key: entry.key, feature, priority: entry.priority, depth: entry.depth, fillAlpha: entry.fillAlpha,
            path: feature?.geometry && ['Polygon', 'MultiPolygon'].includes(feature.geometry.type)
              ? cachedSelectionPath(selectionGeometryRevision(entry.key, 'fill-mask', feature), feature, frameContext) : '' };
        });
        for (const node of toolNodes) {
          const geometry = node.__data__?.geometry;
          if (geometry) maskEntries.push({ key: node.getAttribute('data-object-key'), priority: Number(node.getAttribute('data-interaction-priority')),
            fillAlpha: Number(node.style.fillOpacity), feature: { type: 'Feature', properties: {}, geometry }, path: node.getAttribute('d') });
        }
        const waterPaths = [];
        for (const kind of ['lake', 'river']) for (const group of hydro.hydroRenderGroups?.(kind) || []) {
          const feature = group.collection;
          if (feature) waterPaths.push({ key: `water:${kind}:${group.key}`, feature, path: cachedSelectionPath(`water:${kind}:${group.key}`, feature, frameContext),
            width: kind === 'river' ? group.width || 1 : 0 });
        }
        applySvgInteractionMasks(selectionStageNode, nodes, orderSelectionFillMasks(maskEntries), { prefix: 'selection-fill-mask', waterPaths });
      }
    }
    selectionOverlayStage = 'selection-fallback-path';
    const fallbackStartedAt = performance.now();
    const countFallbackSegments = feature => {
      try { return selection.buildSelectionBoundarySegments?.(feature?.geometry).length || 0; } catch (_) { return 0; }
    };
    for (const request of [...fallbackRequests.candidate.map(item => ({ ...item, candidate: true })), ...fallbackRequests.hover]) {
      const channel = request.candidate ? 'candidate' : 'hover';
      const guideStyle = scaleInteractionStroke(resolveMapStrokeStyle(style, channel), frameContext);
      if (renderedKeys[channel].has(request.key)) continue;
      const fallbackFeature = request.feature || request.resolveFeature?.();
      const d = cachedSelectionPath(request.cacheKey || request.key, fallbackFeature, frameContext);
      if (!d) continue;
      stagedHoverLayer.append('path').datum(fallbackFeature).attr('class', 'map-hover-shape map-hover-outline').attr('fill', 'none')
        .attr('data-selection-fallback-key', request.key).attr('data-selection-channel', channel)
        .attr('stroke', guideStyle.color).attr('stroke-width', guideStyle.width).attr('stroke-opacity', guideStyle.alpha).attr('d', d);
      svgFallbackKeys.push(request.key); boundarySegmentCount += countFallbackSegments(fallbackFeature);
    }
    if (selectionOutlinesVisible) {
      for (const channel of ['secondary', 'primary']) {
        const primary = channel === 'primary';
        const itemStyle = scaleInteractionStroke(resolveMapStrokeStyle(style, channel), frameContext);
        const priorityClass = primary ? ' is-primary' : ' is-secondary';
        for (const request of fallbackRequests[channel]) {
          if (renderedKeys[channel].has(request.key)) continue;
          const fallbackFeature = request.feature || request.resolveFeature?.();
          const d = cachedSelectionPath(request.cacheKey || request.key, fallbackFeature, frameContext);
          if (!d) continue;
          stagedSelectionLayer.append('path').datum(fallbackFeature).attr('class', `map-selection-shape map-selection-outline${priorityClass}`)
            .attr('data-selection-fallback-key', request.key).attr('data-selection-channel', channel)
            .attr('fill', 'none').attr('stroke', selectionStyle.color).attr('stroke-width', itemStyle.width)
            .attr('stroke-opacity', itemStyle.alpha).attr('d', d);
          pathCount += 1; pathCharacterCount += d.length; svgFallbackKeys.push(request.key); boundarySegmentCount += countFallbackSegments(fallbackFeature);
        }
      }
    }
    for (const selector of SELECTION_PAINT_ORDER.filter(role => ['secondary', 'primary'].includes(role)).map(role => `.map-selection-outline.is-${role}`)) {
      stagedSelectionLayer.selectAll(selector).each(function() { this.parentNode?.appendChild(this); });
    }
    const fallbackPathMs = performance.now() - fallbackStartedAt;
    selectionOverlayStage = 'selection-frame-commit';
    selectionTarget?.replaceChildren(...selectionStageNode.childNodes);
    hoverTarget?.replaceChildren(...hoverStageNode.childNodes);
    lastInteractionFillOwner = fillOwner;
    if (editSuccessor) editSuccessor.painted = renderedKeys[editSuccessor.channel].has(editSuccessor.objectKey)
      || objectEditingStrokePresented(editSuccessor.geometry, frameContext)
      || [...(selectionTarget?.querySelectorAll('[data-selection-fallback-key]') || [])]
        .some(node => node.getAttribute('data-selection-fallback-key') === editSuccessor.objectKey && svgStrokePresented(node, frameContext));
    completeEditPreviewHandoff(frameContext, directFrameResult, editSuccessor);
    renderDirectEditPreview(frameContext, directFrameResult);
    selectionOverlayDiagnostics.retainedPreviousFrame = false;
    selectionOverlayDiagnostics.fallbackCount = new Set(svgFallbackKeys).size;
    selectionOverlayDiagnostics.fallbackPathMs = fallbackPathMs;
    const metrics = {
      pathCount,
      pathCharacterCount,
      selectionBoundarySegmentCount: boundarySegmentCount,
      viewRevision: selection.getViewRevision?.(frameContext) || frameContext?.viewRevision || 0,
      boundaryOwner: svgFallbackKeys.length ? 'hybrid' : 'interaction-overlay',
      svgFallbackKeys: [...new Set(svgFallbackKeys)],
      fallbackCount: selectionOverlayDiagnostics.fallbackCount,
      fallbackPathMs,
      renderSucceeded: gpuRenderResult?.succeeded ?? !selectionPassAvailable,
      contextLost: gpuSelectionStats?.contextLost || false,
      retainedPreviousFrame: false,
      gpuCoverage: gpuRenderResult?.channels || null,
      channelBufferMetrics: gpuSelectionStats?.channels || null,
      drawOrder: style.drawOrder,
    };
    selection.publishMetrics?.(metrics);
    selectionOverlayStage = '';
    return true;
  };
  const renderSelectionOverlay = (frameContext = null, options = {}) => {
    try {
      return renderSelectionOverlayFrame(frameContext, options);
    } catch (error) {
      selectionOverlayDiagnostics.failureCount += 1;
      selectionOverlayDiagnostics.lastFailureStage = selectionOverlayStage || 'selection-frame-prepare';
      selectionOverlayDiagnostics.retainedPreviousFrame = true;
      selection.reportError?.({ stage: selectionOverlayDiagnostics.lastFailureStage, error });
      selection.publishMetrics?.({
        renderSucceeded: false,
        retainedPreviousFrame: true,
        failureCount: selectionOverlayDiagnostics.failureCount,
        lastFailureStage: selectionOverlayDiagnostics.lastFailureStage,
      });
      selectionOverlayStage = '';
      return false;
    }
  };
  const renderSelection = (frameContext, packet, options = {}) => renderSelectionOverlay(frameContext, {
    ...options,
    updateData: options.updateData !== false && !options.viewOnly && !options.styleOnly,
  });
  const renderHoverOverlay = (frameContext = null, options = {}) => {
    active();
    if (options.syncStrokes === false) return false;
    if (frameContext) return renderSelectionOverlay(frameContext, options);
    return invalidateSelectionOverlay('hover-overlay');
  };
  const getSelectionRenderStats = () => Object.freeze({
    ...selectionOverlayDiagnostics,
    stage: selectionOverlayStage,
    cacheSize: selectionBoundaryGeometryCache.size + selectionProjectedPathCache.size,
  });
  const recordSelectionRenderError = ({ stage = 'selection-overlay-render', error } = {}) => {
    selectionOverlayDiagnostics.failureCount += 1;
    selectionOverlayDiagnostics.lastFailureStage = stage;
    selectionOverlayDiagnostics.retainedPreviousFrame = true;
    reportDiagnostic({
      operation: 'selection-overlay-render',
      result: 'recovered',
      stage,
      technicalMessage: String(error?.message || error || stage),
      stack: error?.stack || '',
    });
    return false;
  };
  const renderGpuInteraction = (viewState = null) => {
    active();
    const result = gpuMapRenderer?.renderInteraction?.(viewState) || null;
    if (result?.deferred) commitViewAttachedLayers(viewState, result);
    interaction.applyGpuInteractionCoverage?.(result);
    return result;
  };
  const resetProjectGeneration = generation => {
    active();
    resetTerritorialBoundaryCache();
    gpuMapRenderer?.resetProjectRenderState?.({ generation });
    return generation;
  };
  const getStats = () => Object.freeze({
    uploads: uploadScheduler.getStats(),
    ...stats,
    ...(coordinator?.getStats?.() || {}),
    projectGeneration: projectDomain?.getGeneration?.() || 0,
    territorialBoundaryTopologyRebuildCount: content.getTerritorialBoundaryStats().rebuildCount,
    territorialBoundaryRevision: content.getTerritorialBoundaryStats().revision,
    hasMapHost: typeof mapHost === 'function' ? !!mapHost() : !!mapHost,
    hasDomLayers: !!domLayers,
    hasSceneBuilder: !!sceneBuilder,
    hasSelectionDomain: !!selectionDomain,
    hasEditingDomain: typeof getEditingRenderPacket === 'function',
  });
  const dispose = () => {
    resetTerritorialBoundaryCache();
    uploadListeners.forEach(remove => remove());
    if(disposeMapDisplay)disposeMapDisplay();
    labels.disposePlaces?.();
    gpuMapRenderer?.dispose?.();
    uploadScheduler.dispose();
    pendingVisualFrames.clear();
    gpuMapRenderer?.setFramePresentationListener?.(null);
    disposed = true;
  };
  const visualRootNode = value => value?.node?.() || value || null;
  const markVisualRoot = (value, frame) => {
    const node = visualRootNode(value);
    if (!node?.setAttribute) return false;
    node.setAttribute('data-visual-frame-id', String(frame.frameId));
    node.setAttribute('data-view-revision', String(frame.viewRevision));
    node.setAttribute('data-projection-revision', String(frame.projectionRevision));
    return true;
  };
  const editingPacketHasViewContent = packet => !!(
    packet?.draft?.active
    || packet?.objectVertices
    || packet?.boundaryEdit
    || packet?.territoryOperation
    || packet?.snap
    || packet?.preview
    || packet?.validationIssues?.length
  );
  const commitViewAttachedLayers = (frame, gpuResult = null, { canvasPresented = false } = {}) => {
    if (!frame?.__mapVisualFrame) {
      stats.visualFrameRejectedCount += 1;
      return false;
    }
    if (!canvasPresented && (gpuResult?.deferred || pendingVisualFrames.has(Number(frame.frameId)))) {
      pendingVisualFrames.set(Number(frame.frameId), frame);
      // A current Worker frame can be displayed while a later same-view frame
      // waits behind it. Keep its identity until presentation accepts it.
      for (const [key, pending] of pendingVisualFrames) {
        if (pending.projectGeneration !== frame.projectGeneration
          || pending.viewRevision !== frame.viewRevision
          || pending.projectionRevision !== frame.projectionRevision) pendingVisualFrames.delete(key);
      }
      return false;
    }
    syncBaseView(frame);
    renderProjectedOverlays(frame);
    renderCountries(frame, { presentationOnly: true, gpuResult });
    // GPU-only redraws bypass selectionView; accepted Canvas presentation must
    // still retire the previous fill owner while retaining outline fallbacks.
    if (canvasPresented) renderSelectionOverlay(frame, { viewOnly: true, updateData: false, gpuFrameResult: gpuResult });
    renderTerritorialLabelPositions(frame);
    renderUserLabelPositions(frame);
    if (editPresentation && editingPacketHasViewContent(editingPacket)) {
      renderGeometryPreview(frame, editingPacket);
      renderBoundaryEdit(frame, editingPacket);
      renderVertices(frame, editingPacket);
      renderDraft(frame, editingPacket);
      renderSnap(frame, editingPacket);
      renderValidation(frame, editingPacket);
    }
    completeEditPreviewHandoff(frame, gpuResult, null, {
      canvasPresented: canvasPresented || gpuMapRenderer?.getRuntimeState?.()?.renderer === 'canvas2d',
    });
    const roots = typeof domLayers === 'function' ? domLayers() || {} : domLayers || {};
    markVisualRoot(roots.baseSvg, frame);
    markVisualRoot(roots.gpuCanvas, frame);
    markVisualRoot(roots.svg, frame);
    markVisualRoot(roots.interactionSvg, frame);
    markVisualRoot(labels.territorialLabelLayer, frame);
    markVisualRoot(labels.labelLayer, frame);
    markVisualRoot(selection.selectionLayer, frame);
    markVisualRoot(selection.hoverLayer, frame);
    markVisualRoot(editing.boundaryEditLayer, frame);
    markVisualRoot(editing.vertexLayer, frame);
    markVisualRoot(interaction.previewLayer, frame);
    markVisualRoot(interaction.validationLayer, frame);
    markVisualRoot(interaction.draftLayer, frame);
    markVisualRoot(interaction.snapLayer, frame);
    for (const layer of projected.layers || []) markVisualRoot(layer, frame);
    stats.visualFrameCommittedCount += 1;
    stats.lastCommittedVisualFrameId = Number(frame.frameId || 0);
    stats.gpuCommittedFrameId = Number(frame.frameId || 0);
    stats.shellCommittedFrameId = Number(frame.frameId || 0);
    stats.graticuleCommittedFrameId = Number(frame.frameId || 0);
    stats.labelCommittedFrameId = Number(frame.frameId || 0);
    stats.overlayCommittedFrameId = Number(frame.frameId || 0);
    if (canvasPresented) {
      for (const key of pendingVisualFrames.keys()) {
        if (key <= Number(frame.frameId)) pendingVisualFrames.delete(key);
      }
    } else pendingVisualFrames.delete(Number(frame.frameId));
    gpuMapRenderer?.commitVisualFrame?.(frame);
    return true;
  };
  const presentCanvasVisualFrame = result => {
    const frame = pendingVisualFrames.get(Number(result?.frameId || 0));
    if (!frame
      || Number(result?.viewRevision || 0) !== Number(frame.viewRevision || 0)
      || Number(result?.projectionRevision || 0) !== Number(frame.projectionRevision || 0)
      || Number(result?.projectGeneration || 0) !== Number(frame.projectGeneration || 0)) {
      stats.visualFrameRejectedCount += 1;
      return false;
    }
    return commitViewAttachedLayers(frame, result, { canvasPresented: true });
  };
  gpuMapRenderer?.setFramePresentationListener?.(presentCanvasVisualFrame);
  coordinator = createMapRenderCoordinator({
    requestFrame,
    prepareView,
    isPresentationBlocked: () => !!gpuMapRenderer && gpuMapRenderer.getRuntimeState().projectRenderBlocked,
    invalidMaskMode,
    onInvalidMask: error => reportDiagnostic({
      code: error.code,
      stage: 'render-invalidation',
      reason: error.reason,
      input: error.input,
      knownMask: error.knownMask,
    }),
    onFrameComplete,
    renderers: {
      preservedFrame: () => gpuMapRenderer.renderPreservedProjectFrame(),
      beginFrame,
      view: frame => {
        const result = renderPass('view', frame);
        if (result?.deferred) commitViewAttachedLayers(frame, result);
        else if (gpuMapRenderer?.getRuntimeState?.()?.renderer === 'canvas2d') {
          // Canvas2D presents synchronously and has no Worker acceptance callback.
          renderSelectionOverlay(frame, { viewOnly: true, updateData: false, gpuFrameResult: result });
        }
        return result;
      },
      base: renderBase,
      countries: renderCountries,
      gpuInteraction: renderGpuInteraction,
      hydro: renderHydro,
      hydroEdits: renderHydroEdits,
      ...(editPresentation ? {boundaryEdit:renderBoundaryEdit}:{}),
      territorialUnits: renderTerritorialUnits,
      distributions: renderDistributions,
      genericFeatures: renderGenericFeatures,
      stackOverlays: (...args) => renderPass('stackOverlays', ...args),
      projectedOverlays: renderProjectedOverlays,
      ...(editPresentation ? {geometryPreview:frameContext => renderGeometryPreview(frameContext, editingPacket)}:{}),
      selectionData: (frameContext, packet, options = {}) => renderSelection(frameContext, packet, options),
      selectionStyle: (frameContext, packet, options = {}) => renderSelection(frameContext, packet, { ...options, styleOnly: true }),
      selectionView: (frameContext, gpuFrameResult, options = {}) => renderSelection(
        frameContext,
        null,
        { ...options, viewOnly: true, updateData: false, gpuFrameResult },
      ),
      hover: renderHoverOverlay,
      ...(editPresentation ? {validation:frameContext => renderValidation(frameContext, editingPacket)}:{}),
      labelLayout: (...args) => renderPass('labelLayout', ...args),
      territorialLabelPositions: renderTerritorialLabelPositions,
      userLabelPositions: renderUserLabelPositions,
      territorialLabels: renderTerritorialLabels,
      userLabels: renderUserLabels,
      viewPresentation: commitViewAttachedLayers,
      ...(editPresentation ? {vertices:frameContext => renderVertices(frameContext, editingPacket)}:{}),
      ...(editPresentation ? {draft:frameContext => renderDraft(frameContext, editingPacket)}:{}),
      ...(editPresentation ? {snapIndicator:frameContext => renderSnap(frameContext, editingPacket)}:{}),
      debug: (...args) => renderPass('debug', ...args),
      objectSearch: (...args) => renderPass('objectSearch', ...args),
    },
  });

  return Object.freeze({
    requestRender,
    setCountryPropertyEditingActive,
    invalidateView,
    invalidateViewport,
    invalidateProjection,
    invalidateProject,
    invalidateSelection,
    invalidateSelectionStyle,
    invalidateGpuFrame,
    invalidateGpuInteraction,
    invalidateEditingOverlays,
    invalidateGpuContext,
    invalidateQuality,
    invalidateBaseScene,
    invalidateOverlayGeometry,
    invalidateOverlayStyle,
    invalidateCountryPatch,
    invalidateHydroPatch,
    invalidateTerritorialPatch,
    invalidateGenericPatch,
    invalidateEditedGeometryPatch,
    invalidateLabels,
    beginInteraction,
    endInteraction,
    invalidateSelectionOverlay,
    syncSelectionEmphasis,
    getSelectionRenderStats,
    recordSelectionRenderError,
    getDistributionRenderRows: buildDistributionRenderRows,
    resetProjectGeneration,
    getTerritorialBoundaryStats,
    getStats,
    dispose,
  });
}
