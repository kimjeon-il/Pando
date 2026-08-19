'use strict';

(() => {
  const bootstrapScriptUrl = document.currentScript?.src || new URL('./assets/js/bootstrap.js', location.href).href;
  const assetBaseUrl = new URL('./', bootstrapScriptUrl);
  const overlay = document.getElementById('bootstrapLoading');
  const message = document.getElementById('bootstrapLoadingText');
  const progressBar = document.getElementById('bootstrapProgressBar');
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
    overlay?.classList.add('error');
    setProgress(`지도 로드 실패: ${reason}`, 100);
    document.body.classList.add('is-loading');
    const actionText = document.querySelector('#actionStatus strong');
    if (actionText) actionText.textContent = '지도 데이터 로드 실패';
  }

  function finish() {
    setProgress('지도 준비 완료', 100);
    overlay?.setAttribute('hidden', '');
    document.body.classList.remove('is-loading');
  }

  if (location.protocol === 'file:') {
    fail('직접 파일 열기는 지원하지 않습니다. GitHub Pages 또는 로컬 HTTP 서버를 사용해 주세요.');
    return;
  }

  window.ATLASWRIGHT_ASSET_BASE_URL = assetBaseUrl.href;
  const loader = new Worker(new URL('./workers/data-loader-worker.js', assetBaseUrl), {
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
      setProgress(data.message || '지도 데이터 준비 중', data.percent || 0);
      return;
    }
    if (data.type === 'error') {
      loader.terminate();
      fail(data.message || '지도 데이터를 불러오지 못했습니다.');
      return;
    }
    if (data.type !== 'ready') return;
    window.ATLASWRIGHT_COUNTRIES = data.countries;
    window.ATLASWRIGHT_GPU_MESH_BUFFER = data.meshBuffer;
    window.ATLASWRIGHT_LABEL_ANCHORS = data.labelAnchors || {};
    setProgress('지도 편집기 시작 중', 97);
    const app = document.createElement('script');
    app.src = new URL('./app.js', assetBaseUrl).href;
    app.onload = () => setProgress('GPU 지도 준비 중', 99);
    app.onerror = () => fail('애플리케이션 파일을 불러오지 못했습니다.');
    document.body.appendChild(app);
  };
  loader.onerror = event => {
    loader.terminate();
    fail(event.message || '데이터 Worker 실행 오류');
  };
})();
