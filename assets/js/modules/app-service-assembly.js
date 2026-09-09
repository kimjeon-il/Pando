/** ServiceAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createServiceAssembly() {
  let dependencies;
  let selectionPerformanceMetrics;
  let selectionPerformanceBaseline;
  let selectionPerfEnabled;
  let selectionLongTaskCount;
  let gpuMapRenderer;
  function connect(ports) {
    if (dependencies) throw new Error('service-assembly already connected');
    dependencies = ports;
  }

  function selectionPerformanceCounterSnapshot() {
    if (!selectionPerfEnabled) return null;
    const gpu = gpuMapRenderer?.getStats?.() || {};
    const selectionGpu = dependencies.selectionPass?.stats?.() || {};
    const render = dependencies.renderingDomain?.getStats?.() || {};
    return {
      selectionBufferBuildCount: Number(selectionGpu.bufferBuildCount || 0),
      selectionUploadBytes: Number(selectionGpu.bufferUploadBytes || 0),
      selectionDrawCount: Number(selectionGpu.viewDrawCount || 0),
      mainDrawCount: Number(render.fullRenderCount || 0) + Number(render.viewRenderCount || 0),
      hydroUploadBytes: Number(gpu.hydroUploadBytes || 0),
      longTaskCount: selectionLongTaskCount,
    };
  }

  function publishSelectionPerformanceSample(inputStartedAt, before, scenario = 'selection') {
    selectionPerformanceMetrics.inputToPresentMs = performance.now() - inputStartedAt;
    if (!selectionPerfEnabled) return;
    const after = selectionPerformanceCounterSnapshot();
    const gpu = gpuMapRenderer?.getStats?.() || {};
    const selectionGpu = dependencies.selectionPass?.stats?.() || {};
    selectionPerformanceBaseline.record({
      scenario,
      inputToPresentMs: selectionPerformanceMetrics.inputToPresentMs,
      baselineInputToPresentMs: selectionPerformanceMetrics.inputToPresentMs,
      handlerMs: selectionPerformanceMetrics.handlerMs,
      mainGpuFrameMs: Number(gpu.p95CpuSubmitMs || 0),
      selectionGpuDrawMs: Number(selectionGpu.lastDrawMs || 0),
      selectionBufferRebuilds: after.selectionBufferBuildCount - before.selectionBufferBuildCount,
      selectionUploadBytes: after.selectionUploadBytes - before.selectionUploadBytes,
      mainDrawCount: after.mainDrawCount - before.mainDrawCount,
      selectionDrawCount: after.selectionDrawCount - before.selectionDrawCount,
      svgFallbackCount: Number(dependencies.renderingDomain?.getSelectionRenderStats?.().fallbackCount || 0),
      longTaskCount: after.longTaskCount - before.longTaskCount,
      worldMeshUploadCount: 0,
      hydroUploadBytes: after.hydroUploadBytes - before.hydroUploadBytes,
      activeCanvasCount: gpuMapRenderer?.getRenderDevice?.() ? 1 : 0,
      activeContextCount: Number(gpuMapRenderer?.getRuntimeState?.()?.activeWebGlContextCount || 0),
    });
  }

  function initializeSelectionPerformanceMetrics() {
    (selectionPerformanceMetrics = {
      inputToPresentMs: 0,
      handlerMs: 0,
      transactionMs: 0,
      controllerMs: 0,
      summaryMs: 0,
      selectionUiSyncCount: 0,
      selectionUiCoalescedCount: 0,
      boundaryAnalysisBuildCount: 0,
      boundaryAnalysisCacheHitCount: 0,
      boundaryAnalysisCacheMissCount: 0,
      boundaryAnalysisMs: 0,
      selectionCountryBatchCount: 0,
      selectionGenericBatchCount: 0,
      selectionStrokeDrawCallCount: 0,
      propertyPanelMs: 0,
      propertyFieldsMs: 0,
      editorOpenMs: 0,
      indexQueryMs: 0,
      indexedCandidateCount: 0,
      exactHitTestCount: 0,
      fullScanCount: 0,
      gpuPickMs: 0,
      pickCacheHit: false,
      direct: false,
    });

    (selectionPerformanceBaseline = (0, dependencies.createSelectionPerformanceBaseline)({ mobile: (0, dependencies.isMobile)() }));

    (selectionPerfEnabled = new URLSearchParams(location.search).has('perf'));

    (selectionLongTaskCount = 0);

    if (selectionPerfEnabled && typeof globalThis.PerformanceObserver === 'function') {
      try {
        const observer = new globalThis.PerformanceObserver(list => {
          selectionLongTaskCount += list.getEntries().filter(entry => entry.duration >= 50).length;
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch (_) {}
    }
  }

  function initializeGpuMapRenderer() {
    (gpuMapRenderer = (0, dependencies.createGpuMapRenderer)({
      APP_VERSION: dependencies.APP_VERSION,
      ASSET_REVISION: dependencies.ASSET_REVISION,
      DATA_REVISION: dependencies.DATA_REVISION,
      PHYSICAL_DATA_BASE_URL: dependencies.PHYSICAL_DATA_BASE_URL,
      activeProjection: dependencies.activeProjection,
      countryColor: feature => feature.properties?.unitType === 'subunit'
        ? (0, dependencies.territorialUnitColor)((0, dependencies.builtinRenderCountries)().nativeUnits.get(String(feature.id)) || feature) : (0, dependencies.countryColor)(feature),
      countryFeatureById: dependencies.renderCountryFeatureById,
      countryOutlineFeature: dependencies.countryOutlineFeature,
      d3: dependencies.d3,
      deepClone: dependencies.deepClone,
      defaultCountryColor: dependencies.defaultCountryColor,
      flatProjection: dependencies.flatProjection,
      getSystemTheme: () => document.documentElement.dataset.theme || window.__PANDOLAB_THEME__ || dependencies.systemTheme,
      globeProjection: dependencies.globeProjection,
      hydroDisplayColor: dependencies.hydroDisplayColor,
      hydroFeatureById: dependencies.hydroFeatureById,
      hydroVisibilityThreshold: dependencies.hydroVisibilityThreshold,
      isCountryVisibleById: dependencies.isRenderCountryVisible,
      isHydroFeatureVisible: dependencies.isHydroFeatureVisible,
      isLayerItemVisible: dependencies.isLayerItemVisible,
      isMobile: dependencies.isMobile,
      isSafeKoreanErrorMessage: dependencies.isSafeKoreanErrorMessage,
      mapTheme: dependencies.mapTheme,
      mapWorkScheduler: dependencies.mapWorkScheduler,
      prepareHydroFeature: dependencies.prepareHydroFeature,
      queueMapResize: dependencies.queueMapResize,
      renderPendingCountryOverlays: dependencies.renderPendingCountryOverlays,
      renderViewFrame: () => dependencies.renderingDomain?.invalidateView?.('render-view') || false,
      reportOperationError: dependencies.reportOperationError,
      rendererUi: {
        createCanvas: () => document.createElement('canvas'),
        getMapElement: () => (0, dependencies.$)('map'),
        setEngineStatus: text => {
          (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = text;
        },
        onContextStateChange: phase => dependencies.renderingDomain?.invalidateGpuContext?.(phase) || false,
        requestHostRepaint: reason => dependencies.mapHost?.requestRepaint?.(reason) || false,
      },
      runtimeAssetUrl: dependencies.runtimeAssetUrl,
      scheduleGpuFrame: reason => dependencies.renderingDomain?.invalidateGpuFrame?.(reason) || false,
      scheduleGpuInteractionFrame: reason => dependencies.renderingDomain?.invalidateGpuInteraction?.(reason) || false,
      scheduleGpuMeshRebuild: dependencies.scheduleGpuMeshRebuild,
      setActionStatus: dependencies.setActionStatus,
      state: new Proxy(dependencies.state, { get: (target, key) => {
        if (key === 'countriesData') return (0, dependencies.builtinRenderCountries)().collection;
        if (key === 'layerVisibility') return { ...target.layerVisibility, countries: target.layerVisibility.countries
          || [...(0, dependencies.builtinRenderCountries)().nativeUnits.keys()].some(dependencies.isRenderCountryVisible) };
        return Reflect.get(target, key);
      } }),
    }));

    gpuMapRenderer.setRenderQuality?.(dependencies.currentRenderQuality);
  }

  return Object.freeze({
    connect,
    initializeSelectionPerformanceMetrics,
    initializeGpuMapRenderer,
    get gpuMapRenderer() { return gpuMapRenderer; },
    get publishSelectionPerformanceSample() { return publishSelectionPerformanceSample; },
    get selectionPerformanceBaseline() { return selectionPerformanceBaseline; },
    get selectionPerformanceCounterSnapshot() { return selectionPerformanceCounterSnapshot; },
    get selectionPerformanceMetrics() { return selectionPerformanceMetrics; },
  });
}
