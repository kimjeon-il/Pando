import {createMapRenderer} from "../../../../../shared/frontend/js/modules/map-renderer-composition.js";

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
    const selectionGpu = dependencies.gpuRenderingA.selectionPass?.stats?.() || {};
    const render = dependencies.domains.renderingDomain?.getStats?.() || {};
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
    const selectionGpu = dependencies.gpuRenderingA.selectionPass?.stats?.() || {};
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
      svgFallbackCount: Number(dependencies.domains.renderingDomain?.getSelectionRenderStats?.().fallbackCount || 0),
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

    (selectionPerformanceBaseline = (0, dependencies.selectionServices.createSelectionPerformanceBaseline)({ mobile: (0, dependencies.surfaces.isMobile)() }));

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

  function initializeGpuMapRenderer(){gpuMapRenderer=createMapRenderer(dependencies,{productMode:'editor'});}

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
