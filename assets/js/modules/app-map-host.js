/** MapHost: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createMapHost() {
  let dependencies;
  let svg;
  let interactionSvg;
  let root;
  let shadowLayer;
  let oceanLayer;
  let graticuleLayer;
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
  let countryLabelLayer;
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
    const projection = (0, dependencies.activeProjection)();
    const translate = projection.translate().map(Number);
    const center = (0, dependencies.screenToGeo)(translate);
    return {
      projection: dependencies.state.projection,
      flatProjectionKind: dependencies.FLAT_PROJECTION_KIND,
      size: { width: dependencies.state.size.width, height: dependencies.state.size.height },
      dpr: (0, dependencies.currentMapDevicePixelRatio)(),
      safeInset: (0, dependencies.currentMapSafeInsets)(),
      translate,
      scale: Number(projection.scale()),
      rotation: dependencies.state.projection === 'globe' ? dependencies.state.view.globeRotation.map(Number) : null,
      projectionCenter: dependencies.state.projection === 'flat' ? dependencies.state.view.flatCenter.map(Number) : null,
      flatCenter: dependencies.state.view.flatCenter.map(Number),
      globeRotation: dependencies.state.view.globeRotation.map(Number),
      flatZoom: Number(dependencies.state.view.flatZoom),
      globeZoom: Number(dependencies.state.view.globeZoom),
      geographicCenter: center ? center.map(Number) : null,
      zoom: dependencies.state.projection === 'globe' ? Number(dependencies.state.view.globeZoom) : Number(dependencies.state.view.flatZoom),
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
    const gpuStats = dependencies.gpuMapRenderer.getRuntimeState?.() || {};
    const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__;
    if (startupMetrics) {
      startupMetrics.firstCanonicalFrameMs = gpuStats.firstCanonicalFrameMs ?? startupMetrics.firstCanonicalFrameMs;
      startupMetrics.canonicalFrameFallbackCount = Number(gpuStats.canonicalFrameFallbackCount || 0);
    }
    // Startup/full-scene work is intentionally expensive and is not an
    // interaction performance sample. Feeding it into the adaptive window
    // caused an immediate post-load downgrade and another scene refresh.
    const shouldSampleInteractionBudget = sample.interactionActive || (!sample.full && sample.viewFrame === true);
    const changed = shouldSampleInteractionBudget && dependencies.renderQualityController.recordFrame(sample.durationMs, {
      interaction: sample.interactionActive,
    });
    if (changed) (0, dependencies.queueAdaptiveRenderQualityRefresh)('frame-budget-quality-change');
  }

  function visualProjectionForSnapshot(viewState) {
    if (viewState.projection === 'globe') {
      return dependencies.d3.geo.orthographic()
        .translate(viewState.translate)
        .scale(viewState.scale)
        .rotate(viewState.rotation || [0, 0, 0])
        .clipAngle(90)
        .precision((0, dependencies.isMobile)() ? 0.9 : 0.35);
    }
    const safe = viewState.safeInset || dependencies.DEFAULT_SAFE_INSETS;
    return dependencies.d3.geo.equirectangular()
      .translate(viewState.translate)
      .scale(viewState.scale)
      .center(viewState.projectionCenter || [0, 0])
      .rotate([0, 0, 0])
      .clipExtent([
        [safe.left, safe.top],
        [viewState.size.width - safe.right, viewState.size.height - safe.bottom],
      ])
      .precision((0, dependencies.isMobile)() ? 0.7 : 0.25);
  }

  function legacyHostOptions() {
    return {
      getProjectionKind: () => dependencies.state.projection,
      setProjectionKind: kind => {
        dependencies.state.projection = kind === 'globe' ? 'globe' : 'flat';
        (0, dependencies.updateProjection)();
        return true;
      },
      getViewState: () => projectionViewSnapshot(),
      setViewState: view => {
        if (view?.projection) dependencies.state.projection = view.projection === 'globe' ? 'globe' : 'flat';
        if (view?.view) dependencies.state.view = (0, dependencies.deepClone)(view.view);
        (0, dependencies.updateProjection)();
        return true;
      },
      getViewportSize: () => {
        const layout = (0, dependencies.projectionLayoutMetrics)();
        return { width: layout.width, height: layout.height, dpr: layout.dpr };
      },
      project: coordinate => (0, dependencies.activeProjection)()(coordinate),
      unproject: point => (0, dependencies.screenToGeo)(point),
      requestRepaint: reason => dependencies.renderingDomain?.invalidateGpuFrame?.(reason || 'legacy-host-repaint'),
      resize: () => dependencies.gpuMapRenderer.resize(),
      dragBy: dependencies.dragLegacyMapViewBy,
      getDebugState: () => ({ viewRevision }),
    };
  }

  function createPreferredMapHost(mapEl) {
    const legacy = (0, dependencies.createLegacyMapHost)(legacyHostOptions());
    legacy.attach(mapEl);
    return legacy;
  }

  async function activateLegacyMapHost(reason = '') {
    const mapEl = (0, dependencies.$)('map');
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
    dependencies.gpuMapRenderer.attach(gpuCanvas);
    mapHost = (0, dependencies.createLegacyMapHost)(legacyHostOptions());
    mapHost.attach(mapEl);
    await mapHost.initialize();
    document.body.dataset.mapHost = dependencies.MAP_HOST_KINDS.LEGACY;
    window.__PANDOLAB_MAP_HOST__ = mapHost;
    if (reason) console.warn('[map-host]', reason);
    return false;
  }

  async function initializeMapHost() {
    if (!mapHost) return activateLegacyMapHost('MapHost가 초기화되지 않았습니다.');
    try {
      await mapHost.initialize();
      (0, dependencies.applyAdaptiveRenderQuality)({ refreshScene: false, reason: 'map-host-ready' });
      document.body.dataset.mapHost = dependencies.MAP_HOST_KINDS.LEGACY;
      window.__PANDOLAB_MAP_HOST__ = mapHost;
      return true;
    } catch (error) {
      return activateLegacyMapHost(error?.message || String(error));
    }
  }

  function initSvg() {
    const mapEl = (0, dependencies.$)('map');
    const map = dependencies.d3.select(mapEl);
    mapHost?.destroy?.();
    mapHost = null;
    mapHostReadyPromise = Promise.resolve(false);
    dependencies.gpuMapRenderer.setSelectionPass?.(null);
    dependencies.selectionPass = null;
    map.selectAll('*').remove();
    dependencies.mapDebug.installViewFacade();

    dependencies.baseSvg = map.append('svg')
      .attr('class', 'map-base-svg')
      .attr('aria-hidden', 'true')
      .attr('focusable', 'false');
    const baseRoot = dependencies.baseSvg.append('g').attr('class', 'map-base-root');
    dependencies.flatOceanLayer = baseRoot.append('rect').attr('class', 'map-ocean map-ocean-flat');
    oceanLayer = baseRoot.append('circle').attr('class', 'map-ocean map-ocean-globe');
    shadowLayer = baseRoot.append('circle').attr('class', 'globe-shadow');

    mapHost = createPreferredMapHost(mapEl);
    const gpuCanvas = document.createElement('canvas');
    gpuCanvas.className = 'gpu-map-canvas';
    mapEl.appendChild(gpuCanvas);
    dependencies.gpuMapRenderer.attach(gpuCanvas);

    svg = map.append('svg').attr('class', 'map-svg map-overlay-svg');
    const handleSelectionRenderError = ({ stage = 'selection-overlay-render', channel = '', error } = {}) => {
      if (dependencies.renderingDomain?.recordSelectionRenderError) {
        dependencies.renderingDomain.recordSelectionRenderError({ stage, error });
      } else {
        dependencies.reliabilityDiagnostic.push({
          category: 'render',
          operation: 'selection-overlay-render',
          result: 'recovered',
          channel,
          technicalMessage: String(error?.message || error || stage),
          stack: error?.stack || '',
        });
      }
    };
    dependencies.selectionPass = (0, dependencies.createSelectionPass)({
      projectionForView: () => (0, dependencies.activeProjection)(),
      onRenderError: handleSelectionRenderError,
    });
    dependencies.gpuMapRenderer.setSelectionPass?.(dependencies.selectionPass);
    (0, dependencies.syncResolvedInteractionStyle)();
    interactionSvg = map.append('svg').attr('class', 'map-interaction-svg');
    const interactionRoot = interactionSvg.append('g').attr('class', 'map-interaction-root');
    root = svg.append('g').attr('class', 'map-root');
    mapInteractionLayer = root.append('rect').attr('class', 'map-hit-area').attr('x', 0).attr('y', 0);
    graticuleLayer = root.append('path').attr('class', 'map-graticule');
    countryLayer = root.append('g').attr('class', 'countries-layer');
    hydroLakeLayer = root.append('g').attr('class', 'hydro-lakes-layer');
    hydroRiverLayer = root.append('g').attr('class', 'hydro-rivers-layer');
    hydroEditLayer = root.append('g').attr('class', 'hydro-edit-layer');
    boundaryEditLayer = root.append('g').attr('class', 'boundary-edit-layer');
    overlayStackLayer = root.append('g').attr('class', 'overlay-stack-layer');
    territorialBoundaryLayer = root.append('g').attr('class', 'territorial-boundary-layer');
    territorialUnitLayer = overlayStackLayer;
    distributionLayer = overlayStackLayer;
    genericFeatureLayer = overlayStackLayer;
    hoverLayer = root.append('g').attr('class', 'hover-overlay-layer');
    selectionLayer = root.append('g').attr('class', 'selection-overlay-layer');
    previewLayer = root.append('g').attr('class', 'geometry-preview-layer');
    validationLayer = root.append('g').attr('class', 'validation-overlay-layer');
    vertexLayer = root.append('g').attr('class', 'vertices-layer');
    draftLayer = root.append('g').attr('class', 'draft-layer');
    snapLayer = root.append('g').attr('class', 'snap-indicator-layer');
    territorialOperationLayer = interactionRoot.append('g').attr('class', 'territorial-operation-layer');
    countryLabelLayer = root.append('g').attr('class', 'country-label-layer');
    labelLayer = root.append('g').attr('class', 'labels-layer');
    [previewLayer, validationLayer, vertexLayer, draftLayer, snapLayer, countryLabelLayer, labelLayer]
      .forEach(layer => interactionRoot.node().appendChild(layer.node()));

    dependencies.mapInputController = dependencies.mapInputPresentation.bindSvg(svg);
  }

  function queueMapResize(reason = 'layout') {
    mapResizeReasons.add(String(reason || 'layout'));
    if (mapResizeFrame) return;
    mapResizeFrame = requestAnimationFrame(() => {
      mapResizeFrame = 0;
      const reasons = [...mapResizeReasons].sort();
      mapResizeReasons.clear();
      (0, dependencies.refreshMapLayoutMetrics)(reasons.join(',') || 'layout');
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

  function startMapResizeObserver() {
    mapResizeObserver?.disconnect?.();
    if (typeof ResizeObserver === 'function') {
      mapResizeObserver = new ResizeObserver(() => queueMapResize('resize-observer'));
      mapResizeObserver.observe((0, dependencies.$)('map'));
    }
    window.visualViewport?.addEventListener?.('resize', () => {
      (0, dependencies.refreshMapSheetMetrics)();
      queueMapResize('visual-viewport-resize');
    });
    watchDevicePixelRatio();
  }

  function resizeMap() {
    const layout = dependencies.mapLayoutMetricsRefreshCount > 0
      ? (0, dependencies.projectionLayoutMetrics)()
      : (0, dependencies.refreshMapLayoutMetrics)('initial-resize');
    const { width, height } = layout;
    const signature = layout.projectionSignature;
    if (signature === mapResizeSignature) {
      (0, dependencies.syncMapHudBounds)();
      return false;
    }
    mapResizeSignature = signature;
    dependencies.state.size.width = width;
    dependencies.state.size.height = height;
    const viewBox = `0 0 ${dependencies.state.size.width} ${dependencies.state.size.height}`;
    [dependencies.baseSvg, svg].forEach(layer => {
      layer?.attr('width', dependencies.state.size.width)
        .attr('height', dependencies.state.size.height)
        .attr('viewBox', viewBox)
        .attr('preserveAspectRatio', 'none');
    });
    mapInteractionLayer
      ?.attr('width', dependencies.state.size.width)
      .attr('height', dependencies.state.size.height);
    mapHost?.resize?.();
    dependencies.gpuMapRenderer.resize();
    dependencies.renderingDomain?.invalidateViewport?.('resize');
    (0, dependencies.syncMapHudBounds)();
    requestAnimationFrame(() => dependencies.gpuMapRenderer.verifyLayout());
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
    connect,
    initializeSvg,
    initializeValidationLayer,
    initializeMapResizeObserver,
    initializeResolutionQuery,
    initializeMapHostBindings,
    get boundaryEditLayer() { return boundaryEditLayer; },
    get countryLabelLayer() { return countryLabelLayer; },
    get countryLayer() { return countryLayer; },
    get distributionLayer() { return distributionLayer; },
    get draftLayer() { return draftLayer; },
    get genericFeatureLayer() { return genericFeatureLayer; },
    get graticuleLayer() { return graticuleLayer; },
    get handleRenderFrameComplete() { return handleRenderFrameComplete; },
    get hoverLayer() { return hoverLayer; },
    get hydroEditLayer() { return hydroEditLayer; },
    get hydroLakeLayer() { return hydroLakeLayer; },
    get hydroRiverLayer() { return hydroRiverLayer; },
    get initSvg() { return initSvg; },
    get initializeMapHost() { return initializeMapHost; },
    get interactionSvg() { return interactionSvg; },
    get labelLayer() { return labelLayer; },
    get lastVisualProjectionKind() { return lastVisualProjectionKind; },
    set lastVisualProjectionKind(value) { lastVisualProjectionKind = value; },
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
    set visualProjectionRevision(value) { visualProjectionRevision = value; },
  });
}
