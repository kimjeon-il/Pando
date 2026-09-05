import {
  createMapRenderCoordinator,
  MAP_RENDER_DIRTY,
  MAP_RENDER_MASKS,
} from './map-render-coordinator.js';
import { EMPTY_EDITING_RENDER_PACKET } from './editing-render-packet.js';

export function createRenderingDomain({
  context = null,
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
  labelPositionCadence = null,
  renderers = {},
  requestFrame = callback => globalThis.requestAnimationFrame?.(callback) ?? globalThis.setTimeout(callback, 0),
  prepareView = () => null,
  onFrameComplete = null,
  invalidMaskMode = 'throw',
  reportDiagnostic = () => {},
} = {}) {
  let disposed = false;
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
  };
  let resourceFrameToken = null;
  const active = () => { if (disposed) throw new Error('Rendering domain is disposed.'); };
  const labels = labelResources || {};
  const labelCadence = labelPositionCadence || {};
  const requestedLabelCadence = Number(labelCadence.maxHz || 30);
  const labelCadenceHz = Math.max(1, Math.min(30, Number.isFinite(requestedLabelCadence) ? requestedLabelCadence : 30));
  const labelCadenceIntervalMs = 1000 / labelCadenceHz;
  const labelNow = labelCadence.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const requestLabelFrame = labelCadence.requestFrame || (callback => (
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame(callback)
      : globalThis.setTimeout(callback, 0)
  ));
  const cancelLabelFrame = labelCadence.cancelFrame || (handle => {
    if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle);
    else globalThis.clearTimeout(handle);
  });
  const setLabelTimer = labelCadence.setTimer || ((callback, delay) => globalThis.setTimeout(callback, delay));
  const clearLabelTimer = labelCadence.clearTimer || (handle => globalThis.clearTimeout(handle));
  let labelPositionFrame = 0;
  let labelPositionTimer = 0;
  let pendingLabelPositionFrameContext = null;
  let lastLabelPositionCommitAt = Number.NEGATIVE_INFINITY;
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
  const publishEditingInteraction = event => {
    const packet = editingPacket || EMPTY_EDITING_RENDER_PACKET;
    const normalized = Object.freeze({
      ...event,
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
  const projectLabelCoordinate = (coordinate, frameContext = null) => {
    const point = typeof labels.projectVisibleCoordinate === 'function'
      ? labels.projectVisibleCoordinate(coordinate, frameContext)
      : (labels.isCoordVisible?.(coordinate) ? labels.activeProjection?.()(coordinate) : null);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    stats.labelPositionProjectionCount += 1;
    return point;
  };
  const cancelScheduledLabelPositions = () => {
    if (labelPositionFrame) cancelLabelFrame(labelPositionFrame);
    if (labelPositionTimer) clearLabelTimer(labelPositionTimer);
    labelPositionFrame = 0;
    labelPositionTimer = 0;
    pendingLabelPositionFrameContext = null;
  };
  const renderCountryLabels = (layout = null) => {
    active();
    cancelScheduledLabelPositions();
    lastLabelPositionCommitAt = labelNow();
    const state = labelState();
    const layer = labels.countryLabelLayer;
    if (!layer) return false;
    const resolvedLayout = layout || labels.visibleLabelLayout?.();
    const data = resolvedLayout?.countryLabels || [];
    const selection = layer.selectAll('text.country-label').data(data, d => d.id);
    selection.exit().remove();
    selection.enter().append('text')
      .attr('class', 'country-label')
      .attr('dy', '.35em')
      .on('click', function(d) {
        if (labels.mapClickBlocked?.()) return;
        if (state.tool === 'new-country' && state.newCountryPhase === 'sources') {
          labels.d3?.event?.stopPropagation?.();
          labels.toggleNewCountrySource?.(d.id);
          return;
        }
        if (state.tool === 'annex-territory' && state.annexPhase === 'donor') {
          labels.d3?.event?.stopPropagation?.();
          labels.toggleAnnexDonor?.(d.id);
          return;
        }
        if (state.tool === 'merge-country' && state.mergeSourceCountryId) {
          labels.d3?.event?.stopPropagation?.();
          labels.toggleMergeTarget?.(d.id);
          return;
        }
        if (state.tool === 'country-border' && state.boundaryEditPhase === 'selecting') {
          labels.d3?.event?.stopPropagation?.();
          labels.toggleBoundaryEditCountry?.(d.id);
          return;
        }
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        labels.d3?.event?.stopPropagation?.();
        const point = labels.d3?.mouse?.(labels.svg);
        labels.handleObjectSelectionAt?.(point, {
          sourceEvent: labels.d3?.event,
          forcedRef: { domain: 'territorial', type: labels.countryType || 'country', id: d.id },
        });
      });
    const all = layer.selectAll('text.country-label');
    all.text(labels.countryName || (d => d.name || ''))
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
      labels.handleObjectSelectionAt?.(point, { sourceEvent: labels.d3?.event, forcedRef: { domain: 'label', type: d.kind || 'label', id: d.id } });
    });
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
    return true;
  };
  const applyCountryLabelPositions = (frameContext = null) => {
    active();
    const state = labelState();
    labels.countryLabelLayer?.selectAll('text.country-label').attr('transform', feature => {
      const settings = labels.automaticLabelSettings?.('country', labels.labelSettings?.(state, 'country', feature.id) || {});
      const anchor = settings?.pinned && settings.manualPosition ? settings.manualPosition : labels.countryLabelAnchors?.()?.get?.(String(feature.id || ''));
      const point = Array.isArray(anchor) && anchor.length >= 2 ? projectLabelCoordinate(anchor, frameContext) : null;
      return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
    });
    return true;
  };
  const applyUserLabelPositions = (frameContext = null) => {
    active();
    const state = labelState();
    labels.labelLayer?.selectAll('g.user-label').attr('transform', label => {
      const settings = labels.automaticLabelSettings?.(label.kind, labels.labelSettings?.(state, 'label', label.id) || {});
      const coordinate = settings?.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      const point = projectLabelCoordinate(coordinate, frameContext);
      return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
    });
    return true;
  };
  const commitLabelPositions = () => {
    labelPositionFrame = 0;
    const frameContext = pendingLabelPositionFrameContext;
    pendingLabelPositionFrameContext = null;
    const elapsed = labelNow() - lastLabelPositionCommitAt;
    if (elapsed + 0.01 < labelCadenceIntervalMs) {
      labelPositionTimer = setLabelTimer(() => {
        labelPositionTimer = 0;
        labelPositionFrame = requestLabelFrame(commitLabelPositions);
      }, Math.max(0, labelCadenceIntervalMs - elapsed));
      pendingLabelPositionFrameContext = frameContext;
      return;
    }
    lastLabelPositionCommitAt = labelNow();
    applyCountryLabelPositions(frameContext);
    applyUserLabelPositions(frameContext);
    stats.labelPositionCommitCount += 1;
    stats.labelPositionLastFrameRevision = Number(frameContext?.revision || 0);
  };
  const scheduleLabelPositions = (frameContext = null) => {
    active();
    stats.labelPositionRequestCount += 1;
    pendingLabelPositionFrameContext = frameContext || pendingLabelPositionFrameContext;
    if (labelPositionFrame || labelPositionTimer) {
      stats.labelPositionMergedCount += 1;
      return true;
    }
    const elapsed = labelNow() - lastLabelPositionCommitAt;
    if (elapsed + 0.01 >= labelCadenceIntervalMs) {
      labelPositionFrame = requestLabelFrame(commitLabelPositions);
    } else {
      labelPositionTimer = setLabelTimer(() => {
        labelPositionTimer = 0;
        labelPositionFrame = requestLabelFrame(commitLabelPositions);
      }, Math.max(0, labelCadenceIntervalMs - elapsed));
    }
    return true;
  };
  const renderCountryLabelPositions = frameContext => scheduleLabelPositions(frameContext);
  const renderUserLabelPositions = frameContext => scheduleLabelPositions(frameContext);
  const renderCountries = (viewStateOrRevision = null) => {
    active();
    const state = countries.getState?.() || {};
    const revision = typeof viewStateOrRevision === 'number' && Number.isFinite(viewStateOrRevision)
      ? Number(viewStateOrRevision)
      : Number(viewStateOrRevision?.revision || countries.getViewRevision?.() || 0);
    const renderViewState = viewStateOrRevision && typeof viewStateOrRevision === 'object' ? viewStateOrRevision : null;
    countries.renderPendingCountryOverlays?.();
    const highlighted = state.layerVisibility?.countries && state.countriesData
      ? state.countriesData.features.filter(feature => {
          const id = String(feature.id || '');
          if (!countries.isLayerItemVisible?.('countries', id)) return false;
          return (state.tool === 'country-coast' && state.coastEditCountryId === id)
            || (state.tool === 'country-border' && state.boundaryEditCountryIds?.includes(id))
            || (state.tool === 'annex-territory' && (state.annexTargetCountryId === id || state.annexDonorCountryIds?.includes(id)))
            || (state.tool === 'merge-country' && (state.mergeSourceCountryId === id || state.mergeTargetCountryIds?.includes(id)))
            || (state.tool === 'new-country' && state.newCountrySourceIds?.includes(id));
        })
      : [];
    const fillSelection = countries.countryLayer?.selectAll('path.country-highlight-fill').data(highlighted, feature => feature.id);
    fillSelection?.enter().append('path').attr('class', 'country-highlight-fill');
    const allCountryFills = countries.countryLayer?.selectAll('path.country-highlight-fill');
    allCountryFills?.attr('d', feature => countries.path?.(feature))
      .attr('data-gpu-scene-key', feature => `country-tool-fill:${feature.id}`)
      .classed('border-editing', feature => state.tool === 'country-border' && state.boundaryEditCountryIds?.includes(String(feature.id)))
      .classed('annex-editing', feature => state.tool === 'annex-territory' && state.annexTargetCountryId === feature.id)
      .classed('annex-donor', feature => state.tool === 'annex-territory' && state.annexDonorCountryIds?.includes(String(feature.id)))
      .classed('merge-target', feature => state.tool === 'merge-country' && state.mergeTargetCountryIds?.includes(String(feature.id)))
      .classed('new-country-source', feature => state.tool === 'new-country' && state.newCountrySourceIds?.includes(String(feature.id)));
    fillSelection?.exit().remove();
    const selection = countries.countryLayer?.selectAll('path.country-shape').data(highlighted, feature => feature.id);
    selection?.enter().append('path').attr('class', 'country-shape gpu-country-highlight');
    const allCountries = countries.countryLayer?.selectAll('path.country-shape');
    allCountries?.attr('d', feature => countries.path?.(countries.countryOutlineFeature?.(feature)))
      .attr('data-gpu-scene-key', feature => `country-tool-outline:${feature.id}`)
      .classed('border-editing', feature => state.tool === 'country-border' && state.boundaryEditCountryIds?.includes(String(feature.id)))
      .classed('coast-editing', feature => state.tool === 'country-coast' && state.coastEditCountryId === feature.id)
      .classed('annex-editing', feature => state.tool === 'annex-territory' && state.annexTargetCountryId === feature.id)
      .classed('annex-donor', feature => state.tool === 'annex-territory' && state.annexDonorCountryIds?.includes(String(feature.id)))
      .classed('merge-target', feature => state.tool === 'merge-country' && state.mergeTargetCountryIds?.includes(String(feature.id)))
      .classed('new-country-source', feature => state.tool === 'new-country' && state.newCountrySourceIds?.includes(String(feature.id)));
    selection?.exit().remove();
    const pending = state.layerVisibility?.countries && state.pendingCountryRenderIds?.size
      ? [...state.pendingCountryRenderIds].map(countries.countryFeatureById).filter(Boolean)
      : [];
    const polygons = [];
    const strokes = [];
    for (const feature of pending) {
      const id = String(feature.id || '');
      const geometryRevision = countries.selectionGeometryRevision?.(`country:${id}`, 'pending-country', feature);
      polygons.push({ key: `pending-country-fill:${id}`, geometryRevision, geometry: feature.geometry, order: -300, style: { color: countries.countryColor?.(feature), fillAlpha: countries.mapTheme?.().fillAlpha, blendMode: 'normal' } });
      strokes.push({ key: `pending-country-outline:${id}`, geometryRevision, geometry: countries.countryOutlineFeature?.(feature).geometry, order: -290, style: { color: countries.mapTheme?.().border, alpha: countries.mapTheme?.().borderAlpha, width: 1, cap: 'round' } });
    }
    const highlightStyle = feature => {
      const id = String(feature.id || '');
      if (state.tool === 'annex-territory' && state.annexTargetCountryId === id) return { color: '#68be7e', fillAlpha: 0.16, stroke: '#9ee0a9', width: 2.4 };
      if ((state.tool === 'annex-territory' && state.annexDonorCountryIds?.includes(id)) || (state.tool === 'merge-country' && state.mergeTargetCountryIds?.includes(id))) return { color: '#996fcd', fillAlpha: 0.16, stroke: '#d8b5ff', width: 2.6 };
      if (state.tool === 'new-country' && state.newCountrySourceIds?.includes(id)) return { color: '#e2c982', fillAlpha: 0.14, stroke: '#ffd77d', width: 2.6 };
      return { color: countries.resolvedInteractionStyle?.().selection.color, fillAlpha: 0.18, stroke: countries.mapTheme?.().border, width: 0.72 };
    };
    for (const feature of highlighted) {
      const id = String(feature.id || '');
      const toolStyle = highlightStyle(feature);
      const geometryRevision = countries.selectionGeometryRevision?.(`country:${id}`, 'tool-highlight', feature);
      polygons.push({ key: `country-tool-fill:${id}`, geometryRevision, geometry: feature.geometry, order: 9000, style: { color: toolStyle.color, fillAlpha: toolStyle.fillAlpha, blendMode: 'normal' } });
      strokes.push({ key: `country-tool-outline:${id}`, geometryRevision, geometry: countries.countryOutlineFeature?.(feature).geometry, order: 9010, style: { color: toolStyle.stroke, alpha: 1, width: toolStyle.width, cap: 'round' } });
    }
    const sceneChanged = countries.replaceGpuSceneDomain?.('country-overlays', { polygons, strokes });
    if (sceneChanged !== false) countries.syncGpuRenderScene?.();
    const frameResult = countries.gpuMapRenderer?.render?.(revision, renderViewState);
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
      .on('mouseleave.hover', () => hydro.setMapHover?.('', '', null))
      .on('click', function(feature) {
        const stateNow = hydro.getState?.() || {};
        if (hydro.mapClickBlocked?.() || stateNow.tool !== 'select' || stateNow.labelPlacementMode) return;
        hydro.d3?.event?.stopPropagation?.();
        hydro.handleObjectSelectionAt?.(hydro.d3?.mouse?.(hydro.svg), {
          sourceEvent: hydro.d3?.event,
          forcedRef: { domain: 'hydro', type: feature.properties?.category || 'river', id: feature.id },
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
    const types = t.TERRITORIAL_UNIT_TYPES || {};
    const visibleIds = new Set((t.visibleMapObjectCandidates?.(['territorial']) || []).map(record => String(record.id)));
    const data = (state.territorialUnits || []).filter(feature => {
      const group = feature.properties?.unitType === types.ADMIN ? 'administrative'
        : feature.properties?.unitType === types.REGION ? 'regions' : 'territories';
      const selected = t.selectionHas?.(t.normalizeObjectRef?.({
        domain: 'territorial', type: feature.properties?.unitType || types.TERRITORY, id: feature.id,
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
        domain: 'territorial', type: feature.properties?.unitType || types.TERRITORY, id: feature.id,
      }))
      .on('mouseleave.hover', () => t.setMapHover?.('', '', null))
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
          forcedRef: { domain: 'territorial', type: feature.properties?.unitType || types.TERRITORY, id: feature.id },
        });
      });
    selection?.attr('d', feature => t.path?.(feature))
      .attr('data-gpu-scene-key', feature => {
        const type = feature.properties?.unitType || types.TERRITORY;
        const key = t.normalizeObjectRef?.({ domain: 'territorial', type, id: feature.id })?.key
          || `territorial:${type}:${feature.id}`;
        return `${key}:fill`;
      })
      .classed('is-territory', feature => feature.properties?.unitType === types.TERRITORY)
      .classed('is-administrative', feature => feature.properties?.unitType === types.ADMIN)
      .classed('is-region', feature => feature.properties?.unitType === types.REGION)
      .classed('has-explicit-color', feature => !!t.territorialStyleColor?.(feature))
      .classed('territorial-unit-merge-source', feature => state.territorialUnitMergeSourceId === String(feature.id))
      .classed('territorial-unit-merge-target', feature => (state.territorialUnitMergeTargetIds || []).includes(String(feature.id)))
      .style('color', t.territorialUnitColor)
      .style('fill', t.territorialUnitColor)
      .style('fill-opacity', feature => t.layerStyle?.(state.layerPresentation, t.presentationGroupForTerritorialFeature?.(feature)).opacity)
      .style('stroke', 'none').style('stroke-opacity', 0).style('stroke-width', 0).style('stroke-dasharray', 'none')
      .style('mix-blend-mode', feature => t.layerStyle?.(state.layerPresentation, t.presentationGroupForTerritorialFeature?.(feature)).blendMode)
      .attr('data-presentation-group', t.presentationGroupForTerritorialFeature);
    selection?.exit().remove();
    const operationOutlines = data.filter(feature => state.territorialUnitMergeSourceId === String(feature.id)
      || (state.territorialUnitMergeTargetIds || []).includes(String(feature.id)));
    const outlineSelection = t.territorialOperationLayer?.selectAll('path.territorial-unit-operation-outline')
      .data(operationOutlines, feature => String(feature.id));
    outlineSelection?.enter().append('path').attr('class', 'territorial-unit-operation-outline')
      .style('fill', 'none').style('pointer-events', 'none');
    outlineSelection?.attr('d', feature => t.path?.(t.buildRenderableStrokeFeature?.(feature) || feature))
      .attr('data-gpu-scene-key', feature => {
        const type = feature.properties?.unitType || types.TERRITORY;
        const key = t.normalizeObjectRef?.({ domain: 'territorial', type, id: feature.id })?.key
          || `territorial:${type}:${feature.id}`;
        return `${key}:operation-outline`;
      })
      .style('stroke', feature => state.territorialUnitMergeSourceId === String(feature.id) ? 'var(--accent-2)' : 'var(--accent)')
      .style('stroke-opacity', 1).style('stroke-width', 3).style('stroke-dasharray', 'none');
    outlineSelection?.exit().remove();
    const polygons = [];
    const strokes = [];
    for (const feature of data) {
      const group = t.presentationGroupForTerritorialFeature?.(feature) || 'territories';
      const unitStyle = t.layerStyle?.(state.layerPresentation, group) || {};
      const type = feature.properties?.unitType || types.TERRITORY;
      const objectKey = t.normalizeObjectRef?.({ domain: 'territorial', type, id: feature.id })?.key
        || `territorial:${type}:${feature.id}`;
      const geometryRevision = t.selectionGeometryRevision?.(objectKey, 'gpu-scene', feature);
      polygons.push({ key: `${objectKey}:fill`, objectKey, geometryRevision, geometry: feature.geometry,
        order: t.gpuSceneOrder?.(group, 10), blendMode: unitStyle.blendMode,
        style: { color: t.territorialUnitColor?.(feature), fillAlpha: unitStyle.opacity, blendMode: unitStyle.blendMode } });
      if (state.territorialUnitMergeSourceId === String(feature.id)
        || (state.territorialUnitMergeTargetIds || []).includes(String(feature.id))) {
        strokes.push({ key: `${objectKey}:operation-outline`, objectKey, geometryRevision,
          geometry: (t.buildRenderableStrokeFeature?.(feature) || feature).geometry, order: 9500,
          style: { color: state.territorialUnitMergeSourceId === String(feature.id) ? '#ffd77d' : t.resolvedInteractionStyle?.().selection.color,
            alpha: 1, width: 3, cap: 'round', join: 'round' } });
      }
    }
    t.replaceGpuSceneDomain?.('territorial-units', { polygons, strokes });
    const boundaryFeatures = (state.territorialUnits || []).filter(feature => {
      const group = t.presentationGroupForTerritorialFeature?.(feature) || 'territories';
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
      .on('mouseleave.hover', () => g.setMapHover?.('', '', null))
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
        g.handleObjectSelectionAt?.(g.d3?.mouse?.(g.svg), { sourceEvent: g.d3?.event, forcedRef: { domain: 'generic', type: 'feature', id: d.id } });
      });
    const selectedRef = d => g.normalizeObjectRef?.({ domain: 'generic', type: 'feature', id: d.id });
    selection?.attr('d', g.path)
      .attr('data-gpu-scene-key', d => d.geometry?.type?.includes('Polygon')
        ? `${selectedRef(d)?.key || `generic:feature:${d.id}`}:fill`
        : ['LineString', 'MultiLineString'].includes(d.geometry?.type) ? `${selectedRef(d)?.key || `generic:feature:${d.id}`}:line` : null)
      .classed('selected', d => g.selectionHas?.(selectedRef(d)))
      .classed('selected-point', d => d.geometry?.type === 'Point' && g.selectionHas?.(selectedRef(d)))
      .classed('is-primary-selection', d => selectedRef(d)?.key === g.selectionSnapshot?.()?.primaryKey)
      .classed('is-secondary-selection', d => g.selectionHas?.(selectedRef(d)) && selectedRef(d)?.key !== g.selectionSnapshot?.()?.primaryKey)
      .style('fill', d => d.geometry?.type?.includes('Polygon') ? g.genericFeatureColor?.(d) : 'none')
      .style('fill-opacity', d => d.geometry?.type?.includes('Polygon') ? 0.34 * style.opacity : 0)
      .style('stroke', d => d.geometry?.type?.includes('Polygon') ? 'none' : g.genericFeatureColor?.(d))
      .style('stroke-opacity', d => d.geometry?.type?.includes('Polygon') ? 0 : style.boundaryVisible ? style.opacity : 0)
      .style('stroke-width', d => d.geometry?.type?.includes('Polygon') ? 0 : style.boundaryWidth)
      .style('mix-blend-mode', style.blendMode)
      .attr('data-presentation-group', 'genericFeatures')
      .classed('generic-feature-merge-source', d => state.tool === 'merge-generic-feature' && state.genericFeatureMergeSourceId === String(d.id))
      .classed('generic-feature-merge-target', d => state.tool === 'merge-generic-feature' && (state.genericFeatureMergeTargetIds || []).includes(String(d.id)));
    selection?.exit().remove();
    const polygonSelection = g.genericFeatureLayer?.selectAll('path.generic-feature-boundary').data(
      data.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)), feature => String(feature.id));
    polygonSelection?.enter().append('path').attr('class', 'generic-feature-boundary').style('fill', 'none').style('pointer-events', 'none');
    polygonSelection?.attr('d', feature => g.path?.(g.buildRenderableStrokeFeature?.(feature) || feature))
      .attr('data-gpu-scene-key', feature => `${selectedRef(feature)?.key || `generic:feature:${feature.id}`}:boundary`)
      .style('stroke', g.genericFeatureColor)
      .style('stroke-opacity', style.boundaryVisible ? style.opacity : 0)
      .style('stroke-width', style.boundaryWidth)
      .style('mix-blend-mode', style.blendMode)
      .classed('generic-feature-merge-source', feature => state.tool === 'merge-generic-feature' && state.genericFeatureMergeSourceId === String(feature.id))
      .classed('generic-feature-merge-target', feature => state.tool === 'merge-generic-feature' && (state.genericFeatureMergeTargetIds || []).includes(String(feature.id)));
    polygonSelection?.exit().remove();
    const polygons = [];
    const strokes = [];
    for (const feature of data) {
      const objectKey = selectedRef(feature)?.key || `generic:feature:${feature.id}`;
      const geometryRevision = g.selectionGeometryRevision?.(objectKey, 'gpu-scene', feature);
      const mergeTarget = state.tool === 'merge-generic-feature' && (state.genericFeatureMergeTargetIds || []).includes(String(feature.id));
      const mergeSource = state.tool === 'merge-generic-feature' && state.genericFeatureMergeSourceId === String(feature.id);
      if (['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        polygons.push({ key: `${objectKey}:fill`, objectKey, geometryRevision, geometry: feature.geometry,
          order: g.gpuSceneOrder?.('genericFeatures', 10), blendMode: style.blendMode,
          style: { color: g.genericFeatureColor?.(feature), fillAlpha: (mergeTarget ? 0.48 : 0.34) * style.opacity, blendMode: style.blendMode } });
        if (style.boundaryVisible || mergeSource || mergeTarget) strokes.push({
          key: `${objectKey}:boundary`, objectKey, geometryRevision,
          geometry: (g.buildRenderableStrokeFeature?.(feature) || feature).geometry,
          order: g.gpuSceneOrder?.('genericFeatures', 20), blendMode: style.blendMode,
          style: { color: mergeTarget ? g.resolvedInteractionStyle?.().selection.color : g.genericFeatureColor?.(feature), alpha: style.opacity,
            width: mergeSource || mergeTarget ? 3 : style.boundaryWidth, cap: 'round', join: 'round', blendMode: style.blendMode },
        });
      } else if (['LineString', 'MultiLineString'].includes(feature.geometry?.type) && style.boundaryVisible) strokes.push({
        key: `${objectKey}:line`, objectKey, geometryRevision, geometry: feature.geometry,
        order: g.gpuSceneOrder?.('genericFeatures', 15), blendMode: style.blendMode,
        style: { color: g.genericFeatureColor?.(feature), alpha: style.opacity, width: style.boundaryWidth, cap: 'round', join: 'round', blendMode: style.blendMode },
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
      .on('mouseleave.hover', () => d.setMapHover?.('', '', null))
      .on('click', function(row) {
        const stateNow = d.getState?.() || {};
        if (d.mapClickBlocked?.() || stateNow.tool !== 'select' || stateNow.labelPlacementMode) return;
        d.d3?.event?.stopPropagation?.();
        d.handleObjectSelectionAt?.(d.d3?.mouse?.(d.svg), { sourceEvent: d.d3?.event, forcedRef: { domain: 'distribution', type: row.layer.type, id: row.layer.id } });
      });
    selection.attr('d', row => d.path?.({ type: 'Feature', properties: {}, geometry: row.geometry }))
      .attr('data-gpu-scene-key', row => `distribution-entry:${row.id}:${isArea(row) ? 'fill' : 'line'}`)
      .style('fill', row => color(row)).style('stroke', row => isArea(row) ? 'none' : color(row))
      .style('fill-opacity', row => (0.12 + Math.max(0, Math.min(100, row.entry.share)) / 100 * 0.58) * styleFor(row).opacity)
      .style('stroke-opacity', row => isArea(row) ? 0 : boundaryVisible ? styleFor(row).opacity : 0)
      .style('stroke-width', row => isArea(row) ? 0 : styleFor(row).boundaryWidth)
      .style('mix-blend-mode', row => styleFor(row).blendMode)
      .attr('data-presentation-group', row => groups[row.layer.type]);
    selection.exit().remove();
    const polygonSelection = d.distributionLayer.selectAll('path.distribution-boundary').data(data.filter(isArea), row => row.id);
    polygonSelection.enter().append('path').attr('class', 'distribution-boundary').style('fill', 'none').style('pointer-events', 'none');
    polygonSelection.attr('d', row => d.path?.(d.buildRenderableStrokeFeature?.(d.featureFromGeometry?.(row.geometry)) || d.featureFromGeometry?.(row.geometry)))
      .attr('data-gpu-scene-key', row => `distribution-entry:${row.id}:boundary`).style('stroke', row => color(row))
      .style('stroke-opacity', row => boundaryVisible && styleFor(row).boundaryVisible ? styleFor(row).opacity : 0)
      .style('stroke-width', row => styleFor(row).boundaryWidth).style('mix-blend-mode', row => styleFor(row).blendMode);
    polygonSelection.exit().remove();
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
        if (boundaryVisible && renderStyle.boundaryVisible) strokes.push({ key: `distribution-entry:${row.id}:boundary`, objectKey, geometryRevision, geometry: (d.buildRenderableStrokeFeature?.(feature) || feature).geometry, order: d.gpuSceneOrder?.(group, 20), blendMode: renderStyle.blendMode, style: { color: color(row), alpha: renderStyle.opacity, width: renderStyle.boundaryWidth, cap: 'round', join: 'round', blendMode: renderStyle.blendMode } });
      } else if (['LineString', 'MultiLineString'].includes(row.geometry?.type) && boundaryVisible) strokes.push({ key: `distribution-entry:${row.id}:line`, objectKey, geometryRevision, geometry: row.geometry, order: d.gpuSceneOrder?.(group, 15), blendMode: renderStyle.blendMode, style: { color: color(row), alpha: renderStyle.opacity, width: renderStyle.boundaryWidth, cap: 'round', join: 'round', blendMode: renderStyle.blendMode } });
    }
    d.replaceGpuSceneDomain?.('distributions', { polygons, strokes });
    return true;
  };
  let territorialBoundaryCache = { countries: null, units: null, revision: -1, inputSignature: '', segments: [], rebuildCount: 0 };
  let territorialBoundaryBatchCache = { signature: '', revision: '', groups: [] };
  const renderTerritorialInternalBoundaries = (visibleFeatures = []) => {
    active();
    const t = territorialBoundary;
    const state = t.getState?.() || {};
    const countries = state.countriesData?.features || [];
    const units = state.territorialUnits || [];
    const revision = t.getTerritorialGeometryRevision?.() ?? 0;
    const inputSignature = JSON.stringify([
      t.getCountryLandRevision?.() ?? 0,
      revision,
      countries.map(feature => [String(feature?.id || ''), t.geometryToken?.(feature?.geometry)]),
      units.map(feature => [String(feature?.id || ''), t.geometryToken?.(feature?.geometry), String(feature?.properties?.unitType || ''), String(feature?.properties?.sovereignId || ''), String(feature?.properties?.parentId || '')]),
    ]);
    if (territorialBoundaryCache.countries !== countries || territorialBoundaryCache.units !== units
      || territorialBoundaryCache.revision !== revision || territorialBoundaryCache.inputSignature !== inputSignature) {
      territorialBoundaryCache = { countries, units, revision, inputSignature,
        segments: t.buildTerritorialInternalBoundarySegments?.(countries, units) || [], rebuildCount: territorialBoundaryCache.rebuildCount + 1 };
    }
    const visibleIds = new Set(visibleFeatures.map(feature => String(feature.id)));
    const styleByType = new Map([
      ['territory', { presentationGroup: 'territories', width: 2, dash: [0, 0] }],
      ['administrative', { presentationGroup: 'administrative', width: 1.1, dash: [3, 2] }],
      ['region', { presentationGroup: 'regions', width: 1.5, dash: [7, 3] }],
    ]);
    const visibleSignature = [...visibleIds].sort().map(id => {
      const feature = visibleFeatures.find(item => String(item.id) === id);
      return `${id}:${t.territorialUnitColor?.(feature)}`;
    }).join('|');
    const styleSignature = [...styleByType].map(([type, definition]) => {
      const style = t.layerStyle?.(state.layerPresentation, definition.presentationGroup) || {};
      return `${type}:${style.opacity}:${style.boundaryVisible}`;
    }).join('|');
    const signature = `${territorialBoundaryCache.rebuildCount};${visibleSignature};${styleSignature}`;
    if (territorialBoundaryBatchCache.signature !== signature) {
      const groups = new Map([...styleByType].map(([styleType, definition]) => [styleType, { key: styleType, styleType, width: definition.width, dash: definition.dash, segments: [] }]));
      for (const segment of territorialBoundaryCache.segments) {
        const owner = (segment.unitIds || []).find(id => visibleIds.has(String(id)));
        if (!owner) continue;
        const feature = visibleFeatures.find(item => String(item.id) === String(owner));
        const styleType = feature?.properties?.unitType || 'territory';
        const definition = styleByType.get(styleType) || styleByType.get('territory');
        const group = groups.get(styleType) || groups.get('territory');
        if (!group) continue;
        const style = t.layerStyle?.(state.layerPresentation, definition.presentationGroup) || {};
        if (!style.boundaryVisible || !(style.opacity > 0)) continue;
        group.segments.push({ a: segment.a, b: segment.b, color: t.territorialUnitColor?.(feature) || t.mapTheme?.().border, opacity: style.opacity });
      }
      territorialBoundaryBatchCache = { signature, revision: `${territorialBoundaryCache.rebuildCount}:${signature}`, groups: [...groups.values()].filter(group => group.segments.length) };
    }
    const fallbackGroups = new Map();
    for (const group of territorialBoundaryBatchCache.groups) for (const segment of group.segments) {
      const key = `${group.styleType}:${segment.color}:${segment.opacity}`;
      if (!fallbackGroups.has(key)) fallbackGroups.set(key, { key, styleType: group.styleType, color: segment.color, opacity: segment.opacity, coordinates: [] });
      fallbackGroups.get(key).coordinates.push([segment.a, segment.b]);
    }
    const data = [...fallbackGroups.values()].map(group => ({ ...group, geometry: { type: 'MultiLineString', coordinates: group.coordinates } }));
    const selection = t.territorialBoundaryLayer?.selectAll('path.territorial-internal-boundary').data(data, group => group.key);
    selection?.enter().append('path').attr('class', 'territorial-internal-boundary');
    selection?.attr('class', group => `territorial-internal-boundary territorial-internal-boundary--${group.styleType}`)
      .attr('d', group => t.path?.({ type: 'Feature', properties: {}, geometry: group.geometry }))
      .attr('data-gpu-scene-key', group => `territorial-internal:${group.key}`).style('color', group => group.color).style('stroke', group => group.color).style('stroke-opacity', group => group.opacity);
    selection?.exit().remove();
    t.replaceGpuSceneDomain?.('territorial-boundaries', { strokes: data.map((group, index) => {
      const definition = styleByType.get(group.styleType) || styleByType.get('territory') || { presentationGroup: 'territories', width: 1, dash: [] };
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
        b.graticuleLayer.datum(fallbackGeometry).attr('d', b.path).attr('data-gpu-scene-key', 'base:graticule');
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
  const renderProjectedOverlays = () => {
    active();
    for (const layer of projected.layers || []) layer?.selectAll?.('path')?.attr('d', projected.path);
    return true;
  };
  const renderBoundaryEdit = (frameContext = null, packet = editingPacket) => {
    active();
    const boundary = packet?.boundaryEdit;
    const visibleSegments = (boundary?.segments || []).filter(segment => (
      editing.isCoordVisible?.(segment.start, frameContext) || editing.isCoordVisible?.(segment.end, frameContext)
    ));
    const data = ['coast', 'shared'].map(kind => {
      const segments = visibleSegments.filter(segment => (segment.kind === 'coast' ? 'coast' : 'shared') === kind);
      return segments.length ? {
        key: `${kind}:${packet?.revision || 0}`,
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
      .attr('d', d => editing.path?.({ type: 'Feature', geometry: d.geometry, properties: {} }))
      .attr('data-gpu-scene-key', d => `boundary-edit:${d.key}`)
      .classed('coast', d => d.kind === 'coast')
      .classed('shared', d => d.kind === 'shared')
      .on('click.vertex-add', null);
    editing.replaceGpuSceneDomain?.('boundary-edit', {
      strokes: data.map(item => ({
        key: `boundary-edit:${item.key}`,
        geometryRevision: `${editing.getEditInteractionRevision?.() || 0}:${item.key}`,
        geometry: item.geometry,
        order: 9800,
        style: {
          color: item.kind === 'coast' ? '#72c9ef' : editing.getInteractionStyle?.()?.selection?.color,
          alpha: 1,
          width: 3.4,
          dash: item.kind === 'shared' ? [6, 3] : [0, 0],
          cap: 'round', join: 'round',
        },
      })),
    });
    return true;
  };
  const thinVisibleCoastHandles = handles => {
    const projection = editing.activeProjection?.();
    const zoom = editing.currentMapZoom?.() || 1;
    const mobile = editing.isMobile?.() === true;
    const minDistance = Math.max(mobile ? 7 : 4, (mobile ? 18 : 11) / Math.sqrt(Math.max(1, zoom)));
    const occupied = new Map();
    const accepted = [];
    for (const handle of [...(handles || [])].sort((left, right) => Number(!!right.fixed) - Number(!!left.fixed))) {
      if (!editing.isCoordVisible?.(handle.coord)) continue;
      const point = projection?.(handle.coord);
      if (!point) continue;
      const gx = Math.floor(point[0] / minDistance), gy = Math.floor(point[1] / minDistance);
      let crowded = false;
      for (let x = gx - 1; x <= gx + 1 && !crowded; x += 1) {
        for (let y = gy - 1; y <= gy + 1; y += 1) {
          const other = occupied.get(`${x}:${y}`);
          if (other && Math.hypot(point[0] - other[0], point[1] - other[1]) < minDistance) { crowded = true; break; }
        }
      }
      if (crowded) continue;
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
    let data = (objectPacket?.handles || []).map(item => ({ ...item, coord: item.coordinate }));
    if (boundaryMode) data = thinVisibleCoastHandles(data);
    else data = data.filter(vertex => editing.isCoordVisible?.(vertex.coord, frameContext));
    const layer = editing.vertexLayer;
    if (!layer) return false;
    const selection = layer.selectAll('circle.vertex-handle').data(data, d => d.nodeKey || d.key || d.index);
    selection.enter().append('circle').attr('class', 'vertex-handle');
    selection.exit().remove();
    const allVertices = layer.selectAll('circle.vertex-handle');
    allVertices
      .attr('r', boundaryMode ? (editing.isMobile?.() ? 7.2 : 5.2) : 4.5)
      .classed('country-vertex', boundaryMode)
      .classed('coast-vertex', d => boundaryMode && d.boundaryKind === 'coast')
      .classed('shared-boundary-vertex', d => boundaryMode && d.boundaryKind === 'shared')
      .classed('fixed-boundary-vertex', d => boundaryMode && d.fixed)
      .attr('transform', d => {
        const point = editing.activeProjection?.()(d.coord);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    allVertices.on('.drag', null);
    const dragKind = boundaryMode ? 'boundary-vertex' : 'object-vertex';
    if (objectPacket?.targetRef) {
      const behavior = editingDragBehavior(dragKind, objectPacket.targetRef);
      if (behavior) {
        if (boundaryMode) allVertices.filter(d => !d.fixed).call(behavior);
        else allVertices.call(behavior);
      }
    }
    allVertices.on('click.vertex-select', null);
    allVertices.each(function(d) {
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
    MAP_RENDER_DIRTY.SELECTION_STYLE | MAP_RENDER_DIRTY.GPU_INTERACTION,
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
    MAP_RENDER_DIRTY.EDITING_OVERLAYS | MAP_RENDER_DIRTY.GPU_INTERACTION,
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
    MAP_RENDER_DIRTY.EDITING_OVERLAYS,
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
    MAP_RENDER_DIRTY.LABEL_POSITIONS | MAP_RENDER_DIRTY.LAYER_TREE,
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
    return frameToken;
  };
  const renderPass = (name, ...args) => {
    active();
    const renderer = renderers?.[name];
    if (typeof renderer !== 'function') return undefined;
    return renderer(...args);
  };
  const renderDraftInsertionHandle = (packet = editingPacket) => {
    active();
    const layer = interaction.draftLayer;
    if (!layer) return false;
    const target = packet?.draft?.insertTarget;
    const data = target?.coordinate
      && interaction.isCoordVisible?.(target.coordinate)
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
        const point = interaction.activeProjection?.()(item.coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      })
      .on('click', function() {
        interaction.d3?.event?.preventDefault?.();
        interaction.d3?.event?.stopPropagation?.();
        publishEditingInteraction({ type: 'draft-insert-request' });
      });
    return true;
  };
  const renderRiverPartitionEmphasis = (packet = editingPacket) => {
    active();
    const layer = interaction.draftLayer;
    const operation = packet?.territoryOperation;
    const componentMode = operation?.kind === 'annex-territory' && operation?.phase === 'components';
    if (!layer || !componentMode) return false;
    const selected = new Set((operation.components || []).filter(item => item.selected).map(item => item.key));
    const candidates = operation.components || [];
    for (const candidate of candidates.filter(item => item.usesRiverBoundary)) {
      for (const section of candidate.riverBoundarySegments || []) {
        if (!Array.isArray(section) || section.length < 2) continue;
        layer.append('path')
          .datum(interaction.featureFromGeometry?.({ type: 'LineString', coordinates: section }))
          .attr('class', `river-partition-emphasis${selected.has(candidate.key) ? ' selected' : ''}`)
          .attr('d', interaction.path)
          .attr('stroke', interaction.selectionStyle?.color)
          .attr('stroke-width', interaction.selectionStyle?.primaryWidth)
          .attr('stroke-opacity', selected.has(candidate.key) ? interaction.selectionStyle?.primaryAlpha : interaction.selectionStyle?.secondaryAlpha);
      }
    }
    return true;
  };
  const renderGeometryPreview = (frameContext = null, packet = editingPacket) => {
    active();
    const layer = interaction.previewLayer;
    if (!layer) return false;
    layer.selectAll('*').remove();
    const session = packet?.preview?.session || packet?.preview;
    if (!session || session.status === 'discarded' || session.status === 'committed') {
      interaction.syncGpuInteractionLayer?.('preview', layer);
      return true;
    }
    const delta = session.delta || {};
    for (const [className, geometry] of [
      ['geometry-preview-remove', delta.removedGeometry],
      ['geometry-preview-add', delta.addedGeometry],
    ]) {
      if (!geometry) continue;
      const feature = interaction.featureFromGeometry?.(geometry);
      if (interaction.hasAreaGeometry?.(feature)) {
        layer.append('path').datum(feature).attr('class', `${className} geometry-preview-fill`).attr('d', interaction.path);
      }
      const outline = interaction.buildRenderableStrokeFeature?.(feature);
      if (outline?.geometry?.coordinates?.length) {
        layer.append('path').datum(outline).attr('class', `${className} geometry-preview-outline`).attr('d', interaction.path);
      }
    }
    for (const geometry of delta.oldBoundaries || []) {
      const outline = interaction.buildRenderableStrokeFeature?.(interaction.featureFromGeometry?.(geometry));
      if (outline) layer.append('path').datum(outline).attr('class', 'geometry-preview-old-boundary').attr('d', interaction.path);
    }
    for (const geometry of delta.newBoundaries || []) {
      const outline = interaction.buildRenderableStrokeFeature?.(interaction.featureFromGeometry?.(geometry));
      if (outline) layer.append('path').datum(outline).attr('class', 'geometry-preview-new-boundary').attr('d', interaction.path);
    }
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
  let sparseFallbackViewSignature = '';
  let sparseFallbackLastAt = Number.NEGATIVE_INFINITY;
  let sparseFallbackPathCount = 0;
  let sparseFallbackDirty = true;
  const setLimitedSelectionCache = (cache, key, value, limit = 160) => {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  };
  const selectionGeometryRevision = (key, role = 'outline', feature = null) => {
    // Canonical mutation boundaries already advance these revisions.  Using
    // them keeps multipart selection geometry out of the hot-path serializer;
    // the feature is still passed through to the exact renderer on a miss.
    void feature;
    const stateRevision = selection.getStateRevision?.()
      ?? selection.getState?.()?.stateRevision
      ?? 0;
    const countryRevision = selection.getCountryLandRevision?.() || 0;
    return `${key}:${role}:state-${stateRevision}:country-${countryRevision}`;
  };
  const cachedSelectionBoundaryFeature = (key, feature, role = 'outline') => {
    const revision = selectionGeometryRevision(key, role, feature);
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
    if (selectionProjectedPathCache.has(key)) {
      selectionOverlayDiagnostics.projectedPathCacheHits += 1;
      return selectionProjectedPathCache.get(key);
    }
    selectionOverlayDiagnostics.projectedPathCacheMisses += 1;
    return setLimitedSelectionCache(selectionProjectedPathCache, key, selection.path?.(feature), 96);
  };
  const syncSelectionEmphasis = () => {
    if (!gpuMapRenderer?.setCountryEmphasis) return false;
    const selectionState = selectionDomain?.snapshot?.() || { selection: { items: [], primaryKey: null }, hover: null };
    const items = selectionState.selection.items;
    const countryIds = items
      .filter(ref => ref.domain === 'territorial' && ref.type === selection.countryType)
      .map(ref => ref.id);
    const primary = items.find(ref => ref.key === selectionState.selection.primaryKey);
    const hovered = selectionState.hover;
    const hoveredCountryId = !selection.isMobile?.()
      && hovered?.domain === 'territorial'
      && hovered?.type === selection.countryType
      && !selectionDomain.has(hovered)
      ? String(hovered.id || '')
      : '';
    gpuMapRenderer.setCountryEmphasis({
      primaryId: primary?.domain === 'territorial' && primary.type === selection.countryType ? primary.id : '',
      hoverId: hoveredCountryId,
      selectedIds: countryIds,
    });
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
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (!sparseFallbackDirty
      && (sparseFallbackViewSignature === viewSignature || now - sparseFallbackLastAt < 1000 / 30)) {
      return sparseFallbackPathCount > 0;
    }
    let pathCount = 0;
    const reproject = (layer, selector) => {
      const paths = layer?.selectAll?.(selector);
      if (!paths?.attr) return;
      paths.attr('d', (feature, index) => {
        pathCount += 1;
        try {
          return cachedSelectionPath(`sparse:${selector}:${index}`, feature, frameContext) || '';
        } catch (_) {
          return '';
        }
      });
    };
    reproject(selection.selectionLayer, 'path.map-selection-shape');
    reproject(selection.hoverLayer, 'path.map-hover-shape');
    sparseFallbackViewSignature = viewSignature;
    sparseFallbackLastAt = now;
    sparseFallbackPathCount = pathCount;
    sparseFallbackDirty = false;
    if (!pathCount) return false;
    selection.publishMetrics?.({
      viewRevision: selection.getViewRevision?.(frameContext) || frameContext?.viewRevision || frameContext?.revision || 0,
      boundaryOwner: 'svg-fallback',
      fallbackCount: selectionOverlayDiagnostics.fallbackCount,
      sparseFallbackPathCount: pathCount,
      renderSucceeded: true,
      reusedGpuFrame: true,
    });
    return true;
  };
  const renderSelectionOverlayFrame = (frameContext = null, {
    updateData = true,
    gpuFrameResult = null,
    viewOnly = false,
  } = {}) => {
    active();
    if (!viewOnly) sparseFallbackDirty = true;
    if (viewOnly) {
      const gpuSelectionResult = gpuFrameResult?.selection || gpuFrameResult?.interactionResult?.selection || null;
      const gpuFrameFailed = gpuFrameResult && (
        gpuFrameResult.succeeded === false
        || gpuSelectionResult?.succeeded === false
        || gpuSelectionResult?.contextLost === true
      );
      if (!gpuFrameFailed) return renderSparseSelectionFallbackView(frameContext);
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
    const items = selectionState.selection.items;
    const primaryKey = selectionState.selection.primaryKey;
    const genericPrimary = [];
    const genericSecondary = [];
    const genericHover = [];
    const interactionFillRequests = [];
    const fallbackRequests = { hover: [], primary: [], secondary: [] };
    let countryPrimaryId = '';
    const countrySecondaryIds = [];
    let countryHoverId = '';
    const selectionPass = selection.selectionPass;
    const style = selection.resolvedInteractionStyle?.() || selection.getInteractionStyle?.() || {};
    const selectionStyle = style.selection || {};
    const selectionPassAvailable = !!selectionPass?.isAvailable?.();
    const selectionOutlinesVisible = selectionStyle.outlineVisible !== false;
    const state = selection.getState?.() || {};
    const hovered = selectionState.hover;
    const hoveredFeature = hovered ? selection.mapFeatureForObjectRef?.(hovered) : null;
    const hoverActive = !selection.isMobile?.() && hoveredFeature?.geometry && !state.mapMoving && !editingPacket?.draft?.dragging
      && !selectionDomain.has(hovered);
    if (hoverActive) {
      const isCountry = hovered.domain === 'territorial' && hovered.type === selection.countryType;
      const feature = isCountry ? selection.countryDisplayFeature?.(hoveredFeature) : hoveredFeature;
      const key = isCountry ? `country:${String(hovered.id || '')}` : hovered.key;
      const pendingCountry = isCountry && state.pendingCountryRenderIds?.has(String(hovered.id || ''));
      if ((!isCountry || pendingCountry) && ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) {
        stagedHoverLayer.append('path').datum(feature)
          .attr('class', 'map-hover-shape map-hover-fill')
          .attr('data-object-key', hovered.key || '')
          .attr('fill', style.hover?.color)
          .attr('fill-opacity', style.hover?.fillAlpha)
          .attr('d', selection.path);
      }
      const boundary = !isCountry && ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
        ? cachedSelectionBoundaryFeature(key, feature, 'hover')
        : { feature, revision: selectionGeometryRevision(key, 'hover', feature) };
      fallbackRequests.hover.push(isCountry
        ? { key, resolveFeature: () => selection.countryOutlineFeature?.(feature), cacheKey: selectionGeometryRevision(key, 'hover-country') }
        : { key, feature: boundary.feature, cacheKey: boundary.revision });
      if (isCountry) {
        if (!pendingCountry) countryHoverId = String(hovered.id || '');
      } else {
        genericHover.push({ key, geometry: boundary.feature, geometryRevision: boundary.revision });
        if (hovered.key && ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) {
          interactionFillRequests.push({
            objectKey: hovered.key,
            singleResourceOnly: true,
            style: { color: style.hover?.color, fillAlpha: style.hover?.fillAlpha },
          });
        }
      }
    }
    for (const ref of items) {
      const primary = primaryKey === ref.key;
      const canonicalFeature = selection.mapFeatureForObjectRef?.(ref);
      const isCountry = ref.domain === 'territorial' && ref.type === selection.countryType;
      const feature = isCountry ? selection.countryDisplayFeature?.(canonicalFeature) : canonicalFeature;
      if (!feature?.geometry && feature?.type !== 'FeatureCollection') continue;
      const geometries = feature.type === 'FeatureCollection' ? (feature.features || []).map(item => item.geometry) : [feature.geometry];
      const hasBoundaryGeometry = geometries.some(geometry => ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geometry?.type));
      if (isCountry) {
        const pendingCountry = state.pendingCountryRenderIds?.has(String(ref.id));
        const itemStyle = primary ? selectionStyle.primary : selectionStyle.secondary;
        if (pendingCountry) {
          const priorityClass = primary ? ' is-primary' : ' is-secondary';
          if ((itemStyle?.fillAlpha || 0) > 0) stagedSelectionLayer.append('path').datum(feature)
            .attr('class', `map-selection-shape map-selection-fill${priorityClass}`)
            .attr('fill', selectionStyle.color).attr('fill-opacity', itemStyle.fillAlpha).attr('stroke', 'none').attr('d', selection.path);
        }
        if (selectionOutlinesVisible) {
          const channel = primary ? 'primary' : 'secondary';
          const key = `country:${ref.id}`;
          fallbackRequests[channel].push({ key, resolveFeature: () => selection.countryOutlineFeature?.(feature), cacheKey: selectionGeometryRevision(key, 'country-outline') });
          if (!pendingCountry) {
            if (primary) countryPrimaryId = ref.id;
            else countrySecondaryIds.push(ref.id);
          }
        }
        continue;
      }
      if (hasBoundaryGeometry && geometries.some(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type))) {
        const fillAlpha = primary ? selectionStyle.primary?.fillAlpha : selectionStyle.secondary?.fillAlpha;
        if ((fillAlpha || 0) > 0) stagedSelectionLayer.append('path').datum(feature)
          .attr('class', `map-selection-shape map-selection-fill${primary ? ' is-primary' : ' is-secondary'}`)
          .attr('data-object-key', ref.key).attr('fill', selectionStyle.color).attr('fill-opacity', fillAlpha).attr('stroke', 'none').attr('d', selection.path);
        if ((fillAlpha || 0) > 0) interactionFillRequests.push({ objectKey: ref.key, style: { color: selectionStyle.color, fillAlpha } });
      }
      const boundary = hasBoundaryGeometry && geometries.some(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type))
        ? cachedSelectionBoundaryFeature(ref.key, feature, 'selection-outline')
        : { feature, revision: selectionGeometryRevision(ref.key, 'selection-outline', feature) };
      if (selectionOutlinesVisible) {
        const channel = primary ? 'primary' : 'secondary';
        fallbackRequests[channel].push({ key: ref.key, feature: boundary.feature, cacheKey: boundary.revision });
        if (hasBoundaryGeometry) (primary ? genericPrimary : genericSecondary).push({ key: ref.key, geometry: boundary.feature, geometryRevision: boundary.revision });
      }
    }
    let gpuSelectionStats = null;
    let gpuRenderResult = null;
    let gpuFillResult = null;
    let fillResourcesByObject = new Map();
    if (selectionPass) {
      if (updateData) {
        const countryBoundarySnapshot = gpuMapRenderer?.getCountryInteractionBoundaryData?.() || null;
        selectionPass.setCountryBoundaryResources?.(countryBoundarySnapshot);
        selectionOverlayStage = 'selection-buffer-build';
        const packet = selectionDomain?.createPacket?.({
          geometryRevision: countryBoundarySnapshot?.revision || selection.getCountryLandRevision?.() || 0,
          styleRevision: `${selectionStyle.color}:${style.hover?.color}:${selectionStyle.outlineVisible}`,
          countryBoundaryRevision: countryBoundarySnapshot?.revision || '',
          territorialBoundaryRevision: selection.getTerritorialBoundaryRevision?.() || '',
          country: { hoverId: countryHoverId, primaryId: countryPrimaryId, secondaryIds: countrySecondaryIds },
          generic: { hover: genericHover, primary: genericPrimary, secondary: genericSecondary },
          style,
        });
        selection.setCurrentSelectionPacket?.(packet);
        selectionPass.updateData?.(packet);
      }
      const interactionFills = selection.buildGpuInteractionFillItems?.(interactionFillRequests) || { items: [], resourcesByObject: new Map() };
      fillResourcesByObject = interactionFills.resourcesByObject;
      selection.syncGpuInteractionState?.({ interactionFillItems: interactionFills.items });
      selectionOverlayStage = 'selection-gpu-render';
      // A view-only frame has already drawn GPU interaction passes in the
      // shared VIEW renderer. Never start a second WebGL frame here.
      const interactionFrame = gpuFrameResult || (viewOnly ? null : renderGpuInteraction(frameContext));
      gpuRenderResult = interactionFrame?.selection || interactionFrame?.interactionResult?.selection || null;
      gpuFillResult = interactionFrame?.interactionResult?.genericFillResult || null;
      gpuSelectionStats = selectionPass.stats?.() || null;
      boundarySegmentCount = Number(gpuSelectionStats?.segmentCount || 0);
      selection.updatePerformanceMetrics?.({
        selectionCountryBatchCount: Number(gpuSelectionStats?.countryBatchCount || 0),
        selectionGenericBatchCount: Number(gpuSelectionStats?.genericBatchCount || 0),
        selectionStrokeDrawCallCount: Number(gpuSelectionStats?.strokeDrawCallCount || 0),
      });
    }
    if (!gpuSelectionStats) gpuSelectionStats = selectionPass?.stats?.() || null;
    const renderedKeys = {
      hover: new Set(gpuRenderResult?.channels?.hover?.renderedKeys || []),
      primary: new Set(gpuRenderResult?.channels?.primary?.renderedKeys || []),
      secondary: new Set(gpuRenderResult?.channels?.secondary?.renderedKeys || []),
    };
    const renderedFillKeys = new Set(gpuFillResult?.renderedKeys || []);
    const gpuFilledObjectKeys = new Set();
    for (const [objectKey, resourceKeys] of fillResourcesByObject) {
      if (resourceKeys.length && resourceKeys.every(key => renderedFillKeys.has(key))) gpuFilledObjectKeys.add(objectKey);
    }
    stagedSelectionLayer.selectAll('.map-selection-fill[data-object-key]').filter(function() {
      return gpuFilledObjectKeys.has(this.getAttribute('data-object-key') || '');
    }).remove();
    stagedHoverLayer.selectAll('.map-hover-fill[data-object-key]').filter(function() {
      return gpuFilledObjectKeys.has(this.getAttribute('data-object-key') || '');
    }).remove();
    selectionOverlayStage = 'selection-fallback-path';
    const fallbackStartedAt = performance.now();
    const countFallbackSegments = feature => {
      try { return selection.buildSelectionBoundarySegments?.(feature?.geometry).length || 0; } catch (_) { return 0; }
    };
    for (const request of fallbackRequests.hover) {
      if (renderedKeys.hover.has(request.key)) continue;
      const fallbackFeature = request.feature || request.resolveFeature?.();
      const d = cachedSelectionPath(request.cacheKey || request.key, fallbackFeature, frameContext);
      if (!d) continue;
      stagedHoverLayer.append('path').datum(fallbackFeature).attr('class', 'map-hover-shape map-hover-outline').attr('fill', 'none')
        .attr('stroke', style.hover?.color).attr('stroke-width', style.hover?.width).attr('stroke-opacity', style.hover?.alpha).attr('d', d);
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
            .attr('fill', 'none').attr('stroke', selectionStyle.casingColor).attr('stroke-width', itemStyle?.outerWidth)
            .attr('stroke-opacity', itemStyle?.casingAlpha).attr('d', d);
          stagedSelectionLayer.append('path').datum(fallbackFeature).attr('class', `map-selection-shape map-selection-outline${priorityClass}`)
            .attr('fill', 'none').attr('stroke', selectionStyle.color).attr('stroke-width', itemStyle?.innerWidth)
            .attr('stroke-opacity', itemStyle?.innerAlpha).attr('d', d);
          pathCount += 2; pathCharacterCount += d.length * 2; svgFallbackKeys.push(request.key); boundarySegmentCount += countFallbackSegments(fallbackFeature);
        }
      }
    }
    for (const selector of ['.map-selection-casing.is-secondary', '.map-selection-outline.is-secondary', '.map-selection-casing.is-primary', '.map-selection-outline.is-primary']) {
      stagedSelectionLayer.selectAll(selector).each(function() { this.parentNode?.appendChild(this); });
    }
    const fallbackPathMs = performance.now() - fallbackStartedAt;
    selectionOverlayStage = 'selection-frame-commit';
    selectionTarget?.replaceChildren(...selectionStageNode.childNodes);
    hoverTarget?.replaceChildren(...hoverStageNode.childNodes);
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
    layer.selectAll('*').remove();
    const audit = interaction.getValidationPacket?.() || {};
    const issues = packet?.validationIssues?.length ? packet.validationIssues : audit.issues || [];
    for (const issue of issues) {
      const className = geometryPreviewIssueClass(issue.kind);
      if (issue.geometry && (audit.selectedIssueId === issue.id || interaction.geometryMayIntersectViewport?.(issue.geometry))) {
        const feature = interaction.featureFromGeometry?.(issue.geometry);
        const selectedClass = audit.selectedIssueId === issue.id ? ' selected' : '';
        if (interaction.hasAreaGeometry?.(feature)) {
          layer.append('path').datum(feature).attr('class', `map-validation-issue map-validation-fill ${className}${selectedClass}`).attr('d', interaction.path);
        }
        const outline = interaction.buildRenderableStrokeFeature?.(feature);
        if (outline?.geometry?.coordinates?.length) {
          layer.append('path').datum(outline).attr('class', `map-validation-issue map-validation-outline ${className}${selectedClass}`).attr('d', interaction.path);
        }
      }
      const coordinate = interaction.issueCoordinate?.(issue);
      if (!coordinate || !interaction.isCoordVisible?.(coordinate)) continue;
      const point = interaction.activeProjection?.()(coordinate);
      if (!point) continue;
      layer.append('circle').attr('class', `map-validation-marker ${className}`)
        .attr('cx', point[0]).attr('cy', point[1])
        .attr('r', audit.selectedIssueId === issue.id ? 8 : 6)
        .append('title').text(issue.message || '지도 오류');
    }
    return true;
  };
  const renderSnap = (frameContext = null, packet = editingPacket) => {
    active();
    const layer = interaction.snapLayer;
    if (!layer) return false;
    layer.selectAll('*').remove();
    const indicator = packet?.snap || null;
    if (!indicator?.coordinate || !interaction.isCoordVisible?.(indicator.coordinate)) return true;
    if (indicator.segmentEndpoints?.length === 2) {
      layer.append('path').datum(interaction.featureFromGeometry?.({ type: 'LineString', coordinates: indicator.segmentEndpoints }))
        .attr('class', 'snap-indicator-segment').attr('d', interaction.path);
    }
    const point = interaction.activeProjection?.()(indicator.coordinate);
    if (!point) return true;
    if (indicator.kind === 'intersection') {
      layer.append('path').attr('class', 'snap-indicator-cross')
        .attr('d', `M${point[0] - 7},${point[1] - 7}L${point[0] + 7},${point[1] + 7}M${point[0] + 7},${point[1] - 7}L${point[0] - 7},${point[1] + 7}`);
    }
    layer.append('circle').attr('class', 'snap-indicator-point').attr('cx', point[0]).attr('cy', point[1]).attr('r', 6);
    return true;
  };
  const renderGpuInteraction = (viewState = null) => {
    active();
    const result = gpuMapRenderer?.renderInteraction?.(
      Number(viewState?.revision || interaction.getViewRevision?.() || 0),
      viewState || interaction.getViewState?.() || null,
    ) || null;
    interaction.applyGpuInteractionCoverage?.(result);
    return result;
  };
  const resetTerritorialBoundaryCache = () => {
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
  const resetProjectGeneration = generation => {
    active();
    resetTerritorialBoundaryCache();
    gpuMapRenderer?.resetProjectRenderState?.({ generation });
    return generation;
  };
  const getStats = () => Object.freeze({
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
    cancelScheduledLabelPositions();
    disposed = true;
  };
  const renderDraft = (frameContext = null, packet = editingPacket) => {
    active();
    const draftLayer = interaction.draftLayer;
    if (!draftLayer) return false;
    const { d3, path, isMobile, activeProjection, isCoordVisible, syncGpuInteractionLayer, formatTerritoryArea } = interaction;
    const draft = packet?.draft || EMPTY_EDITING_RENDER_PACKET.draft;
    const operation = packet?.territoryOperation;
    draftLayer.selectAll('*').remove();

    const components = (operation?.components || []).map(item => ({ type: 'Feature', geometry: item.geometry, properties: item }));
    const componentPaths = draftLayer.selectAll('path.territory-component').data(components, item => item.properties.key).enter().append('path')
      .attr('class', item => `territory-component${item.properties.usesRiverBoundary ? ' river-partition' : ''} ${item.properties.selected ? 'selected-component' : 'available'}${item.properties.hovered && !item.properties.selected ? ' hovered-component' : ''}`)
      .attr('d', path)
      .on('mouseenter', item => publishEditingInteraction({ type: 'territory-component-hover', componentKey: item.properties.key }))
      .on('mouseleave', item => publishEditingInteraction({ type: 'territory-component-leave', componentKey: item.properties.key }))
      .on('click', function(item) {
        d3?.event?.preventDefault?.();
        d3?.event?.stopPropagation?.();
        publishEditingInteraction({ type: 'territory-component-toggle', componentKey: item.properties.key, screenPoint: localEditingPoint() });
      });
    componentPaths.append('title').text(item => `${item.properties.countryName} · ${formatTerritoryArea?.(item.properties.areaKm2) || item.properties.areaKm2} · 선택하여 ${item.properties.selected ? '해제' : '추가'}`);

    const candidates = (operation?.candidates || []).map(item => ({ type: 'Feature', geometry: item.geometry, properties: item }));
    draftLayer.selectAll('path.annex-candidate').data(candidates, item => item.properties.index).enter().append('path')
      .attr('class', item => `annex-candidate ${item.properties.index === 0 ? 'side-a' : 'side-b'} ${item.properties.selected ? 'selected-candidate' : 'alternate-candidate'}`)
      .attr('d', path)
      .on('click', function(item) {
        d3?.event?.preventDefault?.();
        d3?.event?.stopPropagation?.();
        publishEditingInteraction({ type: 'territory-candidate-select', candidateIndex: item.properties.index });
      });

    if (draft.rawStrokeGeometry) {
      draftLayer.append('path').datum({ type: 'Feature', properties: {}, geometry: draft.rawStrokeGeometry })
        .attr('class', 'draft-shape draft-raw-stroke').attr('d', path);
    }
    if (draft.geometry) {
      draftLayer.append('path').datum({ type: 'Feature', properties: {}, geometry: draft.geometry })
        .attr('class', ['draft-shape', packet.tool === 'annex-territory' ? 'annex-draft' : '', draft.cutStatus ? `cut-${draft.cutStatus}` : '', !draft.cutStatus && draft.issues.length ? 'draft-invalid' : ''].filter(Boolean).join(' '))
        .attr('d', path);
    }
    if (draft.autoCloseSegment) {
      draftLayer.append('path').datum({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [draft.autoCloseSegment.start, draft.autoCloseSegment.end] } })
        .attr('class', 'draft-auto-close-preview').attr('d', path);
    }
    draftLayer.selectAll('path.draft-split-preview').data(draft.splitCandidates, item => item.key).enter().append('path')
      .attr('class', (_, index) => `draft-split-preview side-${index === 0 ? 'a' : 'b'}`)
      .attr('d', item => path({ type: 'Feature', properties: {}, geometry: item.geometry }));

    const segmentHits = draftLayer.selectAll('path.draft-segment-hit').data(draft.segments, item => item.segmentIndex).enter().append('path')
      .attr('class', 'draft-segment-hit draft-interactive')
      .attr('d', item => path({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [item.start, item.end] } }))
      .on('mousemove', item => {
        if (isMobile?.() || draft.dragging) return;
        publishEditingInteraction({ type: 'draft-segment-hover', segmentIndex: item.segmentIndex, screenPoint: localEditingPoint() });
      })
      .on('mouseleave', item => publishEditingInteraction({ type: 'draft-segment-leave', segmentIndex: item.segmentIndex }))
      .on('click', function(item) {
        d3?.event?.preventDefault?.();
        d3?.event?.stopPropagation?.();
        publishEditingInteraction({ type: 'draft-segment-hover', segmentIndex: item.segmentIndex, screenPoint: localEditingPoint() });
      });
    segmentHits.append('title').text('선분에 꼭짓점 삽입');

    const vertices = draftLayer.selectAll('g.draft-vertex').data(draft.vertices.filter(item => isCoordVisible?.(item.coordinate, frameContext)), item => item.index).enter().append('g')
      .attr('class', item => `draft-vertex draft-interactive${item.selected ? ' selected' : ''}`)
      .attr('transform', item => {
        const point = activeProjection?.()(item.coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      })
      .on('click', function(item) {
        d3?.event?.preventDefault?.();
        d3?.event?.stopPropagation?.();
        publishEditingInteraction({ type: 'draft-vertex-select', vertexIndex: item.index });
      });
    vertices.append('circle').attr('class', 'draft-vertex-hit').attr('r', isMobile?.() ? 16 : 10);
    vertices.append('circle').attr('class', 'draft-vertex-dot').attr('r', isMobile?.() ? 6.5 : 4.5);
    vertices.append('title').text(item => `꼭짓점 ${item.index + 1} · 드래그하여 이동`);
    const draftDrag = editingDragBehavior('draft-vertex');
    if (draftDrag) vertices.call(draftDrag);

    renderDraftInsertionHandle(packet);
    const issueMarkers = draftLayer.selectAll('g.draft-issue-marker').data(draft.issues.filter(item => item.coordinate && isCoordVisible?.(item.coordinate, frameContext)), (item, index) => `${item.kind}-${item.vertexIndex ?? item.segmentIndex ?? index}`).enter().append('g')
      .attr('class', 'draft-issue-marker')
      .attr('transform', item => {
        const point = activeProjection?.()(item.coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    issueMarkers.append('circle').attr('r', 7);
    issueMarkers.append('path').attr('d', 'M-3.2-3.2 3.2 3.2M3.2-3.2-3.2 3.2');
    issueMarkers.append('title').text(item => item.message || '수정이 필요한 위치');
    draftLayer.selectAll('circle.draft-snap-point').data(draft.snapPoints, item => item.endpoint).enter().append('circle')
      .attr('class', item => `draft-snap-point ${item.endpoint}`).attr('r', 6)
      .attr('transform', item => {
        const point = activeProjection?.()(item.coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    renderRiverPartitionEmphasis(packet);
    syncGpuInteractionLayer?.('draft', draftLayer);
    return true;
  };
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
      view: (...args) => {
        syncBaseView(args[0]);
        return renderPass('view', ...args);
      },
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
      vertices: frameContext => renderVertices(frameContext, editingPacket),
      draft: frameContext => renderDraft(frameContext, editingPacket),
      snapIndicator: frameContext => renderSnap(frameContext, editingPacket),
      debug: (...args) => renderPass('debug', ...args),
      layerTree: (...args) => renderPass('layerTree', ...args),
    },
  });

  return Object.freeze({
    beginFrame,
    requestRender,
    invalidateView,
    invalidateViewSettle,
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
    renderGpuInteraction,
    renderBoundaryEdit,
    renderGeometryPreview,
    renderSelection,
    renderHoverOverlay,
    invalidateSelectionOverlay,
    syncSelectionEmphasis,
    getSelectionRenderStats,
    recordSelectionRenderError,
    renderValidation,
    renderCountryLabels,
    renderUserLabels,
    renderCountryLabelPositions,
    renderUserLabelPositions,
    renderCountries,
    renderHydro,
    renderHydroEdits,
    renderTerritorialUnits,
    renderGenericFeatures,
    renderDistributions,
    getDistributionRenderRows: buildDistributionRenderRows,
    renderBase,
    renderProjectedOverlays,
    resetProjectGeneration,
    getTerritorialBoundaryStats,
    getStats,
    dispose,
  });
}
