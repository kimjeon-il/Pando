'use strict';

(() => {
  const BUILD_ID = '0.30.0';
  const ASSET_REVISION = '0.30.0-r32';
  const CACHE_RECOVERY_PARAM = '_pandolab_cache';
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
  const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__ = {
    buildId: BUILD_ID,
    assetRevision: ASSET_REVISION,
    signals: startupSignals,
    loadPolicy: null,
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

  function installPhaseOneUiCleanup() {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = versionedAsset('../css/phase1-ui-cleanup.css').href;
    style.dataset.pandolabPhase = 'ui-cleanup-1';
    document.head.appendChild(style);

    window.addEventListener('pandolab:interactive', () => {
      import(versionedAsset('./modules/phase1-ui-cleanup.js').href)
        .then(module => module.applyPhase1UiCleanup?.())
        .catch(error => console.error('[PL-UI-CLEANUP-001]', error));
    }, { once: true });
  }

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

  if (appRoot?.dataset.appVersion !== BUILD_ID) {
    if (!recoverCacheMismatch()) fail(cacheMismatchMessage());
    return;
  }

  installPhaseOneUiCleanup();

  window.PANDOLAB_ASSET_BASE_URL = assetBaseUrl.href;
  window.PANDOLAB_BUILD_ID = BUILD_ID;
  window.PANDOLAB_ASSET_REVISION = ASSET_REVISION;
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
  window.PANDOLAB_CANONICAL_DATA_PROMISE = Promise.all([
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
    finish();
  }, { once: true });
  window.addEventListener('pandolab:editable', event => {
    startupMetrics.editableMs = performance.now() - bootStartedAt;
    startupMetrics.geometryDisplayMs = Math.max(0, startupMetrics.editableMs - Number(startupMetrics.geometryReceivedMs || 0));
    if (event?.detail?.useBuiltInMesh === false) loader.postMessage({ type: 'cancel-mesh' });
    else loader.postMessage({ type: 'geometry-applied' });
  }, { once: true });
  window.addEventListener('pandolab:ready', () => {
    startupMetrics.readyMs = performance.now() - bootStartedAt;
    startupMetrics.meshDisplayMs = Math.max(0, startupMetrics.readyMs - Number(startupMetrics.meshReceivedMs || 0));
    loader.terminate();
  }, { once: true });
  window.addEventListener('online', () => {
    if (!previewReady) return;
    if (geometryFailed && !geometryReady) {
      geometryFailed = false;
      loader.postMessage({ type: 'retry-geometry' });
    }
    if (meshFailed && geometryReady && !meshReady) {
      meshFailed = false;
      loader.postMessage({ type: 'retry-mesh' });
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
    if (data.buildId !== BUILD_ID) {
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
      startupMetrics.geometryMainThreadTransferMs = Number.isFinite(Number(data.postedEpochMs))
        ? Math.max(0, performance.timeOrigin + performance.now() - Number(data.postedEpochMs))
        : null;
      resolveGeometry({ countries: data.countries, countriesSourceBuffer: data.countriesSourceBuffer, metrics: data.metrics || null });
      return;
    }
    if (data.type === 'mesh-ready') {
      meshReady = true;
      meshFailed = false;
      startupMetrics.mesh = data.metrics || null;
      startupMetrics.loadPolicy = data.metrics?.policy || startupMetrics.loadPolicy;
      startupMetrics.meshReceivedMs = performance.now() - bootStartedAt;
      startupMetrics.meshMainThreadTransferMs = Number.isFinite(Number(data.postedEpochMs))
        ? Math.max(0, performance.timeOrigin + performance.now() - Number(data.postedEpochMs))
        : null;
      resolveMesh({ meshBuffer: data.meshBuffer, metrics: data.metrics || null });
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
