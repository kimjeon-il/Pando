import { mapVisualRank } from './layer-presentation.js';
import { createProductModePolicy } from './product-mode-policy.js';
/** MapHost: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createMapHost({productMode='editor'}={}) {
  const productPolicy=createProductModePolicy(productMode);
  let dependencies;
  let svg;
  let interactionSvg;
  let shadowLayer;
  let oceanLayer;
  let countryLayer;
  let previewLayer;
  let hoverLayer;
  let selectionLayer;
  let validationLayer;
  let snapLayer;
  let boundaryEditLayer;
  let overlayStackLayer;
  let territorialBoundaryLayer;
  let territorialOperationLayer;
  let territorialUnitLayer;
  let distributionLayer;
  let genericFeatureLayer;
  let hydroLakeLayer;
  let hydroRiverLayer;
  let hydroEditLayer;
  let territorialLabelLayer;
  let labelLayer;
  let vertexLayer;
  let draftLayer;
  let mapInteractionLayer;
  let mapResizeObserver;
  let mapResizeFrame;
  let mapResizeSignature;
  let mapResizeReasons;
  let resolutionQuery;
  let viewRevision;
  let visualProjectionRevision;
  let lastVisualProjectionKind;
  let renderedViewSignature;
  let mapHost;
  let mapHostReadyPromise;
  function connect(ports) {
    if (dependencies) throw new Error('map-host already connected');
    dependencies = ports;
  }

  function projectionViewSnapshot() {
    const projection = (0, dependencies.mapView.activeProjection)();
    const translate = projection.translate().map(Number);
    const center = (0, dependencies.mapView.screenToGeo)(translate);
    return {
      projection: dependencies.projectState.state.projection,
      flatProjectionKind: dependencies.platformConfigurationA.FLAT_PROJECTION_KIND,
      size: { width: dependencies.projectState.state.size.width, height: dependencies.projectState.state.size.height },
      dpr: dependencies.rendering.gpuMapRenderer.getRenderPixelRatio(),
      sourceDpr: Math.max(1, Number(window.devicePixelRatio || 1)),
      safeInset: (0, dependencies.projectionView.currentMapSafeInsets)(),
      translate,
      scale: Number(projection.scale()),
      rotation: dependencies.projectState.state.projection === 'globe' ? dependencies.projectState.state.view.globeRotation.map(Number) : null,
      projectionCenter: dependencies.projectState.state.projection === 'flat' ? dependencies.projectState.state.view.flatCenter.map(Number) : null,
      flatCenter: dependencies.projectState.state.view.flatCenter.map(Number),
      globeRotation: dependencies.projectState.state.view.globeRotation.map(Number),
      flatZoom: Number(dependencies.projectState.state.view.flatZoom),
      globeZoom: Number(dependencies.projectState.state.view.globeZoom),
      geographicCenter: center ? center.map(Number) : null,
      zoom: dependencies.projectState.state.projection === 'globe' ? Number(dependencies.projectState.state.view.globeZoom) : Number(dependencies.projectState.state.view.flatZoom),
    };
  }

  function syncViewRevision() {
    const snapshot = projectionViewSnapshot();
    const signature = JSON.stringify(snapshot);
    if (signature !== renderedViewSignature) {
      renderedViewSignature = signature;
      viewRevision += 1;
    }
    window.__PANDOLAB_VIEW_REVISION__ = viewRevision;
    const viewState = { ...snapshot, revision: viewRevision };
    window.__PANDOLAB_VIEW_STATE__ = viewState;
    return viewState;
  }

  function syncMapHostFromState() {
    return false;
  }

  function handleRenderFrameComplete(sample) {
    const gpuStats = dependencies.rendering.gpuMapRenderer.getRuntimeState?.() || {};
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) {
      startupMetrics.firstCanonicalFrameMs = gpuStats.firstCanonicalFrameMs ?? startupMetrics.firstCanonicalFrameMs;
      startupMetrics.canonicalFrameFallbackCount = Number(gpuStats.canonicalFrameFallbackCount || 0);
    }
    // Startup/full-scene work is intentionally expensive and is not an
    // interaction performance sample. Feeding it into the adaptive window
    // caused an immediate post-load downgrade and another scene refresh.
    const shouldSampleInteractionBudget = sample.interactionActive || (!sample.full && sample.viewFrame === true);
    const changed = shouldSampleInteractionBudget && dependencies.renderQuality.renderQualityController.recordFrame(sample.durationMs, {
      interaction: sample.interactionActive,
    });
    if (changed) (0, dependencies.renderQuality.queueAdaptiveRenderQualityRefresh)('frame-budget-quality-change');
  }

  function visualProjectionForSnapshot(viewState) {
    if (viewState.projection === 'globe') {
      return dependencies.platform.d3.geo.orthographic()
        .translate(viewState.translate)
        .scale(viewState.scale)
        .rotate(viewState.rotation || [0, 0, 0])
        .clipAngle(90)
        .precision((0, dependencies.surfaces.isMobile)() ? 0.9 : 0.35);
    }
    const safe = viewState.safeInset || dependencies.mapLayout.DEFAULT_SAFE_INSETS;
    return dependencies.platform.d3.geo.equirectangular()
      .translate(viewState.translate)
      .scale(viewState.scale)
      .center(viewState.projectionCenter || [0, 0])
      .rotate([0, 0, 0])
      .clipExtent([
        [safe.left, safe.top],
        [viewState.size.width - safe.right, viewState.size.height - safe.bottom],
      ])
      .precision((0, dependencies.surfaces.isMobile)() ? 0.7 : 0.25);
  }

  function prepareVisualFrame({frameId}={}){
    dependencies.mapView.updateProjection();
    const viewState=syncViewRevision();
    if(lastVisualProjectionKind!==viewState.projection){lastVisualProjectionKind=viewState.projection;visualProjectionRevision++;}
    const visualProjection=visualProjectionForSnapshot(viewState);
    const visualPath=dependencies.platform.d3.geo.path().projection(visualProjection);
    return dependencies.renderFactories.createMapVisualFrame({frameId,viewRevision:viewState.revision,
      projectGeneration:dependencies.domains.projectDomain.getGeneration(),projectionRevision:visualProjectionRevision,viewState,
      layoutSnapshot:dependencies.mapLayout.mapLayoutMetricsSnapshot,projectCoordinate:coordinate=>visualProjection(coordinate),
      projectPath:geometry=>visualPath(geometry),createCanvasPath:context=>dependencies.platform.d3.geo.path().projection(visualProjection).context(context)});
  }

  function mapSurfaceHostOptions() {
    return {
      getProjectionKind: () => dependencies.projectState.state.projection,
      setProjectionKind: kind => {
        productPolicy.assertProjection(kind);
        dependencies.projectState.state.projection = kind === 'globe' ? 'globe' : 'flat';
        (0, dependencies.mapView.updateProjection)();
        return true;
      },
      getViewState: () => projectionViewSnapshot(),
      setViewState: view => {
        productPolicy.assertProjection(view?.projection);
        if (view?.projection) dependencies.projectState.state.projection = view.projection === 'globe' ? 'globe' : 'flat';
        if (view?.view) dependencies.projectState.state.view = (0, dependencies.platform.deepClone)(view.view);
        (0, dependencies.mapView.updateProjection)();
        return true;
      },
      getViewportSize: () => {
        const layout = (0, dependencies.mapView.projectionLayoutMetrics)();
        return { width: layout.width, height: layout.height, dpr: layout.dpr };
      },
      project: coordinate => (0, dependencies.mapView.activeProjection)()(coordinate),
      unproject: point => (0, dependencies.mapView.screenToGeo)(point),
      requestRepaint: reason => dependencies.domains.renderingDomain?.invalidateGpuFrame?.(reason || 'legacy-host-repaint'),
      resize: () => dependencies.rendering.gpuMapRenderer.resize(),
      dragBy: dependencies.navigation.panMapViewBy,
      getDebugState: () => ({ viewRevision }),
    };
  }

  function createPreferredMapHost(mapEl) {
    const legacy = (0, dependencies.renderFactories.createMapSurfaceHost)(mapSurfaceHostOptions());
    legacy.attach(mapEl);
    return legacy;
  }

  async function activateMapSurfaceHost(reason = '') {
    const mapEl = (0, dependencies.platform.$)('map');
    mapHost?.destroy?.();
    // Reuse the Pando canvas created by initSvg when host initialization is
    // retried. Creating another canvas here would create a second visible
    // surface and, after a context failure, leave stale pixels underneath it.
    const gpuCanvas = mapEl?.querySelector('.gpu-map-canvas') || document.createElement('canvas');
    if (!gpuCanvas.parentNode) {
      const overlay = mapEl?.querySelector('.map-overlay-svg');
      if (overlay) mapEl.insertBefore(gpuCanvas, overlay);
      else mapEl?.appendChild(gpuCanvas);
    }
    dependencies.rendering.gpuMapRenderer.attach(gpuCanvas);
    mapHost = (0, dependencies.renderFactories.createMapSurfaceHost)(mapSurfaceHostOptions());
    mapHost.attach(mapEl);
    await mapHost.initialize();
    document.body.dataset.mapHost = dependencies.applicationConstantsA.MAP_HOST_KINDS.LEGACY;
    window.__PANDOLAB_MAP_HOST__ = mapHost;
    if (reason) console.warn('[map-host]', reason);
    return false;
  }

  async function initializeMapHost() {
    if (!mapHost) return activateMapSurfaceHost('MapHost가 초기화되지 않았습니다.');
    try {
      await mapHost.initialize();
      (0, dependencies.renderQuality.applyAdaptiveRenderQuality)({ refreshScene: false, reason: 'map-host-ready' });
      document.body.dataset.mapHost = dependencies.applicationConstantsA.MAP_HOST_KINDS.LEGACY;
      window.__PANDOLAB_MAP_HOST__ = mapHost;
      return true;
    } catch (error) {
      return activateMapSurfaceHost(error?.message || String(error));
    }
  }

  function attachMapOutput({overlaySvg,gpuCanvas}) {
    svg = overlaySvg;
    mapHost?.destroy?.();
    mapHost = createPreferredMapHost((0, dependencies.platform.$)('map'));
    dependencies.rendering.gpuMapRenderer.attach(gpuCanvas);
    const handleSelectionRenderError = ({ stage = 'selection-overlay-render', channel = '', error } = {}) => {
      if (dependencies.domains.renderingDomain?.recordSelectionRenderError) {
        dependencies.domains.renderingDomain.recordSelectionRenderError({ stage, error });
      } else {
        dependencies.readiness.reliabilityDiagnostic.push({
          category: 'render',
          operation: 'selection-overlay-render',
          result: 'recovered',
          channel,
          technicalMessage: String(error?.message || error || stage),
          stack: error?.stack || '',
        });
      }
    };
    dependencies.mapHostCommands.installSelectionPass((0, dependencies.renderFactories.createSelectionPass)({
      onRenderError: handleSelectionRenderError,
    }));
    dependencies.rendering.gpuMapRenderer.setSelectionPass?.(dependencies.gpuRenderingA.selectionPass);
    (0, dependencies.preferences.syncResolvedInteractionStyle)();
  }

  function stopMapResizeObserver() {
    mapResizeObserver?.disconnect();
    window.visualViewport?.removeEventListener('resize', handleVisualViewportResize);
    if (mapResizeFrame) cancelAnimationFrame(mapResizeFrame);
    mapResizeFrame = 0;
    resolutionQuery?.removeEventListener('change', watchDevicePixelRatio);
    resolutionQuery = null;
    mapHost?.destroy?.();
  }

  function initSvg() {
    const mapEl = (0, dependencies.platform.$)('map');
    const map = dependencies.platform.d3.select(mapEl);
    mapHost?.destroy?.();
    mapHost = null;
    mapHostReadyPromise = Promise.resolve(false);
    dependencies.rendering.gpuMapRenderer.setSelectionPass?.(null);
    dependencies.mapHostCommands.installSelectionPass(null);
    map.selectAll('*').remove();
    dependencies.lifecycleUi.mapDebug.installViewFacade();

    dependencies.mapHostCommands.installBaseSvg(map.append('svg')
      .attr('class', 'map-base-svg')
      .attr('aria-hidden', 'true')
      .attr('focusable', 'false'));
    const baseRoot = dependencies.mapLayers.baseSvg.append('g').attr('class', 'map-base-root');
    dependencies.mapHostCommands.installFlatOceanLayer(baseRoot.append('rect').attr('class', 'map-ocean map-ocean-flat'));
    if(productMode==='viewer') {
      oceanLayer = baseRoot.append('circle').attr('class', 'map-ocean map-ocean-globe');
      shadowLayer = baseRoot.append('circle').attr('class', 'globe-shadow');
    }

    const gpuCanvas = document.createElement('canvas');
    gpuCanvas.className = 'gpu-map-canvas';
    mapEl.appendChild(gpuCanvas);
    svg = map.append('svg').attr('class', 'map-svg map-overlay-svg');
    attachMapOutput({overlaySvg:svg,gpuCanvas});
    ({interactionSvg,mapInteractionLayer,countryLayer,hydroLakeLayer,hydroRiverLayer,hydroEditLayer,boundaryEditLayer,overlayStackLayer,territorialBoundaryLayer,territorialUnitLayer,distributionLayer,genericFeatureLayer,hoverLayer,selectionLayer,previewLayer,validationLayer,vertexLayer,draftLayer,snapLayer,territorialOperationLayer,territorialLabelLayer,labelLayer}=createMapOverlayLayers({map,svg}));

    dependencies.mapHostCommands.installMapInputController(dependencies.lifecycleUi.mapInputPresentation.bindSvg(svg));
  }

  function queueMapResize(reason = 'layout') {
    mapResizeReasons.add(String(reason || 'layout'));
    if (mapResizeFrame) return;
    mapResizeFrame = requestAnimationFrame(() => {
      mapResizeFrame = 0;
      const reasons = [...mapResizeReasons].sort();
      mapResizeReasons.clear();
      (0, dependencies.projectionView.refreshMapLayoutMetrics)(reasons.join(',') || 'layout');
      resizeMap();
    });
  }

  function watchDevicePixelRatio() {
    if (resolutionQuery) {
      if (typeof resolutionQuery.removeEventListener === 'function') resolutionQuery.removeEventListener('change', watchDevicePixelRatio);
      else resolutionQuery.removeListener?.(watchDevicePixelRatio);
    }
    resolutionQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) || null;
    if (typeof resolutionQuery?.addEventListener === 'function') resolutionQuery.addEventListener('change', watchDevicePixelRatio, { once: true });
    else resolutionQuery?.addListener?.(watchDevicePixelRatio);
    queueMapResize('dpr-change');
  }

  function handleVisualViewportResize() {
    (0, dependencies.workspaceUiB.refreshMapSheetMetrics)();
    queueMapResize('visual-viewport-resize');
  }

  function startMapResizeObserver() {
    mapResizeObserver?.disconnect?.();
    window.visualViewport?.removeEventListener('resize', handleVisualViewportResize);
    if (typeof ResizeObserver === 'function') {
      mapResizeObserver = new ResizeObserver(() => queueMapResize('resize-observer'));
      mapResizeObserver.observe((0, dependencies.platform.$)('map'));
    }
    window.visualViewport?.addEventListener('resize', handleVisualViewportResize);
    watchDevicePixelRatio();
  }

  function resizeMap() {
    const layout = dependencies.projectionView.mapLayoutMetricsRefreshCount > 0
      ? (0, dependencies.mapView.projectionLayoutMetrics)()
      : (0, dependencies.projectionView.refreshMapLayoutMetrics)('initial-resize');
    const { width, height } = layout;
    const signature = layout.projectionSignature;
    if (signature === mapResizeSignature) {
      if (productMode === 'editor') (0, dependencies.taskPresentation.syncMapHudBounds)();
      return false;
    }
    mapResizeSignature = signature;
    dependencies.projectState.state.size.width = width;
    dependencies.projectState.state.size.height = height;
    const viewBox = `0 0 ${dependencies.projectState.state.size.width} ${dependencies.projectState.state.size.height}`;
    [dependencies.mapLayers.baseSvg, svg].forEach(layer => {
      layer?.attr('width', dependencies.projectState.state.size.width)
        .attr('height', dependencies.projectState.state.size.height)
        .attr('viewBox', viewBox)
        .attr('preserveAspectRatio', 'none');
    });
    mapInteractionLayer
      ?.attr('width', dependencies.projectState.state.size.width)
      .attr('height', dependencies.projectState.state.size.height);
    mapHost?.resize?.();
    dependencies.rendering.gpuMapRenderer.resize();
    dependencies.domains.renderingDomain?.invalidateViewport?.('resize');
    if (productMode === 'editor') (0, dependencies.taskPresentation.syncMapHudBounds)();
    requestAnimationFrame(() => dependencies.rendering.gpuMapRenderer.verifyLayout());
    return true;
  }

  function initializeSvg() {

  }

  function initializeValidationLayer() {

  }

  function initializeMapResizeObserver() {
    (mapResizeObserver = null);

    (mapResizeFrame = 0);

    (mapResizeSignature = '');

    (mapResizeReasons = new Set());
  }

  function initializeResolutionQuery() {
    (resolutionQuery = null);

    (viewRevision = 0);

    (visualProjectionRevision = 0);

    (lastVisualProjectionKind = '');

    (renderedViewSignature = '');
  }

  function initializeMapHostBindings() {
    (mapHost = null);

    (mapHostReadyPromise = Promise.resolve(false));
  }

  return Object.freeze({
    connect,attachMapOutput,stopMapResizeObserver,
    prepareVisualFrame,
    initializeSvg,
    initializeValidationLayer,
    initializeMapResizeObserver,
    initializeResolutionQuery,
    initializeMapHostBindings,
    get boundaryEditLayer() { return boundaryEditLayer; },
    get territorialLabelLayer() { return territorialLabelLayer; },
    get countryLayer() { return countryLayer; },
    get distributionLayer() { return distributionLayer; },
    get draftLayer() { return draftLayer; },
    get genericFeatureLayer() { return genericFeatureLayer; },
    get handleRenderFrameComplete() { return handleRenderFrameComplete; },
    get hoverLayer() { return hoverLayer; },
    get hydroEditLayer() { return hydroEditLayer; },
    get hydroLakeLayer() { return hydroLakeLayer; },
    get hydroRiverLayer() { return hydroRiverLayer; },
    get initSvg() { return initSvg; },
    get initializeMapHost() { return initializeMapHost; },
    get interactionSvg() { return interactionSvg; },
    get labelLayer() { return labelLayer; },
    get mapHost() { return mapHost; },
    get mapHostReadyPromise() { return mapHostReadyPromise; },
    set mapHostReadyPromise(value) { mapHostReadyPromise = value; },
    get mapResizeObserver() { return mapResizeObserver; },
    get oceanLayer() { return oceanLayer; },
    get overlayStackLayer() { return overlayStackLayer; },
    get previewLayer() { return previewLayer; },
    get projectionViewSnapshot() { return projectionViewSnapshot; },
    get queueMapResize() { return queueMapResize; },
    get resizeMap() { return resizeMap; },
    get selectionLayer() { return selectionLayer; },
    get shadowLayer() { return shadowLayer; },
    get snapLayer() { return snapLayer; },
    get startMapResizeObserver() { return startMapResizeObserver; },
    get svg() { return svg; },
    get syncMapHostFromState() { return syncMapHostFromState; },
    get syncViewRevision() { return syncViewRevision; },
    get territorialBoundaryLayer() { return territorialBoundaryLayer; },
    get territorialOperationLayer() { return territorialOperationLayer; },
    get territorialUnitLayer() { return territorialUnitLayer; },
    get validationLayer() { return validationLayer; },
    get vertexLayer() { return vertexLayer; },
    get viewRevision() { return viewRevision; },
    get visualProjectionForSnapshot() { return visualProjectionForSnapshot; },
    get visualProjectionRevision() { return visualProjectionRevision; },
  });
}

export function createMapOverlayLayers({map,svg,productMode='editor'}){
    const interactionSvg = map.append('svg').attr('class', 'map-interaction-svg');
    const interactionRoot = interactionSvg.append('g').attr('class', 'map-interaction-root');
    const root = svg.append('g').attr('class', 'map-root');
    const mapInteractionLayer = root.append('rect').attr('class', 'map-hit-area').attr('x', 0).attr('y', 0);
    const countryLayer = root.append('g').attr('class', 'countries-layer');
    const hydroLakeLayer = root.append('g').attr('class', 'hydro-lakes-layer');
    const hydroRiverLayer = root.append('g').attr('class', 'hydro-rivers-layer');
    const hydroEditLayer = root.append('g').attr('class', 'hydro-edit-layer');
    const boundaryEditLayer = productMode==='editor'?root.append('g').attr('class', 'boundary-edit-layer'):null;
    const overlayStackLayer = root.append('g').attr('class', 'overlay-stack-layer');
    const territorialBoundaryLayer = root.append('g').attr('class', 'territorial-boundary-layer');
    const territorialUnitLayer = overlayStackLayer;
    const distributionLayer = overlayStackLayer;
    const genericFeatureLayer = overlayStackLayer;
    const hoverLayer = root.append('g').attr('class', 'hover-overlay-layer');
    const selectionLayer = root.append('g').attr('class', 'selection-overlay-layer');
    const previewLayer = productMode==='editor'?root.append('g').attr('class', 'geometry-preview-layer'):null;
    const validationLayer = productMode==='editor'?root.append('g').attr('class', 'validation-overlay-layer'):null;
    const vertexLayer = productMode==='editor'?root.append('g').attr('class', 'vertices-layer'):null;
    const draftLayer = productMode==='editor'?root.append('g').attr('class', 'draft-layer'):null;
    const snapLayer = productMode==='editor'?root.append('g').attr('class', 'snap-indicator-layer'):null;
    const territorialOperationLayer = productMode==='editor'?interactionRoot.append('g').attr('class', 'territorial-operation-layer'):null;
    const territorialLabelLayer = root.append('g').attr('class', 'territorial-label-layer');
    const labelLayer = root.append('g').attr('class', 'labels-layer');
    const interactionLayers = [[territorialOperationLayer, 'edit-preview'], [hoverLayer, 'hover'],
      [selectionLayer, 'primary'], [previewLayer, 'edit-preview'], [validationLayer, 'validation'],
      [vertexLayer, 'edit-handles'], [draftLayer, 'draft'], [snapLayer, 'snap'],
      [territorialLabelLayer, 'territorial-labels'], [labelLayer, 'labels']];
    interactionLayers.filter(([layer])=>layer).sort((a, b) => mapVisualRank(a[1]) - mapVisualRank(b[1]))
      .forEach(([layer]) => interactionRoot.node().appendChild(layer.node()));

    return {interactionSvg,root,mapInteractionLayer,countryLayer,hydroLakeLayer,hydroRiverLayer,hydroEditLayer,boundaryEditLayer,overlayStackLayer,territorialBoundaryLayer,territorialUnitLayer,distributionLayer,genericFeatureLayer,hoverLayer,selectionLayer,previewLayer,validationLayer,vertexLayer,draftLayer,snapLayer,territorialOperationLayer,territorialLabelLayer,labelLayer};
}
