import { createMapVisualFrame, isMapVisualFrame } from './map-visual-frame.js';
import { placeLabelDimensions } from './label-layout.js';
import { createPlaceRuntime } from './place-runtime.js';
import { isBuiltinPlaceId } from './place-contract.js';
import { placeLabelRowsAtMonth } from './place-name-display.js';
import { temporalMonthEnd } from './temporal.js';
import { territorialLabelFlag } from './territorial-label-flags.js';
import { effectiveTerritorialFlagUrl } from './country-flags.js';
import { territorialPaintRole, territorialSymbolVisibility } from './layer-presentation.js';
import { createTerritorialFillResolver } from './territorial-fill-style.js';

/** TerritorialLabels: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createTerritorialLabels({ capabilities = {builtinPlaces:true,eagerBuiltinPlaces:true} } = {}) {
  let dependencies;
  let countryOutlineCache;
  let labelLayoutMetrics;
  let territorialLabelScreenAreas;
  let builtinPlaces;
  function connect(ports) {
    if (dependencies) throw new Error('territorial-labels already connected');
    dependencies = ports;
  }

  function placeMapDate() {
    const month = dependencies.projectState.state.timelineCursor;
    return typeof month === 'string' && /^\d{4}-\d{2}$/u.test(month)
      ? temporalMonthEnd(month).canonical : null;
  }

  function placeView() {
    dependencies.mapView.updateProjection();
    const state = dependencies.projectState.state;
    const frame = createMapVisualFrame({ viewState: dependencies.mapHostViewB.projectionViewSnapshot(), projectCoordinate: dependencies.mapView.activeProjection() });
    const projectionFrame = { mode: frame.mode, cssTranslate: frame.cssTranslate, cssScale: frame.cssScale, cssViewport: frame.cssViewport,
      safeInset: frame.safeInset, flatCenter: frame.flatCenter, worldOffsets: frame.worldOffsets,
      rows: { rowX: frame.rowX, rowY: frame.rowY, rowZ: frame.rowZ } };
    return { projection: state.projection, threshold: currentMapZoom(), mapDate: placeMapDate(), presentation: {month:state.timelineCursor,languages:dependencies.preferences.userPreferences.labels.place.languages}, width: state.size.width, height: state.size.height,
      scale: frame.cssScale, flatCenter: state.view.flatCenter, rotation: state.view.globeRotation, projectionFrame };
  }

  function preparePlaces({ force = false } = {}) {
    if (!capabilities.builtinPlaces || (!capabilities.eagerBuiltinPlaces && !force && builtinPlaces.snapshot().revision === 0)) return Promise.resolve(false);
    if (dependencies.projectState.state.mapMoving) { builtinPlaces.beginInteraction(); return Promise.resolve(false); }
    if (!force && dependencies.projectState.state.layerVisibility.labels === false) { builtinPlaces.cancelViewport(); return builtinPlaces.settle(null); }
    return builtinPlaces.settle(placeView());
  }

  function labelById(id) {
    const user = dependencies.projectState.state.labels.find(item => String(item.id) === String(id));
    if (user) return user;
    const builtin = builtinPlaces.resolve(id);
    if (builtin) builtinPlaces.retain(builtin);
    return builtin;
  }

  function currentMapZoom() {
    return dependencies.projectState.state.projection === 'globe' ? dependencies.projectState.state.view.globeZoom : dependencies.projectState.state.view.flatZoom;
  }

  function countryOutlineFeature(feature) {
    const geometry = feature?.geometry;
    if (geometry && countryOutlineCache.has(geometry)) return countryOutlineCache.get(geometry);
    const outline = (0, dependencies.labelPresentation.buildRenderableStrokeFeature)(feature);
    if (geometry) countryOutlineCache.set(geometry, outline);
    return outline;
  }

  function territorialLabelScreenMetrics(feature, fontSize, projectedExtent, labelFeature, frame) {
    let width = Number(projectedExtent?.width);
    let height = Number(projectedExtent?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      const geometry = feature?.geometry;
      const bounds = geometry ? (0, dependencies.spatialQuery.geometryBounds)(geometry) : null;
      const scale = frame.cssScale;
      const lonSpan = bounds?.every(Number.isFinite)
        ? Math.max(0, Math.min(360, Number(bounds[2]) - Number(bounds[0]))) * Math.PI / 180
        : 0;
      const latSpan = bounds?.every(Number.isFinite)
        ? Math.max(0, Math.min(180, Number(bounds[3]) - Number(bounds[1]))) * Math.PI / 180
        : 0;
      if (frame.projection === 'globe') {
        const centerLatitude = bounds?.every(Number.isFinite)
          ? Math.max(-89.999, Math.min(89.999, (Number(bounds[1]) + Number(bounds[3])) / 2)) * Math.PI / 180
          : 0;
        width = Math.min(scale * 2, scale * lonSpan * Math.max(0.08, Math.abs(Math.cos(centerLatitude))));
        height = Math.min(scale * 2, scale * latSpan);
      } else {
        width = scale * lonSpan;
        height = scale * latSpan;
      }
    }
    const textWidth = Math.max(20, [...(0, dependencies.objectPresentation.territorialEntityName)(labelFeature)].length * fontSize * 1.02 + 8);
    return {
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      area: Number.isFinite(width * height) ? width * height : 0,
      textWidth,
      textHeight: fontSize * 1.65 + 4,
    };
  }

  function shouldShowTerritorialLabel(feature, metrics) {
    const id = String(feature.id || '');
    if (!(0, dependencies.layerPresentation.isLayerItemVisible)('objectLabels', id) || dependencies.labelPresentation.pendingCountryLabelAnchors.has(id)) return false;
    if ((dependencies.projectState.state.selected?.domain === 'territorial' && (dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.entityKind === 'general' && !dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.selected?.id)?.properties.parentId)) && dependencies.projectState.state.selected.id === id) return true;
    const widthFit = metrics.width >= Math.min(34, metrics.textWidth * ((0, dependencies.surfaces.isMobile)() ? 0.48 : 0.42));
    const heightFit = metrics.height >= metrics.textHeight * 0.52;
    const areaFit = metrics.area >= Math.max((0, dependencies.surfaces.isMobile)() ? 72 : 58, metrics.textWidth * metrics.textHeight * 0.32);
    return widthFit && heightFit && areaFit;
  }

  function renderPendingCountryOverlays(frame) {
    if (!dependencies.mapLayers.countryLayer) return;
    if (!isMapVisualFrame(frame) || typeof frame.projectPath !== 'function') throw new TypeError('Country patch SVG requires a MapVisualFrame path.');
    const theme = dependencies.preferences.mapTheme();
    const resolveFill = createTerritorialFillResolver({ state: dependencies.projectState.state,
      entityRepository: dependencies.territorialModel.entityRepository,
      terrainAlpha: theme.countryColorAlpha,
      mapSubstrate: dependencies.projectState.state.physicalSettings.terrainVisible ? null
        : { color: theme.defaultLand, fillAlpha: theme.baseLandAlpha } });
    const pending = dependencies.projectState.state.layerVisibility.objects && dependencies.projectState.state.pendingCountryRenderIds?.size
      ? [...dependencies.projectState.state.pendingCountryRenderIds]
        .map(dependencies.territorialModel.entityRepository.get)
        .filter(feature => feature && (0, dependencies.layerPresentation.isCountryVisibleById)(String(feature.id || '')))
      : [];
    const patchFill = dependencies.mapLayers.countryLayer.selectAll('path.country-patch-preview-fill')
      .data(pending, feature => feature.id);
    patchFill.enter().append('path').attr('class', 'country-patch-preview country-patch-preview-fill');
    dependencies.mapLayers.countryLayer.selectAll('path.country-patch-preview-fill')
      .attr('d', feature => frame.projectPath(feature))
      .attr('data-gpu-scene-key', feature => `pending-country-fill:${feature.id}`)
      .style('fill', feature => resolveFill(feature).color || 'none')
      .style('fill-opacity', feature => resolveFill(feature).fillAlpha)
      .style('stroke', 'none');
    patchFill.exit().remove();
    const patchOutline = dependencies.mapLayers.countryLayer.selectAll('path.country-patch-preview-outline')
      .data(pending, feature => feature.id);
    patchOutline.enter().append('path').attr('class', 'country-patch-preview country-patch-preview-outline');
    dependencies.mapLayers.countryLayer.selectAll('path.country-patch-preview-outline')
      .attr('d', feature => frame.projectPath(countryOutlineFeature(feature)))
      .attr('data-gpu-scene-key', feature => `pending-country-outline:${feature.id}`)
      .style('fill', 'none')
      .style('stroke', (0, dependencies.preferences.mapTheme)().border)
      .style('stroke-opacity', (0, dependencies.preferences.mapTheme)().borderAlpha);
    patchOutline.exit().remove();
  }

  function visibleLabelLayout(frameContext) {
    if (!isMapVisualFrame(frameContext)) throw new TypeError('Label layout requires a MapVisualFrame.');
    dependencies.countries.scheduleCountryLabelAnchors?.();
    const candidates = [];
    const indexedLabelIds = dependencies.projectState.state.layerVisibility.labels
      ? new Set((0, dependencies.spatialQuery.visibleMapObjectCandidates)(['label']).map(record => String(record.id)))
      : new Set();
    territorialLabelScreenAreas.clear();
    const zoom = frameContext.viewState.zoom;
    const renderCountries = (0, dependencies.countries.builtinTerritorialScene)();
    const visibility = territorialSymbolVisibility(dependencies.projectState.state);
    const flagOptions = {
      zoom, enabled: true,
      isVisible: feature => visibility.flag,
      flagUrl: feature => effectiveTerritorialFlagUrl(territorialPaintRole(feature) === 'country-fill'
        ? dependencies.territorialModel.entityRepository.get(feature.id) : feature,
        { assetRevision: dependencies.layerPresentation.ASSET_REVISION }),
    };
    for (const feature of renderCountries.labelById.values()) {
      if (dependencies.projectState.state.countryVisualPhase === 'pending') continue;
      const id = String(feature.id || '');
      const group = 'objects';
      const namesVisible = visibility.name;
      const labelRef = renderCountries.labelRefs.get(id);
      if (!(0, dependencies.layerPresentation.isLayerItemVisible)(group, labelRef?.id || id)) continue;
      if (!(0, dependencies.layerPresentation.isLayerItemVisible)('objectLabels', id) || dependencies.labelPresentation.pendingCountryLabelAnchors.has(id)) continue;
      const flag = namesVisible ? null : territorialLabelFlag(feature, flagOptions);
      if (!namesVisible && !flag) continue;
      const settings = (0, dependencies.labelPresentation.automaticLabelSettings)('country', dependencies.projectState.state.labelSettings[(0, dependencies.labelPresentation.labelKey)('territorial', labelRef.id)] || {});
      if (zoom < Number(settings.minZoom ?? -Infinity) || zoom > Number(settings.maxZoom ?? Infinity)) continue;
      const anchor = dependencies.labelPresentation.countryLabelAnchors.get(id);
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : anchor;
      if (!Array.isArray(coordinate)) continue;
      const point = frameContext.projectVisibleCoordinate(coordinate);
      if (!point) continue;
      const selected = dependencies.domains.selectionDomain.has(labelRef);
      const displayFeature = dependencies.objectModelB.territorialScope.displayFeature(renderCountries.labelRefs.get(String(feature.id))?.id || feature.id);
      const baseMetrics = territorialLabelScreenMetrics(displayFeature, (0, dependencies.surfaces.isMobile)() ? 8 : 9, null, feature, frameContext);
      const fontSize = baseMetrics.area >= ((0, dependencies.surfaces.isMobile)() ? 3200 : 2200) ? ((0, dependencies.surfaces.isMobile)() ? 10 : 12) : (0, dependencies.surfaces.isMobile)() ? 8 : 9;
      const metrics = territorialLabelScreenMetrics(displayFeature, fontSize, baseMetrics, feature, frameContext);
      territorialLabelScreenAreas.set(id, metrics.area);
      if (namesVisible && !selected && !shouldShowTerritorialLabel(feature, metrics)) continue;
      candidates.push({
        key: (0, dependencies.labelPresentation.labelKey)('territorial', labelRef.id), sourceType: 'territorial', source: feature, point,
        nameVisible: namesVisible,
        width: namesVisible ? metrics.textWidth : flag.width,
        height: namesVisible ? metrics.textHeight : flag.height,
        priority: settings.priority ?? dependencies.labelPresentation.LABEL_PRIORITIES.country, minZoom: settings.minZoom, maxZoom: settings.maxZoom,
        pinned: settings.pinned, collisionGroup: settings.collisionGroup,
        selected,
      });
    }
    const copiedIds = new Set(dependencies.projectState.state.labels.map(label => label.sourcePlaceId).filter(Boolean));
    const selectedIds = new Set(dependencies.domains.selectionDomain.snapshot().selection.items.filter(ref => ref.domain === 'label').map(ref => String(ref.id)));
    const builtinLabels = [...new Map([...builtinPlaces.snapshot().records, ...[...selectedIds].map(id => builtinPlaces.resolve(id)).filter(Boolean)].map(label => [label.id, label])).values()].filter(label => !copiedIds.has(label.id));
    const builtinIds = new Set(builtinLabels.map(label => label.id));
    const labelSources = [...dependencies.projectState.state.labels, ...builtinLabels];
    const placeLanguages = dependencies.preferences.userPreferences.labels.place.languages;
    if (dependencies.projectState.state.layerVisibility.labels) for (const label of labelSources) {
      const selected = selectedIds.has(String(label.id));
      if (!selected && !builtinIds.has(label.id) && !indexedLabelIds.has(String(label.id))) continue;
      const settings = (0, dependencies.labelPresentation.automaticLabelSettings)(label.kind, dependencies.projectState.state.labelSettings[(0, dependencies.labelPresentation.labelKey)('label', label.id)] || {});
      if (zoom < Number(settings.minZoom ?? -Infinity) || zoom > Number(settings.maxZoom ?? Infinity)) continue;
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      const point = frameContext.projectVisibleCoordinate(coordinate);
      if (!point) continue;
      const priority = settings.priority ?? (label.kind === 'capital' ? dependencies.labelPresentation.LABEL_PRIORITIES.capital : label.kind === 'city' ? dependencies.labelPresentation.LABEL_PRIORITIES.majorCity : label.kind === 'region' ? dependencies.labelPresentation.LABEL_PRIORITIES.administrative : dependencies.labelPresentation.LABEL_PRIORITIES.place);
      const rows = isBuiltinPlaceId(label.id)
        ? placeLabelRowsAtMonth(label, dependencies.projectState.state.timelineCursor, placeLanguages)
        : [{ language: 'ko', text: label.name }];
      if (!rows.length) continue;
      candidates.push({
        key: (0, dependencies.labelPresentation.labelKey)('label', label.id), sourceType: 'label', source: label, point, rows,
        ...placeLabelDimensions(rows),
        priority, minZoom: Math.max(settings.minZoom, Number(label.minZoom || 0)), maxZoom: settings.maxZoom,
        pinned: settings.pinned, collisionGroup: settings.collisionGroup,
        selected,
      });
    }
    // Visibility follows zoom, viewport and collision rules. GPU quality must
    // never let territorial names consume a reduced budget ahead of places.
    // layoutLabels still owns the fixed safety cap and protected priorities.
    const nextLabelLayoutMetrics = {
      qualityTier: dependencies.renderScene.currentRenderQuality.tier,
      qualityCandidateCount: candidates.length,
      qualityCulledCount: 0,
    };
    const safe = frameContext.safeInset;
    const placed = (0, dependencies.labelPresentation.layoutLabels)(candidates, {
      zoom,
      padding: (0, dependencies.surfaces.isMobile)() ? 5 : 3,
      bounds: {
        left: Number(safe.left || 0),
        top: Number(safe.top || 0),
        right: frameContext.cssViewport[0] - Number(safe.right || 0),
        bottom: frameContext.cssViewport[1] - Number(safe.bottom || 0),
      },
      metrics: nextLabelLayoutMetrics,
    });
    const territorialFlags = (0, dependencies.labelPresentation.layoutTerritorialFlags)(placed, flagOptions);
    const placedTerritorialLabels = placed.filter(item => item.sourceType === 'territorial'
      && (item.nameVisible || territorialFlags.has(String(item.source.id))));
    const placedUserLabels = placed.filter(item => item.sourceType === 'label');
    labelLayoutMetrics = nextLabelLayoutMetrics;
    if (dependencies.spatialQuery.viewportCullingMetrics.lastByDomain.label) dependencies.spatialQuery.viewportCullingMetrics.lastByDomain.label.finalVisibleCount = placedUserLabels.length;
    return {
      territorialLabels: placedTerritorialLabels.map(item => item.source),
      territorialLabelNames: new Map(placedTerritorialLabels.map(item => [String(item.source.id), item.nameVisible])),
      territorialFlags,
      userLabels: placedUserLabels.map(item => item.source),
      userLabelRows: new Map(placedUserLabels.map(item => [String(item.source.id), item.rows])),
      territorialLabelPoints: new Map(placedTerritorialLabels.map(item => [String(item.source?.id || ''), item.point])),
      userLabelPoints: new Map(placedUserLabels.map(item => [String(item.source?.id || ''), item.point])),
      territorialLabelScreenAreas: new Map(territorialLabelScreenAreas),
      candidateCount: candidates.length,
    };
  }

  function initializeCountryOutlineCache() {
    (countryOutlineCache = new WeakMap());
  }

  function initializeLabelLayoutMetrics() {
    (labelLayoutMetrics = {});
    builtinPlaces = createPlaceRuntime({
      getPresentation:()=>({month:dependencies.projectState.state.timelineCursor,languages:dependencies.preferences.userPreferences.labels.place.languages}),
      admitReferences:refs=>dependencies.domains.projectDomain.admitSelectionCatalog('placeBuiltin',refs),
      manifestUrl: dependencies.platform.runtimeAssetUrl('../data/places/manifest.json').href,
      createWorker: () => new Worker(dependencies.platform.runtimeAssetUrl('workers/place-worker.js'), { type: 'module', name: 'pandolab-places' }),
      getProtectedIds: () => {
        const selection = dependencies.domains.selectionDomain.snapshot().selection;
        const refs = selection.items.filter(ref => ref.domain === 'label');
        return [refs.find(ref => ref.key === selection.primaryKey)?.id, ...refs.map(ref => ref.id)].filter(Boolean);
      },
      onSettled: () => { dependencies.domains.objectSearchController.render(); },
      onSnapshot: () => dependencies.domains.renderingDomain.invalidateLabels('builtin-places-ready'),
      onError: error => dependencies.feedback.reportOperationError(error, '내장 지명을 불러오지 못했습니다.', 'PL-PLACE-LOAD-001'),
    });
  }

  function initializeTerritorialLabelScreenAreas() {
    (territorialLabelScreenAreas = new Map());

  }

  return Object.freeze({
    connect,
    preparePlaces,
    labelById,
    get builtinPlaces() { return builtinPlaces; },
    builtinPlaceSelectionReferences:()=>builtinPlaces.selectionReferences(),
    initializeCountryOutlineCache,
    initializeLabelLayoutMetrics,
    initializeTerritorialLabelScreenAreas,
    get countryOutlineCache() { return countryOutlineCache; },
    get countryOutlineFeature() { return countryOutlineFeature; },
    get currentMapZoom() { return currentMapZoom; },
    get labelLayoutMetrics() { return labelLayoutMetrics; },
    get renderPendingCountryOverlays() { return renderPendingCountryOverlays; },
    get visibleLabelLayout() { return visibleLabelLayout; },
  });
}
