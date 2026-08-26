'use strict';

(() => {
  const BUILD_ID = '0.26.0';
  const ASSET_REVISION = '0.26.0-r1';
  const CACHE_RECOVERY_PARAM = '_aw_cache';
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
      : '내부 오류가 발생했습니다. 오류 코드 AW-BOOT-001을 확인하세요.';
    if (safeReason !== rawReason) console.error('[AW-BOOT-001]', rawReason);
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

  window.ATLASWRIGHT_ASSET_BASE_URL = assetBaseUrl.href;
  window.ATLASWRIGHT_BUILD_ID = BUILD_ID;
  window.ATLASWRIGHT_ASSET_REVISION = ASSET_REVISION;
  const loader = new Worker(versionedAsset('./workers/data-loader-worker.js'), {
    name: 'atlaswright-data-loader',
  });

  const onRuntimeError = event => fail(event?.detail || event?.reason?.message || event?.message || '애플리케이션 실행 오류');
  window.addEventListener('atlaswright:error', onRuntimeError, { once: true });
  window.addEventListener('atlaswright:ready', () => {
    loader.terminate();
    finish();
  }, { once: true });

  loader.onmessage = event => {
    const data = event.data || {};
    if (data.type === 'progress') {
      setProgress(data.message || '지도 데이터를 준비하는 중입니다.', data.percent || 0);
      return;
    }
    if (data.type === 'error') {
      loader.terminate();
      fail(data.message || '지도 데이터를 불러오지 못했습니다.');
      return;
    }
    if (data.type !== 'ready') return;
    if (data.buildId !== BUILD_ID) {
      loader.terminate();
      if (!recoverCacheMismatch()) fail(cacheMismatchMessage());
      return;
    }
    window.ATLASWRIGHT_COUNTRIES = data.countries;
    window.ATLASWRIGHT_GPU_MESH_BUFFER = data.meshBuffer;
    window.ATLASWRIGHT_LABEL_ANCHORS = data.labelAnchors || {};
    setProgress('지도 편집기를 시작하는 중입니다.', 97);
    const app = document.createElement('script');
    app.type = 'module';
    app.src = versionedAsset('./app.js').href;
    app.onload = () => setProgress('GPU 지도를 준비하는 중입니다.', 99);
    app.onerror = () => fail('애플리케이션 파일을 불러오지 못했습니다.');
    document.body.appendChild(app);
  };
  loader.onerror = event => {
    loader.terminate();
    fail(event.message || '데이터 Worker 실행 오류');
  };
})();
