'use strict';

(async () => {
  const buildMeta = globalThis.PANDOLAB_BUILD_META;
  if (!buildMeta) throw new Error('빌드 메타데이터를 불러오지 못했습니다.');
  const APP_VERSION = String(buildMeta.appVersion || '');
  const BUILD_ID = String(buildMeta.buildId || '');
  const ASSET_REVISION = String(buildMeta.assetRevision || '');
  const DATA_REVISION = String(buildMeta.dataRevision || `data-${APP_VERSION}`);
  if (!APP_VERSION || !BUILD_ID || !ASSET_REVISION || !DATA_REVISION) throw new Error('빌드 메타데이터가 불완전합니다.');
  const CACHE_RECOVERY_PARAM = '_pandolab_cache';
  const MODAL_UI_BUNDLE = '../css/ui-modal.bundle.css';

  const bootstrapScriptUrl = document.currentScript?.src || new URL('./assets/js/bootstrap.js', location.href).href;
  const assetBaseUrl = new URL('./', bootstrapScriptUrl);
  const overlay = document.getElementById('bootstrapLoading');
  const message = document.getElementById('bootstrapLoadingText');
  const probe = document.getElementById('startupProbe');
  const progressBar = document.getElementById('bootstrapProgressBar');
  const appRoot = document.getElementById('app');
  const initialLayout = window.matchMedia('(max-width: 799px)').matches
    ? 'mobile'
    : window.matchMedia('(max-width: 1199px)').matches
      ? 'compact'
      : 'wide';
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const startupSignals = {
    layout: initialLayout,
    deviceMemory: Number.isFinite(Number(navigator.deviceMemory)) ? Number(navigator.deviceMemory) : null,
    hardwareConcurrency: Number.isFinite(Number(navigator.hardwareConcurrency)) ? Number(navigator.hardwareConcurrency) : null,
    effectiveType: connection?.effectiveType || null,
    saveData: !!connection?.saveData,
  };
  const bootStartedAt = performance.now();
  const detailedMemoryDiagnostics = new URLSearchParams(location.search).get('perf') === '1';
  const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__ = {
    buildId: BUILD_ID,
    assetRevision: ASSET_REVISION,
    dataRevision: DATA_REVISION,
    dataCacheName: `pandolab-data-${DATA_REVISION}`,
    uiStylesheetRequestCount: 0,
    coreStylesheetRequestCount: document.querySelectorAll('link[rel="stylesheet"]').length,
    modalStylesheetRequestCount: 0,
    uiBundleBuildSourceCount: 13,
    firstCanonicalFrameMs: null,
    canonicalFrameFallbackCount: 0,
    signals: startupSignals,
    loadPolicy: null,
    startupPhase: 'preview',
    interactivePaintMs: null,
    canonicalQuietWindowMs: 500,
    canonicalInputDeferralCount: 0,
    canonicalGeometryQueuedMs: null,
    canonicalGeometryStartedMs: null,
    canonicalGeometryReceivedMs: null,
    canonicalGeometryAppliedMs: null,
    canonicalMeshQueuedMs: null,
    canonicalMeshStartedMs: null,
    canonicalMeshReceivedMs: null,
    canonicalMeshAppliedMs: null,
    canonicalWorkStartedDuringInputCount: 0,
    canonicalPacketCompressedBytes: 0,
    canonicalPacketDecodedBytes: 0,
    canonicalPacketRetainedBytes: 0,
    canonicalPacketTransferBytes: 0,
    canonicalStructuredCloneMetadataBytes: 0,
    canonicalCacheWriteMs: 0,
    canonicalDecompressMs: 0,
    canonicalPacketValidateMs: 0,
    canonicalPacketTransferMs: 0,
    canonicalMaterializeMs: 0,
    canonicalMaterializeSliceCount: 0,
    canonicalMaterializeMaxSliceMs: 0,
    canonicalMaterializedCoordinateCount: 0,
    canonicalPreviewReleasedBytes: 0,
    canonicalPristineReparseCount: 0,
    canonicalMemorySamples: [],
    lazyModalLoadedMs: null,
    lazyGisLoadedMs: null,
    lazyHistoricalLoadedMs: null,
    lazyModuleLoadErrorCount: 0,
    initialModuleRequestCount: 0,
    startedAt: bootStartedAt,
    preview: null,
    geometry: null,
    mesh: null,
    canonical: null,
    interactiveMs: null,
    editableMs: null,
    readyMs: null,
    layerHydrationStartedMs: null,
    layerTreeRenderedMs: null,
    layerReadyMs: null,
    geometryError: '',
    meshError: '',
  };
  appRoot?.setAttribute('data-layout', initialLayout);
  document.body.dataset.layout = initialLayout;

  function setProgress(text, percent = 0) {
    if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  }

  function fail(reason) {
    const rawReason = String(reason || '');
    const safeReason = /[가-힣]/.test(rawReason) && !/(Cannot read|undefined|null is not|is not a function|TypeError|ReferenceError|SyntaxError|RangeError|failed\b|\bat\s+\S+\s*\()/i.test(rawReason)
      ? rawReason
      : '내부 오류가 발생했습니다. 오류 코드 PL-BOOT-001을 확인하세요.';
    if (safeReason !== rawReason) console.error('[PL-BOOT-001]', rawReason);
    overlay?.classList.add('error');
    if (message) message.textContent = '지도를 불러오지 못했습니다';
    if (probe) probe.textContent = '페이지를 새로고침해 다시 시도해 주세요';
    setProgress('', 100);
    document.body.classList.add('is-loading');
    const actionText = document.querySelector('#actionStatus strong');
    if (actionText) actionText.textContent = '지도 데이터를 불러올 수 없습니다.';
  }

  function finish() {
    setProgress('지도를 준비했습니다.', 100);
    overlay?.setAttribute('hidden', '');
    document.body.classList.remove('is-loading');
    const currentUrl = new URL(location.href);
    if (currentUrl.searchParams.get(CACHE_RECOVERY_PARAM) === ASSET_REVISION) {
      currentUrl.searchParams.delete(CACHE_RECOVERY_PARAM);
      window.history.replaceState(null, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    }
  }

  function versionedAsset(relativePath) {
    const url = new URL(relativePath, assetBaseUrl);
    url.searchParams.set('v', ASSET_REVISION);
    return url;
  }

  function installUiRuntime() {
    window.addEventListener('pandolab:interactive', () => {
      import(versionedAsset('./modules/ui-runtime.js').href)
        .then(module => module.initializeUiRuntime?.(document))
        .catch(error => console.error('[PL-UI-RUNTIME-001]', error));
    }, { once: true });
  }

  let memorySampleChain = Promise.resolve();
  function sampleStartupMemory(label) {
    const collect = async () => {
      const sample = { label, atMs: performance.now() - bootStartedAt, supported: false };
      try {
        if (detailedMemoryDiagnostics && typeof performance.measureUserAgentSpecificMemory === 'function') {
          const measurement = await performance.measureUserAgentSpecificMemory();
          sample.bytes = Number(measurement?.bytes || 0);
          sample.supported = Number.isFinite(sample.bytes) && sample.bytes > 0;
          sample.source = 'measureUserAgentSpecificMemory';
        } else if (Number.isFinite(Number(performance.memory?.usedJSHeapSize))) {
          sample.bytes = Number(performance.memory.usedJSHeapSize);
          sample.supported = true;
          sample.source = 'performance.memory';
        } else if (typeof performance.measureUserAgentSpecificMemory === 'function') {
          const measurement = await performance.measureUserAgentSpecificMemory();
          sample.bytes = Number(measurement?.bytes || 0);
          sample.supported = Number.isFinite(sample.bytes) && sample.bytes > 0;
          sample.source = 'measureUserAgentSpecificMemory';
        }
      } catch (error) {
        sample.error = error?.message || String(error);
      }
      startupMetrics.canonicalMemorySamples.push(sample);
      return sample;
    };
    memorySampleChain = memorySampleChain.then(collect, collect);
    return memorySampleChain;
  }
  window.PANDOLAB_SAMPLE_STARTUP_MEMORY = sampleStartupMemory;

  let modalStylesPromise = null;
  window.PANDOLAB_ENSURE_MODAL_STYLES = () => {
    if (modalStylesPromise) return modalStylesPromise;
    modalStylesPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('link[data-pandolab-ui-modal="ui-modal-bundle"]');
      if (existing?.sheet) return resolve(existing);
      const style = existing || document.createElement('link');
      style.rel = 'stylesheet';
      style.href = versionedAsset(MODAL_UI_BUNDLE).href;
      style.dataset.pandolabUiModal = 'ui-modal-bundle';
      style.addEventListener('load', () => resolve(style), { once: true });
      style.addEventListener('error', () => {
        modalStylesPromise = null;
        reject(new Error('모달 스타일을 불러오지 못했습니다.'));
      }, { once: true });
      if (!existing) {
        document.head.appendChild(style);
        startupMetrics.modalStylesheetRequestCount += 1;
      }
    });
    return modalStylesPromise;
  };

  function cacheMismatchMessage() {
    return '화면 파일과 스크립트 버전이 다릅니다. 페이지를 강력 새로고침하세요. PC에서는 Ctrl+F5를 사용할 수 있습니다.';
  }

  function recoverCacheMismatch() {
    const recoveryUrl = new URL(location.href);
    if (recoveryUrl.searchParams.get(CACHE_RECOVERY_PARAM) === ASSET_REVISION) return false;
    recoveryUrl.searchParams.set(CACHE_RECOVERY_PARAM, ASSET_REVISION);
    location.replace(recoveryUrl.href);
    return true;
  }

  if (location.protocol === 'file:') {
    fail('직접 파일 열기는 지원하지 않습니다. GitHub Pages 또는 로컬 HTTP 서버를 사용하세요.');
    return;
  }

  if (appRoot?.dataset.appVersion !== APP_VERSION) {
    if (!recoverCacheMismatch()) fail(cacheMismatchMessage());
    return;
  }

  installUiRuntime();

  const [{ createStartupTaskGate }, { createCanonicalCountryStore }] = await Promise.all([
    import(versionedAsset('./modules/startup-task-gate.js').href),
    import(versionedAsset('./modules/canonical-country-packet.js').href),
  ]);
  const startupGate = createStartupTaskGate({
    quietWindowMs: 500,
    onStateChange: state => {
      startupMetrics.startupPhase = state;
    },
    onDeferral: () => {
      startupMetrics.canonicalInputDeferralCount += 1;
    },
  });
  const activePointers = new Set();
  const noteInput = active => startupGate.noteInput({ active });
  const startupInputCleanup = [];
  const listenForStartup = (target, type, listener, options) => {
    target.addEventListener(type, listener, options);
    startupInputCleanup.push(() => target.removeEventListener(type, listener, options));
  };
  const onPointerDown = event => {
    activePointers.add(event.pointerId);
    noteInput(true);
  };
  const onPointerMove = () => noteInput(activePointers.size > 0);
  const onPointerEnd = event => {
    activePointers.delete(event.pointerId);
    noteInput(activePointers.size > 0);
  };
  const onTouchStartOrMove = () => noteInput(true);
  const onTouchEnd = () => noteInput(false);
  const onWheel = () => noteInput(false);
  const onKeyDown = event => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '=', 'PageUp', 'PageDown'].includes(event.key)) noteInput(false);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') noteInput(false);
  };
  const onBlur = () => {
    activePointers.clear();
    noteInput(false);
  };
  const onInteractionState = event => {
    startupGate.noteInput({ active: event?.detail?.active === true, pulse: false });
  };
  const capturePassive = { capture: true, passive: true };
  listenForStartup(document, 'pointerdown', onPointerDown, capturePassive);
  listenForStartup(document, 'pointermove', onPointerMove, capturePassive);
  for (const type of ['pointerup', 'pointercancel']) listenForStartup(document, type, onPointerEnd, capturePassive);
  listenForStartup(document, 'touchstart', onTouchStartOrMove, capturePassive);
  listenForStartup(document, 'touchmove', onTouchStartOrMove, capturePassive);
  for (const type of ['touchend', 'touchcancel']) listenForStartup(document, type, onTouchEnd, capturePassive);
  listenForStartup(document, 'wheel', onWheel, capturePassive);
  listenForStartup(document, 'keydown', onKeyDown, true);
  listenForStartup(document, 'visibilitychange', onVisibilityChange);
  listenForStartup(window, 'blur', onBlur);
  listenForStartup(window, 'pandolab:interaction-state', onInteractionState);

  window.PANDOLAB_ASSET_BASE_URL = assetBaseUrl.href;
  window.PANDOLAB_APP_VERSION = APP_VERSION;
  window.PANDOLAB_ASSET_REVISION = ASSET_REVISION;
  window.PANDOLAB_DATA_REVISION = DATA_REVISION;
  const loaderUrl = versionedAsset('./workers/data-loader-worker.js');
  for (const [key, value] of Object.entries(startupSignals)) {
    if (value !== null && value !== '') loaderUrl.searchParams.set(key, String(value));
  }
  const loader = new Worker(loaderUrl, { name: 'pandolab-data-loader', type: 'module' });
  let previewReady = false;
  let geometryReady = false;
  let meshReady = false;
  let geometryFailed = false;
  let meshFailed = false;
  let appInjected = false;
  let resolveGeometry;
  let resolveMesh;
  window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE = new Promise(resolve => { resolveGeometry = resolve; });
  window.PANDOLAB_CANONICAL_MESH_PROMISE = new Promise(resolve => { resolveMesh = resolve; });
  void Promise.all([
    window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE,
    window.PANDOLAB_CANONICAL_MESH_PROMISE,
  ]).then(([geometry, mesh]) => {
    const canonical = {
      ...geometry,
      meshBuffer: mesh.meshBuffer,
      metrics: { geometry: geometry.metrics || null, mesh: mesh.metrics || null },
    };
    startupMetrics.canonical = canonical.metrics;
    return canonical;
  });

  const onRuntimeError = event => fail(event?.detail || event?.reason?.message || event?.message || '애플리케이션 실행 오류');
  window.addEventListener('pandolab:error', onRuntimeError, { once: true });
  window.addEventListener('pandolab:interactive', () => {
    startupMetrics.interactiveMs = performance.now() - bootStartedAt;
    startupMetrics.previewDisplayMs = Math.max(0, startupMetrics.interactiveMs - Number(startupMetrics.previewReceivedMs || 0));
    startupMetrics.initialModuleRequestCount = performance.getEntriesByType('resource')
      .filter(entry => /\.(?:js|mjs)(?:\?|$)/i.test(entry.name)).length;
    finish();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      startupMetrics.interactivePaintMs = performance.now() - bootStartedAt;
      startupGate.markInteractivePaint();
      startupMetrics.canonicalGeometryQueuedMs = performance.now() - bootStartedAt;
      startupGate.queue('start-geometry', () => {
        startupMetrics.canonicalGeometryStartedMs = performance.now() - bootStartedAt;
        if (startupGate.getState().interactionActive) startupMetrics.canonicalWorkStartedDuringInputCount += 1;
        void sampleStartupMemory('canonical-packet-request');
        loader.postMessage({ type: 'start-geometry' });
      }, { queuedState: 'geometry-queued', runningState: 'geometry-loading' });
    }));
  }, { once: true });
  window.addEventListener('pandolab:editable', event => {
    startupMetrics.editableMs = performance.now() - bootStartedAt;
    startupMetrics.geometryDisplayMs = Math.max(0, startupMetrics.editableMs - Number(startupMetrics.geometryReceivedMs || 0));
    startupMetrics.canonicalGeometryAppliedMs = performance.now() - bootStartedAt;
    startupGate.setState('geometry-applied');
    if (event?.detail?.useBuiltInMesh === false) loader.postMessage({ type: 'cancel-mesh' });
    else {
      startupMetrics.canonicalMeshQueuedMs = performance.now() - bootStartedAt;
      startupGate.queue('start-mesh', () => {
        startupMetrics.canonicalMeshStartedMs = performance.now() - bootStartedAt;
        if (startupGate.getState().interactionActive) startupMetrics.canonicalWorkStartedDuringInputCount += 1;
        loader.postMessage({ type: 'geometry-applied' });
      }, { queuedState: 'mesh-queued', runningState: 'mesh-loading' });
    }
  }, { once: true });
  window.addEventListener('pandolab:ready', () => {
    startupMetrics.readyMs = performance.now() - bootStartedAt;
    startupMetrics.canonicalMeshAppliedMs = startupMetrics.readyMs;
    startupGate.setState('canonical-ready');
    startupGate.dispose();
    startupInputCleanup.splice(0).forEach(cleanup => cleanup());
    startupMetrics.meshDisplayMs = Math.max(0, startupMetrics.readyMs - Number(startupMetrics.meshReceivedMs || 0));
    void sampleStartupMemory('canonical-mesh-committed');
    window.PANDOLAB_CANONICAL_GEOMETRY_PROMISE = null;
    window.PANDOLAB_CANONICAL_MESH_PROMISE = null;
    resolveGeometry = null;
    resolveMesh = null;
    loader.terminate();
  }, { once: true });
  window.addEventListener('online', () => {
    if (!previewReady) return;
    if (geometryFailed && !geometryReady) {
      geometryFailed = false;
      startupGate.queue('retry-geometry', () => loader.postMessage({ type: 'retry-geometry' }), {
        queuedState: 'geometry-queued', runningState: 'geometry-loading',
      });
    }
    if (meshFailed && geometryReady && !meshReady) {
      meshFailed = false;
      startupGate.queue('retry-mesh', () => loader.postMessage({ type: 'retry-mesh' }), {
        queuedState: 'mesh-queued', runningState: 'mesh-loading',
      });
    }
  });

  loader.onmessage = event => {
    const data = event.data || {};
    if (data.type === 'preview-progress') {
      setProgress(data.message || '지도 데이터를 준비하는 중입니다.', data.percent || 0);
      return;
    }
    if (data.type === 'preview-error') {
      loader.terminate();
      fail(data.message || '지도 데이터를 불러오지 못했습니다.');
      return;
    }
    if (data.type === 'geometry-progress') {
      window.dispatchEvent(new CustomEvent('pandolab:geometry-progress', { detail: data }));
      return;
    }
    if (data.type === 'mesh-progress') {
      window.dispatchEvent(new CustomEvent('pandolab:mesh-progress', { detail: data }));
      return;
    }
    if (data.type === 'geometry-error') {
      geometryFailed = true;
      startupMetrics.geometryError = data.message || '무손실 국가 데이터를 준비하지 못했습니다.';
      window.dispatchEvent(new CustomEvent('pandolab:geometry-error', { detail: startupMetrics.geometryError }));
      return;
    }
    if (data.type === 'mesh-error') {
      meshFailed = true;
      startupMetrics.meshError = data.message || '고화질 지도를 준비하지 못했습니다.';
      window.dispatchEvent(new CustomEvent('pandolab:mesh-error', { detail: startupMetrics.meshError }));
      return;
    }
    if (!['preview-ready', 'geometry-ready', 'mesh-ready'].includes(data.type)) return;
    if (data.buildId !== APP_VERSION) {
      loader.terminate();
      if (!recoverCacheMismatch()) fail(cacheMismatchMessage());
      return;
    }
    if (data.type === 'geometry-ready') {
      geometryReady = true;
      geometryFailed = false;
      startupMetrics.geometry = data.metrics || null;
      startupMetrics.loadPolicy = data.metrics?.policy || startupMetrics.loadPolicy;
      startupMetrics.geometryReceivedMs = performance.now() - bootStartedAt;
      startupMetrics.canonicalGeometryReceivedMs = startupMetrics.geometryReceivedMs;
      startupMetrics.geometryMainThreadTransferMs = Number.isFinite(Number(data.postedEpochMs))
        ? Math.max(0, performance.timeOrigin + performance.now() - Number(data.postedEpochMs))
        : null;
      startupMetrics.canonicalPacketCompressedBytes = Number(data.metrics?.canonicalPacketCompressedBytes || 0);
      startupMetrics.canonicalPacketDecodedBytes = Number(data.metrics?.canonicalPacketDecodedBytes || data.countryPacketBuffer?.byteLength || 0);
      startupMetrics.canonicalPacketTransferBytes = Number(data.countryPacketBuffer?.byteLength || 0);
      startupMetrics.canonicalPacketRetainedBytes = startupMetrics.canonicalPacketTransferBytes;
      startupMetrics.canonicalCacheWriteMs = Number(data.metrics?.canonicalCacheWriteMs || 0);
      startupMetrics.canonicalDecompressMs = Number(data.metrics?.canonicalDecompressMs || 0);
      startupMetrics.canonicalPacketValidateMs = Number(data.metrics?.canonicalPacketValidateMs || 0);
      startupMetrics.canonicalPacketTransferMs = Number(startupMetrics.geometryMainThreadTransferMs || 0);
      startupMetrics.canonicalStructuredCloneMetadataBytes = new TextEncoder().encode(JSON.stringify({
        type: data.type,
        buildId: data.buildId,
        packetHeader: data.packetHeader,
        postedEpochMs: data.postedEpochMs,
        metrics: data.metrics,
      })).byteLength;
      void sampleStartupMemory('packet-transferred');
      startupGate.queue('apply-geometry', async () => {
        startupGate.setState('geometry-applying');
        const materializeStartedAt = performance.now();
        try {
          const canonicalCountryStore = createCanonicalCountryStore(data.countryPacketBuffer, {
            expectedHeader: data.packetHeader?.words || null,
          });
          void sampleStartupMemory('materialization-start');
          const materialized = await canonicalCountryStore.materializeCollection({
            budgetMs: 4,
            coordinateBudget: 4096,
            waitForQuiet: startupGate.waitForQuiet,
            yieldFrame: startupGate.yieldFrame,
            onSlice: slice => {
              startupMetrics.canonicalMaterializeSliceCount = slice.sliceCount;
              startupMetrics.canonicalMaterializeMaxSliceMs = Math.max(
                startupMetrics.canonicalMaterializeMaxSliceMs,
                Number(slice.elapsed || 0),
              );
            },
          });
          startupMetrics.canonicalMaterializeMs = performance.now() - materializeStartedAt;
          startupMetrics.canonicalMaterializeSliceCount = materialized.metrics.sliceCount;
          startupMetrics.canonicalMaterializeMaxSliceMs = materialized.metrics.maxSliceMs;
          startupMetrics.canonicalMaterializedCoordinateCount = materialized.metrics.coordinateCount;
          window.dispatchEvent(new CustomEvent('pandolab:canonical-packet-materialized', {
            detail: Object.freeze({
              decodedBytes: startupMetrics.canonicalPacketDecodedBytes,
              retainedBytes: startupMetrics.canonicalPacketRetainedBytes,
              structuredCloneMetadataBytes: startupMetrics.canonicalStructuredCloneMetadataBytes,
              materializeMs: startupMetrics.canonicalMaterializeMs,
              sliceCount: startupMetrics.canonicalMaterializeSliceCount,
              maxSliceMs: startupMetrics.canonicalMaterializeMaxSliceMs,
              coordinateCount: startupMetrics.canonicalMaterializedCoordinateCount,
              pristineReparseCount: startupMetrics.canonicalPristineReparseCount,
              memorySampleCount: startupMetrics.canonicalMemorySamples.length,
            }),
          }));
          void sampleStartupMemory('materialization-complete');
          resolveGeometry({
            countries: materialized.collection,
            canonicalCountryStore,
            metrics: { ...(data.metrics || {}), materialization: materialized.metrics },
          });
        } catch (error) {
          geometryFailed = true;
          startupMetrics.geometryError = error?.message || String(error);
          window.dispatchEvent(new CustomEvent('pandolab:geometry-error', { detail: startupMetrics.geometryError }));
        }
      }, { queuedState: 'geometry-ready', runningState: 'geometry-applying' });
      return;
    }
    if (data.type === 'mesh-ready') {
      meshReady = true;
      meshFailed = false;
      startupMetrics.mesh = data.metrics || null;
      startupMetrics.loadPolicy = data.metrics?.policy || startupMetrics.loadPolicy;
      startupMetrics.meshReceivedMs = performance.now() - bootStartedAt;
      startupMetrics.canonicalMeshReceivedMs = startupMetrics.meshReceivedMs;
      startupMetrics.meshMainThreadTransferMs = Number.isFinite(Number(data.postedEpochMs))
        ? Math.max(0, performance.timeOrigin + performance.now() - Number(data.postedEpochMs))
        : null;
      startupGate.queue('apply-mesh', () => {
        resolveMesh({ meshBuffer: data.meshBuffer, metrics: data.metrics || null });
      }, { queuedState: 'mesh-ready', runningState: 'mesh-ready' });
      return;
    }
    previewReady = true;
    startupMetrics.preview = data.metrics || null;
    startupMetrics.loadPolicy = data.metrics?.policy || null;
    startupMetrics.previewReceivedMs = performance.now() - bootStartedAt;
    startupMetrics.previewMainThreadTransferMs = Number.isFinite(Number(data.postedEpochMs))
      ? Math.max(0, performance.timeOrigin + performance.now() - Number(data.postedEpochMs))
      : null;
    window.PANDOLAB_COUNTRIES = data.countries;
    window.PANDOLAB_GPU_MESH_BUFFER = data.meshBuffer;
    window.PANDOLAB_LABEL_ANCHORS = data.labelAnchors || {};
    setProgress('빠른 미리보기 지도를 시작하는 중입니다.', 99);
    if (appInjected) return;
    appInjected = true;
    const app = document.createElement('script');
    app.type = 'module';
    app.src = versionedAsset('./app.js').href;
    app.onload = () => setProgress('빠른 지도를 표시하는 중입니다.', 99);
    app.onerror = () => fail('애플리케이션 파일을 불러오지 못했습니다.');
    document.body.appendChild(app);
  };
  loader.onerror = event => {
    if (!previewReady) {
      loader.terminate();
      fail(event.message || '데이터 Worker 실행 오류');
      return;
    }
    const detail = event.message || '데이터 Worker 실행 오류';
    if (!geometryReady) {
      geometryFailed = true;
      startupMetrics.geometryError = detail;
      window.dispatchEvent(new CustomEvent('pandolab:geometry-error', { detail }));
    } else {
      meshFailed = true;
      startupMetrics.meshError = detail;
      window.dispatchEvent(new CustomEvent('pandolab:mesh-error', { detail }));
    }
  };
})();
