import { MAP_RENDER_DIRTY } from './map-render-coordinator.js';

export function createRenderingDomain({
  context = null,
  gpuMapRenderer = null,
  sceneBuilder = null,
  coordinator = null,
  mapHost = null,
  selectionDomain = null,
  editingDomain = null,
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
  renderers = {},
  renderSelectionFrame = null,
  renderEditingPreviewFrame = null,
  onFrameCommitted = () => {},
  reportDiagnostic = () => {},
} = {}) {
  let scene = null;
  let selectionPacket = null;
  let editingPreviewPacket = null;
  let disposed = false;
  let contextLost = false;
  const stats = { invalidations: 0, renders: 0, selectionRenders: 0, editingRenders: 0, lastReason: '' };
  const active = () => { if (disposed) throw new Error('Rendering domain is disposed.'); };
  const labels = labelResources || {};
  const countries = countryResources || {};
  const hydro = hydroResources || {};
  const territorial = territorialResources || {};
  const generic = genericResources || {};
  const distribution = distributionResources || {};
  const territorialBoundary = territorialBoundaryResources || {};
  const base = baseResources || {};
  const projected = projectedOverlayResources || {};
  const labelState = () => labels.getState?.() || {};
  const renderCountryLabels = (layout = null) => {
    active();
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
        const point = Array.isArray(anchor) && anchor.length >= 2 ? labels.activeProjection?.()(anchor) : null;
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
        const point = labels.activeProjection?.()(coordinate);
        return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
      });
    selection.select('text').text(d => d.name);
    selection.on('.drag', null);
    if (state.tool === 'select' && !state.labelPlacementMode) selection.call(labels.labelDragBehavior?.());
    selection.exit().remove();
    return true;
  };
  const renderCountryLabelPositions = () => {
    active();
    const state = labelState();
    labels.countryLabelLayer?.selectAll('text.country-label').attr('transform', feature => {
      const settings = labels.automaticLabelSettings?.('country', labels.labelSettings?.(state, 'country', feature.id) || {});
      const anchor = settings?.pinned && settings.manualPosition ? settings.manualPosition : labels.countryLabelAnchors?.()?.get?.(String(feature.id || ''));
      const point = Array.isArray(anchor) && anchor.length >= 2 && labels.isCoordVisible?.(anchor) ? labels.activeProjection?.()(anchor) : null;
      return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
    });
    return true;
  };
  const renderUserLabelPositions = () => {
    active();
    const state = labelState();
    labels.labelLayer?.selectAll('g.user-label').attr('transform', label => {
      const settings = labels.automaticLabelSettings?.(label.kind, labels.labelSettings?.(state, 'label', label.id) || {});
      const coordinate = settings?.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      const point = labels.isCoordVisible?.(coordinate) ? labels.activeProjection?.()(coordinate) : null;
      return point ? `translate(${point[0]},${point[1]})` : 'translate(-9999,-9999)';
    });
    return true;
  };
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
    countries.replaceGpuSceneDomain?.('country-overlays', { polygons, strokes });
    countries.syncGpuRenderScene?.();
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
    const renderer = hydro.gpuMapRenderer?.getStats?.({ detailed: false }).renderer;
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
    const renderer = hydro.gpuMapRenderer?.getStats?.({ detailed: false }).renderer;
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
  const renderBase = (viewState = null) => {
    active();
    const b = base;
    b.updatePandoGlobeShell?.(viewState);
    const graticuleGeometry = b.graticule?.();
    if (!graticuleGeometry || !b.graticuleLayer) return false;
    const renderer = b.gpuMapRenderer?.getStats?.({ detailed: false })?.renderer;
    const gpuOwnsGraticule = renderer === 'webgl2' || renderer === 'webgl1';
    b.graticuleLayer.attr('display', gpuOwnsGraticule ? 'none' : null)
      .datum(graticuleGeometry).attr('d', b.path).attr('data-gpu-scene-key', 'base:graticule');
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
  const invalidate = (mask, reason = 'render-invalidation') => {
    active();
    stats.invalidations += 1;
    stats.lastReason = String(reason);
    return coordinator?.invalidate?.(mask, reason) ?? false;
  };
  const invalidateView = reason => invalidate(
    MAP_RENDER_DIRTY.VIEW | MAP_RENDER_DIRTY.SELECTION_VIEW | MAP_RENDER_DIRTY.LABEL_POSITIONS,
    reason || 'view-change',
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
  const invalidateProjectRender = reason => coordinator?.scheduleFull?.(reason || 'project-render')
    ?? invalidate(MAP_RENDER_DIRTY.FULL, reason || 'project-render');
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
  const invalidateLabels = reason => invalidate(
    MAP_RENDER_DIRTY.LABEL_POSITIONS | MAP_RENDER_DIRTY.LAYER_TREE,
    reason || 'labels',
  );
  const scheduleView = (reason = 'view-change') => {
    active();
    stats.invalidations += 1;
    stats.lastReason = String(reason);
    return coordinator?.scheduleView?.(reason) ?? coordinator?.invalidate?.(0, reason) ?? false;
  };
  const setScene = nextScene => {
    active();
    scene = nextScene || null;
    return scene;
  };
  const render = viewState => {
    active();
    stats.renders += 1;
    const frame = viewState || context?.getFrameContext?.() || null;
    const result = gpuMapRenderer?.render?.(frame?.revision, frame) || null;
    onFrameCommitted({ domain: 'rendering', result, sceneRevision: scene?.revision || 0 });
    return result;
  };
  const renderSelection = packet => {
    active();
    stats.selectionRenders += 1;
    selectionPacket = packet || null;
    if (typeof renderSelectionFrame === 'function') return renderSelectionFrame(selectionPacket);
    return gpuMapRenderer?.renderSelection?.(selectionPacket) || false;
  };
  const renderEditingPreview = packet => {
    active();
    stats.editingRenders += 1;
    editingPreviewPacket = packet || null;
    if (typeof renderEditingPreviewFrame === 'function') return renderEditingPreviewFrame(editingPreviewPacket);
    return gpuMapRenderer?.renderEditingPreview?.(editingPreviewPacket) || editingPreviewPacket;
  };
  const renderPass = (name, ...args) => {
    active();
    const renderer = renderers?.[name];
    if (typeof renderer !== 'function') return undefined;
    return renderer(...args);
  };
  const renderScene = (frameContext, dirtyMask = 0) => {
    active();
    if (contextLost) return null;
    const frame = frameContext || context?.getFrameContext?.() || null;
    const result = renderPass('base', frame, dirtyMask);
    onFrameCommitted({ domain: 'rendering', type: 'scene', frameId: frame?.frameId || null, dirtyMask, result });
    return result;
  };
  const renderDraft = packet => renderPass('draft', packet);
  const renderVertices = packet => renderPass('vertices', packet);
  const renderSnap = packet => renderPass('snapIndicator', packet);
  const resetProjectGeneration = generation => {
    active();
    scene = null;
    selectionPacket = null;
    editingPreviewPacket = null;
    contextLost = false;
    gpuMapRenderer?.resetProjectRenderState?.({ generation });
    return generation;
  };
  const handleContextLost = event => {
    contextLost = true;
    gpuMapRenderer?.handleContextLost?.(event);
    reportDiagnostic({ type: 'context-lost', event });
  };
  const handleContextRestored = event => {
    contextLost = false;
    gpuMapRenderer?.handleContextRestored?.(event);
    reportDiagnostic({ type: 'context-restored', event });
  };
  const getStats = () => Object.freeze({
    ...stats,
    contextLost,
    projectGeneration: projectDomain?.getGeneration?.() || 0,
    hasScene: !!scene,
    hasMapHost: typeof mapHost === 'function' ? !!mapHost() : !!mapHost,
    hasDomLayers: !!domLayers,
    hasSceneBuilder: !!sceneBuilder,
    hasSelectionDomain: !!selectionDomain,
    hasEditingDomain: !!editingDomain,
  });
  const dispose = () => { disposed = true; scene = null; selectionPacket = null; editingPreviewPacket = null; };
  return Object.freeze({
    setScene,
    invalidate,
    invalidateView,
    invalidateSelection,
    invalidateSelectionStyle,
    invalidateOverlayGeometry,
    invalidateOverlayStyle,
    invalidateProjectRender,
    invalidateCountryPatch,
    invalidateHydroPatch,
    invalidateTerritorialPatch,
    invalidateGenericPatch,
    invalidateLabels,
    scheduleView,
    render,
    renderScene,
    renderSelection,
    renderEditingPreview,
    renderDraft,
    renderVertices,
    renderSnap,
    renderPass,
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
    renderTerritorialInternalBoundaries,
    renderBase,
    renderProjectedOverlays,
    resetProjectGeneration,
    handleContextLost,
    handleContextRestored,
    getStats,
    dispose,
  });
}
