/** ReadinessNotifications: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createReadinessNotifications() {
  let dependencies;
  let CANONICAL_CONTROL_SELECTOR;
  let READINESS_INDEPENDENT_CONTROL_SELECTOR;
  let canonicalControls;
  let canonicalControlReadiness;
  let canonicalControlsRegistered;
  function connect(ports) {
    if (dependencies) throw new Error('readiness-notifications already connected');
    dependencies = ports;
  }

  function setCurrentTool() {
    syncStatusBar();
  }

  function syncStatusBar() {
    const selectedText = (0, dependencies.$)('selectionStatus')?.textContent?.trim() || '';
    const showSelection = !!dependencies.state.selected && !!selectedText;
    const projectionLabel = dependencies.state.projection === 'flat' ? '평면지도' : '지구본';
    if ((0, dependencies.$)('projectionStatus')) (0, dependencies.$)('projectionStatus').textContent = projectionLabel;
    (0, dependencies.$)('statusSelection')?.classList.toggle('hidden', !showSelection);
  }

  function clearNotification() {
    clearTimeout(setActionStatus._timer);
    const notice = (0, dependencies.$)('actionStatus');
    if (!notice) return;
    notice.classList.add('hidden');
    notice.classList.remove('working', 'success', 'error', 'info', 'warning');
    notice.classList.add('ready');
    notice.setAttribute('role', 'status');
    document.body.classList.remove('notification-visible');
  }

  function clearErrorNotification() {
    if ((0, dependencies.$)('actionStatus')?.classList.contains('error')) clearNotification();
  }

  function setActionStatus(message, tone = 'success', timeout = 1800) {
    const notice = (0, dependencies.$)('actionStatus');
    if (!notice) return;
    const fullMessage = String(message ?? '').replace(/\s+/g, ' ').trim();
    const visibleMessage = (0, dependencies.isMobile)()
      ? (0, dependencies.compactNotificationMessage)(fullMessage, { tone, maxLength: 22 })
      : fullMessage;
    clearTimeout(setActionStatus._timer);
    notice.classList.remove('hidden');
    notice.classList.remove('ready', 'working', 'success', 'error', 'info', 'warning');
    notice.classList.add(tone);
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    notice.setAttribute('aria-label', fullMessage);
    if (visibleMessage !== fullMessage) notice.dataset.tooltip = fullMessage;
    else delete notice.dataset.tooltip;
    const strong = notice.querySelector('strong');
    if (strong) strong.textContent = visibleMessage;
    document.body.classList.add('notification-visible');
    if (tone === 'error' || timeout <= 0) return;
    setActionStatus._timer = setTimeout(clearNotification, timeout);
  }

  function isReadinessIndependentControl(element) {
    return !!element?.matches?.(READINESS_INDEPENDENT_CONTROL_SELECTOR);
  }

  function syncLayerVisibilityToggle(input) {
    if (!input?.classList?.contains('layer-visibility-toggle')) return;
    const label = input.dataset.visibilityLabel || '레이어';
    input.dataset.tooltip = input.checked ? `${label} 숨기기` : `${label} 표시`;
  }

  function syncLayerVisibilityToggles(scope = document) {
    scope?.querySelectorAll?.('input.layer-visibility-toggle').forEach(syncLayerVisibilityToggle);
  }

  function syncCanonicalControls(scope = document) {
    const unavailable = !(0, dependencies.canMutateProject)(dependencies.state.dataReadiness);
    if (!canonicalControlsRegistered || scope !== document) {
      for (const element of scope.querySelectorAll(CANONICAL_CONTROL_SELECTOR)) canonicalControls.add(element);
      canonicalControlsRegistered = true;
    }
    (0, dependencies.$)('app')?.setAttribute('data-readiness', dependencies.state.dataReadiness);
    document.body.dataset.mapReadiness = dependencies.state.dataReadiness;
    for (const element of canonicalControls) {
      if (!element.isConnected) { canonicalControls.delete(element); continue; }
      if (canonicalControlReadiness.get(element) === unavailable) continue;
      canonicalControlReadiness.set(element, unavailable);
      if (isReadinessIndependentControl(element)) continue;
      if (unavailable) {
        if (!Object.hasOwn(element.dataset, 'readinessDisabled')) {
          element.dataset.readinessDisabled = String('disabled' in element && element.disabled);
          element.dataset.readinessAriaDisabled = element.hasAttribute('aria-disabled')
            ? String(element.getAttribute('aria-disabled'))
            : '';
        }
        if ('disabled' in element) element.disabled = true;
        element.setAttribute('aria-disabled', 'true');
        continue;
      }
      if (Object.hasOwn(element.dataset, 'readinessDisabled')) {
        if ('disabled' in element) element.disabled = element.dataset.readinessDisabled === 'true';
        const previousAria = element.dataset.readinessAriaDisabled;
        if (previousAria) element.setAttribute('aria-disabled', previousAria);
        else element.removeAttribute('aria-disabled');
        delete element.dataset.readinessDisabled;
        delete element.dataset.readinessAriaDisabled;
      }
    }
    syncLayerVisibilityToggles((0, dependencies.$)('layerSection'));
  }

  function setDataReadiness(value) {
    dependencies.state.dataReadiness = Object.values(dependencies.DATA_READINESS).includes(value) ? value : dependencies.DATA_READINESS.PREVIEW;
    syncCanonicalControls();
  }

  function applyDataReadinessEvent(event) {
    setDataReadiness((0, dependencies.transitionDataReadiness)(dependencies.state.dataReadiness, event));
  }

  function requireCanonicalData() {
    if ((0, dependencies.canMutateProject)(dependencies.state.dataReadiness)) return true;
    const message = dependencies.state.dataReadiness === dependencies.DATA_READINESS.ERROR
      ? '편집 데이터를 불러오지 못했습니다. 새로고침하세요.'
      : `편집 데이터 준비 중 · ${Math.round(dependencies.state.geometryProgress || 0)}%`;
    setActionStatus(message, dependencies.state.dataReadiness === dependencies.DATA_READINESS.ERROR ? 'error' : 'working', 2600);
    return false;
  }

  function blockUnavailableCanonicalAction(event) {
    if ((0, dependencies.canMutateProject)(dependencies.state.dataReadiness)) return;
    const target = event.target instanceof window.Element ? event.target.closest(CANONICAL_CONTROL_SELECTOR) : null;
    if (!target || isReadinessIndependentControl(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requireCanonicalData();
  }

  function isSafeKoreanErrorMessage(error) {
    const message = String(error?.message || '');
    if (!/[가-힣]/.test(message)) return false;
    return !/(Cannot read|undefined|null is not|is not a function|TypeError|ReferenceError|SyntaxError|RangeError|failed\b|\bat\s+\S+\s*\()/i.test(message);
  }

  function reportOperationError(error, fallbackMessage, code, timeout = 4400) {
    console.error(`[${code}]`, error);
    const detail = isSafeKoreanErrorMessage(error) ? String(error.message).trim() : '';
    const hasRecoveryAction = /(선택|확인|입력|이동|조정|해제|새로고침|다시 시도|다시 그리)하세요\.$/.test(detail);
    const fallbackSummary = String(fallbackMessage || '').split(/(?<=[.!?])\s+/u)[0];
    const message = detail
      ? (hasRecoveryAction ? detail : `${detail} · ${code}`)
      : `${fallbackSummary} · ${code}`;
    setActionStatus(message, 'error', timeout);
  }

  function createGisImportError(userMessage, {
    category = dependencies.RELIABILITY_ERROR_CATEGORIES.TRANSACTION,
    objectIds = [],
    technicalMessage = '',
    cause = null,
    code = 'PL-GIS-001',
  } = {}) {
    return (0, dependencies.createOperationalError)({
      code,
      category,
      userMessage,
      technicalMessage: technicalMessage || cause?.message || userMessage,
      objectIds,
      operationType: 'gis-import',
      cause,
    });
  }

  function reportGisImportError(error, { rollback = '' } = {}) {
    const code = String(error?.code || 'PL-GIS-001');
    const objectIds = [...new Set((error?.objectIds || []).map(String).filter(Boolean))];
    const technicalMessage = String(error?.message || error || 'GIS import failed');
    console.error(`[${code}]`, {
      operation: error?.operationType || 'gis-import',
      objectIds,
      rollback,
    }, error);
    dependencies.reliabilityDiagnostic.push({
      category: error?.category || 'gis',
      operation: error?.operationType || 'gis-import',
      objectIds,
      result: 'failed',
      errorCode: code,
      technicalMessage,
      stack: error?.stack || '',
      rollback,
    });
    const hasSpecificUserMessage = !!String(error?.userMessage || '').trim() || isSafeKoreanErrorMessage(error);
    const userMessage = String(error?.userMessage || '').trim()
      || (isSafeKoreanErrorMessage(error) ? technicalMessage.trim() : '파일을 불러오지 못했습니다. 파일 형식과 구성을 확인하세요.');
    setActionStatus(hasSpecificUserMessage ? userMessage : `${userMessage} · ${code}`, 'error', 5600);
  }

  function showFatalError(error) {
    if ((0, dependencies.isAbortError)(error)) return;
    console.error('[PL-RUNTIME-001]', error);
    const message = isSafeKoreanErrorMessage(error)
      ? String(error.message).trim()
      : '내부 오류로 판도연구소를 시작할 수 없습니다. 오류 코드 PL-RUNTIME-001을 확인하세요.';
    let box = document.getElementById('fatalErrorBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fatalErrorBox';
      box.className = 'fatal-runtime-message';
      document.body.appendChild(box);
    }
    box.textContent = `판도연구소를 시작할 수 없습니다.\n${message}\n\n페이지를 새로고침하세요. 문제가 계속되면 오류 코드를 확인하세요.`;
    (window.__PANDOLAB_STARTUP_METRICS__ ||= {}).rendererStatus = '실행 오류';
  }

  function handleUnexpectedRuntimeError(error) {
    if ((0, dependencies.isAbortError)(error)) return;
    if (!dependencies.runtimeReady) {
      showFatalError(error);
      return;
    }
    console.error('[PL-RUNTIME-001]', error);
    setActionStatus('작업 실패 · PL-RUNTIME-001', 'error', 0);
  }

  function initializeCANONICAL_CONTROL_SELECTOR() {
    (CANONICAL_CONTROL_SELECTOR = [
      '#createMenu .create-menu-item',
      '#rightPanel input', '#rightPanel select', '#rightPanel textarea',
      '#rightPanel button:not(.sheet-close-btn):not(#focusSelectedObjectBtn)',
      '.top-actions button', '.top-actions input',
      '#undoBtn', '#redoBtn',
      '.layer-child-menu', '.layer-folder-lock', '.layer-style-toggle',
      '[data-layer-style-opacity]', '[data-layer-style-boundary]', '[data-layer-style-blend-mode]',
      '.layer-folder input[type="checkbox"]', '#labelsVisible', '#basemapLabelsVisible',
    ].join(','));

    (READINESS_INDEPENDENT_CONTROL_SELECTOR = [
      '.layer-visibility-toggle',
      '.layer-style-toggle',
      '[data-layer-style-opacity]',
      '[data-layer-style-boundary]',
      '[data-layer-style-blend-mode]',
      '#terrainVisible',
      'input[name="terrainStyle"]',
      '#labelsVisible',
      '#basemapLabelsVisible',
    ].join(','));

    (canonicalControls = new Set());

    (canonicalControlReadiness = new WeakMap());

    (canonicalControlsRegistered = false);

    document.addEventListener('click', blockUnavailableCanonicalAction, true);

    document.addEventListener('change', blockUnavailableCanonicalAction, true);

    window.addEventListener('error', event => {
      const error = event.error || event.message;
      if ((0, dependencies.isAbortError)(error)) {
        event.preventDefault();
        return;
      }
      handleUnexpectedRuntimeError(error);
    });

    window.addEventListener('unhandledrejection', event => {
      if ((0, dependencies.isAbortError)(event.reason)) {
        event.preventDefault();
        return;
      }
      handleUnexpectedRuntimeError(event.reason);
    });
  }

  return Object.freeze({
    connect,
    initializeCANONICAL_CONTROL_SELECTOR,
    get applyDataReadinessEvent() { return applyDataReadinessEvent; },
    get clearErrorNotification() { return clearErrorNotification; },
    get clearNotification() { return clearNotification; },
    get createGisImportError() { return createGisImportError; },
    get isSafeKoreanErrorMessage() { return isSafeKoreanErrorMessage; },
    get reportGisImportError() { return reportGisImportError; },
    get reportOperationError() { return reportOperationError; },
    get requireCanonicalData() { return requireCanonicalData; },
    get setActionStatus() { return setActionStatus; },
    get setCurrentTool() { return setCurrentTool; },
    get showFatalError() { return showFatalError; },
    get syncCanonicalControls() { return syncCanonicalControls; },
    get syncLayerVisibilityToggle() { return syncLayerVisibilityToggle; },
    get syncStatusBar() { return syncStatusBar; },
  });
}
