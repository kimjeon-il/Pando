import { applySvgInteractionMasks, applySvgCasingMask } from './interaction-svg-mask.js';
import { rendererOwnsSceneGeometry } from './render-channel-ownership.js';
import { interactionRoleStyle, resolveMapInteractionStyle, interactionNodeRole } from './map-interaction-style.js';
import { mapInteractionEntries } from './interaction-roles.js';
import { selectionEntries, selectionDisplayPlan, orderSelectionFillMasks, selectionFrameOwnership, selectionGeometryKinds, planSelectionEntry, planHoverEntry, selectionCoverage } from './selection-overlay-plan.js';
import { geometryRevision as readGeometryRevision } from './geometry-versions.js';
import { boundaryViewBounds, queryBoundaryDisplay } from './boundary-display.js';
import {
  createMapRenderCoordinator,
  MAP_RENDER_DIRTY,
  MAP_RENDER_MASKS,
} from './map-render-coordinator.js';
import { EMPTY_EDITING_RENDER_PACKET } from './editing-render-packet.js';
import { createGpuUploadScheduler } from './gpu-upload-scheduler.js';
import { commitSelectionFallbackCoverage } from './selection-fallback-coverage.js';
import { createTerritorialFillResolver } from './territorial-fill-style.js';
import { connectBoundarySegments } from './boundary-lines.js';

export function createRenderingDomain({
  context = null,
  prepareEditDisplay = null,
  onEditDisplayReady = () => {},
  gpuMapRenderer = null,
  sceneBuilder = null,
  mapHost = null,
  selectionDomain = null,
  projectDomain = null,
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
  getEditingRenderPacket = () => EMPTY_EDITING_RENDER_PACKET,
  emitEditingInteraction = null,
  renderers = {},
  requestFrame = callback => globalThis.requestAnimationFrame?.(callback) ?? globalThis.setTimeout(callback, 0),
  prepareView = () => null,
  onFrameComplete = null,
  invalidMaskMode = 'throw',
  reportDiagnostic = () => {},
} = {}) {
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
  listenUploadInput(globalThis.document, 'pointermove', pulseUploadInput);
  for (const type of ['pointerup', 'pointercancel']) listenUploadInput(globalThis.document, type, event => { uploadPointers.delete(event.pointerId); pulseUploadInput(); });
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listenUploadInput(globalThis.document, type, event => { uploadTouches = event.touches?.length || 0; pulseUploadInput(); });
  listenUploadInput(globalThis.document, 'wheel', pulseUploadInput);
  listenUploadInput(globalThis.document, 'keydown', event => { if (/^(Arrow|Page|Home|End)|^[+\-=]$/.test(event.key)) pulseUploadInput(); });
  const resetUploadInput = () => { uploadPointers.clear(); uploadTouches = 0; uploadMapMoving = false; pulseUploadInput(); };
  listenUploadInput(globalThis.window, 'blur', resetUploadInput);
  listenUploadInput(globalThis.document, 'visibilitychange', resetUploadInput);
  let coordinator = null;
  let editingPacket = EMPTY_EDITING_RENDER_PACKET;
  let editingGestureSequence = 0;
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
  let countryLabelPositionBindings = [];
  let userLabelPositionBindings = [];
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
  const editingPresentation = new Map();
  const editingChannelChanged = (name, layer, ...parts) => {
    const previous = editingPresentation.get(name);
    if (previous && previous.layer === layer && previous.generation === editingPacket.projectGeneration
      && previous.parts.length === parts.length && parts.every((part, i) => part === previous.parts[i])) return false;
    editingPresentation.set(name, { layer, parts, generation: editingPacket.projectGeneration });
    return true;
  };
  const joinEditingNodes = (layer, selector, data, key) => {
    const binding = layer.selectAll(selector).data(data, key);
    binding.exit().remove();
    const [tag, className] = selector.split('.');
    binding.enter().append(tag).attr('class', className);
    return layer.selectAll(selector);
  };
  const componentProjectionCache = new WeakMap();
  const reprojectEditingLayer = (layer, frame) => {
    const path = framePath(frame, interaction.path || editing.path);
    layer?.selectAll('path').each(function(d) {
      const geometry = d?.geometry || (d?.start && d?.end ? { type: 'LineString', coordinates: [d.start, d.end] } : null);
      if (geometry) {
        const cacheable = this.classList.contains('territory-component') && Object.isFrozen(geometry)
          && frame?.viewRevision != null && frame?.projectionRevision != null;
        const cached = cacheable && componentProjectionCache.get(this);
        if (cached && cached.geometry === geometry && cached.view === frame.viewRevision
          && cached.projection === frame.projectionRevision) return;
        this.setAttribute('d', path({ type: 'Feature', properties: {}, geometry }) || '');
        if (cacheable) componentProjectionCache.set(this, { geometry, view: frame.viewRevision, projection: frame.projectionRevision });
      }
    });
    layer?.selectAll('g, circle, path.snap-indicator-cross').each(function(d) {
      if (this.parentNode !== layer.node?.() && (this.parentNode?.__data__?.coordinate || this.parentNode?.__data__?.coord)) return;
      const coordinate = d?.coordinate || d?.coord;
      if (!coordinate) return;
      const point = frameProjectCoordinate(coordinate, frame, interaction.activeProjection?.());
      this.style.visibility = point ? '' : 'hidden';
      if (!point) return;
      if (this.tagName.toLowerCase() === 'circle') {
        this.removeAttribute('transform');
        this.setAttribute('cx', point[0]); this.setAttribute('cy', point[1]);
      } else if (this.classList.contains('snap-indicator-cross')) {
        this.setAttribute('d', `M${point[0] - 7},${point[1] - 7}L${point[0] + 7},${point[1] + 7}M${point[0] + 7},${point[1] - 7}L${point[0] - 7},${point[1] + 7}`);
      } else this.setAttribute('transform', `translate(${point[0]},${point[1]})`);
    });
    return true;
  };
  const publishEditingInteraction = event => {
    const packet = editingPacket || EMPTY_EDITING_RENDER_PACKET;
    const normalized = Object.freeze({
      ...event,
      territorySourceKey: event?.territorySourceKey ?? packet.territoryOperation?.sourceKey,
      projectGeneration: Number(event?.projectGeneration ?? packet.projectGeneration ?? 0),
      packetRevision: Number(event?.packetRevision ?? packet.revision ?? 0),
      screenPoint: Array.isArray(event?.screenPoint)
        ? Object.freeze([Number(event.screenPoint[0]), Number(event.screenPoint[1])])
        : null,
      targetRef: event?.targetRef ? Object.freeze({ ...event.targetRef }) : null,
      modifiers: event?.modifiers ? Object.freeze({ ...event.modifiers }) : null,
    });
    if (typeof emitEditingInteraction === 'function') return emitEditingInteraction(normalized);
    context?.publish?.('editing-interaction', normalized);
    return true;
  };
  const pointerMetadata = sourceEvent => ({
    pointerType: sourceEvent?.pointerType || (sourceEvent?.touches ? 'touch' : 'mouse'),
    modifiers: {
      altKey: sourceEvent?.altKey === true,
      ctrlKey: sourceEvent?.ctrlKey === true,
      metaKey: sourceEvent?.metaKey === true,
      shiftKey: sourceEvent?.shiftKey === true,
    },
  });
  const localEditingPoint = () => interaction.d3?.mouse?.(interaction.svg?.node?.() || interaction.svg) || null;
  const editingDragBehavior = (kind, targetRef = null) => {
    let gestureId = '';
    return interaction.d3?.behavior?.drag?.()
      .on('dragstart', function(item) {
        gestureId = `editing-${++editingGestureSequence}`;
        const sourceEvent = interaction.d3?.event?.sourceEvent;
        sourceEvent?.preventDefault?.();
        sourceEvent?.stopPropagation?.();
        publishEditingInteraction({
          type: `${kind}-drag-start`, gestureId, targetRef: targetRef || item?.targetRef,
          vertexKey: item?.nodeKey || item?.key || null, vertexIndex: item?.index,
          screenPoint: localEditingPoint(), ...pointerMetadata(sourceEvent),
        });
      })
      .on('drag', function(item) {
        const sourceEvent = interaction.d3?.event?.sourceEvent;
        publishEditingInteraction({
          type: `${kind}-drag-move`, gestureId, targetRef: targetRef || item?.targetRef,
          vertexKey: item?.nodeKey || item?.key || null, vertexIndex: item?.index,
          screenPoint: localEditingPoint(), ...pointerMetadata(sourceEvent),
        });
      })
      .on('dragend', function(item) {
        const sourceEvent = interaction.d3?.event?.sourceEvent;
        sourceEvent?.preventDefault?.();
        sourceEvent?.stopPropagation?.();
        publishEditingInteraction({
          type: `${kind}-drag-end`, gestureId, targetRef: targetRef || item?.targetRef,
          vertexKey: item?.nodeKey || item?.key || null, vertexIndex: item?.index,
          screenPoint: localEditingPoint(), ...pointerMetadata(sourceEvent),
        });
        gestureId = '';
      });
  };
  const geometryPreviewIssueClass = (kind = '') => {
    if (kind === 'overlap') return 'issue-overlap';
    if (kind === 'gap' || kind === 'shared-boundary-gap') return 'issue-gap';
    if (['invalid-sovereign', 'orphan-administrative', 'outside-parent', 'missing-territorial-reference', 'duplicate-id'].includes(kind)) return 'issue-relation';
    return 'issue-invalid';
  };
  const labelState = () => labels.getState?.() || {};
  const frameProjectCoordinate = (coordinate, frameContext = null, fallback = null) => {
    if (typeof frameContext?.projectVisibleCoordinate === 'function') {
      return frameContext.projectVisibleCoordinate(coordinate);
    }
    return typeof fallback === 'function' ? fallback(coordinate) : null;
  };
  const framePath = (frameContext = null, fallback = null) => (
    typeof frameContext?.projectPath === 'function' ? frameContext.projectPath : fallback
  );
  const projectLabelCoordinate = (coordinate, frameContext = null) => {
    const point = typeof labels.projectVisibleCoordinate === 'function'
      ? labels.projectVisibleCoordinate(coordinate, frameContext)
      : (labels.isCoordVisible?.(coordinate) ? labels.activeProjection?.()(coordinate) : null);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    stats.labelPositionProjectionCount += 1;
    return point;
  };
  const renderCountryLabels = (layout = null) => {
    active();
    const state = labelState();
    const layer = labels.countryLabelLayer;
    if (!layer) return false;
    const resolvedLayout = layout || labels.visibleLabelLayout?.();
    const namesVisible = feature => resolvedLayout?.countryLabelNames?.get(String(feature.id)) !== false;
    const data = resolvedLayout?.countryLabels || [];
    const selection = layer.selectAll('g.country-label-item').data(data, d => d.id);
    selection.exit().remove();
    // Use ground hit-testing and tool dispatch, rather than forcing the named object.
    const enter = selection.enter().append('g')
      .attr('class', 'country-label-item')
      .on('click', function() {
        if (labels.mapClickBlocked?.()) return;
        labels.d3.event.stopPropagation();
        labels.handleMapClick(labels.d3.mouse(labels.svg.node()));
      });
    enter.append('image').attr('class', 'country-label-flag').attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('aria-hidden', 'true').style('pointer-events', 'none')
      .on('error', function() {
        this.dataset.failedUrl = this.getAttribute('href');
        this.style.display = 'none';
        this.parentNode.querySelector('text')?.setAttribute('x', '0');
      });
    enter.append('text').attr('class', 'country-label').attr('dy', '.35em');
    const all = layer.selectAll('g.country-label-item');
    all.select('text').text(feature => namesVisible(feature) ? labels.countryName?.(feature) || feature.properties?.name || '' : '')
      .style('display', feature => namesVisible(feature) ? null : 'none')
      .classed('major', d => (resolvedLayout?.countryScreenAreas?.get(String(d.id || '')) || 0) >= (labels.isMobile?.() ? 3200 : 2200));
    all
      .style('opacity', labels.layerStyle?.(state.layerPresentation, 'countryLabels').opacity)
      .classed('major', d => (resolvedLayout?.countryScreenAreas?.get(String(d.id || '')) || 0) >= (labels.isMobile?.() ? 3200 : 2200))
      .attr('transform', d => {
        const settings = labels.automaticLabelSettings?.('country', labels.labelSettings?.(state, 'country', d.id) || {});
        const anchor = settings?.pinned && settings.manualPosition
          ? settings.manualPosition
          : labels.countryLabelAnchors?.()?.get?.(String(d.id || ''));
        const point = resolvedLayout?.countryLabelPoints?.get?.(String(d.id || ''))
          || (Array.isArray(anchor) && anchor.length >= 2 ? projectLabelCoordinate(anchor) : null);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    countryLabelPositionBindings = [];
    all.each(function(feature) {
      const nameVisible = namesVisible(feature);
      let flag = resolvedLayout?.countryFlags?.get(String(feature.id));
      const text = this.querySelector('text');
      const image = this.querySelector('image');
      if (flag?.url === image.dataset.failedUrl) flag = null;
      text.setAttribute('x', flag && nameVisible ? (flag.width + flag.gap) / 2 : 0);
      image.style.display = flag ? '' : 'none';
      if (flag) {
        const width = nameVisible ? text.getComputedTextLength() : 0;
        image.setAttribute('x', nameVisible ? -(width + flag.width + flag.gap) / 2 : -flag.width / 2);
        image.setAttribute('y', -flag.height / 2);
        image.setAttribute('width', flag.width); image.setAttribute('height', flag.height);
        if (image.getAttribute('href') !== flag.url) image.setAttribute('href', flag.url);
      } else image.removeAttribute('href');
      const settings = labels.automaticLabelSettings?.('country', labels.labelSettings?.(state, 'country', feature.id) || {});
      const coordinate = settings?.pinned && settings.manualPosition ? settings.manualPosition : labels.countryLabelAnchors?.()?.get?.(String(feature.id || ''));
      countryLabelPositionBindings.push({ node: this, coordinate: coordinate?.slice() });
    });
    return true;
  };
  const renderUserLabels = (layout = null) => {
    active();
    const state = labelState();
    const layer = labels.labelLayer;
    if (!layer) return false;
    const labelStyle = labels.layerStyle?.(state.layerPresentation, 'labels') || {};
    const selectionState = labels.selectionSnapshot?.() || { primaryKey: null };
    const labelRef = label => labels.normalizeObjectRef?.({ domain: 'label', type: label.kind || 'label', id: label.id });
    const resolvedLayout = layout || labels.visibleLabelLayout?.() || {};
    const data = state.layerVisibility?.labels ? resolvedLayout.userLabels || [] : [];
    const selection = layer.selectAll('g.user-label').data(data, d => d.id);
    const enter = selection.enter().append('g').attr('class', 'user-label').on('click', function(d) {
      if (labels.mapClickBlocked?.() || state.tool !== 'select' || state.labelPlacementMode) return;
      labels.d3?.event?.stopPropagation?.();
      const point = labels.d3?.mouse?.(labels.svg);
      labels.handleObjectSelectionAt?.(point, { sourceEvent: labels.d3?.event, hitRef: { domain: 'label', type: d.kind || 'label', id: d.id } });
    });
    enter.on('mouseenter.hover', d => {
      if (!labels.isMobile?.() && labelState().tool === 'select' && !labelState().mapMoving) selectionDomain?.setHover(labelRef(d), { source: 'map' });
    }).on('mouseleave.hover', d => selectionDomain?.setHover(null, { source: 'map', expectedKey: labelRef(d)?.key }));
    enter.append('circle').attr('class', 'user-label-dot').attr('r', 4);
    enter.append('text').attr('class', 'user-label-text').attr('x', 7).attr('dy', '.35em');
    selection.style('opacity', labelStyle.opacity)
      .classed('selected', d => labels.selectionHas?.(labelRef(d)))
      .classed('is-primary-selection', d => labelRef(d)?.key === selectionState.primaryKey)
      .classed('is-secondary-selection', d => labels.selectionHas?.(labelRef(d)) && labelRef(d)?.key !== selectionState.primaryKey)
      .attr('transform', d => {
        const settings = labels.automaticLabelSettings?.(d.kind, labels.labelSettings?.(state, 'label', d.id) || {});
        const coordinate = settings?.pinned && settings.manualPosition ? settings.manualPosition : d.coordinates;
        const point = resolvedLayout?.userLabelPoints?.get?.(String(d.id || ''))
          || projectLabelCoordinate(coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    selection.select('text').text(d => d.name);
    selection.on('.drag', null);
    if (state.tool === 'select' && !state.labelPlacementMode) selection.call(labels.labelDragBehavior?.());
    selection.exit().remove();
    userLabelPositionBindings = [];
    layer.selectAll('g.user-label').each(function(label) {
      const settings = labels.automaticLabelSettings?.(label.kind, labels.labelSettings?.(state, 'label', label.id) || {});
      const coordinate = settings?.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      userLabelPositionBindings.push({ node: this, coordinate: coordinate?.slice() });
    });
    return true;
  };
  const applyCountryLabelPositions = (frameContext = null) => {
    active();
    for (const { node, coordinate: anchor } of countryLabelPositionBindings) {
      const point = Array.isArray(anchor) && anchor.length >= 2 ? projectLabelCoordinate(anchor, frameContext) : null;
      node?.setAttribute?.('transform', point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)');
    }
    return true;
  };
  const applyUserLabelPositions = (frameContext = null) => {
    active();
    for (const { node, coordinate } of userLabelPositionBindings) {
      const point = projectLabelCoordinate(coordinate, frameContext);
      node?.setAttribute?.('transform', point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)');
    }
    return true;
  };
  const renderCountryLabelPositions = frameContext => {
    stats.labelPositionRequestCount += 1;
    const result = applyCountryLabelPositions(frameContext);
    stats.labelPositionCommitCount += 1;
    stats.labelPositionLastFrameRevision = Number(frameContext?.viewRevision || frameContext?.revision || 0);
    return result;
  };
  const renderUserLabelPositions = frameContext => applyUserLabelPositions(frameContext);
  const renderCountries = (viewStateOrRevision = null, {
    presentationOnly = false,
    gpuResult = null,
  } = {}) => {
    active();
    const state = countries.getState?.() || {};
    const renderViewState = viewStateOrRevision && typeof viewStateOrRevision === 'object' ? viewStateOrRevision : null;
    countries.renderPendingCountryOverlays?.();
    const pending = state.layerVisibility?.countries && state.pendingCountryRenderIds?.size
      ? [...state.pendingCountryRenderIds].map(countries.countryFeatureById).filter(Boolean)
      : [];
    const pendingPolygons = [];
    const pendingStrokes = [];
    for (const feature of pending) {
      const id = String(feature.id || '');
      const geometryRevision = countries.selectionGeometryRevision?.(`country:${id}`, 'pending-country', feature);
      pendingPolygons.push({ key: `pending-country-fill:${id}`, geometryRevision, geometry: feature.geometry, order: -300,
        role: 'territorial-fill', ownerId: id, territoryDepth: 0,
        style: { color: countries.countryColor?.(feature), fillAlpha: countries.mapTheme?.().fillAlpha, blendMode: 'normal' } });
      pendingStrokes.push({ key: `pending-country-outline:${id}`, geometryRevision, geometry: countries.countryOutlineFeature?.(feature).geometry, order: -290, style: { color: countries.mapTheme?.().border, alpha: countries.mapTheme?.().borderAlpha, width: 1, cap: 'round' } });
    }
    countries.replaceGpuSceneDomain?.('country-overlays', {
      polygons: pendingPolygons,
      strokes: pendingStrokes,
    });
    countries.syncGpuRenderScene?.();
    const frameResult = !presentationOnly && renderViewState?.__mapVisualFrame
      ? countries.gpuMapRenderer?.renderFrame?.(renderViewState)
      : gpuResult;
    countries.applyGpuSceneCoverage?.(frameResult);
    countries.applyGpuInteractionCoverage?.(frameResult);
    return frameResult;
  };
  const renderHydro = () => {
    active();
    const state = hydro.getState?.() || {};
    if (!hydro.hydroLakeLayer || !hydro.hydroRiverLayer) return false;
    const riverStyle = hydro.layerStyle?.(state.layerPresentation, 'rivers') || {};
    const lakeStyle = hydro.layerStyle?.(state.layerPresentation, 'lakes') || {};
    const renderer = hydro.gpuMapRenderer?.getRuntimeState?.().renderer;
    const nativeHydro = ['webgl2', 'webgl1', 'canvas-worker', 'canvas2d'].includes(renderer);
    if (nativeHydro) {
      hydro.hydroLakeLayer.selectAll('*').remove();
      hydro.hydroRiverLayer.selectAll('*').remove();
    } else {
      const lakes = state.layerVisibility?.lakes ? hydro.hydroRenderGroups?.('lake') || [] : [];
      const lakeSelection = hydro.hydroLakeLayer.selectAll('path.hydro-lake-group').data(lakes, item => item.key);
      lakeSelection.enter().append('path').attr('class', 'hydro-lake-group');
      lakeSelection.attr('d', item => hydro.path?.(item.collection))
        .style('fill', hydro.hydroDisplayColor?.('lake'))
        .style('stroke', hydro.hydroDisplayColor?.('lake'))
        .style('opacity', null)
        .style('fill-opacity', lakeStyle.opacity)
        .style('stroke-opacity', lakeStyle.boundaryVisible ? lakeStyle.opacity : 0)
        .style('stroke-width', lakeStyle.boundaryWidth);
      lakeSelection.exit().remove();
      const rivers = state.layerVisibility?.rivers ? hydro.hydroRenderGroups?.('river') || [] : [];
      const riverSelection = hydro.hydroRiverLayer.selectAll('path.hydro-river-group').data(rivers, item => item.key);
      riverSelection.enter().append('path').attr('class', 'hydro-river-group');
      riverSelection.attr('d', item => hydro.path?.(item.collection))
        .style('stroke-width', item => `${item.width * riverStyle.boundaryWidth}px`)
        .style('stroke', hydro.hydroDisplayColor?.('river'))
        .style('opacity', null)
        .style('stroke-opacity', riverStyle.opacity);
      riverSelection.exit().remove();
    }
    return true;
  };
  const renderHydroEdits = () => {
    active();
    const state = hydro.getState?.() || {};
    if (!hydro.hydroEditLayer) return false;
    const renderer = hydro.gpuMapRenderer?.getRuntimeState?.().renderer;
    const nativeHydro = ['webgl2', 'webgl1', 'canvas-worker', 'canvas2d'].includes(renderer);
    hydro.gpuMapRenderer?.setHydroEdits?.(state.hydroEdits || [], hydro.getStateRevision?.() || state.stateRevision);
    const riverStyle = hydro.layerStyle?.(state.layerPresentation, 'rivers') || {};
    const lakeStyle = hydro.layerStyle?.(state.layerPresentation, 'lakes') || {};
    const visibleHydroIds = new Set((hydro.visibleMapObjectCandidates?.(['hydro']) || []).map(record => String(record.id)));
    const data = (state.hydroEdits || []).filter(feature => hydro.isHydroFeatureVisible?.(feature) && feature.geometry
      && ((visibleHydroIds.has(String(feature.id)) && hydro.geometryMayIntersectViewport?.(feature.geometry))
        || hydro.selectionHas?.(hydro.normalizeObjectRef?.({ domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id }))));
    if (hydro.viewportCullingMetrics?.lastByDomain?.hydro) hydro.viewportCullingMetrics.lastByDomain.hydro.finalVisibleCount = data.length;
    const selection = hydro.hydroEditLayer.selectAll('path.hydro-edit-shape').data(data, feature => String(feature.id));
    selection.enter().append('path')
      .attr('class', 'hydro-edit-shape')
      .on('mouseenter.hover', feature => hydro.setMapHover?.('hydro', feature.id, feature, {
        domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id,
      }))
      .on('mouseleave.hover', feature => hydro.setMapHover?.('', '', null, { domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id }))
      .on('click', function(feature) {
        const stateNow = hydro.getState?.() || {};
        if (hydro.mapClickBlocked?.() || stateNow.tool !== 'select' || stateNow.labelPlacementMode) return;
        hydro.d3?.event?.stopPropagation?.();
        hydro.handleObjectSelectionAt?.(hydro.d3?.mouse?.(hydro.svg), {
          sourceEvent: hydro.d3?.event,
          hitRef: { domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id },
        });
      });
    selection.attr('d', feature => hydro.path?.(feature))
      .classed('hydro-edit-native-hit', nativeHydro)
      .style('fill', feature => feature.properties?.category === 'lake'
        ? (nativeHydro ? 'transparent' : hydro.hydroEditColor?.(feature) || hydro.hydroDisplayColor?.('lake'))
        : 'none')
      .style('fill-opacity', feature => feature.properties?.category === 'lake' ? (nativeHydro ? 0 : 0.34 * lakeStyle.opacity) : 0)
      .style('stroke', feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
        ? 'none' : (nativeHydro ? 'transparent' : hydro.hydroEditColor?.(feature) || hydro.hydroDisplayColor?.('river')))
      .style('stroke-opacity', feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
        ? 0 : (nativeHydro ? 0 : riverStyle.opacity))
      .style('stroke-width', feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
        ? 0 : (nativeHydro ? Math.max(8, riverStyle.boundaryWidth) : riverStyle.boundaryWidth));
    selection.exit().remove();
    const polygonSelection = hydro.hydroEditLayer.selectAll('path.hydro-edit-boundary').data(
      nativeHydro ? [] : data.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)),
      feature => String(feature.id),
    );
    polygonSelection.enter().append('path').attr('class', 'hydro-edit-boundary').style('fill', 'none').style('pointer-events', 'none');
    polygonSelection.attr('d', feature => hydro.path?.(hydro.buildRenderableStrokeFeature?.(feature) || feature))
      .style('stroke', feature => hydro.hydroEditColor?.(feature) || hydro.hydroDisplayColor?.('lake'))
      .style('stroke-opacity', lakeStyle.boundaryVisible ? lakeStyle.opacity : 0)
      .style('stroke-width', lakeStyle.boundaryWidth);
    polygonSelection.exit().remove();
    return true;
  };
  const renderTerritorialUnits = () => {
    active();
    const t = territorial;
    const state = t.getState?.() || {};
    const theme = countries.mapTheme?.() || {};
    const resolveFill = createTerritorialFillResolver({ state, countryColor: feature => countries.countryColor?.(feature),
      defaultColor: theme.defaultLand, terrainAlpha: theme.countryColorAlpha ?? theme.terrainColorAlpha ?? 1 });
    t.syncBuiltinPalette?.();
    const types = t.TERRITORIAL_UNIT_TYPES || {};
    const visibleIds = new Set((t.visibleMapObjectCandidates?.(['territorial']) || []).map(record => String(record.id)));
    const data = (state.territorialUnits || []).filter(feature => {
      const group = feature.properties?.unitType === types.SUBUNIT ? 'subunits'
        : feature.properties?.unitType === types.REGION ? 'regions' : 'subunits';
      const selected = t.selectionHas?.(t.normalizeObjectRef?.({
        domain: 'territorial', type: feature.properties?.unitType || types.SUBUNIT, id: feature.id,
      }));
      const editing = state.territorialUnitMergeSourceId === String(feature.id)
        || (state.territorialUnitMergeTargetIds || []).includes(String(feature.id))
        || state.territorialUnitSplitSourceId === String(feature.id)
        || state.territorialUnitRedrawSourceId === String(feature.id);
      return state.layerVisibility?.[group] !== false && t.isLayerItemVisible?.(group, feature.id)
        && (selected || editing || (visibleIds.has(String(feature.id)) && t.geometryMayIntersectViewport?.(feature.geometry)));
    });
    if (t.viewportCullingMetrics?.lastByDomain?.territorial) t.viewportCullingMetrics.lastByDomain.territorial.finalVisibleCount = data.length;
    const selection = t.territorialUnitLayer?.selectAll('path.territorial-unit-shape').data(data, feature => String(feature.id));
    selection?.enter().append('path').attr('class', 'territorial-unit-shape')
      .on('mouseenter.hover', feature => t.setMapHover?.('territorialUnit', feature.id, feature, {
        domain: 'territorial', type: feature.properties?.unitType || types.SUBUNIT, id: feature.id,
      }))
      .on('mouseleave.hover', feature => t.setMapHover?.('', '', null, { domain: 'territorial', type: feature.properties.unitType, id: feature.id }))
      .on('click', function(feature) {
        const stateNow = t.getState?.() || {};
        if (t.mapClickBlocked?.()) return;
        if (stateNow.tool === 'merge-territorial-unit') {
          t.d3?.event?.stopPropagation?.();
          t.toggleTerritorialUnitMergeTarget?.(String(feature.id));
          return;
        }
        if (stateNow.tool !== 'select' || stateNow.labelPlacementMode) return;
        t.d3?.event?.stopPropagation?.();
        t.handleObjectSelectionAt?.(t.d3?.mouse?.(t.svg), {
          sourceEvent: t.d3?.event,
          hitRef: { domain: 'territorial', type: feature.properties?.unitType || types.SUBUNIT, id: feature.id },
        });
      });
    selection?.attr('d', feature => t.path?.(feature))
      .attr('data-gpu-scene-key', feature => {
        const type = feature.properties?.unitType || types.SUBUNIT;
        const key = t.normalizeObjectRef?.({ domain: 'territorial', type, id: feature.id })?.key
          || `territorial:${type}:${feature.id}`;
        return `${key}:fill`;
      })
      .classed('is-territory', feature => feature.properties?.unitType === types.SUBUNIT)
      .classed('is-region', feature => feature.properties?.unitType === types.REGION)
      .classed('territorial-unit-merge-source', feature => state.territorialUnitMergeSourceId === String(feature.id))
      .classed('territorial-unit-merge-target', feature => (state.territorialUnitMergeTargetIds || []).includes(String(feature.id)))
      .style('color', null)
      .style('fill', 'transparent')
      .style('fill-opacity', 0)
      .style('stroke', 'none').style('stroke-opacity', 0).style('stroke-width', 0).style('stroke-dasharray', 'none')
      .style('mix-blend-mode', 'normal')
      .attr('data-presentation-group', t.presentationGroupForTerritorialFeature);
    selection?.exit().remove();
    t.territorialOperationLayer?.selectAll('path.territorial-unit-operation-outline').remove();
    const polygons = [];
    const strokes = [];
    for (const feature of data) {
      const group = t.presentationGroupForTerritorialFeature?.(feature) || 'subunits';
      const unitStyle = resolveFill(feature);
      const type = feature.properties?.unitType || types.SUBUNIT;
      const objectKey = t.normalizeObjectRef?.({ domain: 'territorial', type, id: feature.id })?.key
        || `territorial:${type}:${feature.id}`;
      const geometryRevision = t.selectionGeometryRevision?.(objectKey, 'gpu-scene', feature);
      polygons.push({ key: `${objectKey}:fill`, objectKey, geometryRevision, geometry: feature.geometry,
        role: 'territorial-fill', ownerId: unitStyle.ownerId, parentId: unitStyle.parentId, territoryDepth: unitStyle.depth,
        order: t.gpuSceneOrder?.(group, 10, objectKey), blendMode: unitStyle.blendMode,
        style: { color: unitStyle.color, fillAlpha: unitStyle.fillAlpha, blendMode: unitStyle.blendMode } });

    }
    t.replaceGpuSceneDomain?.('territorial-units', { polygons, strokes });
    const boundaryFeatures = (state.territorialUnits || []).filter(feature => {
      if (t.isNativeBuiltinSubunit?.(feature)) return false;
      const group = t.presentationGroupForTerritorialFeature?.(feature) || 'subunits';
      return state.layerVisibility?.[group] !== false && t.isLayerItemVisible?.(group, feature.id);
    });
    renderTerritorialInternalBoundaries(boundaryFeatures);
    return true;
  };
  const renderGenericFeatures = () => {
    active();
    const g = generic;
    const state = g.getState?.() || {};
    const style = g.layerStyle?.(state.layerPresentation, 'genericFeatures') || {};
    const visibleIds = state.layerVisibility?.genericFeatures
      ? new Set((g.visibleMapObjectCandidates?.(['generic']) || []).map(record => String(record.id)))
      : new Set();
    const data = state.layerVisibility?.genericFeatures
      ? (state.genericFeatures || []).filter(feature => g.isLayerItemVisible?.('genericFeatures', feature.id))
        .map(feature => g.genericFeatureDisplayFeature?.(feature) || feature)
        .filter(feature => feature.geometry && ((visibleIds.has(String(feature.id)) && g.geometryMayIntersectViewport?.(feature.geometry))
          || g.selectionHas?.(g.normalizeObjectRef?.({ domain: 'generic', type: 'feature', id: feature.id }))))
      : [];
    if (g.viewportCullingMetrics?.lastByDomain?.generic) g.viewportCullingMetrics.lastByDomain.generic.finalVisibleCount = data.length;
    const selection = g.genericFeatureLayer?.selectAll('path.generic-feature-shape').data(data, d => String(d.id));
    selection?.enter().append('path').attr('class', 'generic-feature-shape')
      .on('mouseenter.hover', d => g.setMapHover?.('generic', d.id, d, { domain: 'generic', type: 'feature', id: d.id }))
      .on('mouseleave.hover', feature => g.setMapHover?.('', '', null, { domain: 'generic', type: 'feature', id: feature.id }))
      .on('click', function(d) {
        const stateNow = g.getState?.() || {};
        if (g.mapClickBlocked?.()) return;
        if (stateNow.tool === 'merge-generic-feature') {
          g.d3?.event?.stopPropagation?.();
          g.toggleGenericFeatureMergeTarget?.(String(d.id));
          return;
        }
        if (stateNow.tool !== 'select' || stateNow.labelPlacementMode) return;
        g.d3?.event?.stopPropagation?.();
        g.handleObjectSelectionAt?.(g.d3?.mouse?.(g.svg), { sourceEvent: g.d3?.event, hitRef: { domain: 'generic', type: 'feature', id: d.id } });
      });
    const selectedRef = d => g.normalizeObjectRef?.({ domain: 'generic', type: 'feature', id: d.id });
    const sceneGeometry = d => ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(d.geometry?.type);
    selection?.attr('d', g.path)
      .attr('data-gpu-scene-key', d => d.geometry?.type?.includes('Polygon')
        ? `${selectedRef(d)?.key || `generic:feature:${d.id}`}:fill`
        : ['LineString', 'MultiLineString'].includes(d.geometry?.type) ? `${selectedRef(d)?.key || `generic:feature:${d.id}`}:line` : null)
      .classed('selected', d => g.selectionHas?.(selectedRef(d)))
      .classed('selected-point', d => d.geometry?.type === 'Point' && g.selectionHas?.(selectedRef(d)))
      .classed('is-primary-selection', d => selectedRef(d)?.key === g.selectionSnapshot?.()?.primaryKey)
      .classed('is-secondary-selection', d => g.selectionHas?.(selectedRef(d)) && selectedRef(d)?.key !== g.selectionSnapshot?.()?.primaryKey)
      .style('fill', d => sceneGeometry(d) ? 'transparent' : 'none')
      .style('fill-opacity', 0)
      .style('stroke', d => sceneGeometry(d) ? 'transparent' : g.genericFeatureColor?.(d))
      .style('stroke-opacity', d => sceneGeometry(d) ? 0 : style.boundaryVisible ? style.opacity : 0)
      .style('stroke-width', d => sceneGeometry(d) ? 0 : style.boundaryWidth)
      .style('mix-blend-mode', d => sceneGeometry(d) ? 'normal' : style.blendMode)
      .attr('data-presentation-group', 'genericFeatures')
      .classed('generic-feature-merge-source', d => state.tool === 'merge-generic-feature' && state.genericFeatureMergeSourceId === String(d.id))
      .classed('generic-feature-merge-target', d => state.tool === 'merge-generic-feature' && (state.genericFeatureMergeTargetIds || []).includes(String(d.id)));
    selection?.exit().remove();
    g.genericFeatureLayer?.selectAll('path.generic-feature-boundary').remove();
    const polygons = [];
    const strokes = [];
    for (const feature of data) {
      const objectKey = selectedRef(feature)?.key || `generic:feature:${feature.id}`;
      const geometryRevision = g.selectionGeometryRevision?.(objectKey, 'gpu-scene', feature);
      if (['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        polygons.push({ key: `${objectKey}:fill`, objectKey, geometryRevision, geometry: feature.geometry,
          order: g.gpuSceneOrder?.('genericFeatures', 10), blendMode: style.blendMode,
          style: { color: g.genericFeatureColor?.(feature), fillAlpha: 0.34 * style.opacity, blendMode: style.blendMode } });
        if (style.boundaryVisible) strokes.push({
          key: `${objectKey}:boundary`, objectKey, geometryRevision,
          geometry: (g.buildRenderableStrokeFeature?.(feature) || feature).geometry,
          order: g.gpuSceneOrder?.('genericFeatures', 20), blendMode: style.blendMode,
          style: { color: g.genericFeatureColor?.(feature), alpha: style.opacity,
            width: style.boundaryWidth, cap: 'round', join: 'round', blendMode: style.blendMode, antiAlias: false },
        });
      } else if (['LineString', 'MultiLineString'].includes(feature.geometry?.type) && style.boundaryVisible) strokes.push({
        key: `${objectKey}:line`, objectKey, geometryRevision, geometry: feature.geometry,
        order: g.gpuSceneOrder?.('genericFeatures', 15), blendMode: style.blendMode,
        style: { color: g.genericFeatureColor?.(feature), alpha: style.opacity, width: style.boundaryWidth, cap: 'round', join: 'round', blendMode: style.blendMode, antiAlias: false },
      });
    }
    g.replaceGpuSceneDomain?.('generic-features', { polygons, strokes });
    return true;
  };
  let distributionRenderRowCache = { layers: null, entries: null, countries: null, countryGeometryRevision: -1, territorialUnits: null, renderMode: '', selectedLayerId: '', visibilityRevision: -1, rows: Object.freeze([]), rebuildCount: 0, buildMs: 0 };
  const buildDistributionRenderRows = () => {
    const d = distribution;
    const state = d.getState?.() || {};
    const settings = state.distributionSettings || {};
    const renderMode = settings.renderMode;
    const modes = d.DISTRIBUTION_RENDER_MODES || {};
    const selectedLayerId = renderMode === modes.INTENSITY ? String(state.selectedDistributionLayerId || (state.selected?.domain === 'distribution' ? state.selected.id : '') || '') : '';
    const visibilityRevision = d.getDistributionVisibilityRevision?.() ?? 0;
    const countryRevision = d.getCountryGeometryRevision?.() ?? 0;
    const cacheCurrent = distributionRenderRowCache.layers === state.distributionLayers
      && distributionRenderRowCache.entries === state.distributionEntries
      && distributionRenderRowCache.countries === state.countriesData?.features
      && distributionRenderRowCache.countryGeometryRevision === countryRevision
      && distributionRenderRowCache.territorialUnits === state.territorialUnits
      && distributionRenderRowCache.renderMode === renderMode
      && distributionRenderRowCache.selectedLayerId === selectedLayerId
      && distributionRenderRowCache.visibilityRevision === visibilityRevision;
    if (cacheCurrent) return distributionRenderRowCache.rows;
    const started = globalThis.performance?.now?.() || Date.now();
    const groups = d.DISTRIBUTION_TYPE_GROUPS || {};
    const visibleLayers = (state.distributionLayers || []).filter(layer => {
      const group = groups[layer.type];
      return state.layerVisibility?.[group] !== false && d.isLayerItemVisible?.(group, layer.id);
    });
    const visibleIds = new Set(visibleLayers.map(layer => layer.id));
    const entries = renderMode === modes.INTENSITY
      ? (visibleIds.has(selectedLayerId) ? d.distributionEntriesForLayer?.(state.distributionEntries || [], selectedLayerId) || [] : [])
      : Object.values(d.DISTRIBUTION_TYPES || {}).flatMap(type => {
      const typeLayers = visibleLayers.filter(layer => layer.type === type);
      const typeIds = new Set(typeLayers.map(layer => layer.id));
      return d.dominantDistributionEntries?.(typeLayers, (state.distributionEntries || []).filter(entry => typeIds.has(entry.layerId))) || [];
    });
    const byLayer = new Map(visibleLayers.map(layer => [layer.id, layer]));
    const rows = entries.map(entry => {
      const layer = byLayer.get(entry.layerId);
      const geometry = entry.mode === (d.DISTRIBUTION_MODES || {}).TERRITORIAL
        ? d.territorialRepository?.get?.(entry.territorialUnitId)?.geometry : entry.geometry;
      if (!layer || !geometry) return null;
      return Object.freeze({ id: entry.id, layer, entry, geometry, bounds: d.geometryBounds?.(geometry), type: 'Feature' });
    }).filter(Boolean);
    distributionRenderRowCache = { layers: state.distributionLayers, entries: state.distributionEntries, countries: state.countriesData?.features,
      countryGeometryRevision: countryRevision, territorialUnits: state.territorialUnits, renderMode, selectedLayerId, visibilityRevision,
      rows: Object.freeze(rows), rebuildCount: distributionRenderRowCache.rebuildCount + 1, buildMs: (globalThis.performance?.now?.() || Date.now()) - started };
    return distributionRenderRowCache.rows;
  };
  const visibleDistributionRenderRows = () => {
    const d = distribution;
    const rows = buildDistributionRenderRows();
    const candidates = new Set((d.visibleMapObjectCandidates?.(['distribution']) || []).map(record => String(record.id)));
    const started = globalThis.performance?.now?.() || Date.now();
    let verificationCount = 0;
    const visible = rows.filter(row => {
      const selected = d.selectionHas?.(d.normalizeObjectRef?.({ domain: 'distribution', type: row.layer.type, id: row.layer.id }));
      if (selected) return true;
      if (!candidates.has(String(row.id))) return false;
      verificationCount += 1;
      return d.geometryMayIntersectViewport?.(row.geometry);
    });
    if (d.viewportCullingMetrics) {
      d.viewportCullingMetrics.finalVisibleCount = visible.length;
      if (d.viewportCullingMetrics.lastByDomain?.distribution) d.viewportCullingMetrics.lastByDomain.distribution.finalVisibleCount = visible.length;
      d.viewportCullingMetrics.projectedVerificationCount = (d.viewportCullingMetrics.projectedVerificationCount || 0) + verificationCount;
      d.viewportCullingMetrics.projectedVerificationMs = (d.viewportCullingMetrics.projectedVerificationMs || 0) + ((globalThis.performance?.now?.() || Date.now()) - started);
    }
    return visible;
  };
  const renderDistributions = () => {
    active();
    const d = distribution;
    const state = d.getState?.() || {};
    if (!d.distributionLayer) return false;
    const data = visibleDistributionRenderRows();
    const boundaryVisible = state.distributionSettings?.boundaryVisible !== false;
    const groups = d.DISTRIBUTION_TYPE_GROUPS || {};
    const isArea = row => ['Polygon', 'MultiPolygon'].includes(row.geometry?.type);
    const color = row => d.distributionColor?.(row.layer);
    const styleFor = row => d.layerStyle?.(state.layerPresentation, groups[row.layer.type]) || {};
    const selection = d.distributionLayer.selectAll('path.distribution-shape').data(data, row => row.id);
    selection.enter().append('path').attr('class', 'distribution-shape')
      .on('mouseenter.hover', row => d.setMapHover?.('distribution', row.id, d.featureFromGeometry?.(row.geometry), { domain: 'distribution', type: row.layer.type, id: row.layer.id }))
      .on('mouseleave.hover', row => d.setMapHover?.('', '', null, { domain: 'distribution', type: row.layer.type, id: row.layer.id }))
      .on('click', function(row) {
        const stateNow = d.getState?.() || {};
        if (d.mapClickBlocked?.() || stateNow.tool !== 'select' || stateNow.labelPlacementMode) return;
        d.d3?.event?.stopPropagation?.();
        d.handleObjectSelectionAt?.(d.d3?.mouse?.(d.svg), { sourceEvent: d.d3?.event, hitRef: { domain: 'distribution', type: row.layer.type, id: row.layer.id } });
      });
    selection.attr('d', row => d.path?.({ type: 'Feature', properties: {}, geometry: row.geometry }))
      .attr('data-gpu-scene-key', row => `distribution-entry:${row.id}:${isArea(row) ? 'fill' : 'line'}`)
      .style('fill', 'transparent').style('stroke', 'transparent')
      .style('fill-opacity', 0)
      .style('stroke-opacity', 0)
      .style('stroke-width', 0)
      .style('mix-blend-mode', 'normal')
      .attr('data-presentation-group', row => groups[row.layer.type]);
    selection.exit().remove();
    d.distributionLayer.selectAll('path.distribution-boundary').remove();
    const polygons = [], strokes = [];
    for (const row of data) {
      const group = groups[row.layer.type];
      const renderStyle = styleFor(row);
      const objectKey = d.normalizeObjectRef?.({ domain: 'distribution', type: row.layer.type, id: row.layer.id })?.key || `distribution:${row.layer.type}:${row.layer.id}`;
      const feature = d.featureFromGeometry?.(row.geometry);
      const geometryRevision = d.selectionGeometryRevision?.(`distribution-entry:${row.id}`, 'gpu-scene', feature);
      const fillAlpha = (0.12 + Math.max(0, Math.min(100, row.entry.share)) / 100 * 0.58) * renderStyle.opacity;
      if (isArea(row)) {
        polygons.push({ key: `distribution-entry:${row.id}:fill`, objectKey, geometryRevision, geometry: row.geometry, order: d.gpuSceneOrder?.(group, 10), blendMode: renderStyle.blendMode, style: { color: color(row), fillAlpha, blendMode: renderStyle.blendMode } });
        if (boundaryVisible && renderStyle.boundaryVisible) strokes.push({ key: `distribution-entry:${row.id}:boundary`, objectKey, geometryRevision, geometry: (d.buildRenderableStrokeFeature?.(feature) || feature).geometry, order: d.gpuSceneOrder?.(group, 20), blendMode: renderStyle.blendMode, style: { color: color(row), alpha: renderStyle.opacity, width: renderStyle.boundaryWidth, cap: 'round', join: 'round', blendMode: renderStyle.blendMode, antiAlias: false } });
      } else if (['LineString', 'MultiLineString'].includes(row.geometry?.type) && boundaryVisible) strokes.push({ key: `distribution-entry:${row.id}:line`, objectKey, geometryRevision, geometry: row.geometry, order: d.gpuSceneOrder?.(group, 15), blendMode: renderStyle.blendMode, style: { color: color(row), alpha: renderStyle.opacity, width: renderStyle.boundaryWidth, cap: 'round', join: 'round', blendMode: renderStyle.blendMode, antiAlias: false } });
    }
    d.replaceGpuSceneDomain?.('distributions', { polygons, strokes });
    return true;
  };
  let pendingTerritorialBoundary = null;
  const pendingHighlights = new Map();
  let territorialBoundaryCache = { countries: null, units: null, revision: -1, inputSignature: '', segments: [], rebuildCount: 0 };
  let territorialBoundaryBatchCache = { signature: '', revision: '', groups: [] };
  const renderTerritorialInternalBoundaries = (visibleFeatures = []) => {
    active();
    const t = territorialBoundary;
    const state = t.getState?.() || {};
    const countries = state.countriesData?.features || [];
    const units = state.territorialUnits || [];
    const revision = t.getTerritorialGeometryRevision?.() ?? 0;
    if (!units.some(feature => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type))) {
      const hadBoundaries = territorialBoundaryCache.segments.length || territorialBoundaryBatchCache.groups.length;
      territorialBoundaryCache = { countries: null, units: null, revision: -1, inputSignature: '', segments: [], rebuildCount: territorialBoundaryCache.rebuildCount };
      territorialBoundaryBatchCache = { signature: '', revision: '', groups: [] };
      t.territorialBoundaryLayer?.selectAll('path.territorial-internal-boundary').remove();
      if (hadBoundaries) t.replaceGpuSceneDomain?.('territorial-boundaries', { strokes: [] });
      return true;
    }
    const inputSignature = JSON.stringify([
      t.getCountryLandRevision?.() ?? 0,
      revision,
      countries.map(feature => [String(feature?.id || ''), t.geometryToken?.(feature?.geometry)]),
      units.map(feature => [String(feature?.id || ''), t.geometryToken?.(feature?.geometry), String(feature?.properties?.unitType || ''), String(feature?.properties?.sovereignId || ''), String(feature?.properties?.parentId || '')]),
    ]);
    if (territorialBoundaryCache.countries !== countries || territorialBoundaryCache.units !== units
      || territorialBoundaryCache.revision !== revision || territorialBoundaryCache.inputSignature !== inputSignature) {
      if (prepareEditDisplay && pendingTerritorialBoundary !== inputSignature) {
        pendingTerritorialBoundary = inputSignature;
        prepareEditDisplay({ kind: 'boundaries' }, { jobKey: 'edit-display:boundaries' }).then(response => {
          if (disposed || pendingTerritorialBoundary !== inputSignature) return;
          territorialBoundaryCache = { countries, units, revision, inputSignature,
            segments: response.result.segments, rebuildCount: territorialBoundaryCache.rebuildCount + 1 };
          pendingTerritorialBoundary = null;
          onEditDisplayReady();
        }).catch(() => { if (pendingTerritorialBoundary === inputSignature) pendingTerritorialBoundary = null; });
      }
      // Never draw a boundary belonging to an older geometry while preparing.
      if (territorialBoundaryCache.segments.length) {
        territorialBoundaryCache = { ...territorialBoundaryCache, segments: [], rebuildCount: territorialBoundaryCache.rebuildCount + 1 };
      }
    }
    const visibleIds = new Set(visibleFeatures.map(feature => String(feature.id)));
    const styleByType = new Map([
      ['subunit', { presentationGroup: 'subunits', width: 2, dash: [0, 0] }],
      ['subunit-internal', { presentationGroup: 'subunits', width: 1.1, dash: [3, 2] }],
      ['region', { presentationGroup: 'regions', width: 1.5, dash: [7, 3] }],
    ]);
    const visibleSignature = [...visibleIds].sort().map(id => {
      const feature = visibleFeatures.find(item => String(item.id) === id);
      return `${id}:${t.territorialUnitColor?.(feature)}:${JSON.stringify(t.layerStyle?.(state.layerPresentation, t.presentationGroupForTerritorialFeature?.(feature), `territorial:${feature.properties.unitType}:${id}`))}`;
    }).join('|');
    const styleSignature = [...styleByType].map(([type, definition]) => {
      const style = t.layerStyle?.(state.layerPresentation, definition.presentationGroup) || {};
      return `${type}:${style.opacity}:${style.boundaryVisible}`;
    }).join('|');
    const boundaryColor = t.mapTheme?.().border || '#ffffff';
    const signature = `${territorialBoundaryCache.rebuildCount};${visibleSignature};${styleSignature};${boundaryColor}`;
    if (territorialBoundaryBatchCache.signature !== signature) {
      const groups = new Map([...styleByType].map(([styleType, definition]) => [styleType, { key: styleType, styleType, width: definition.width, dash: definition.dash, segments: [] }]));
      for (const segment of territorialBoundaryCache.segments) {
        const owner = (segment.unitOwners || []).find(item => visibleIds.has(String(item.id)));
        if (!owner) continue;
        const feature = visibleFeatures.find(item => String(item.id) === String(owner.id));
        const styleType = segment.styleType || feature?.properties?.unitType || 'subunit';
        const definition = styleByType.get(styleType) || styleByType.get('subunit');
        const group = groups.get(styleType) || groups.get('subunit');
        if (!group) continue;
        const style = t.layerStyle?.(state.layerPresentation, definition.presentationGroup, `territorial:${feature.properties.unitType}:${feature.id}`) || {};
        if (!style.boundaryVisible || !(style.opacity > 0)) continue;
        group.segments.push({ a: segment.a, b: segment.b, color: boundaryColor, opacity: style.opacity });
      }
      territorialBoundaryBatchCache = { signature, revision: `${territorialBoundaryCache.rebuildCount}:${signature}`, groups: [...groups.values()].filter(group => group.segments.length) };
    }
    const fallbackGroups = new Map();
    for (const group of territorialBoundaryBatchCache.groups) for (const segment of group.segments) {
      const key = `${group.styleType}:${segment.color}:${segment.opacity}`;
      if (!fallbackGroups.has(key)) fallbackGroups.set(key, { key, styleType: group.styleType, color: segment.color, opacity: segment.opacity, coordinates: [] });
      fallbackGroups.get(key).coordinates.push([segment.a, segment.b]);
    }
    const data = [...fallbackGroups.values()].map(group => ({ ...group, geometry: { type: 'MultiLineString', coordinates: connectBoundarySegments(group.coordinates) } }));
    // These are scene strokes. A projected SVG copy caused a second visual
    // owner with different cache and transition timing.
    t.territorialBoundaryLayer?.selectAll('path.territorial-internal-boundary').remove();
    t.replaceGpuSceneDomain?.('territorial-boundaries', { strokes: data.map((group, index) => {
      const definition = styleByType.get(group.styleType) || styleByType.get('subunit') || { presentationGroup: 'subunits', width: 1, dash: [] };
      return { key: `territorial-internal:${group.key}`, geometryRevision: territorialBoundaryBatchCache.revision, geometry: group.geometry, order: t.gpuSceneOrder?.(definition.presentationGroup, 30 + index), style: { color: group.color, alpha: group.opacity, width: definition.width, dash: definition.dash, cap: 'round', join: 'round' } };
    }) });
    return true;
  };
  const syncBaseView = (viewState = null) => {
    active();
    const b = base;
    b.updatePandoGlobeShell?.(viewState);
    const renderer = b.gpuMapRenderer?.getRuntimeState?.()?.renderer;
    const gpuOwnsGraticule = renderer === 'webgl2' || renderer === 'webgl1';
    b.graticuleLayer?.attr('display', gpuOwnsGraticule ? 'none' : null);
    if (!gpuOwnsGraticule) {
      const fallbackGeometry = b.graticule?.();
      if (fallbackGeometry && b.graticuleLayer) {
        b.graticuleLayer.datum(fallbackGeometry).attr('d', framePath(viewState, b.path)).attr('data-gpu-scene-key', 'base:graticule');
      }
    }
    return true;
  };
  const renderBase = (viewState = null) => {
    syncBaseView(viewState);
    const b = base;
    const graticuleGeometry = b.graticule?.();
    if (!graticuleGeometry) return false;
    const light = b.isLightTheme?.() ?? true;
    b.replaceGpuSceneDomain?.('base-graticule', { strokes: [{
      key: 'base:graticule', geometryRevision: `${b.getProjection?.() || 'unknown'}:graticule-v2`,
      ...b.buildGraticuleStrokeGeometryPacket?.(graticuleGeometry, { maxEdgeDegrees: 0.5 }),
      lodPolicy: 'exact', protected: true, order: -10000,
      style: { color: light ? '#aaaaaa' : '#688091', alpha: light ? 0.34 : 0.20, width: 0.55, cap: 'butt', join: 'round' },
    }] });
    return true;
  };
  const renderProjectedOverlays = (frameContext = null) => {
    active();
    for (const layer of projected.layers || []) {
      layer?.selectAll?.('path')?.attr('d', framePath(frameContext, projected.path));
    }
    return true;
  };
  const renderBoundaryEdit = (frameContext = null, packet = editingPacket) => {
    active();
    const boundary = packet?.boundaryEdit;
    const view = frameContext?.viewRevision;
    const projection = frameContext?.projectionRevision;
    if (!editingChannelChanged('boundary', editing.boundaryEditLayer, boundary, view, projection, JSON.stringify(editing.getInteractionStyle?.()))) return true;
    const visibleSegments = queryBoundaryDisplay(boundary?.displayIndex?.segments, boundaryViewBounds(frameContext), boundary?.segments || []);
    const data = (editing.getInteractionStyle?.()?.selection?.outlineVisible === false ? ['coast', 'shared'] : []).map(kind => {
      const segments = visibleSegments.filter(segment => (segment.kind === 'coast' ? 'coast' : 'shared') === kind);
      return segments.length ? {
        key: `${boundary?.preparationId || packet?.revision || 0}:${kind}:${view ?? 0}:${projection ?? 0}`,
        kind,
        geometry: { type: 'MultiLineString', coordinates: segments.map(segment => [segment.start, segment.end]) },
      } : null;
    }).filter(Boolean);
    const layer = editing.boundaryEditLayer;
    if (!layer) return false;
    const selection = layer.selectAll('path.boundary-edit-segment').data(data, d => d.key);
    selection.enter().append('path').attr('class', 'boundary-edit-segment');
    selection.exit().remove();
    layer.selectAll('path.boundary-edit-segment')
      .attr('d', d => framePath(frameContext, editing.path)?.({ type: 'Feature', geometry: d.geometry, properties: {} }))
      .attr('data-gpu-scene-key', d => `boundary-edit:${d.key}`)
      .classed('coast', d => d.kind === 'coast')
      .classed('shared', d => d.kind === 'shared')
      .on('click.vertex-add', null);
    editing.replaceGpuSceneDomain?.('boundary-edit', {
      strokes: data.map(item => ({
        key: `boundary-edit:${item.key}`,
        geometryRevision: item.key,
        geometry: item.geometry,
        order: 9800,
        style: {
          ...interactionRoleStyle(editing.getInteractionStyle?.() || resolveMapInteractionStyle(), 'edit-target', { directManipulation: true }),
          dash: item.kind === 'shared' ? [6, 3] : [0, 0],
          cap: 'round', join: 'round',
        },
      })),
    });
    return true;
  };
  const vertexRows = new WeakMap();
  const vertexByKey = new WeakMap();
  let vertexProjectionCache = null;
  let visibleVertexRows = [];
  const thinVisibleCoastHandles = (handles, points, activeKey) => {
    const zoom = editing.currentMapZoom?.() || 1;
    const mobile = editing.isMobile?.() === true;
    const minDistance = Math.max(mobile ? 7 : 4, (mobile ? 18 : 11) / Math.sqrt(Math.max(1, zoom)));
    const occupied = new Map();
    const accepted = [];
    for (const handle of handles) {
      const point = points.get(handle);
      if (!point) continue;
      const gx = Math.floor(point[0] / minDistance), gy = Math.floor(point[1] / minDistance);
      let crowded = false;
      for (let x = gx - 1; x <= gx + 1 && !crowded; x += 1) {
        for (let y = gy - 1; y <= gy + 1; y += 1) {
          const other = occupied.get(`${x}:${y}`);
          if (other && Math.hypot(point[0] - other[0], point[1] - other[1]) < minDistance) { crowded = true; break; }
        }
      }
      if (crowded && !handle.fixed && handle.nodeKey !== activeKey) continue;
      occupied.set(`${gx}:${gy}`, point);
      accepted.push(handle);
    }
    return accepted;
  };
  const renderVertices = (frameContext = null, packet = editingPacket) => {
    active();
    const boundaryHandles = packet?.boundaryEdit?.handles || [];
    const boundaryMode = ['country-border', 'country-coast'].includes(packet?.tool) && boundaryHandles.length > 0;
    const objectPacket = boundaryMode ? {
      mode: packet.tool,
      handles: boundaryHandles,
      targetRef: {
        domain: 'territorial',
        type: 'country',
        id: String(boundaryHandles[0]?.ownerIds?.[0] || ''),
      },
    } : packet?.objectVertices;
    const handles = objectPacket?.handles;
    let rows = handles && vertexRows.get(handles);
    if (!rows) {
      rows = boundaryMode && packet.boundaryEdit.displayIndex ? handles : (handles || []).map(item => ({ ...item, coord: item.coordinate }));
      if (handles) {
        vertexRows.set(handles, rows);
        if (!packet?.boundaryEdit?.displayIndex) vertexByKey.set(handles, new Map(rows.map(row => [row.nodeKey, row])));
      }
    }
    const activeKey = packet?.boundaryActiveNodeKey;
    const activeCoordinate = packet?.boundaryActiveCoordinate;
    const cache = vertexProjectionCache;
    const sameProjection = frameContext && cache && cache.handles === handles && cache.view === frameContext.viewRevision
      && cache.projection === frameContext.projectionRevision && cache.activeKey === activeKey;
    let points, data;
    if (sameProjection) {
      ({ points, data } = cache);
      if (activeKey && (cache.activeCoordinate?.[0] !== activeCoordinate?.[0] || cache.activeCoordinate?.[1] !== activeCoordinate?.[1])) {
        const active = packet?.boundaryEdit?.displayIndex
          ? rows[packet.boundaryEdit.displayIndex.nodeKeys?.[activeKey]] : vertexByKey.get(handles)?.get(activeKey);
        if (active) points.set(active, frameProjectCoordinate(activeCoordinate || active.coord, frameContext, editing.activeProjection?.()));
        cache.activeCoordinate = activeCoordinate;
      }
    }
    else {
      let candidates = boundaryMode
        ? queryBoundaryDisplay(packet.boundaryEdit.displayIndex?.handles, boundaryViewBounds(frameContext), rows) : rows;
      const active = activeKey && (packet?.boundaryEdit?.displayIndex
        ? rows[packet.boundaryEdit.displayIndex.nodeKeys?.[activeKey]] : vertexByKey.get(handles)?.get(activeKey));
      if (active && !candidates.includes(active)) candidates = [...candidates, active];
      candidates = candidates.slice().sort((a, b) => Number(b.nodeKey === activeKey) - Number(a.nodeKey === activeKey) || Number(!!b.fixed) - Number(!!a.fixed));
      points = new Map(candidates.map(row => [row, frameProjectCoordinate(row === active && activeCoordinate ? activeCoordinate : row.coord, frameContext, editing.activeProjection?.())]));
      data = boundaryMode ? thinVisibleCoastHandles(candidates, points, activeKey) : candidates.filter(row => points.get(row));
      vertexProjectionCache = { handles, view: frameContext?.viewRevision, projection: frameContext?.projectionRevision, activeKey, activeCoordinate, points, data };
    }
    const layer = editing.vertexLayer;
    if (!layer) return false;
    const handlesChanged = editingChannelChanged('vertices', layer, packet?.objectVertices, packet?.boundaryEdit, packet?.tool);
    const joinChanged = handlesChanged || data.length !== visibleVertexRows.length || data.some((row, i) => row !== visibleVertexRows[i]);
    let enteredVertices = layer.selectAll('circle.vertex-handle').filter(() => false);
    if (joinChanged) {
      const selection = layer.selectAll('circle.vertex-handle').data(data, d => d.nodeKey || d.key || d.index);
      enteredVertices = selection.enter().append('circle').attr('class', 'vertex-handle draft-interactive');
      selection.exit().remove(); visibleVertexRows = data;
    }
    const allVertices = layer.selectAll('circle.vertex-handle');
    allVertices
      .attr('r', boundaryMode ? (editing.isMobile?.() ? 7.2 : 5.2) : 4.5)
      .classed('country-vertex', boundaryMode)
      .classed('coast-vertex', d => boundaryMode && d.boundaryKind === 'coast')
      .classed('shared-boundary-vertex', d => boundaryMode && d.boundaryKind === 'shared')
      .classed('fixed-boundary-vertex', d => boundaryMode && d.fixed)
      .attr('transform', d => {
        const point = points.get(d);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    const eventVertices = handlesChanged ? allVertices : enteredVertices;
    eventVertices.on('.drag', null);
    const dragKind = boundaryMode ? 'boundary-vertex' : 'object-vertex';
    if (objectPacket?.targetRef) {
      const behavior = editingDragBehavior(dragKind, objectPacket.targetRef);
      if (behavior) {
        if (boundaryMode) eventVertices.filter(d => !d.fixed).call(behavior);
        else eventVertices.call(behavior);
      }
    }
    eventVertices.on('click.vertex-select', null);
    eventVertices.each(function(d) {
      let title = editing.d3?.select(this).select('title');
      if (title?.empty?.()) title = editing.d3.select(this).append('title');
      title?.text?.(boundaryMode
        ? (d.fixed ? '선택 밖 국가와 연결되어 고정된 접경점' : d.boundaryKind === 'shared' ? `${d.ownerIds?.length || 2}개 국가가 공유하는 국경 꼭짓점` : '해안선 꼭짓점')
        : '꼭짓점');
    });
    return true;
  };
  const invalidate = (mask, reason = 'render-invalidation') => {
    active();
    stats.invalidations += 1;
    stats.lastReason = String(reason);
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
    MAP_RENDER_DIRTY.GPU_FRAME | MAP_RENDER_DIRTY.OVERLAY_STYLE | MAP_RENDER_DIRTY.LAYER_TREE,
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
  const beginInteraction = reason => {
    active();
    coordinator?.beginInteraction?.(reason || 'interaction');
  };
  const endInteraction = reason => {
    active();
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
  const beginFrame = (frameContext = null) => {
    active();
    const frameToken = frameContext?.frameId ?? frameContext?.revision ?? null;
    if (frameToken !== null && frameToken === resourceFrameToken) return resourceFrameToken;
    refreshRenderResources?.(frameToken);
    editingPacket = getEditingRenderPacket?.() || EMPTY_EDITING_RENDER_PACKET;
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
  const renderDraftInsertionHandle = (frameContext = null, packet = editingPacket) => {
    active();
    const layer = interaction.draftLayer;
    if (!layer) return false;
    const target = packet?.draft?.insertTarget;
    const data = target?.coordinate
      && packet?.draft?.active
      && !packet?.draft?.dragging ? [target] : [];
    const selection = layer.selectAll('g.draft-insert-handle').data(data, item => item.segmentIndex);
    const enter = selection.enter().append('g').attr('class', 'draft-insert-handle draft-interactive');
    const mobile = interaction.isMobile?.() === true;
    enter.append('circle').attr('class', 'draft-insert-hit').attr('r', mobile ? 18 : 13);
    enter.append('circle').attr('class', 'draft-insert-dot').attr('r', mobile ? 9 : 7);
    enter.append('path').attr('class', 'draft-insert-plus').attr('d', 'M-3.5 0h7M0-3.5v7');
    selection.exit().remove();
    layer.selectAll('g.draft-insert-handle')
      .attr('transform', item => {
        const point = frameProjectCoordinate(item.coordinate, frameContext, interaction.activeProjection?.());
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      })
      .on('click', function() {
        interaction.d3?.event?.preventDefault?.();
        interaction.d3?.event?.stopPropagation?.();
        publishEditingInteraction({ type: 'draft-insert-request' });
      });
    return true;
  };
  const renderGeometryPreview = (frameContext = null, packet = editingPacket) => {
    active();
    const layer = interaction.previewLayer;
    if (!layer) return false;
    if (!editingChannelChanged('preview', layer, packet?.preview, selection.resolvedInteractionStyle?.())) return reprojectEditingLayer(layer, frameContext);
    const session = packet?.preview?.session || packet?.preview;
    const delta = session && !['discarded', 'committed'].includes(session.status) ? session.delta || {} : {};
    const rows = [];
    const path = framePath(frameContext, interaction.path);
    for (const [className, geometry] of [
      ['geometry-preview-remove', delta.removedGeometry],
      ['geometry-preview-add', delta.addedGeometry],
    ]) {
      if (!geometry) continue;
      const feature = interaction.featureFromGeometry?.(geometry);
      if (interaction.hasAreaGeometry?.(feature)) {
        rows.push({ geometry: feature.geometry, className: `${className} geometry-preview-fill` });
      }
      const outline = interaction.buildRenderableStrokeFeature?.(feature);
      if (outline?.geometry?.coordinates?.length) {
        rows.push({ geometry: outline.geometry, className: `${className} geometry-preview-outline` });
      }
    }
    for (const geometry of delta.oldBoundaries || []) {
      const outline = interaction.buildRenderableStrokeFeature?.(interaction.featureFromGeometry?.(geometry));
      if (outline) rows.push({ geometry: outline.geometry, className: 'geometry-preview-old-boundary' });
    }
    for (const geometry of delta.newBoundaries || []) {
      const outline = interaction.buildRenderableStrokeFeature?.(interaction.featureFromGeometry?.(geometry));
      if (outline) rows.push({ geometry: outline.geometry, className: 'geometry-preview-new-boundary' });
    }
    joinEditingNodes(layer, 'path.editing-preview-path', rows, (d, i) => `${d.className}:${i}`)
      .attr('class', d => `editing-preview-path ${d.className}`)
      .attr('d', d => path({ type: 'Feature', geometry: d.geometry, properties: {} }));
    interaction.syncGpuInteractionLayer?.('preview', layer);
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
    const source = feature?.geometry || (key.startsWith('country:') ? state.countriesData?.features?.find(item => String(item.id) === key.slice(8))?.geometry : null);
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
      framePath(frameContext, selection.path)?.(feature),
      96,
    );
  };
  const syncSelectionEmphasis = () => {
    if (!gpuMapRenderer?.setCountryEmphasis) return false;
    const selectionState = selectionDomain?.snapshot?.() || { selection: { items: [], primaryKey: null }, hover: null };
    const state = selection.getState?.() || {};
    const entries = mapInteractionEntries(selectionState, state, { countryType: selection.countryType,
      visible: ref => selection.objectRefVisible?.(ref) !== false });
    const countryEntries = entries.filter(entry => entry.ref.domain === 'territorial' && entry.ref.type === selection.countryType);
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
    const covered = (result?.interactionResult?.previewResults || []).some(value => value.renderedKeys?.includes(packet?.key));
    let node = root.querySelector('.map-direct-preview');
    if (!packet || covered) { node?.remove(); if (!packet) directPreviewGeometry = null; return; }
    const key = `${packet.key}:${packet.geometryRevision}`;
    if (directPreviewGeometry?.key !== key) {
      const coordinates = [];
      for (let i = 0; i < packet.startsEnds.length; i += 4) coordinates.push([[packet.startsEnds[i], packet.startsEnds[i + 1]], [packet.startsEnds[i + 2], packet.startsEnds[i + 3]]]);
      directPreviewGeometry = { key, feature: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates } } };
    }
    if (!node) { node = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path'); root.appendChild(node); }
    const style = interactionRoleStyle(selection.resolvedInteractionStyle?.() || selection.getInteractionStyle?.(), 'edit-target', { directManipulation: true });
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
      renderDirectEditPreview(frameContext, gpuFrameResult);
      const { result: gpuSelectionResult, reuseView } = selectionFrameOwnership({ gpuFrameResult,
        renderer: gpuMapRenderer?.getRuntimeState?.()?.renderer, lastFillOwner: lastInteractionFillOwner });
      if (reuseView) {
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
        return renderSparseSelectionFallbackView(frameContext);
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
    const emphasisEntries = selectionEntries(selectionState, state, { countryType: selection.countryType,
      visible: ref => selection.objectRefVisible?.(ref) !== false }, toolEntries);
    const genericPrimary = [];
    const genericSecondary = [];
    const genericHover = [];
    const genericCandidate = [];
    const interactionFillRequests = [];
    const fallbackRequests = { hover: [], primary: [], secondary: [], candidate: [] };
    let countryPrimaryId = '';
    const countrySecondaryIds = [];
    let countryHoverId = '';
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
      const roleStyle = entry ? interactionRoleStyle(style, entry.role) : null;
      let ring = this.querySelector('.user-label-interaction');
      if (!(roleStyle?.width > 0)) { ring?.remove(); return; }
      if (!ring) { ring = this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle'); this.appendChild(ring); }
      for (const [name, value] of Object.entries({ class: 'user-label-interaction', r: 7, fill: 'none', stroke: roleStyle.color,
        'stroke-width': roleStyle.width, 'stroke-opacity': roleStyle.alpha, 'pointer-events': 'none', 'vector-effect': 'non-scaling-stroke' })) ring.setAttribute(name, value);
    });
    const selectionFramePath = framePath(frameContext, selection.path);
    const selectionPassAvailable = !!selectionPass?.isAvailable?.();
    const sceneOwnsFills = rendererOwnsSceneGeometry(gpuMapRenderer?.getRuntimeState?.()?.renderer);
    const hierarchyBoundary = (ref, feature, role) => {
      const boundary = { feature, revision: selectionGeometryRevision(ref.key, 'boundary', feature) };
      const owners = (displayPlan.boundaryOwnersByKey.get(ref.key) || []).map(entry => ({
        key: entry.key, ref: entry.ref, feature: entry.ref.scopeFeature || selection.mapFeatureForObjectRef?.(entry.ref),
      })).filter(item => item.feature?.geometry);
      if (!owners.length) return ref.domain === 'territorial' && ref.type === selection.countryType
        ? boundary : cachedSelectionBoundaryFeature(ref.key, feature, role);
      const signature = owners.map(item => `${item.key}:${selectionGeometryRevision(item.key, 'ownership', item.feature)}`).sort().join(',');
      const revision = `${boundary.revision}:owners:${signature}`;
      const cached = selectionBoundaryGeometryCache.get(revision);
      if (cached) return { feature: cached, revision, owned: true };
      if (prepareEditDisplay && !pendingHighlights.has(revision)) {
        const sourceKey = object => `${object.domain === 'territorial' && object.type === selection.countryType ? 'country' : object.domain}:${object.id}`;
        const pending = prepareEditDisplay({ kind: 'highlight', ...((ref.scopeFeature || ref.domain === 'hydro') ? { feature } : { featureKey: sourceKey(ref) }),
          occluders: owners.map(item => (item.ref.scopeFeature || item.ref.domain === 'hydro') ? { feature: item.feature } : { key: sourceKey(item.ref) }) }, { jobKey: `edit-display:highlight:${ref.key}` });
        pendingHighlights.set(revision, pending);
        pending.then(response => {
          if (disposed || pendingHighlights.get(revision) !== pending) return;
          setLimitedSelectionCache(selectionBoundaryGeometryCache, revision, response.result.feature);
          onEditDisplayReady({ kind: 'highlight' });
        }).catch(error => {
          if (!error?.cancelled) selection.publishMetrics?.({ highlightPreparationError: String(error?.message || error) });
        }).finally(() => pendingHighlights.delete(revision));
      }
      return { feature: { type: 'Feature', properties: {}, geometry: null }, revision: `${revision}:pending`, owned: true };
    };
    if (hoverActive) {
      const isCountry = hovered.domain === 'territorial' && hovered.type === selection.countryType;
      const feature = isCountry ? selection.countryDisplayFeature?.(hoveredFeature) : hoveredFeature;
      const key = isCountry ? `country:${String(hovered.id || '')}` : hovered.key;
      const pendingCountry = isCountry && state.pendingCountryRenderIds?.has(String(hovered.id || ''));
      const boundary = selectionGeometryKinds(feature).boundary
        ? hierarchyBoundary(hovered, feature, 'hover')
        : { feature, revision: selectionGeometryRevision(key, 'hover', feature) };
      const plan = planHoverEntry({ ref: hovered, countryType: selection.countryType, feature, boundary, pendingCountry, hoverStyle: style.hover });
      if (plan.fill && !sceneOwnsFills) {
        stagedHoverLayer.append('path').datum(feature)
          .attr('class', 'map-hover-shape map-hover-fill')
          .attr('data-object-key', hovered.key || '')
          .attr('fill', plan.fill.color)
          .attr('fill-opacity', plan.fill.fillAlpha)
          .attr('d', selectionFramePath);
      }
      fallbackRequests.hover.push(plan.fallback.kind === 'country'
        ? { key, resolveFeature: () => selection.countryOutlineFeature?.(feature), cacheKey: selectionGeometryRevision(key, 'hover-country') }
        : plan.fallback);
      if (plan.generic) genericHover.push(plan.generic);
      if (plan.countryId !== null) countryHoverId = plan.countryId;
      if (plan.fillRequest) interactionFillRequests.push(plan.fillRequest);
    }
    for (const { entry, channel, outlineVisible } of displayPlan.items) {
      const ref = entry.ref;
      const primary = channel === 'primary';
      const canonicalFeature = ref.scopeFeature || selection.mapFeatureForObjectRef?.(ref);
      const isCountry = ref.domain === 'territorial' && ref.type === selection.countryType;
      const feature = isCountry ? selection.countryDisplayFeature?.(canonicalFeature) : canonicalFeature;
      if (!feature?.geometry && feature?.type !== 'FeatureCollection') continue;
      const boundary = (isCountry || selectionGeometryKinds(feature).boundary) && outlineVisible
        ? hierarchyBoundary(ref, feature, 'selection-outline')
        : { feature, revision: selectionGeometryRevision(ref.key, 'selection-outline', feature) };
      const plan = planSelectionEntry({ ref, entry, channel, countryType: selection.countryType, feature, boundary,
        pendingCountry: state.pendingCountryRenderIds?.has(String(ref.id)), outlineVisible, selectionStyle });
      if (plan.fill && !sceneOwnsFills) stagedSelectionLayer.append('path').datum(feature)
        .attr('class', `map-selection-shape map-selection-fill${primary ? ' is-primary' : ' is-secondary'}`)
        .attr('data-object-key', ref.key).attr('fill', plan.fill.color).attr('fill-opacity', plan.fill.fillAlpha)
        .attr('stroke', 'none').attr('d', selectionFramePath);
      if (plan.fillRequest) interactionFillRequests.push(plan.fillRequest);
      if (plan.generic) ({ candidate: genericCandidate, hover: genericHover, primary: genericPrimary, secondary: genericSecondary })[channel].push(plan.generic);
      if (plan.fallback) fallbackRequests[channel].push(plan.fallback.kind === 'country'
        ? { key: plan.fallback.key, resolveFeature: () => selection.countryOutlineFeature?.(feature), cacheKey: selectionGeometryRevision(plan.fallback.key, 'country-outline') }
        : plan.fallback);
      if (plan.countryId !== null) {
        if (primary) countryPrimaryId = plan.countryId;
        else countrySecondaryIds.push(plan.countryId);
      }
    }
    let gpuSelectionStats = null;
    let gpuRenderResult = null;
    let directFrameResult = gpuFrameResult;
    let gpuFillResult = null;
    let fillOwner = gpuFrameResult?.interactionResult?.fillOwner || 'svg';
    let fillResourcesByObject = new Map();
    if (selectionPass) {
      if (updateData) {
        const countryBoundarySnapshot = gpuMapRenderer?.getCountryInteractionBoundaryData?.() || null;
        selectionPass.setCountryBoundaryResources?.(countryBoundarySnapshot);
        selectionOverlayStage = 'selection-buffer-build';
        const packet = selectionDomain?.createPacket?.({
          geometryRevision: countryBoundarySnapshot?.revision || selection.getCountryLandRevision?.() || 0,
          styleRevision: JSON.stringify(style),
          countryBoundaryRevision: countryBoundarySnapshot?.revision || '',
          territorialBoundaryRevision: selection.getTerritorialBoundaryRevision?.() || '',
          country: { hoverId: countryHoverId, primaryId: countryPrimaryId, secondaryIds: countrySecondaryIds },
          generic: { hover: genericHover, primary: genericPrimary, secondary: genericSecondary, candidate: genericCandidate },
          style,
        });
        selection.setCurrentSelectionPacket?.(packet);
        selectionPass.updateData?.(packet);
      }
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
    }
    if (!gpuSelectionStats) gpuSelectionStats = selectionPass?.stats?.() || null;
    const { renderedKeys, gpuFilledObjectKeys } = selectionCoverage(gpuRenderResult, gpuFillResult, fillResourcesByObject);
    stagedSelectionLayer.selectAll('.map-selection-fill[data-object-key]').filter(function() {
      return gpuFilledObjectKeys.has(this.getAttribute('data-object-key') || '');
    }).remove();
    stagedHoverLayer.selectAll('.map-hover-fill[data-object-key]').filter(function() {
      return gpuFilledObjectKeys.has(this.getAttribute('data-object-key') || '');
    }).remove();
    lastInteractionFillOwner = fillOwner;
    if (fillOwner === 'svg' && !sceneOwnsFills) {
      for (const entry of emphasisEntries) {
        if (entry.ref.domain !== 'territorial' || entry.ref.type !== selection.countryType) continue;
        const itemStyle = interactionRoleStyle(style, entry.role);
        if (!(itemStyle.fillAlpha > 0) || (entry.role === 'hover' && !hoverActive)) continue;
        const feature = selection.countryDisplayFeature?.(selection.mapFeatureForObjectRef?.(entry.ref));
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
      const guideStyle = interactionRoleStyle(style, channel);
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
        const itemStyle = primary ? selectionStyle.primary : selectionStyle.secondary;
        const priorityClass = primary ? ' is-primary' : ' is-secondary';
        for (const request of fallbackRequests[channel]) {
          if (renderedKeys[channel].has(request.key)) continue;
          const fallbackFeature = request.feature || request.resolveFeature?.();
          const d = cachedSelectionPath(request.cacheKey || request.key, fallbackFeature, frameContext);
          if (!d) continue;
          stagedSelectionLayer.append('path').datum(fallbackFeature).attr('class', `map-selection-shape map-selection-casing${priorityClass}`)
            .attr('data-selection-fallback-key', request.key).attr('data-selection-channel', channel)
            .attr('fill', 'none').attr('stroke', selectionStyle.casingColor).attr('stroke-width', itemStyle?.outerWidth)
            .attr('stroke-opacity', itemStyle?.casingAlpha).attr('d', d);
          stagedSelectionLayer.append('path').datum(fallbackFeature).attr('class', `map-selection-shape map-selection-outline${priorityClass}`)
            .attr('data-selection-fallback-key', request.key).attr('data-selection-channel', channel)
            .attr('fill', 'none').attr('stroke', selectionStyle.color).attr('stroke-width', itemStyle?.innerWidth)
            .attr('stroke-opacity', itemStyle?.innerAlpha).attr('d', d);
          pathCount += 2; pathCharacterCount += d.length * 2; svgFallbackKeys.push(request.key); boundarySegmentCount += countFallbackSegments(fallbackFeature);
        }
      }
    }
    for (const selector of ['.map-selection-casing.is-secondary', '.map-selection-casing.is-primary', '.map-selection-outline.is-secondary', '.map-selection-outline.is-primary']) {
      stagedSelectionLayer.selectAll(selector).each(function() { this.parentNode?.appendChild(this); });
    }
    applySvgCasingMask(selectionStageNode);
    const fallbackPathMs = performance.now() - fallbackStartedAt;
    selectionOverlayStage = 'selection-frame-commit';
    selectionTarget?.replaceChildren(...selectionStageNode.childNodes);
    hoverTarget?.replaceChildren(...hoverStageNode.childNodes);
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
  const renderValidation = (frameContext = null, packet = editingPacket) => {
    active();
    const layer = interaction.validationLayer;
    if (!layer) return false;
    const audit = interaction.getValidationPacket?.() || {};
    if (!editingChannelChanged('validation', layer, packet?.validationIssues, audit.issues, audit.selectedIssueId)) return reprojectEditingLayer(layer, frameContext);
    const rows = [];
    const markers = [];
    const path = framePath(frameContext, interaction.path);
    const issues = packet?.validationIssues?.length ? packet.validationIssues : audit.issues || [];
    for (const issue of issues) {
      const className = geometryPreviewIssueClass(issue.kind);
      if (issue.geometry) {
        const feature = interaction.featureFromGeometry?.(issue.geometry);
        const selectedClass = audit.selectedIssueId === issue.id ? ' selected' : '';
        if (interaction.hasAreaGeometry?.(feature)) {
          rows.push({ key: `${issue.id}:fill:${rows.length}`, geometry: feature.geometry, className: `map-validation-issue map-validation-fill ${className}${selectedClass}` });
        }
        const outline = interaction.buildRenderableStrokeFeature?.(feature);
        if (outline?.geometry?.coordinates?.length) {
          rows.push({ key: `${issue.id}:outline:${rows.length}`, geometry: outline.geometry, className: `map-validation-issue map-validation-outline ${className}${selectedClass}` });
        }
      }
      const coordinate = interaction.issueCoordinate?.(issue);
      if (coordinate) markers.push({ key: issue.id || markers.length, coordinate, className, radius: audit.selectedIssueId === issue.id ? 8 : 6, message: issue.message });
    }
    joinEditingNodes(layer, 'path.editing-validation-path', rows, d => d.key).attr('class', d => `editing-validation-path ${d.className}`)
      .attr('d', d => path({ type: 'Feature', properties: {}, geometry: d.geometry }));
    joinEditingNodes(layer, 'circle.map-validation-marker', markers, d => d.key).attr('class', d => `map-validation-marker ${d.className}`).attr('r', d => d.radius)
      .each(function(d) { const node = interaction.d3.select(this); if (node.select('title').empty()) node.append('title'); node.select('title').text(d.message || '지도 오류'); });
    return reprojectEditingLayer(layer, frameContext);
  };
  const renderSnap = (frameContext = null, packet = editingPacket) => {
    active();
    const layer = interaction.snapLayer;
    if (!layer) return false;
    const indicator = packet?.snap;
    if (editingChannelChanged('snap', layer, indicator)) {
      joinEditingNodes(layer, 'path.snap-indicator-segment', indicator?.segmentEndpoints?.length === 2 ? [{ geometry: { type: 'LineString', coordinates: indicator.segmentEndpoints } }] : [], () => 'segment');
      joinEditingNodes(layer, 'path.snap-indicator-cross', indicator?.kind === 'intersection' ? [indicator] : [], () => 'cross');
      joinEditingNodes(layer, 'circle.snap-indicator-point', indicator?.coordinate ? [indicator] : [], () => 'point').attr('r', 6);
    }
    return reprojectEditingLayer(layer, frameContext);
  };
  const renderGpuInteraction = (viewState = null) => {
    active();
    const result = gpuMapRenderer?.renderInteraction?.(viewState) || null;
    interaction.applyGpuInteractionCoverage?.(result);
    return result;
  };
  const resetTerritorialBoundaryCache = () => {
    pendingTerritorialBoundary = null;
    pendingHighlights.clear();
    territorialBoundaryCache = {
      countries: null,
      units: null,
      revision: -1,
      inputSignature: '',
      segments: [],
      rebuildCount: 0,
    };
    territorialBoundaryBatchCache = { signature: '', revision: '', groups: [] };
  };
  const getTerritorialBoundaryStats = () => Object.freeze({
    rebuildCount: territorialBoundaryCache.rebuildCount,
    revision: territorialBoundaryBatchCache.revision || '',
    inputSignature: territorialBoundaryCache.inputSignature || '',
    batchSignature: territorialBoundaryBatchCache.signature || '',
    segmentCount: territorialBoundaryCache.segments.length,
    groupCount: territorialBoundaryBatchCache.groups.length,
  });
  const resetProjectGeneration = (generation, { preserveBuiltinMesh = false } = {}) => {
    active();
    resetTerritorialBoundaryCache();
    gpuMapRenderer?.resetProjectRenderState?.({ generation, preserveBuiltinMesh });
    return generation;
  };
  const getStats = () => Object.freeze({
    uploads: uploadScheduler.getStats(),
    ...stats,
    ...(coordinator?.getStats?.() || {}),
    projectGeneration: projectDomain?.getGeneration?.() || 0,
    territorialBoundaryTopologyRebuildCount: territorialBoundaryCache.rebuildCount,
    territorialBoundaryRevision: territorialBoundaryBatchCache.revision || '',
    hasMapHost: typeof mapHost === 'function' ? !!mapHost() : !!mapHost,
    hasDomLayers: !!domLayers,
    hasSceneBuilder: !!sceneBuilder,
    hasSelectionDomain: !!selectionDomain,
    hasEditingDomain: typeof getEditingRenderPacket === 'function',
  });
  const dispose = () => {
    uploadListeners.forEach(remove => remove());
    gpuMapRenderer?.dispose?.();
    uploadScheduler.dispose();
    pendingVisualFrames.clear();
    gpuMapRenderer?.setFramePresentationListener?.(null);
    disposed = true;
  };
  const renderDraft = (frameContext = null, packet = editingPacket) => {
    active();
    const layer = interaction.draftLayer;
    if (!layer) return false;
    const draft = packet?.draft || EMPTY_EDITING_RENDER_PACKET.draft;
    const operation = packet?.territoryOperation;
    if (!editingChannelChanged('draft', layer, draft, operation, packet.tool, selection.resolvedInteractionStyle?.())) return reprojectEditingLayer(layer, frameContext);
    const path = framePath(frameContext, interaction.path);
    const { d3, isMobile, formatTerritoryArea } = interaction;
    const stop = () => { d3?.event?.preventDefault?.(); d3?.event?.stopPropagation?.(); };
    const components = (operation?.components || []).map(item => ({ ...item, geometry: item.geometry }));
    const componentPaths = joinEditingNodes(layer, 'path.territory-component', components, d => d.key)
      .attr('class', d => `territory-component${d.usesRiverBoundary ? ' river-partition' : ''} ${d.selected ? 'selected-component' : 'available'}${d.hovered && !d.selected ? ' hovered-component' : ''}`)
      .on('mouseenter', d => publishEditingInteraction({ type: 'territory-component-hover', componentKey: d.key }))
      .on('mouseleave', d => publishEditingInteraction({ type: 'territory-component-leave', componentKey: d.key }))
      .on('click', d => { stop(); publishEditingInteraction({ type: 'territory-component-toggle', componentKey: d.key, screenPoint: localEditingPoint() }); });
    componentPaths.each(function(d) { const node = d3.select(this); if (node.select('title').empty()) node.append('title'); node.select('title').text(`${d.countryName} · ${formatTerritoryArea?.(d.areaKm2) || d.areaKm2}`); });
    joinEditingNodes(layer, 'path.territory-candidate', operation?.candidates || [], d => d.index)
      .attr('class', d => `territory-candidate ${d.selected ? 'selected-candidate' : 'alternate-candidate'}`)
      .attr('aria-label', d => `${String.fromCharCode(65 + d.index)} · ${d.selected ? '선택됨' : '선택 안 됨'}`)
      .style('pointer-events', d => d.interactive === false ? 'none' : null)
      .on('click', d => { if (d.interactive === false) return; stop(); publishEditingInteraction({ type: 'territory-candidate-select', candidateIndex: d.index }); });
    const shapes = [
      { key: 'raw', geometry: draft.rawStrokeGeometry, className: 'draft-shape draft-raw-stroke' },
      { key: 'shape', geometry: draft.geometry, className: ['draft-shape', packet.tool === 'annex-territory' ? 'annex-draft' : '', draft.cutStatus ? 'cut-' + draft.cutStatus : draft.issues.length ? 'draft-invalid' : ''].filter(Boolean).join(' ') },
      { key: 'close', geometry: draft.autoCloseSegment ? { type: 'LineString', coordinates: [draft.autoCloseSegment.start, draft.autoCloseSegment.end] } : null, className: 'draft-auto-close-preview' },
    ].filter(d => d.geometry);
    joinEditingNodes(layer, 'path.draft-packet-shape', shapes, d => d.key).attr('class', d => 'draft-packet-shape ' + d.className);
    joinEditingNodes(layer, 'path.draft-split-preview', draft.splitCandidates, d => d.key).attr('class', (_, i) => 'draft-split-preview side-' + (i === 0 ? 'a' : 'b'));
    joinEditingNodes(layer, 'path.draft-segment-hit', draft.segments, d => d.segmentIndex)
      .attr('class', 'draft-segment-hit draft-interactive')
      .on('mousemove', d => { if (!isMobile?.() && !editingPacket.draft.dragging) publishEditingInteraction({ type: 'draft-segment-hover', segmentIndex: d.segmentIndex, screenPoint: localEditingPoint() }); })
      .on('mouseleave', d => publishEditingInteraction({ type: 'draft-segment-leave', segmentIndex: d.segmentIndex }))
      .on('click', d => { stop(); publishEditingInteraction({ type: editingPacket.draft.vertexInsertMode ? 'draft-segment-insert' : 'draft-segment-hover', segmentIndex: d.segmentIndex, screenPoint: localEditingPoint() }); });
    const vertices = joinEditingNodes(layer, 'g.draft-vertex', draft.vertices, d => d.index)
      .attr('class', d => 'draft-vertex draft-interactive' + (d.selected ? ' selected' : ''))
      .on('click', d => { stop(); publishEditingInteraction({ type: 'draft-vertex-select', vertexIndex: d.index }); });
    vertices.each(function() {
      const node = d3.select(this);
      if (node.select('circle').empty()) {
        node.append('circle').attr('class', 'draft-vertex-hit').attr('r', isMobile?.() ? 16 : 10);
        node.append('circle').attr('class', 'draft-vertex-dot').attr('r', isMobile?.() ? 6.5 : 4.5);
        node.append('title');
      }
      node.select('title').text(d => '꼭짓점 ' + (d.index + 1) + ' · 드래그하여 이동');
    });
    const drag = editingDragBehavior('draft-vertex');
    if (drag) vertices.call(drag);
    renderDraftInsertionHandle(frameContext, packet);
    const issues = joinEditingNodes(layer, 'g.draft-issue-marker', draft.issues.filter(d => d.coordinate), (d, i) => d.kind + ':' + (d.vertexIndex ?? d.segmentIndex ?? i));
    issues.each(function(d) {
      const node = d3.select(this);
      if (node.select('circle').empty()) { node.append('circle').attr('r', 7); node.append('path').attr('d', 'M-3.2-3.2 3.2 3.2M3.2-3.2-3.2 3.2'); node.append('title'); }
      node.select('title').text(d.message || '수정이 필요한 위치');
    });
    joinEditingNodes(layer, 'circle.draft-snap-point', draft.snapPoints, d => d.endpoint).attr('class', d => 'draft-snap-point ' + d.endpoint).attr('r', 6);
    const riverSections = [];
    for (const component of operation?.components || []) for (const [i, section] of (component.riverBoundarySegments || []).entries()) {
      if (component.usesRiverBoundary && section.length >= 2) riverSections.push({ key: component.key + ':' + i, selected: component.selected, geometry: { type: 'LineString', coordinates: section } });
    }
    joinEditingNodes(layer, 'path.river-partition-emphasis', riverSections, d => d.key)
      .attr('class', d => 'river-partition-emphasis' + (d.selected ? ' selected' : ''))
      .attr('stroke', interaction.selectionStyle?.color).attr('stroke-width', interaction.selectionStyle?.primaryWidth);
    void path;
    reprojectEditingLayer(layer, frameContext);
    interaction.syncGpuInteractionLayer?.('draft', layer);
    return true;
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
    if (gpuResult?.deferred && !canvasPresented) {
      pendingVisualFrames.set(Number(frame.frameId), frame);
      for (const key of pendingVisualFrames.keys()) {
        if (key < Number(frame.frameId)) pendingVisualFrames.delete(key);
      }
      return false;
    }
    syncBaseView(frame);
    renderProjectedOverlays(frame);
    renderCountries(frame, { presentationOnly: true, gpuResult });
    renderCountryLabelPositions(frame);
    renderUserLabelPositions(frame);
    if (editingPacketHasViewContent(editingPacket)) {
      renderGeometryPreview(frame, editingPacket);
      renderBoundaryEdit(frame, editingPacket);
      renderVertices(frame, editingPacket);
      renderDraft(frame, editingPacket);
      renderSnap(frame, editingPacket);
      renderValidation(frame, editingPacket);
    }
    const roots = typeof domLayers === 'function' ? domLayers() || {} : domLayers || {};
    markVisualRoot(roots.baseSvg, frame);
    markVisualRoot(roots.gpuCanvas, frame);
    markVisualRoot(roots.svg, frame);
    markVisualRoot(roots.interactionSvg, frame);
    markVisualRoot(base.graticuleLayer, frame);
    markVisualRoot(labels.countryLabelLayer, frame);
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
    pendingVisualFrames.delete(Number(frame.frameId));
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
      beginFrame,
      view: (...args) => renderPass('view', ...args),
      base: renderBase,
      countries: renderCountries,
      gpuInteraction: renderGpuInteraction,
      hydro: renderHydro,
      hydroEdits: renderHydroEdits,
      boundaryEdit: renderBoundaryEdit,
      territorialUnits: renderTerritorialUnits,
      distributions: renderDistributions,
      genericFeatures: renderGenericFeatures,
      stackOverlays: (...args) => renderPass('stackOverlays', ...args),
      projectedOverlays: renderProjectedOverlays,
      geometryPreview: frameContext => renderGeometryPreview(frameContext, editingPacket),
      selectionData: (frameContext, packet, options = {}) => renderSelection(frameContext, packet, options),
      selectionStyle: (frameContext, packet, options = {}) => renderSelection(frameContext, packet, { ...options, styleOnly: true }),
      selectionView: (frameContext, gpuFrameResult, options = {}) => renderSelection(
        frameContext,
        null,
        { ...options, viewOnly: true, updateData: false, gpuFrameResult },
      ),
      hover: renderHoverOverlay,
      validation: frameContext => renderValidation(frameContext, editingPacket),
      labelLayout: (...args) => renderPass('labelLayout', ...args),
      countryLabelPositions: renderCountryLabelPositions,
      userLabelPositions: renderUserLabelPositions,
      countryLabels: renderCountryLabels,
      userLabels: renderUserLabels,
      viewPresentation: commitViewAttachedLayers,
      vertices: frameContext => renderVertices(frameContext, editingPacket),
      draft: frameContext => renderDraft(frameContext, editingPacket),
      snapIndicator: frameContext => renderSnap(frameContext, editingPacket),
      debug: (...args) => renderPass('debug', ...args),
      layerTree: (...args) => renderPass('layerTree', ...args),
    },
  });

  return Object.freeze({
    requestRender,
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
    renderValidation,
    renderCountries,
    renderHydro,
    renderTerritorialUnits,
    renderGenericFeatures,
    getDistributionRenderRows: buildDistributionRenderRows,
    resetProjectGeneration,
    getTerritorialBoundaryStats,
    getStats,
    dispose,
  });
}
