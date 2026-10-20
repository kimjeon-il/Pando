import {temporalContains,temporalMonthEnd} from './temporal.js';
import {territorialPaintRole} from './layer-presentation.js';
import {resolveMapStrokeStyle} from './map-interaction-style.js';
import {distributionValueRange,distributionValueAlpha} from './distribution-model.js';
import {createTerritorialFillResolver} from './territorial-fill-style.js';
import {connectBoundarySegments} from './boundary-lines.js';

/** Canonical map content and scene presentation; product outputs supply registered surfaces. */
export function createMapContentPresentation({countries={},hydro={},territorial={},generic={},distribution={},
 territorialBoundary={},base={},projected={},active,requireFrame=value=>value,framePath,
 commitViewAttachedLayers=()=>{},prepareMapDisplay=null,onMapDisplayReady=()=>{},
 reportDiagnostic=()=>{},isDisposed,isSmooth=()=>document.documentElement.dataset.smoothLines!=='false'}={}) {
  const renderCountries = (frame, {
    presentationOnly = false,
    gpuResult = null,
  } = {}) => {
    active();
    const state = countries.getState?.() || {};
    const renderViewState = requireFrame(frame);
    countries.renderPendingCountryOverlays?.(renderViewState);
    const pending = state.layerVisibility?.objects && state.pendingCountryRenderIds?.size
      ? [...state.pendingCountryRenderIds].map(countries.getEntity).filter(Boolean)
      : [];
    const pendingPolygons = [];
    const pendingStrokes = [];
    const theme = pending.length ? countries.mapTheme() : null;
    const resolveFill = pending.length ? createTerritorialFillResolver({ state, entityRepository: territorial.entityRepository,
      terrainAlpha: theme.countryColorAlpha,
      mapSubstrate: state.physicalSettings.terrainVisible ? null
        : { color: theme.defaultLand, fillAlpha: theme.baseLandAlpha } }) : null;
    for (const feature of pending) {
      const id = String(feature.id || '');
      const geometryRevision = countries.selectionGeometryRevision?.(`country:${id}`, 'pending-country', feature);
      pendingPolygons.push({ key: `pending-country-fill:${id}`, geometryRevision, geometry: feature.geometry, order: -300,
        role: 'territorial-fill', ownerId: id, territoryDepth: 0,
        style: resolveFill(feature) });
      pendingStrokes.push({ key: `pending-country-outline:${id}`, geometryRevision, geometry: countries.countryOutlineFeature?.(feature).geometry, order: -290, style: Object.freeze({ ...theme.strokes.country, alpha: theme.borderAlpha }) });
    }
    countries.replaceGpuSceneDomain?.('country-overlays', {
      polygons: pendingPolygons,
      strokes: pendingStrokes,
    });
    countries.syncGpuRenderScene?.();
    const frameResult = !presentationOnly && renderViewState?.__mapVisualFrame
      ? countries.gpuMapRenderer?.renderFrame?.(renderViewState)
      : gpuResult;
    if (!presentationOnly && frameResult?.deferred) commitViewAttachedLayers(renderViewState, frameResult);
    countries.applyGpuSceneCoverage?.(frameResult);
    countries.applyGpuInteractionCoverage?.(frameResult);
    return frameResult;
  };
  const renderHydro = frameContext => {
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
      lakeSelection.attr('d', item => framePath(frameContext)(item.collection))
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
      riverSelection.attr('d', item => framePath(frameContext)(item.collection))
        .style('stroke-width', item => `${item.width * riverStyle.boundaryWidth}px`)
        .style('stroke', hydro.hydroDisplayColor?.('river'))
        .style('opacity', null)
        .style('stroke-opacity', riverStyle.opacity);
      riverSelection.exit().remove();
    }
    return true;
  };
  const renderHydroEdits = frameContext => {
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
    selection.attr('d', feature => framePath(frameContext)(feature))
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
    polygonSelection.attr('d', feature => framePath(frameContext)(hydro.buildRenderableStrokeFeature?.(feature) || feature))
      .style('stroke', feature => hydro.hydroEditColor?.(feature) || hydro.hydroDisplayColor?.('lake'))
      .style('stroke-opacity', lakeStyle.boundaryVisible ? lakeStyle.opacity : 0)
      .style('stroke-width', lakeStyle.boundaryWidth);
    polygonSelection.exit().remove();
    return true;
  };
  const renderTerritorialUnits = frameContext => {
    active();
    const t = territorial;
    const state = t.getState?.() || {};
    const theme = countries.mapTheme?.() || {};
    const resolveFill = createTerritorialFillResolver({ state, entityRepository: t.entityRepository,
      terrainAlpha: theme.countryColorAlpha });
    t.syncBuiltinPalette?.();
    const visibleIds = new Set((t.visibleMapObjectCandidates?.(['territorial']) || []).map(record => String(record.id)));
    const displayedUnits = t.displayEntities().filter(entity => territorialPaintRole(entity) !== 'country-fill');
    const data = displayedUnits.filter(feature => {
      const group = 'objects';
      const selected = t.selectionHas?.(t.normalizeObjectRef?.({
        domain: 'territorial', type: 'entity', id: feature.id,
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
        domain: 'territorial', type: 'entity', id: feature.id,
      }))
      .on('mouseleave.hover', feature => t.setMapHover?.('', '', null, { domain: 'territorial', type: 'entity', id: feature.id }))
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
          hitRef: { domain: 'territorial', type: 'entity', id: feature.id },
        });
      });
    selection?.attr('d', feature => framePath(frameContext)(feature))
      .attr('data-gpu-scene-key', feature => {
        const key = t.normalizeObjectRef?.({ domain: 'territorial', type: 'entity', id: feature.id })?.key
          || `territorial:entity:${feature.id}`;
        return `${key}:fill`;
      })
      .classed('is-territory', feature => feature.properties?.entityKind === 'general')
      .classed('is-region', feature => feature.properties?.entityKind === 'regional')
      .classed('territorial-unit-merge-source', feature => state.territorialUnitMergeSourceId === String(feature.id))
      .classed('territorial-unit-merge-target', feature => (state.territorialUnitMergeTargetIds || []).includes(String(feature.id)))
      .style('color', null)
      .style('fill', 'transparent')
      .style('fill-opacity', 0)
      .style('stroke', 'none').style('stroke-opacity', 0).style('stroke-width', 0).style('stroke-dasharray', 'none')
      .style('mix-blend-mode', 'normal')
      .attr('data-presentation-group', 'objects');
    selection?.exit().remove();
    t.territorialOperationLayer?.selectAll('path.territorial-unit-operation-outline').remove();
    const polygons = [];
    const strokes = [];
    for (const feature of data) {
      const group = 'objects';
      const unitStyle = resolveFill(feature);
      const objectKey = t.normalizeObjectRef?.({ domain: 'territorial', type: 'entity', id: feature.id })?.key
        || `territorial:entity:${feature.id}`;
      const geometryRevision = t.selectionGeometryRevision?.(objectKey, 'gpu-scene', feature);
      polygons.push({ key: `${objectKey}:fill`, objectKey, geometryRevision, geometry: feature.geometry,
        role: feature.properties.entityKind === 'regional' ? 'regional-overlay' : 'territorial-fill', ownerId: unitStyle.ownerId, parentId: unitStyle.parentId, territoryDepth: unitStyle.depth,
        order: t.gpuSceneOrder?.(group, 'fill', objectKey), blendMode: unitStyle.blendMode,
        style: { color: unitStyle.color, fillAlpha: unitStyle.fillAlpha, blendMode: unitStyle.blendMode } });

    }
    t.replaceGpuSceneDomain?.('territorial-units', { polygons, strokes });
    const boundaryFeatures = displayedUnits.filter(feature => {
      if (t.isNativeBuiltinSubunit?.(feature)) return false;
      const group = 'objects';
      return state.layerVisibility?.[group] !== false && t.isLayerItemVisible?.(group, feature.id);
    });
    renderTerritorialInternalBoundaries(boundaryFeatures);
    return true;
  };
  const renderGenericFeatures = frameContext => {
    active();
    const g = generic;
    const state = g.getState?.() || {};
    const style = g.layerStyle?.(state.layerPresentation, 'genericFeatures') || {};
    const visibleIds = state.layerVisibility?.genericFeatures !== false
      ? new Set((g.visibleMapObjectCandidates?.(['generic']) || []).map(record => String(record.id)))
      : new Set();
    const data = state.layerVisibility?.genericFeatures !== false
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
    selection?.attr('d', framePath(frameContext))
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
          order: g.gpuSceneOrder?.('genericFeatures', 'fill'), blendMode: style.blendMode,
          style: { color: g.genericFeatureColor?.(feature), fillAlpha: 0.34 * style.opacity, blendMode: style.blendMode } });
        if (style.boundaryVisible) strokes.push({
          key: `${objectKey}:boundary`, objectKey, geometryRevision,
          geometry: (g.buildRenderableStrokeFeature?.(feature) || feature).geometry,
          order: g.gpuSceneOrder?.('genericFeatures', 'boundary'), blendMode: style.blendMode,
          style: resolveMapStrokeStyle({ color: g.genericFeatureColor?.(feature), layerStyle: style, antiAlias: isSmooth() }, 'generic'),
        });
      } else if (['LineString', 'MultiLineString'].includes(feature.geometry?.type) && style.boundaryVisible) strokes.push({
        key: `${objectKey}:line`, objectKey, geometryRevision, geometry: feature.geometry,
        order: g.gpuSceneOrder?.('genericFeatures', 'line'), blendMode: style.blendMode,
        style: resolveMapStrokeStyle({ color: g.genericFeatureColor?.(feature), layerStyle: style, antiAlias: isSmooth() }, 'generic'),
      });
    }
    g.replaceGpuSceneDomain?.('generic-features', { polygons, strokes });
    return true;
  };
  let distributionRenderRowCache = { layers: null, entries: null, entities: null, countryGeometryRevision: -1, month:'', renderMode: '', selectedLayerId: '', visibilityRevision: -1, rows: Object.freeze([]), rebuildCount: 0, buildMs: 0 };
  const buildDistributionRenderRows = () => {
    const d = distribution;
    const state = d.getState?.() || {};
    const settings = state.distributionSettings || {};
    const renderMode = settings.renderMode;
    const month=state.timelineCursor;
    const at=month?temporalMonthEnd(month):null;
    const exists=value=>at===null||temporalContains(value,at);
    const modes = d.DISTRIBUTION_RENDER_MODES || {};
    const selectedLayerId = renderMode === modes.SINGLE ? String(settings.activeLayerId || '') : '';
    const visibilityRevision = d.getDistributionVisibilityRevision?.() ?? 0;
    const countryRevision = d.getCountryGeometryRevision?.() ?? 0;
    const cacheCurrent = distributionRenderRowCache.layers === state.distributionLayers
      && distributionRenderRowCache.entries === state.distributionEntries
      && distributionRenderRowCache.entities === state.territorialEntities
      && distributionRenderRowCache.countryGeometryRevision === countryRevision
      && distributionRenderRowCache.month===month
      && distributionRenderRowCache.renderMode === renderMode
      && distributionRenderRowCache.selectedLayerId === selectedLayerId
      && distributionRenderRowCache.visibilityRevision === visibilityRevision;
    if (cacheCurrent) return distributionRenderRowCache.rows;
    const started = globalThis.performance?.now?.() || Date.now();
    const visibleLayers = state.layerVisibility?.distributions === false ? [] :
      (state.distributionLayers || []).filter(layer => exists(layer)&&d.isLayerItemVisible?.('distributions', layer.id));
    const activeId = visibleLayers.some(layer => layer.id === selectedLayerId) ? selectedLayerId : visibleLayers[0]?.id;
    const displayedLayers = renderMode === modes.SINGLE
      ? visibleLayers.filter(layer => layer.id === activeId) : visibleLayers;
    const entriesByLayer = new Map(visibleLayers.map(layer => [layer.id, []]));
    for (const entry of state.distributionEntries || []) if(exists(entry))entriesByLayer.get(entry.layerId)?.push(entry);
    const ranges = new Map(visibleLayers.map(layer => [layer.id, distributionValueRange(layer, entriesByLayer.get(layer.id))]));
    const rows = displayedLayers.flatMap(layer => (entriesByLayer.get(layer.id) || []).map(entry => {
      const geometry = entry.mode === (d.DISTRIBUTION_MODES || {}).TERRITORIAL
        ? d.territorialEntityRepository.get(entry.territorialUnitId)?.geometry : entry.geometry;
      if (!layer || !geometry) return null;
      return Object.freeze({ id: entry.id, layer, entry, range: ranges.get(layer.id),
        geometry, bounds: d.geometryBounds?.(geometry), type: 'Feature' });
    })).filter(Boolean);
    distributionRenderRowCache = { layers: state.distributionLayers, entries: state.distributionEntries, entities: state.territorialEntities,
      countryGeometryRevision: countryRevision, month, renderMode, selectedLayerId, visibilityRevision,
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
      const selected = d.selectionHas?.(d.normalizeObjectRef?.({ domain: 'distribution', type: 'distribution', id: row.layer.id }));
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
  const renderDistributions = frameContext => {
    active();
    const d = distribution;
    const state = d.getState?.() || {};
    if (!d.distributionLayer) return false;
    const data = visibleDistributionRenderRows();
    const boundaryVisible = state.distributionSettings?.boundaryVisible !== false;
    const isArea = row => ['Polygon', 'MultiPolygon'].includes(row.geometry?.type);
    const color = row => d.distributionColor?.(row.layer);
    const styleFor = () => d.layerStyle?.(state.layerPresentation, 'distributions') || {};
    const selection = d.distributionLayer.selectAll('path.distribution-shape').data(data, row => row.id);
    selection.enter().append('path').attr('class', 'distribution-shape')
      .on('mouseenter.hover', row => d.setMapHover?.('distribution', row.id, d.featureFromGeometry?.(row.geometry), { domain: 'distribution', type: 'distribution', id: row.layer.id }))
      .on('mouseleave.hover', row => d.setMapHover?.('', '', null, { domain: 'distribution', type: 'distribution', id: row.layer.id }))
      .on('click', function(row) {
        const stateNow = d.getState?.() || {};
        if (d.mapClickBlocked?.() || stateNow.tool !== 'select' || stateNow.labelPlacementMode) return;
        d.d3?.event?.stopPropagation?.();
        d.handleObjectSelectionAt?.(d.d3?.mouse?.(d.svg), { sourceEvent: d.d3?.event, hitRef: { domain: 'distribution', type: 'distribution', id: row.layer.id } });
      });
    selection.attr('d', row => framePath(frameContext)({ type: 'Feature', properties: {}, geometry: row.geometry }))
      .attr('data-gpu-scene-key', row => `distribution-entry:${row.id}:${isArea(row) ? 'fill' : 'line'}`)
      .style('fill', 'transparent').style('stroke', 'transparent')
      .style('fill-opacity', 0)
      .style('stroke-opacity', 0)
      .style('stroke-width', 0)
      .style('mix-blend-mode', 'normal')
      .attr('data-presentation-group', 'distributions');
    selection.exit().remove();
    d.distributionLayer.selectAll('path.distribution-boundary').remove();
    const polygons = [], strokes = [];
    for (const row of data) {
      const group = 'distributions';
      const renderStyle = styleFor(row);
      const objectKey = d.normalizeObjectRef?.({ domain: 'distribution', type: 'distribution', id: row.layer.id })?.key || `distribution:distribution:${row.layer.id}`;
      const feature = d.featureFromGeometry?.(row.geometry);
      const geometryRevision = d.selectionGeometryRevision?.(`distribution-entry:${row.id}`, 'gpu-scene', feature);
      const fillAlpha = distributionValueAlpha(row.entry.value, row.range, renderStyle.opacity);
      if (isArea(row)) {
        polygons.push({ key: `distribution-entry:${row.id}:fill`, objectKey, geometryRevision, geometry: row.geometry, order: d.gpuSceneOrder?.(group, 'fill'), blendMode: renderStyle.blendMode, style: { color: color(row), fillAlpha, blendMode: renderStyle.blendMode } });
        if (boundaryVisible && renderStyle.boundaryVisible) strokes.push({ key: `distribution-entry:${row.id}:boundary`, objectKey, geometryRevision, geometry: (d.buildRenderableStrokeFeature?.(feature) || feature).geometry, order: d.gpuSceneOrder?.(group, 'boundary'), blendMode: renderStyle.blendMode, style: resolveMapStrokeStyle({ color: color(row), layerStyle: renderStyle, antiAlias: isSmooth() }, 'distribution') });
      } else if (['LineString', 'MultiLineString'].includes(row.geometry?.type) && boundaryVisible) strokes.push({ key: `distribution-entry:${row.id}:line`, objectKey, geometryRevision, geometry: row.geometry, order: d.gpuSceneOrder?.(group, 'line'), blendMode: renderStyle.blendMode, style: resolveMapStrokeStyle({ color: color(row), layerStyle: renderStyle, antiAlias: isSmooth() }, 'distribution') });
    }
    d.replaceGpuSceneDomain?.('distributions', { polygons, strokes });
    return true;
  };
  let pendingTerritorialBoundary = null;
  let territorialBoundaryEpoch = 0;
  let territorialBoundaryCache = { countries: null, units: null, revision: -1, inputSignature: '', segments: [], rebuildCount: 0 };
  let territorialBoundaryBatchCache = { signature: '', revision: '', groups: [], data: [] };
  const renderTerritorialInternalBoundaries = (visibleFeatures = []) => {
    active();
    const t = territorialBoundary;
    const state = t.getState?.() || {};
    const displayed = territorial.displayEntities();
    const countries = displayed.filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId);
    const units = displayed.filter(entity => entity.properties.entityKind === 'regional');
    const revision = t.getTerritorialGeometryRevision?.() ?? 0;
    if (!units.some(feature => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type))) {
      pendingTerritorialBoundary = null;
      const hadBoundaries = territorialBoundaryCache.segments.length || territorialBoundaryBatchCache.groups.length;
      territorialBoundaryCache = { countries: null, units: null, revision: -1, inputSignature: '', segments: [], rebuildCount: territorialBoundaryCache.rebuildCount };
      territorialBoundaryBatchCache = { signature: '', revision: '', groups: [], data: [] };
      t.territorialBoundaryLayer?.selectAll('path.territorial-internal-boundary').remove();
      if (hadBoundaries) t.replaceGpuSceneDomain?.('territorial-boundaries', { strokes: [] });
      return true;
    }
    const inputSignature = JSON.stringify([
      t.getCountryLandRevision?.() ?? 0,
      revision,
      countries.map(feature => [String(feature?.id || ''), t.geometryToken?.(feature?.geometry)]),
      units.map(feature => [String(feature?.id || ''), t.geometryToken?.(feature?.geometry), String(feature?.properties?.entityKind || ''), String(feature?.properties?.parentId || '')]),
    ]);
    // A candidate belongs to one request lifetime, even if its input repeats
    // after undo or a project reset. Only the render path promotes its result.
    if (pendingTerritorialBoundary?.inputSignature !== inputSignature) pendingTerritorialBoundary = null;
    if (territorialBoundaryCache.revision !== revision || territorialBoundaryCache.inputSignature !== inputSignature) {
      if (pendingTerritorialBoundary?.status === 'ready') {
        territorialBoundaryCache = { countries, units, revision, inputSignature,
          segments: pendingTerritorialBoundary.segments, rebuildCount: territorialBoundaryCache.rebuildCount + 1 };
        pendingTerritorialBoundary = null;
      } else if (prepareMapDisplay && !pendingTerritorialBoundary) {
        const candidate = { inputSignature, epoch: territorialBoundaryEpoch, status: 'preparing', segments: null };
        pendingTerritorialBoundary = candidate;
        // Catch synchronous preparation failures as well as Worker rejection.
        (async () => {
          const response = await prepareMapDisplay({ kind: 'boundaries',
            ...(state.countryVisualPhase === 'preview' ? { entities: [...countries, ...units] } : {}) },
          { jobKey: 'edit-display:boundaries' });
          if (isDisposed() || pendingTerritorialBoundary !== candidate || candidate.epoch !== territorialBoundaryEpoch) return;
          if (!Array.isArray(response?.result?.segments)) throw new TypeError('Territorial boundary result requires segments');
          candidate.segments = response.result.segments;
          candidate.status = 'ready';
          onMapDisplayReady();
        })().catch(error => {
          if (isDisposed() || pendingTerritorialBoundary !== candidate || candidate.epoch !== territorialBoundaryEpoch) return;
          if (error?.name === 'AbortError' || error?.cancelled === true) {
            pendingTerritorialBoundary = null;
            return;
          }
          candidate.status = 'failed';
          reportDiagnostic({ operation: 'territorial-boundary-prepare', result: 'recovered', stage: 'topology',
            technicalMessage: String(error?.message || error), stack: error?.stack || '' });
        });
      }
    } else pendingTerritorialBoundary = null;
    const visibleIds = new Set(visibleFeatures.map(feature => String(feature.id)));
    const styleByType = new Map([
      ['subunit', { presentationGroup: 'objects' }],
      ['subunit-internal', { presentationGroup: 'objects' }],
      ['region', { presentationGroup: 'objects' }],
    ]);
    const visibleSignature = [...visibleIds].sort().map(id => {
      const feature = visibleFeatures.find(item => String(item.id) === id);
      return `${id}:${t.territorialEntityColor?.(feature)}:${JSON.stringify(t.layerStyle?.(state.layerPresentation, 'objects', `territorial:entity:${id}`))}`;
    }).join('|');
    const styleSignature = [...styleByType].map(([type, definition]) => {
      const style = t.layerStyle?.(state.layerPresentation, definition.presentationGroup) || {};
      return `${type}:${style.opacity}:${style.boundaryVisible}`;
    }).join('|');
    const boundaryColor = t.mapTheme?.().border || '#ffffff';
    // Aggregate buffers cannot selectively hide their old segments. A visibility
    // change makes that archive ineligible as a GPU upload fallback (M3), even
    // while an otherwise valid new topology is still being prepared.
    const continuityOwnerIds = [...visibleIds].sort().filter(id => {
      const style = t.layerStyle?.(state.layerPresentation, 'objects', `territorial:entity:${id}`) || {};
      return style.boundaryVisible !== false && Number(style.opacity ?? 1) > 0;
    });
    const signature = `${territorialBoundaryCache.rebuildCount};${visibleSignature};${styleSignature};${boundaryColor}`;
    if (territorialBoundaryBatchCache.signature !== signature) {
      const groups = new Map([...styleByType].map(([styleType, definition]) => [styleType, { key: styleType, styleType, segments: [] }]));
      for (const segment of territorialBoundaryCache.segments) {
        const owner = (segment.unitOwners || []).find(item => visibleIds.has(String(item.id)));
        if (!owner) continue;
        const feature = visibleFeatures.find(item => String(item.id) === String(owner.id));
        const styleType = segment.styleType || feature?.properties?.entityKind || 'subunit';
        const definition = styleByType.get(styleType) || styleByType.get('subunit');
        const group = groups.get(styleType) || groups.get('subunit');
        if (!group) continue;
        const style = t.layerStyle?.(state.layerPresentation, definition.presentationGroup, `territorial:entity:${feature.id}`) || {};
        if (!style.boundaryVisible || !(style.opacity > 0)) continue;
        group.segments.push({ a: segment.a, b: segment.b, color: boundaryColor, opacity: style.opacity });
      }
      const preparedGroups = [...groups.values()].filter(group => group.segments.length);
      const fallbackGroups = new Map();
      for (const group of preparedGroups) for (const segment of group.segments) {
        const key = `${group.styleType}:${segment.color}:${segment.opacity}`;
        if (!fallbackGroups.has(key)) fallbackGroups.set(key, { key, styleType: group.styleType, color: segment.color, opacity: segment.opacity, coordinates: [] });
        fallbackGroups.get(key).coordinates.push([segment.a, segment.b]);
      }
      const data = [...fallbackGroups.values()].map(group => ({ ...group, geometry: { type: 'MultiLineString', coordinates: connectBoundarySegments(group.coordinates) } }));
      territorialBoundaryBatchCache = { signature, revision: `${territorialBoundaryCache.rebuildCount}:${signature}`, groups: preparedGroups, data };
    }
    const data = territorialBoundaryBatchCache.data;
    // These are scene strokes. A projected SVG copy caused a second visual
    // owner with different cache and transition timing.
    t.territorialBoundaryLayer?.selectAll('path.territorial-internal-boundary').remove();
    t.replaceGpuSceneDomain?.('territorial-boundaries', { strokes: data.map((group, index) => {
      const definition = styleByType.get(group.styleType) || styleByType.get('subunit') || { presentationGroup: 'objects' };
      return { key: `territorial-internal:${group.key}`, continuityOwnerIds, geometryRevision: territorialBoundaryBatchCache.revision, geometry: group.geometry, order: t.gpuSceneOrder?.(definition.presentationGroup, 'territorial-boundary', '', index), style: resolveMapStrokeStyle({ color: group.color, layerStyle: { opacity: group.opacity, boundaryWidth: 1 } }, group.styleType) };
    }) });
    return true;
  };
  const syncBaseView = (viewState = null) => {
    active();
    const b = base;
    b.updatePandoGlobeShell?.(viewState);
    return true;
  };
  const renderBase = (viewState = null) => {
    syncBaseView(viewState);
    const b = base;
    if(b.getState().resourceCapabilities?.graticule===false||b.getState().backgroundSettings?.graticule===false){b.replaceGpuSceneDomain('base-graticule',{strokes:[]});return true;}
    const graticuleGeometry = b.graticule?.();
    if (!graticuleGeometry) return false;
    const light = b.isLightTheme?.() ?? true;
    b.replaceGpuSceneDomain?.('base-graticule', { strokes: [{
      key: 'base:graticule', geometryRevision: `${viewState.projection}:graticule-v2`,
      ...b.buildGraticuleStrokeGeometryPacket?.(graticuleGeometry, { maxEdgeDegrees: 0.5 }),
      lodPolicy: 'exact', protected: true, order: -10000,
      style: { color: light ? '#aaaaaa' : '#688091', alpha: light ? 0.34 : 0.20, width: 0.55, cap: 'butt', join: 'round' },
    }] });
    return true;
  };
  const renderProjectedOverlays = (frameContext = null) => {
    active();
    for (const layer of projected.layers || []) {
      layer?.selectAll?.('path')?.attr('d', framePath(frameContext));
    }
    return true;
  };
  const resetTerritorialBoundaryCache = () => {
    territorialBoundaryEpoch++;
    pendingTerritorialBoundary = null;
    territorialBoundaryCache = {
      countries: null,
      units: null,
      revision: -1,
      inputSignature: '',
      segments: [],
      rebuildCount: 0,
    };
    territorialBoundaryBatchCache = { signature: '', revision: '', groups: [], data: [] };
  };
  const getTerritorialBoundaryStats = () => Object.freeze({
    rebuildCount: territorialBoundaryCache.rebuildCount,
    revision: territorialBoundaryBatchCache.revision || '',
    inputSignature: territorialBoundaryCache.inputSignature || '',
    batchSignature: territorialBoundaryBatchCache.signature || '',
    segmentCount: territorialBoundaryCache.segments.length,
    groupCount: territorialBoundaryBatchCache.groups.length,
    pendingInputSignature: pendingTerritorialBoundary?.inputSignature || '',
    pendingStatus: pendingTerritorialBoundary?.status || 'idle',
  });
  return Object.freeze({renderCountries,renderHydro,renderHydroEdits,renderTerritorialUnits,
 renderGenericFeatures,renderDistributions,renderBase,syncBaseView,renderProjectedOverlays,
 buildDistributionRenderRows,resetTerritorialBoundaryCache,getTerritorialBoundaryStats});
}
