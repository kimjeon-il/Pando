'use strict';

(() => {
  const BUILD_ID = '0.29.0';
  const ASSET_REVISION = '0.29.0-r3';
  const CACHE_RECOVERY_PARAM = '_pandolab_cache';
  const bootstrapScriptUrl = document.currentScript?.src || new URL('./assets/js/bootstrap.js', location.href).href;
  const assetBaseUrl = new URL('./', bootstrapScriptUrl);
  const overlay = document.getElementById('bootstrapLoading');
  const message = document.getElementById('bootstrapLoadingText');
  const progressBar = document.getElementById('bootstrapProgressBar');
  const appRoot = document.getElementById('app');
  const initialLayout = window.matchMedia('(max-width: 799px)').matches
    ? 'mobile'
    : window.matchMedia('(max-width: 1199px)').matches
      ? 'compact'
      : 'wide';
  const constrainedProfile = initialLayout === 'mobile'
    || Number(navigator.deviceMemory || 8) <= 4
    || Number(navigator.hardwareConcurrency || 8) <= 4;
  const bootStartedAt = performance.now();
  const startupMetrics = window.__PANDOLAB_STARTUP_METRICS__ = {
    buildId: BUILD_ID,
    assetRevision: ASSET_REVISION,
    profile: constrainedProfile ? 'constrained' : 'standard',
    startedAt: bootStartedAt,
    preview: null,
    canonical: null,
    interactiveMs: null,
    readyMs: null,
    canonicalError: '',
  };
  document.getElementById('app')?.setAttribute('data-layout', initialLayout);
  document.body.dataset.layout = initialLayout;

  function setProgress(text, percent = 0) {
    if (message) message.textContent = text;
    if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  }

  function fail(reason) {
    const rawReason = String(reason || '');
    const safeReason = /[가-힣]/.test(rawReason) && !/(Cannot read|undefined|null is not|is not a function|TypeError|ReferenceError|SyntaxError|RangeError|failed\b|\bat\s+\S+\s*\()/i.test(rawReason)
      ? rawReason
      : '내부 오류가 발생했습니다. 오류 코드 PL-BOOT-001을 확인하세요.';
    if (safeReason !== rawReason) console.error('[PL-BOOT-001]', rawReason);
    overlay?.classList.add('error');
    setProgress(`지도를 불러올 수 없습니다. ${safeReason}`, 100);
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

  window.PANDOLAB_ASSET_BASE_URL = assetBaseUrl.href;
  window.PANDOLAB_BUILD_ID = BUILD_ID;
  window.PANDOLAB_ASSET_REVISION = ASSET_REVISION;
  const loaderUrl = versionedAsset('./workers/data-loader-worker.js');
  loaderUrl.searchParams.set('profile', constrainedProfile ? 'constrained' : 'standard');
  const loader = new Worker(loaderUrl, {
    name: 'pandolab-data-loader',
  });
  let previewReady = false;
  let canonicalFailed = false;
  let appInjected = false;
  let resolveCanonicalData;
  window.PANDOLAB_CANONICAL_DATA_PROMISE = new Promise(resolve => { resolveCanonicalData = resolve; });

  const onRuntimeError = event => fail(event?.detail || event?.reason?.message || event?.message || '애플리케이션 실행 오류');
  window.addEventListener('pandolab:error', onRuntimeError, { once: true });
  window.addEventListener('pandolab:interactive', () => {
    startupMetrics.interactiveMs = performance.now() - bootStartedAt;
    startupMetrics.previewDisplayMs = Math.max(0, startupMetrics.interactiveMs - Number(startupMetrics.previewReceivedMs || 0));
    finish();
  }, { once: true });
  window.addEventListener('pandolab:ready', () => {
    startupMetrics.readyMs = performance.now() - bootStartedAt;
    startupMetrics.canonicalDisplayMs = Math.max(0, startupMetrics.readyMs - Number(startupMetrics.canonicalReceivedMs || 0));
    loader.terminate();
  }, { once: true });
  window.addEventListener('online', () => {
    if (!previewReady || !canonicalFailed) return;
    canonicalFailed = false;
    loader.postMessage({ type: 'retry-canonical' });
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
    if (data.type === 'canonical-progress') {
      window.dispatchEvent(new CustomEvent('pandolab:canonical-progress', { detail: data }));
      return;
    }
    if (data.type === 'canonical-error') {
      canonicalFailed = true;
      startupMetrics.canonicalError = data.message || '무손실 데이터를 준비하지 못했습니다.';
      window.dispatchEvent(new CustomEvent('pandolab:canonical-error', { detail: startupMetrics.canonicalError }));
      return;
    }
    if (!['preview-ready', 'canonical-ready'].includes(data.type)) return;
    if (data.buildId !== BUILD_ID) {
      loader.terminate();
      if (!recoverCacheMismatch()) fail(cacheMismatchMessage());
      return;
    }
    if (data.type === 'canonical-ready') {
      startupMetrics.canonical = data.metrics || null;
      startupMetrics.canonicalReceivedMs = performance.now() - bootStartedAt;
      startupMetrics.canonicalMainThreadTransferMs = Number.isFinite(Number(data.postedEpochMs))
        ? Math.max(0, performance.timeOrigin + performance.now() - Number(data.postedEpochMs))
        : null;
      resolveCanonicalData({
        countries: data.countries,
        countriesSourceBuffer: data.countriesSourceBuffer,
        meshBuffer: data.meshBuffer,
        metrics: data.metrics || null,
      });
      return;
    }
    previewReady = true;
    startupMetrics.preview = data.metrics || null;
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
    canonicalFailed = true;
    startupMetrics.canonicalError = event.message || '무손실 데이터 Worker 오류';
    window.dispatchEvent(new CustomEvent('pandolab:canonical-error', { detail: startupMetrics.canonicalError }));
  };
})();
